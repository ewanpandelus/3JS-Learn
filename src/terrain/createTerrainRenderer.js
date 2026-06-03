import * as THREE from 'three';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';
import { TERRAIN_DEPTH, TERRAIN_SEGMENTS, TERRAIN_WIDTH } from '../config/worldExtents.js';
import {
  createDefaultTerrainLayer,
  DEFAULT_BASE_LAYER,
  DEFAULT_ISLAND_SETTINGS,
  normalizeTerrainSettings
} from './terrainLayers.js';
/** Normalized radius of full-strength dry land before the shore rise band. */
const ISLAND_CORE_RADIUS = 0.44;
/** Normalized mesh radius where submerged shelf begins (narrow band = steeper shore). */
const ISLAND_WATER_ENVELOPE_START = 0.56;
/** Normalized mesh radius where the shelf is fully below sea level. */
const ISLAND_WATER_ENVELOPE_END = 0.7;
/** Exponent applied to land mask; values above 1 steepen the pop-up from water to dry land. */
const ISLAND_LAND_RISE_SHARPNESS = 2.4;
/** Minimum dry land height above the water plane at the island peak (world-local y). */
const ISLAND_LAND_BASE_HEIGHT = 0.42;
/** Shelf depth below the water plane on submerged perimeter vertices (world-local y). */
const ISLAND_SHELF_SUBMERGE_DEPTH = 0.55;
/** Lowest hills on dry land as a fraction of amplitude (avoids flat zero-clamped valleys). */
const ISLAND_NOISE_HEIGHT_FLOOR = 0.22;
/** Seed offset for dedicated coastline edge noise. */
const EDGE_NOISE_SEED_OFFSET = 4242;
/** fBm octave count for coastline edge noise. */
const EDGE_NOISE_OCTAVES = 3;
/** fBm lacunarity for coastline edge noise. */
const EDGE_NOISE_LACUNARITY = 2;
/** fBm persistence for coastline edge noise. */
const EDGE_NOISE_PERSISTENCE = 0.5;
const TERRAIN_SEA_LEVEL = -0.18;
const TERRAIN_PERSISTENCE = 0.5;
const TERRAIN_SEED = 1337;
const TERRAIN_ROUGHNESS = 0.92;
const TERRAIN_METALNESS = 0.04;

const DEFAULT_TERRAIN_SETTINGS = {
  width: TERRAIN_WIDTH,
  depth: TERRAIN_DEPTH,
  segments: TERRAIN_SEGMENTS,
  seaLevel: TERRAIN_SEA_LEVEL,
  seed: TERRAIN_SEED,
  mountainSeed: TERRAIN_SEED,
  baseLayer: { ...DEFAULT_BASE_LAYER },
  island: { ...DEFAULT_ISLAND_SETTINGS },
  layers: [createDefaultTerrainLayer(0)],
  colorLow: '#304a33',
  colorHigh: '#b6c391'
};

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
 * Island plateau texture height from fBm noise (base layer only).
 * Inputs: `noise2D` simplex function, `x` and `z` coordinates, and `baseLayer` noise params.
 * Outputs: non-negative height offset for island surface texture.
 * Internal: remaps noise to [floor, 1] × baseLayer.amplitude so amplitude scales detail not bulk.
 */
function sampleBaseLayerHeight(noise2D, x, z, baseLayer) {
  const noise = sampleTerrainHeight(noise2D, x, z, baseLayer);
  const normalized = noise * 0.5 + 0.5;
  const relief = ISLAND_NOISE_HEIGHT_FLOOR + (1 - ISLAND_NOISE_HEIGHT_FLOOR) * normalized;
  return relief * baseLayer.amplitude;
}

/**
 * Mountain layer displacement from bipolar fBm noise.
 * Inputs: `noise2D` simplex function, `x` and `z` coordinates, and one mountain `layer` config.
 * Outputs: signed height offset where `layer.amplitude` scales peaks/valleys only.
 * Internal: samples offset UV per layer; does not remap to [0, 1] so amplitude is true noise scale.
 */
function sampleMountainLayerHeight(noise2D, x, z, layer) {
  const sampleX = x + layer.offsetX;
  const sampleZ = z + layer.offsetZ;
  const noise = sampleTerrainHeight(noise2D, sampleX, sampleZ, layer);
  return noise * layer.amplitude;
}

/**
 * Water-envelope mask from normalized distance to terrain center.
 * Inputs: `x` and `z` vertex coordinates, `halfWidth` and `halfDepth` mesh half-extents.
 * Outputs: multiplier in [0, 1] (0 dry center, 1 submerged shelf at mesh edge).
 * Internal: full submerge outside envelope end; smooth shelf blend only in the start–end band.
 */
