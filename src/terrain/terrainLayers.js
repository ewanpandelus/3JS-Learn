/** Default surface texture on the island plateau (does not scale island bulk). */
export const DEFAULT_BASE_LAYER = {
  amplitude: 0.28,
  frequency: 0.24,
  octaves: 4,
  lacunarity: 2,
  persistence: 0.5
};

const LAYER_SEED_STRIDE = 7919;
const LAYER_OFFSET_STRIDE_X = 17.3;
const LAYER_OFFSET_STRIDE_Z = -11.7;

/**
 * Creates default noise settings for one stackable mountain layer.
 * Inputs: `index` layer position (0-based) for seed/offset variation, optional `overrides` partial layer.
 * Outputs: plain layer settings object.
 * Internal: offsets seed and world UV per index so stacked layers do not align.
 */
export function createDefaultTerrainLayer(index = 0, overrides = {}) {
  return {
    amplitude: 0.6,
    frequency: 0.58,
    octaves: 5,
    lacunarity: 2.2,
    persistence: 0.48,
    seedOffset: 1000 + index * LAYER_SEED_STRIDE,
    offsetX: index * LAYER_OFFSET_STRIDE_X,
    offsetZ: index * LAYER_OFFSET_STRIDE_Z,
    enabled: true,
    ...overrides
  };
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

  normalized.layers = layers.map((layer, index) => ({
    ...createDefaultTerrainLayer(index),
    ...layer,
    enabled: layer?.enabled !== false
  }));

  return normalized;
}
