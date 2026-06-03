import { normalizeTerrainPaint } from './terrainPaint.js';

/** Default surface texture on the island plateau (does not scale island bulk). */
export const DEFAULT_BASE_LAYER = {
  amplitude: 0,
  frequency: 0.53,
  octaves: 4,
  lacunarity: 2,
  persistence: 0.5
};

/** Coastline and island-wide shape tuning (not mountain stack layers). */
export const DEFAULT_ISLAND_SETTINGS = {
  edgeNoiseAmplitude: 0.29,
  edgeNoiseFrequency: 0.42
};

/** Default seed for mountain layer noise (independent of island base seed). */
export const DEFAULT_MOUNTAIN_SEED = 852916;

/** Primary mountain stack layer defaults (large-scale relief). */
export const DEFAULT_MOUNTAIN_LAYER_0 = {
  amplitude: 2.57,
  frequency: 0.08,
  octaves: 1,
  lacunarity: 0.13
};

/** Secondary mountain stack layer defaults (fine detail). */
export const DEFAULT_MOUNTAIN_LAYER_1 = {
  amplitude: 0.77,
  frequency: 0.53,
  octaves: 7,
  lacunarity: 1.48
};
/** Maximum mountain seed value accepted by the editor. */
export const MOUNTAIN_SEED_MAX = 999999;
/** Prime stride between per-layer simplex seeds. */
const LAYER_SEED_STRIDE = 104729;
/** World-space X pan between mountain layer noise samples. */
const LAYER_SAMPLE_PAN_X = 41.9;
/** World-space Z pan between mountain layer noise samples. */
const LAYER_SAMPLE_PAN_Z = 27.3;

/**
 * Returns seed and UV pan for one layer index so samples do not share the same noise patch.
 * Inputs: `index` layer position (0-based).
 * Outputs: `{ seedOffset, offsetX, offsetZ }` object.
 * Internal: uses index + 1 so layer 0 still pans away from the island base origin.
 */
export function getLayerSampleSpace(index) {
  const layerSlot = index + 1;
  return {
    seedOffset: 1000 + index * LAYER_SEED_STRIDE,
    offsetX: layerSlot * LAYER_SAMPLE_PAN_X,
    offsetZ: layerSlot * LAYER_SAMPLE_PAN_Z * -1
  };
}

/**
 * Merges stored layer fields with defaults without clobbering sampling identity.
 * Inputs: `layer` partial layer, `index` position in the stack.
 * Outputs: complete layer settings object.
 * Internal: only fills seed/offset/persistence when missing on the stored layer.
 */
export function mergeLayerWithDefaults(layer, index) {
  const defaults = createDefaultTerrainLayer(index);
  const sampleSpace = getLayerSampleSpace(index);
  return {
    ...defaults,
    ...layer,
    seedOffset: typeof layer?.seedOffset === 'number' ? layer.seedOffset : sampleSpace.seedOffset,
    offsetX: typeof layer?.offsetX === 'number' ? layer.offsetX : sampleSpace.offsetX,
    offsetZ: typeof layer?.offsetZ === 'number' ? layer.offsetZ : sampleSpace.offsetZ,
    persistence: typeof layer?.persistence === 'number' ? layer.persistence : defaults.persistence,
    enabled: layer?.enabled !== false
  };
}

/**
 * Creates default noise settings for one stackable mountain layer.
 * Inputs: `index` layer position (0-based) for seed/offset variation, optional `overrides` partial layer.
 * Outputs: plain layer settings object.
 * Internal: offsets seed and world UV per index so stacked layers do not align.
 */
export function createDefaultTerrainLayer(index = 0, overrides = {}) {
  const layerPreset =
    index === 0
      ? DEFAULT_MOUNTAIN_LAYER_0
      : index === 1
        ? DEFAULT_MOUNTAIN_LAYER_1
        : {
            amplitude: 0.6,
            frequency: 0.58,
            octaves: 5,
            lacunarity: 2.2
          };

  return {
    persistence: 0.48,
    ...getLayerSampleSpace(index),
    enabled: true,
    ...layerPreset,
    ...overrides
  };
}

/**
 * Builds the default two-layer mountain stack used on first load.
 * Inputs: none.
 * Outputs: array of two normalized layer settings objects.
 * Internal: applies `DEFAULT_MOUNTAIN_LAYER_*` presets with per-index sample pan/seed.
 */
export function createDefaultTerrainLayers() {
  return [createDefaultTerrainLayer(0), createDefaultTerrainLayer(1)];
}

/**
 * Normalizes terrain settings and migrates legacy top-level noise keys into layers.
 * Inputs: partial `settings` from UI or persistence.
 * Outputs: settings object with `baseLayer` and `layers` arrays populated.
 * Internal: copies defaults, maps old amplitude/frequency fields to the first mountain layer.
 */
export function normalizeTerrainSettings(settings = {}) {
  const normalized = { ...settings };
  normalized.baseLayer = { ...DEFAULT_BASE_LAYER, ...(normalized.baseLayer ?? {}) };
  normalized.island = { ...DEFAULT_ISLAND_SETTINGS, ...(normalized.island ?? {}) };
  normalized.mountainSeed =
    typeof normalized.mountainSeed === 'number'
      ? Math.max(0, Math.min(MOUNTAIN_SEED_MAX, Math.round(normalized.mountainSeed)))
      : typeof normalized.seed === 'number'
        ? Math.max(0, Math.min(MOUNTAIN_SEED_MAX, Math.round(normalized.seed)))
        : DEFAULT_MOUNTAIN_SEED;
  normalized.paint = normalizeTerrainPaint(normalized);

  const legacyNoise =
    typeof settings.amplitude === 'number' ||
    typeof settings.frequency === 'number' ||
    typeof settings.octaves === 'number' ||
    typeof settings.lacunarity === 'number';

  let layers = Array.isArray(normalized.layers) ? normalized.layers : [];
  if (layers.length === 0 && legacyNoise) {
    layers = [
      createDefaultTerrainLayer(0, {
        amplitude: settings.amplitude,
        frequency: settings.frequency,
        octaves: settings.octaves,
        lacunarity: settings.lacunarity,
        persistence: settings.persistence
      })
    ];
  }

  normalized.layers = ensureDistinctLayerSampleSpaces(
    layers.map((layer, index) => mergeLayerWithDefaults(layer, index))
  );

  return normalized;
}

/**
 * Reassigns pan/seed when two layers share the same sampling coordinates.
 * Inputs: `layers` array of layer settings.
 * Outputs: new array with unique `seedOffset` / `offsetX` / `offsetZ` per index.
 * Internal: keeps the first occurrence and re-pans duplicates via `getLayerSampleSpace`.
 */
export function ensureDistinctLayerSampleSpaces(layers) {
  const usedKeys = new Set();
  return layers.map((layer, index) => {
    const sampleKey = `${layer.seedOffset}|${layer.offsetX}|${layer.offsetZ}`;
    if (!usedKeys.has(sampleKey)) {
      usedKeys.add(sampleKey);
      return layer;
    }
    return mergeLayerWithDefaults({ ...layer, ...getLayerSampleSpace(index) }, index);
  });
}