function waterEnvelopeMask(x, z, halfWidth, halfDepth) {
  const radialDistance = Math.hypot(x / halfWidth, z / halfDepth);
  if (radialDistance >= ISLAND_WATER_ENVELOPE_END) {
    return 1;
  }
  if (radialDistance <= ISLAND_WATER_ENVELOPE_START) {
    return 0;
  }
  const fadeSpan = ISLAND_WATER_ENVELOPE_END - ISLAND_WATER_ENVELOPE_START;
  const fadeT = (radialDistance - ISLAND_WATER_ENVELOPE_START) / fadeSpan;
  const clampedT = Math.max(0, Math.min(1, fadeT));
  return clampedT * clampedT * (3 - 2 * clampedT);
}

/**
 * Dry-land mask from normalized distance to terrain center.
 * Inputs: `x` and `z` vertex coordinates, `halfWidth` and `halfDepth` mesh half-extents.
 * Outputs: multiplier in [0, 1] (1 on the core, steep falloff through the shore band).
 * Internal: flat core plateau then sharp power curve on the complement of the water envelope.
 */
function islandLandMask(x, z, halfWidth, halfDepth) {
  const radialDistance = Math.hypot(x / halfWidth, z / halfDepth);
  if (radialDistance <= ISLAND_CORE_RADIUS) {
    return 1;
  }
  const envelope = waterEnvelopeMask(x, z, halfWidth, halfDepth);
  const landMask = 1 - envelope;
  return landMask ** ISLAND_LAND_RISE_SHARPNESS;
}

/**
 * Mask peaking along the island shore band where edge noise should apply.
 * Inputs: `x` and `z` vertex coordinates, `halfWidth` and `halfDepth` mesh half-extents.
 * Outputs: multiplier in [0, 1] (0 in core and open water, peak mid-coast).
 * Internal: sine bell across radial span from core radius to water envelope end.
 */
function coastalEdgeMask(x, z, halfWidth, halfDepth) {
  const radialDistance = Math.hypot(x / halfWidth, z / halfDepth);
  if (radialDistance <= ISLAND_CORE_RADIUS || radialDistance >= ISLAND_WATER_ENVELOPE_END) {
    return 0;
  }
  const shoreSpan = ISLAND_WATER_ENVELOPE_END - ISLAND_CORE_RADIUS;
  const shoreT = (radialDistance - ISLAND_CORE_RADIUS) / shoreSpan;
  return Math.sin(Math.PI * shoreT);
}

/**
 * Vertical coastline wobble from bipolar fBm noise.
 * Inputs: `noise2D` simplex function, `x` and `z` coordinates, and `island` edge noise settings.
 * Outputs: signed height offset scaled by `edgeNoiseAmplitude`.
 * Internal: uses fixed fBm octaves; frequency comes from island settings.
 */
function sampleCoastalEdgeNoise(noise2D, x, z, island) {
  if (island.edgeNoiseAmplitude <= 0) {
    return 0;
  }
  const noise = sampleTerrainHeight(noise2D, x, z, {
    frequency: island.edgeNoiseFrequency,
    octaves: EDGE_NOISE_OCTAVES,
    lacunarity: EDGE_NOISE_LACUNARITY,
    persistence: EDGE_NOISE_PERSISTENCE
  });
  return noise * island.edgeNoiseAmplitude;
}

/**
 * Rebuilds vertex heights for simple layered-noise terrain.
 * Inputs: `geometry`, `settings`, and mutable `scratch` object for cached arrays/range.
 * Outputs: updates vertex y positions and normalized height attribute; recomputes normals.
 * Internal: island envelope base, optional plateau texture, then stacked mountain layer displacements.
 */
