import * as THREE from 'three';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';
import { TERRAIN_DEPTH, TERRAIN_SEGMENTS, TERRAIN_WIDTH } from '../config/worldExtents.js';
import {
  createDefaultTerrainLayers,
  DEFAULT_BASE_LAYER,
  DEFAULT_ISLAND_SETTINGS,
  DEFAULT_MOUNTAIN_SEED,
  normalizeTerrainSettings
} from './terrainLayers.js';
import {
  BIOME_NOISE_SEED_OFFSET,
  DEFAULT_TERRAIN_PAINT,
  PAINT_BLEND_HASH_DOT,
  PAINT_BLEND_HASH_XY,
  PAINT_BLEND_NOISE_OCTAVE_TWO_SCALE,
  PAINT_BLEND_NOISE_OCTAVE_TWO_WEIGHT,
  PAINT_BLEND_NOISE_SEED_OFFSET,
  SLOPE_BLEND_FLAT_END,
  SLOPE_BLEND_STEEP_END
} from './terrainPaint.js';
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
/** Fully matte so snow albedo is not read as view-dependent specular. */
const TERRAIN_ROUGHNESS = 1;
const TERRAIN_METALNESS = 0;

const DEFAULT_TERRAIN_SETTINGS = {
  width: TERRAIN_WIDTH,
  depth: TERRAIN_DEPTH,
  segments: TERRAIN_SEGMENTS,
  seaLevel: TERRAIN_SEA_LEVEL,
  seed: TERRAIN_SEED,
  mountainSeed: DEFAULT_MOUNTAIN_SEED,
  baseLayer: { ...DEFAULT_BASE_LAYER },
  island: { ...DEFAULT_ISLAND_SETTINGS },
  layers: createDefaultTerrainLayers(),
  paint: { ...DEFAULT_TERRAIN_PAINT }
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
  const biomeNoise2D = createNoise2D(createSeededRandom(settings.seed + BIOME_NOISE_SEED_OFFSET));
  scratch.layerNoise2D = settings.layers.map((layer) =>
    createNoise2D(createSeededRandom(settings.mountainSeed + layer.seedOffset))
  );
  const biomeNoiseFrequency = settings.paint.biomeNoiseFrequency;
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

    const biomeSample = biomeNoise2D(x * biomeNoiseFrequency, z * biomeNoiseFrequency);
    scratch.biomeNorm[i] = biomeSample * 0.5 + 0.5;
  }

  for (let i = 0; i < positions.count; i += 1) {
    const y = scratch.heights[i];
    scratch.minHeight = Math.min(scratch.minHeight, y);
    scratch.maxHeight = Math.max(scratch.maxHeight, y);
    positions.setY(i, y);
  }

  const invHeightRange =
    scratch.maxHeight === scratch.minHeight ? 0 : 1 / (scratch.maxHeight - scratch.minHeight);
  for (let i = 0; i < positions.count; i += 1) {
    scratch.heightNorm[i] =
      invHeightRange === 0 ? 0.5 : (scratch.heights[i] - scratch.minHeight) * invHeightRange;
  }

  geometry.attributes.aBiomeNorm.needsUpdate = true;
  geometry.attributes.aHeightNorm.needsUpdate = true;
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.attributes.normal.needsUpdate = true;
}

/**
 * Builds a stable 2D seed for paint blend dither noise from the terrain seed.
 * Inputs: `seed` integer terrain generation seed.
 * Outputs: `THREE.Vector2` UV offset for shader value noise, no side effects.
 * Internal: mixes seed with `PAINT_BLEND_NOISE_SEED_OFFSET` into two decorrelated scalars.
 */
function createPaintBlendNoiseSeed(seed) {
  const mixed = (seed + PAINT_BLEND_NOISE_SEED_OFFSET) >>> 0;
  return new THREE.Vector2((mixed % 10000) * 0.0017, ((mixed + 97) % 10000) * 0.0023);
}

/**
 * Builds initial terrain paint uniforms for `onBeforeCompile`.
 * Inputs: `paint` normalized paint settings object, `seed` terrain generation seed.
 * Outputs: uniform map for the terrain fragment shader.
 * Internal: biomes from noise; `RockTexBlend` slope tints gated by normalized height.
 */
