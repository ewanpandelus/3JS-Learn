import * as THREE from 'three';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

const DEFAULT_TERRAIN_SETTINGS = {
  width: 14,
  depth: 14,
  segments: 180,
  amplitude: 1.5,
  frequency: 1.1,
  octaves: 5,
  lacunarity: 2,
  persistence: 0.5,
  seed: 1337,
  wireframe: false,
  colorLow: '#304a33',
  colorHigh: '#b6c391'
};

const DEFAULT_LIGHT_DIRECTION = new THREE.Vector3(0.45, 1.0, 0.3).normalize();

/**
 * Builds a deterministic pseudo-random generator from an integer seed.
 * Inputs: `seed` integer used to initialize generator state.
 * Outputs: function returning a float in [0, 1) each call, no side effects outside closure.
 * Internal: uses a mulberry32-style bit-mixing sequence to evolve and emit random values.
 */
function createSeededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Samples layered fractal terrain noise at one 2D coordinate.
 * Inputs: `noise2D` simplex function, `x` and `z` coordinates, and tuning params.
 * Outputs: terrain height scalar, no side effects.
 * Internal: accumulates octaves with increasing frequency and decreasing amplitude.
 */
function sampleTerrainHeight(noise2D, x, z, { frequency, octaves, lacunarity, persistence }) {
  let amplitude = 1;
  let currentFrequency = frequency;
  let total = 0;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += noise2D(x * currentFrequency, z * currentFrequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    currentFrequency *= lacunarity;
  }

  return maxAmplitude === 0 ? 0 : total / maxAmplitude;
}

/**
 * Rebuilds vertex heights for procedural terrain and normalized-height attributes.
 * Inputs: `geometry`, `settings`, and mutable `scratch` object for cached arrays/range.
 * Outputs: mutates vertex positions plus `aHeightNorm` attribute data; recomputes normals.
 * Internal: samples seeded fBm noise per vertex, records min/max, then normalizes heights into a shader-readable attribute.
 */
function rebuildTerrainHeights(geometry, settings, scratch) {
  const seededRandom = createSeededRandom(settings.seed);
  const noise2D = createNoise2D(seededRandom);
  const positions = geometry.attributes.position;
  scratch.minHeight = Number.POSITIVE_INFINITY;
  scratch.maxHeight = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const baseHeight = sampleTerrainHeight(noise2D, x, z, settings);
    const y = baseHeight * settings.amplitude;
    scratch.heights[i] = y;
    scratch.minHeight = Math.min(scratch.minHeight, y);
    scratch.maxHeight = Math.max(scratch.maxHeight, y);
    positions.setY(i, y);
  }

  const invHeightRange =
    scratch.maxHeight === scratch.minHeight ? 0 : 1 / (scratch.maxHeight - scratch.minHeight);
  const normalizedHeights = scratch.normalizedHeights;
  for (let i = 0; i < positions.count; i += 1) {
    normalizedHeights[i] =
      invHeightRange === 0 ? 0.5 : (scratch.heights[i] - scratch.minHeight) * invHeightRange;
  }

  geometry.attributes.aHeightNorm.needsUpdate = true;
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Applies terrain color controls directly to shader uniforms.
 * Inputs: `material` shader material and current color settings object.
 * Outputs: mutates shader uniforms for low/high terrain colors.
 * Internal: updates persistent color uniform vectors so recoloring is GPU-side only.
 */
function applyShaderColors(material, settings) {
  material.uniforms.uColorLow.value.set(settings.colorLow);
  material.uniforms.uColorHigh.value.set(settings.colorHigh);
}

/**
 * Creates a procedural terrain mesh with runtime-update hooks.
 * Inputs: optional `overrides` object matching terrain settings keys.
 * Outputs: object with `mesh`, `settings`, and `update(nextSettings)` for live regeneration.
 * Internal: builds a rotated plane mesh, applies seeded noise displacement, and re-runs generation on setting updates.
 */
export function createTerrainRenderer(overrides = {}) {
  const settings = { ...DEFAULT_TERRAIN_SETTINGS, ...overrides };
  const geometry = new THREE.PlaneGeometry(
    settings.width,
    settings.depth,
    settings.segments,
    settings.segments
  );
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColorLow: { value: new THREE.Color(settings.colorLow) },
      uColorHigh: { value: new THREE.Color(settings.colorHigh) },
      uLightDir: { value: DEFAULT_LIGHT_DIRECTION.clone() }
    },
    wireframe: settings.wireframe,
    vertexShader: `
      attribute float aHeightNorm;
      varying float vHeightNorm;
      varying vec3 vWorldNormal;

      void main() {
        vHeightNorm = aHeightNorm;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColorLow;
      uniform vec3 uColorHigh;
      uniform vec3 uLightDir;

      varying float vHeightNorm;
      varying vec3 vWorldNormal;

      void main() {
        vec3 baseColor = mix(uColorLow, uColorHigh, clamp(vHeightNorm, 0.0, 1.0));
        float diffuse = max(dot(normalize(vWorldNormal), normalize(uLightDir)), 0.0);
        float light = 0.35 + diffuse * 0.65;
        gl_FragColor = vec4(baseColor * light, 1.0);
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const scratch = {
    heights: new Float32Array(geometry.attributes.position.count),
    normalizedHeights: new Float32Array(geometry.attributes.position.count),
    minHeight: 0,
    maxHeight: 0
  };
  geometry.setAttribute('aHeightNorm', new THREE.BufferAttribute(scratch.normalizedHeights, 1));
  rebuildTerrainHeights(geometry, settings, scratch);
  applyShaderColors(material, settings);

  /**
   * Updates terrain settings and re-generates mesh data/material state.
   * Inputs: `nextSettings` partial settings object with numeric/material toggles.
   * Outputs: mutates settings, geometry, and material for immediate visual update.
   * Internal: merges settings, reapplies wireframe flag, then rebuilds displacement and colors.
   */
  function update(nextSettings) {
    const previousSettings = { ...settings };
    Object.assign(settings, nextSettings);
    material.wireframe = settings.wireframe;
    const geometryDirty =
      settings.seed !== previousSettings.seed ||
      settings.frequency !== previousSettings.frequency ||
      settings.octaves !== previousSettings.octaves ||
      settings.lacunarity !== previousSettings.lacunarity ||
      settings.persistence !== previousSettings.persistence ||
      settings.amplitude !== previousSettings.amplitude;

    const colorDirty =
      settings.colorLow !== previousSettings.colorLow ||
      settings.colorHigh !== previousSettings.colorHigh;

    if (geometryDirty) {
      rebuildTerrainHeights(geometry, settings, scratch);
      applyShaderColors(material, settings);
      return;
    }

    if (colorDirty) {
      applyShaderColors(material, settings);
    }
  }

  return {
    mesh,
    settings,
    update
  };
}