function rebuildTerrainHeights(geometry, settings, scratch) {
  const seededRandom = createSeededRandom(settings.seed);
  const baseNoise2D = createNoise2D(seededRandom);
  const edgeNoise2D = createNoise2D(createSeededRandom(settings.seed + EDGE_NOISE_SEED_OFFSET));
  scratch.layerNoise2D = settings.layers.map((layer) =>
    createNoise2D(createSeededRandom(settings.mountainSeed + layer.seedOffset))
  );
  const positions = geometry.attributes.position;
  scratch.minHeight = Number.POSITIVE_INFINITY;
  scratch.maxHeight = Number.NEGATIVE_INFINITY;

  const halfWidth = settings.width * 0.5;
  const halfDepth = settings.depth * 0.5;
  const baseX = scratch.baseX;
  const baseZ = scratch.baseZ;
  for (let i = 0; i < positions.count; i += 1) {
    const x = baseX[i];
    const z = baseZ[i];
    const envelope = waterEnvelopeMask(x, z, halfWidth, halfDepth);
    const landMask = islandLandMask(x, z, halfWidth, halfDepth);
    let y = landMask * ISLAND_LAND_BASE_HEIGHT;
    y += landMask * sampleBaseLayerHeight(baseNoise2D, x, z, settings.baseLayer);

    for (let layerIndex = 0; layerIndex < settings.layers.length; layerIndex += 1) {
      const layer = settings.layers[layerIndex];
      if (!layer.enabled) {
        continue;
      }
      const mountainHeight = sampleMountainLayerHeight(
        scratch.layerNoise2D[layerIndex],
        x,
        z,
        layer
      );
      y += landMask * mountainHeight * landMask;
    }

    const edgeMask = coastalEdgeMask(x, z, halfWidth, halfDepth);
    y += edgeMask * sampleCoastalEdgeNoise(edgeNoise2D, x, z, settings.island);

    y -= envelope * ISLAND_SHELF_SUBMERGE_DEPTH;
    scratch.heights[i] = y;
  }

  for (let i = 0; i < positions.count; i += 1) {
    const y = scratch.heights[i];
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
  geometry.attributes.normal.needsUpdate = true;
}

/**
 * Applies terrain shader color uniforms from current terrain settings.
 * Inputs: `material` terrain material and current settings object.
 * Outputs: updates color uniforms in the material shader hook.
 * Internal: writes values into `onBeforeCompile`-injected uniforms when shader is available.
 */
function applyShaderColors(material, settings) {
  const shader = material.userData.shader;
  if (!shader) {
    return;
  }

  shader.uniforms.uColorLow.value.set(settings.colorLow);
  shader.uniforms.uColorHigh.value.set(settings.colorHigh);
}

/**
 * Creates a procedural terrain mesh with runtime-update hooks.
 * Inputs: optional `overrides` object matching terrain settings keys.
 * Outputs: object with `mesh`, `settings`, and `update(nextSettings)` for live regeneration.
 * Internal: builds a rotated plane mesh, applies seeded noise displacement, and re-runs generation on setting updates.
 */
export function createTerrainRenderer(overrides = {}) {
  const settings = normalizeTerrainSettings({ ...DEFAULT_TERRAIN_SETTINGS, ...overrides });
  const geometry = new THREE.PlaneGeometry(
    settings.width,
    settings.depth,
    settings.segments,
    settings.segments
  );
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    roughness: TERRAIN_ROUGHNESS,
    metalness: TERRAIN_METALNESS
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uColorLow = { value: new THREE.Color(settings.colorLow) };
    shader.uniforms.uColorHigh = { value: new THREE.Color(settings.colorHigh) };
    material.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
        #include <common>
        attribute float aHeightNorm;
        varying float vHeightNorm;
        `
      )
      .replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vHeightNorm = aHeightNorm;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
        #include <common>
        uniform vec3 uColorLow;
        uniform vec3 uColorHigh;
        varying float vHeightNorm;
        `
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `
        vec3 terrainColor = mix(uColorLow, uColorHigh, clamp(vHeightNorm, 0.0, 1.0));
        vec4 diffuseColor = vec4(terrainColor, opacity);
        `
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const scratch = {
    heights: new Float32Array(geometry.attributes.position.count),
    normalizedHeights: new Float32Array(geometry.attributes.position.count),
    baseX: new Float32Array(geometry.attributes.position.count),
    baseZ: new Float32Array(geometry.attributes.position.count),
    minHeight: 0,
    maxHeight: 0
  };
  for (let i = 0; i < geometry.attributes.position.count; i += 1) {
    scratch.baseX[i] = geometry.attributes.position.getX(i);
    scratch.baseZ[i] = geometry.attributes.position.getZ(i);
  }
  geometry.setAttribute('aHeightNorm', new THREE.BufferAttribute(scratch.normalizedHeights, 1));
  rebuildTerrainHeights(geometry, settings, scratch);
  applyShaderColors(material, settings);

  /**
   * Updates terrain settings and re-generates mesh data/material state.
   * Inputs: `nextSettings` partial settings object with numeric/material toggles.
   * Outputs: mutates settings, geometry, and material for immediate visual update.
   * Internal: merges settings, then selectively rebuilds geometry or only recolors when needed.
   */
  function update(nextSettings) {
    const previousSettings = JSON.parse(JSON.stringify(settings));
    Object.assign(settings, normalizeTerrainSettings({ ...settings, ...nextSettings }));
    const geometryDirty =
      settings.seed !== previousSettings.seed ||
      settings.mountainSeed !== previousSettings.mountainSeed ||
      JSON.stringify(settings.baseLayer) !== JSON.stringify(previousSettings.baseLayer) ||
      JSON.stringify(settings.island) !== JSON.stringify(previousSettings.island) ||
      JSON.stringify(settings.layers) !== JSON.stringify(previousSettings.layers);

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