function createTerrainPaintUniforms(paint, seed) {
  return {
    uBiomeAColor: { value: new THREE.Color(paint.biomeAColor) },
    uBiomeBColor: { value: new THREE.Color(paint.biomeBColor) },
    uMellowSlopeColor: { value: new THREE.Color(paint.mellowSlopeColor) },
    uSteepSlopeColor: { value: new THREE.Color(paint.steepSlopeColor) },
    uSnowColor: { value: new THREE.Color(paint.snowColor) },
    uSlopeFlatEnd: { value: SLOPE_BLEND_FLAT_END },
    uSlopeSteepEnd: { value: SLOPE_BLEND_STEEP_END },
    uSlopeHeightStart: { value: paint.slopeHeightStart },
    uSlopeHeightBlend: { value: paint.slopeHeightBlend },
    uSnowHeightStart: { value: paint.snowHeightStart },
    uSnowHeightBlend: { value: paint.snowHeightBlend },
    uPaintBlendNoiseSeed: { value: createPaintBlendNoiseSeed(seed) },
    uPaintBlendNoiseFrequency: { value: paint.blendNoiseFrequency },
    uPaintBlendNoiseStrength: { value: paint.blendNoiseStrength },
    uPaintBlendNoiseOctave2Weight: { value: PAINT_BLEND_NOISE_OCTAVE_TWO_WEIGHT },
    uPaintBlendNoiseOctave2Scale: { value: PAINT_BLEND_NOISE_OCTAVE_TWO_SCALE }
  };
}

/**
 * Applies terrain shader paint uniforms from current terrain settings.
 * Inputs: `material` terrain material and current settings object.
 * Outputs: updates paint uniforms on the compiled shader.
 * Internal: writes values into `onBeforeCompile`-injected uniforms when shader is available.
 */
