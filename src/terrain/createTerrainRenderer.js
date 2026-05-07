import * as THREE from 'three';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

const DEFAULT_TERRAIN_SETTINGS = {
  width: 14,
  depth: 14,
  segments: 180,
  amplitude: 1.1,
  seaLevel: -0.18,
  islandRadius: 0.56,
  islandFalloff: 0.38,
  borderFadeStart: 0.72,
  borderDepth: 1.85,
  coastalShelf: 0.1,
  slopeSmoothing: 0.56,
  edgeWarpStart: 0.68,
  edgeWarpStrength: 1.05,
  edgeWarpFrequency: 0.42,
  frequency: 1.1,
  octaves: 5,
  lacunarity: 2,
  persistence: 0.5,
  seed: 1337,
  wireframe: false,
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
 * Builds a radial island mask where center is elevated and edges sink.
 * Inputs: normalized `distanceFromCenter`, `islandRadius`, and `islandFalloff`.
 * Outputs: scalar mask in [0, 1], where 1 keeps full height and 0 suppresses terrain.
 * Internal: uses a smoothstep transition from island plateau into ocean falloff.
 */
function sampleIslandMask(distanceFromCenter, islandRadius, islandFalloff) {
  const edgeStart = Math.max(0.01, islandRadius);
  const edgeEnd = Math.max(edgeStart + 0.001, islandRadius + islandFalloff);
  const t = THREE.MathUtils.clamp((distanceFromCenter - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

/**
 * Builds a square-border fade mask to sink geometry near terrain bounds.
 * Inputs: normalized coordinate extents `nx`/`nz` and border tuning values.
 * Outputs: scalar sink factor in [0, 1], where 1 means fully at map edge.
 * Internal: measures max axis distance from center and applies smoothstep near outer bounds.
 */
function sampleBorderSink(nx, nz, borderFadeStart) {
  const edgeDistance = Math.max(Math.abs(nx), Math.abs(nz));
  const t = THREE.MathUtils.clamp((edgeDistance - borderFadeStart) / (1 - borderFadeStart), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes a smooth edge-warp factor for vertices near the map boundary.
 * Inputs: normalized `nx`/`nz` vertex coordinates and `edgeWarpStart` threshold.
 * Outputs: scalar in [0, 1] used to drive horizontal boundary distortion.
 * Internal: derives distance to square edge and applies smoothstep from inner-safe area to outer boundary.
 */
function sampleEdgeWarpFactor(nx, nz, edgeWarpStart) {
  const edgeDistance = Math.max(Math.abs(nx), Math.abs(nz));
  const t = THREE.MathUtils.clamp((edgeDistance - edgeWarpStart) / (1 - edgeWarpStart), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes a shoreline relief scale to reduce steep coastal cliffs.
 * Inputs: `islandMask` in [0,1] and `coastalShelf` tuning value.
 * Outputs: scalar multiplier in [0.22, 1] applied to terrain relief.
 * Internal: increases relief suppression near shoreline, with stronger suppression as shelf depth increases.
 */
function sampleShoreReliefScale(islandMask, coastalShelf) {
  const shoreline = 1 - islandMask;
  const shelfInfluence = THREE.MathUtils.clamp(coastalShelf * 1.35, 0.08, 0.95);
  const coastalWeight = THREE.MathUtils.clamp(shoreline * (0.55 + shelfInfluence), 0, 1);
  const smooth = coastalWeight * coastalWeight * (3 - 2 * coastalWeight);
  return THREE.MathUtils.lerp(1, 0.22, smooth);
}

/**
 * Computes how strongly terrain should flatten near coastline/ocean bands.
 * Inputs: `islandMask` in [0,1] where lower values are farther from island center.
 * Outputs: flatten blend scalar in [0,1].
 * Internal: applies smoothstep over shoreline region to avoid abrupt cliff transitions.
 */
function sampleCoastalFlatten(islandMask) {
  const shoreline = 1 - islandMask;
  const t = THREE.MathUtils.clamp((shoreline - 0.18) / (0.92 - 0.18), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes blend weight for forcing outer regions to deep ocean.
 * Inputs: `islandMask` in [0,1], where low values are farther from island core.
 * Outputs: blend scalar in [0,1], where 1 means fully ocean-clamped.
 * Internal: uses a smoothstep-style transition so island shelf remains natural while outer land is suppressed.
 */
function sampleOuterOceanBlend(islandMask) {
  const shoreline = 1 - islandMask;
  const t = THREE.MathUtils.clamp((shoreline - 0.56) / (0.96 - 0.56), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Compresses raw noise heights to reduce sharp cliffs and spikes.
 * Inputs: `height` scalar in roughly [-1, 1].
 * Outputs: softened height scalar preserving sign.
 * Internal: applies signed power curve so large gradients are flattened.
 */
function softenHeight(height) {
  const magnitude = Math.pow(Math.abs(height), 1.45);
  return Math.sign(height) * magnitude;
}

/**
 * Smooths steep local height differences over the terrain grid.
 * Inputs: `heights` array, `gridSize` vertices per side, and `strength` in [0, 1].
 * Outputs: mutates `heights` in place toward neighborhood averages.
 * Internal: computes a 4-neighbor average and lerps each interior vertex toward that average.
 */
function smoothHeightsInPlace(heights, gridSize, strength) {
  if (strength <= 0) {
    return;
  }

  const scratch = new Float32Array(heights.length);
  scratch.set(heights);
  for (let row = 1; row < gridSize - 1; row += 1) {
    for (let col = 1; col < gridSize - 1; col += 1) {
      const index = row * gridSize + col;
      const neighborAvg =
        (scratch[index - 1] + scratch[index + 1] + scratch[index - gridSize] + scratch[index + gridSize]) *
        0.25;
      heights[index] = THREE.MathUtils.lerp(scratch[index], neighborAvg, strength);
    }
  }
}

/**
 * Rebuilds vertex heights for procedural terrain and normalized-height attributes.
 * Inputs: `geometry`, `settings`, and mutable `scratch` object for cached arrays/range.
 * Outputs: mutates vertex positions plus `aHeightNorm` attribute data; recomputes normals.
 * Internal: samples seeded fBm noise per vertex, applies island falloff plus deep border sink near map edges, then normalizes heights into a shader-readable attribute.
 */
function rebuildTerrainHeights(geometry, settings, scratch) {
  const seededRandom = createSeededRandom(settings.seed);
  const noise2D = createNoise2D(seededRandom);
  const positions = geometry.attributes.position;
  scratch.minHeight = Number.POSITIVE_INFINITY;
  scratch.maxHeight = Number.NEGATIVE_INFINITY;

  const gridSize = settings.segments + 1;
  const baseX = scratch.baseX;
  const baseZ = scratch.baseZ;
  for (let i = 0; i < positions.count; i += 1) {
    const x = baseX[i];
    const z = baseZ[i];
    const nx = x / (settings.width * 0.5);
    const nz = z / (settings.depth * 0.5);
    const radialLength = Math.max(1e-5, Math.sqrt(x * x + z * z));
    const radialX = x / radialLength;
    const radialZ = z / radialLength;
    const edgeWarpFactor = sampleEdgeWarpFactor(nx, nz, settings.edgeWarpStart);
    const edgeNoise = sampleTerrainHeight(
      noise2D,
      x * settings.edgeWarpFrequency + 31.73,
      z * settings.edgeWarpFrequency - 17.11,
      {
        frequency: 1,
        octaves: 3,
        lacunarity: 2.05,
        persistence: 0.5
      }
    );
    const edgeOffset = edgeNoise * settings.edgeWarpStrength * edgeWarpFactor;
    const warpedX = x + radialX * edgeOffset;
    const warpedZ = z + radialZ * edgeOffset;
    positions.setX(i, warpedX);
    positions.setZ(i, warpedZ);

    const centerDistance = Math.sqrt(nx * nx + nz * nz);
    const islandMask = sampleIslandMask(centerDistance, settings.islandRadius, settings.islandFalloff);
    const borderSink = sampleBorderSink(nx, nz, settings.borderFadeStart);
    const coastBlend = islandMask * islandMask * (3 - 2 * islandMask);
    const shoreReliefScale = sampleShoreReliefScale(islandMask, settings.coastalShelf);
    const coastalFlatten = sampleCoastalFlatten(islandMask);
    const outerOceanBlend = sampleOuterOceanBlend(islandMask);
    const baseHeight = softenHeight(sampleTerrainHeight(noise2D, warpedX, warpedZ, settings));
    const yRaw =
      baseHeight * settings.amplitude * coastBlend * shoreReliefScale -
      (1 - islandMask) * settings.coastalShelf -
      borderSink * settings.borderDepth;
    const coastalY = THREE.MathUtils.lerp(yRaw, -settings.coastalShelf * 0.7, coastalFlatten);
    const deepOceanY = settings.seaLevel - (0.95 + borderSink * settings.borderDepth * 0.45);
    const y = THREE.MathUtils.lerp(coastalY, deepOceanY, outerOceanBlend);
    scratch.heights[i] = y;
  }

  smoothHeightsInPlace(scratch.heights, gridSize, settings.slopeSmoothing);

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
  const settings = { ...DEFAULT_TERRAIN_SETTINGS, ...overrides };
  const geometry = new THREE.PlaneGeometry(
    settings.width,
    settings.depth,
    settings.segments,
    settings.segments
  );
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    roughness: 0.92,
    metalness: 0.04,
    wireframe: settings.wireframe
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
   * Internal: merges settings, reapplies wireframe flag, then rebuilds displacement and colors.
   */
  function update(nextSettings) {
    const previousSettings = { ...settings };
    Object.assign(settings, nextSettings);
    material.wireframe = settings.wireframe;
    const geometryDirty =
      settings.islandRadius !== previousSettings.islandRadius ||
      settings.islandFalloff !== previousSettings.islandFalloff ||
      settings.borderFadeStart !== previousSettings.borderFadeStart ||
      settings.borderDepth !== previousSettings.borderDepth ||
      settings.coastalShelf !== previousSettings.coastalShelf ||
      settings.slopeSmoothing !== previousSettings.slopeSmoothing ||
      settings.edgeWarpStart !== previousSettings.edgeWarpStart ||
      settings.edgeWarpStrength !== previousSettings.edgeWarpStrength ||
      settings.edgeWarpFrequency !== previousSettings.edgeWarpFrequency ||
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