function applyTerrainPaint(material, settings) {
  const shader = material.userData.shader;
  if (!shader) {
    return;
  }

  const paint = settings.paint;
  shader.uniforms.uBiomeAColor.value.set(paint.biomeAColor);
  shader.uniforms.uBiomeBColor.value.set(paint.biomeBColor);
  shader.uniforms.uMellowSlopeColor.value.set(paint.mellowSlopeColor);
  shader.uniforms.uSteepSlopeColor.value.set(paint.steepSlopeColor);
  shader.uniforms.uSnowColor.value.set(paint.snowColor);
  shader.uniforms.uSlopeHeightStart.value = paint.slopeHeightStart;
  shader.uniforms.uSlopeHeightBlend.value = paint.slopeHeightBlend;
  shader.uniforms.uSnowHeightStart.value = paint.snowHeightStart;
  shader.uniforms.uSnowHeightBlend.value = paint.snowHeightBlend;
  shader.uniforms.uPaintBlendNoiseSeed.value.copy(createPaintBlendNoiseSeed(settings.seed));
  shader.uniforms.uPaintBlendNoiseFrequency.value = paint.blendNoiseFrequency;
  shader.uniforms.uPaintBlendNoiseStrength.value = paint.blendNoiseStrength;
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
    Object.assign(shader.uniforms, createTerrainPaintUniforms(settings.paint, settings.seed));
    material.userData.shader = shader;
    const [paintHashX, paintHashY] = PAINT_BLEND_HASH_XY;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
        #include <common>
        attribute float aBiomeNorm;
        attribute float aHeightNorm;
        varying float vBiomeNorm;
        varying float vHeightNorm;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        `
      )
      .replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vBiomeNorm = aBiomeNorm;
        vHeightNorm = aHeightNorm;
        vWorldNormal = mat3(modelMatrix) * normal;
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
        #include <common>
        uniform vec3 uBiomeAColor;
        uniform vec3 uBiomeBColor;
        uniform vec3 uMellowSlopeColor;
        uniform vec3 uSteepSlopeColor;
        uniform vec3 uSnowColor;
        uniform float uSlopeFlatEnd;
        uniform float uSlopeSteepEnd;
        uniform float uSlopeHeightStart;
        uniform float uSlopeHeightBlend;
        uniform float uSnowHeightStart;
        uniform float uSnowHeightBlend;
        uniform vec2 uPaintBlendNoiseSeed;
        uniform float uPaintBlendNoiseFrequency;
        uniform float uPaintBlendNoiseStrength;
        uniform float uPaintBlendNoiseOctave2Weight;
        uniform float uPaintBlendNoiseOctave2Scale;
        varying float vBiomeNorm;
        varying float vHeightNorm;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;

        const vec2 PAINT_HASH_XY = vec2(${paintHashX}, ${paintHashY});
        const float PAINT_HASH_DOT = ${PAINT_BLEND_HASH_DOT};

        float paintHash21(vec2 p) {
          vec2 q = fract(p * PAINT_HASH_XY);
          q += dot(q, q + PAINT_HASH_DOT);
          return fract(q.x * q.y);
        }

        float paintValueNoise(vec2 p) {
          vec2 cell = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n00 = paintHash21(cell);
          float n10 = paintHash21(cell + vec2(1.0, 0.0));
          float n01 = paintHash21(cell + vec2(0.0, 1.0));
          float n11 = paintHash21(cell + vec2(1.0, 1.0));
          return mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
        }

        float paintBlendNoise(vec2 worldXZ, float octaveScale) {
          vec2 sampleUv = worldXZ * uPaintBlendNoiseFrequency * octaveScale + uPaintBlendNoiseSeed;
          return paintValueNoise(sampleUv);
        }

        float paintBlendNoiseSigned(vec2 worldXZ) {
          float n0 = paintBlendNoise(worldXZ, 1.0);
          float n1 = paintBlendNoise(worldXZ, uPaintBlendNoiseOctave2Scale);
          float blended = mix(n0, n1, uPaintBlendNoiseOctave2Weight);
          return (blended - 0.5) * 2.0 * uPaintBlendNoiseStrength;
        }

        vec3 lowlandColour(vec3 biomeA, vec3 biomeB, float biomeNorm) {
          return mix(biomeA, biomeB, clamp(biomeNorm, 0.0, 1.0));
        }

        vec3 rockTexBlend(float slope, vec3 flatColour, vec3 mellowColour, vec3 steepColour) {
          if (slope < uSlopeFlatEnd) {
            return mix(flatColour, mellowColour, slope / max(uSlopeFlatEnd, 0.0001));
          }
          if (slope < uSlopeSteepEnd) {
            float rockT = (slope - uSlopeFlatEnd) / max(uSlopeSteepEnd - uSlopeFlatEnd, 0.0001);
            return mix(mellowColour, steepColour, clamp(rockT, 0.0, 1.0));
          }
          return steepColour;
        }

        float slopeFromWorldPosition(vec3 worldPos, vec3 vertexWorldNormal) {
          vec3 dpdx = dFdx(worldPos);
          vec3 dpdy = dFdy(worldPos);
          vec3 geomNormal = normalize(cross(dpdx, dpdy));
          if (dot(geomNormal, vertexWorldNormal) < 0.0) {
            geomNormal = -geomNormal;
          }
          return clamp(1.0 - geomNormal.y, 0.0, 1.0);
        }
        `
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `
        vec2 worldXZ = vWorldPosition.xz;
        float blendJitter = paintBlendNoiseSigned(worldXZ);
        vec3 lowland = lowlandColour(uBiomeAColor, uBiomeBColor, vBiomeNorm + blendJitter);
        vec3 vertexWorldNormal = normalize(vWorldNormal);
        float slope = clamp(slopeFromWorldPosition(vWorldPosition, vertexWorldNormal) + blendJitter, 0.0, 1.0);
        vec3 grassSlope = rockTexBlend(slope, lowland, uMellowSlopeColor, uSteepSlopeColor);
        vec3 snowSlope = rockTexBlend(slope, uSnowColor, uMellowSlopeColor, uSteepSlopeColor);
        float slopeHeightEnd = uSlopeHeightStart + uSlopeHeightBlend;
        float snowHeightEnd = uSnowHeightStart + uSnowHeightBlend;
        float heightNorm = clamp(vHeightNorm + blendJitter, 0.0, 1.0);
        float slopeGate = smoothstep(uSlopeHeightStart, slopeHeightEnd, heightNorm);
        float snowGate = smoothstep(uSnowHeightStart, snowHeightEnd, heightNorm);
        vec3 highland = mix(grassSlope, snowSlope, snowGate);
        vec3 terrainColor = mix(lowland, highland, slopeGate);
        vec4 diffuseColor = vec4(terrainColor, opacity);
        `
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const scratch = {
    heights: new Float32Array(geometry.attributes.position.count),
    biomeNorm: new Float32Array(geometry.attributes.position.count),
    heightNorm: new Float32Array(geometry.attributes.position.count),
    baseX: new Float32Array(geometry.attributes.position.count),
    baseZ: new Float32Array(geometry.attributes.position.count),
    minHeight: 0,
    maxHeight: 0
  };
  for (let i = 0; i < geometry.attributes.position.count; i += 1) {
    scratch.baseX[i] = geometry.attributes.position.getX(i);
    scratch.baseZ[i] = geometry.attributes.position.getZ(i);
  }
  geometry.setAttribute('aBiomeNorm', new THREE.BufferAttribute(scratch.biomeNorm, 1));
  geometry.setAttribute('aHeightNorm', new THREE.BufferAttribute(scratch.heightNorm, 1));
  rebuildTerrainHeights(geometry, settings, scratch);
  applyTerrainPaint(material, settings);

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
      JSON.stringify(settings.layers) !== JSON.stringify(previousSettings.layers) ||
      settings.paint.biomeNoiseFrequency !== previousSettings.paint.biomeNoiseFrequency;

    const paintDirty = JSON.stringify(settings.paint) !== JSON.stringify(previousSettings.paint);

    if (geometryDirty) {
      rebuildTerrainHeights(geometry, settings, scratch);
      applyTerrainPaint(material, settings);
      return;
    }

    if (paintDirty) {
      applyTerrainPaint(material, settings);
    }

  }

  return {
    mesh,
    settings,
    update
  };
}
