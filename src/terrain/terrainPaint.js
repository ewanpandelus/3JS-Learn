/** Seed offset for biome classification noise (separate from height noise). */
export const BIOME_NOISE_SEED_OFFSET = 5191;
/** Seed offset for paint blend dither noise (separate from biome noise). */
export const PAINT_BLEND_NOISE_SEED_OFFSET = 7843;
/** Default world-space frequency for paint blend dither noise. */
export const PAINT_BLEND_NOISE_FREQUENCY_DEFAULT = 1.68;
/** Default strength for shifting normalized paint blend thresholds. */
export const PAINT_BLEND_NOISE_STRENGTH_DEFAULT = 0.15;
/** Second octave weight when sampling paint blend noise. */
export const PAINT_BLEND_NOISE_OCTAVE_TWO_WEIGHT = 0.5;
/** Second octave frequency scale for paint blend noise. */
export const PAINT_BLEND_NOISE_OCTAVE_TWO_SCALE = 2;
/** Hash mix coefficients for GLSL value-noise (fixed recipe, not tunable). */
export const PAINT_BLEND_HASH_XY = [123.34, 456.21];
export const PAINT_BLEND_HASH_DOT = 45.32;

/** Slope below this blends lowland toward mellow (matches DirectX `RockTexBlend` 0.2). */
export const SLOPE_BLEND_FLAT_END = 0.2;
/** Slope above this is fully steep rock colour (matches DirectX `RockTexBlend` 0.7). */
export const SLOPE_BLEND_STEEP_END = 0.7;

/**
 * Default terrain paint: biomes from noise; slope rock/snow above a height gate.
 * Inputs: none.
 * Outputs: plain paint settings object for shaders and UI.
 * Internal: mirrors TerrainGenerationDirectX11 `RockTexBlend` + height bands from light_ps.hlsl.
 */
export const DEFAULT_TERRAIN_PAINT = {
  biomeAColor: '#dcc69f',
  biomeBColor: '#ad7f81',
  mellowSlopeColor: '#6e6458',
  steepSlopeColor: '#080731',
  snowColor: '#eeeeee',
  biomeNoiseFrequency: 0.09,
  blendNoiseFrequency: PAINT_BLEND_NOISE_FREQUENCY_DEFAULT,
  blendNoiseStrength: PAINT_BLEND_NOISE_STRENGTH_DEFAULT,
  slopeHeightStart: 0.35,
  slopeHeightBlend: 0.12,
  snowHeightStart: 0.78,
  snowHeightBlend: 0.16
};

/**
 * Normalizes terrain paint settings and migrates legacy fields.
 * Inputs: partial `settings` from UI or persistence.
 * Outputs: `paint` object with clamped thresholds and hex colours.
 * Internal: maps old mountain/slope/height keys onto the current paint schema.
 */
export function normalizeTerrainPaint(settings = {}) {
  const legacyBiomeA = typeof settings.colorLow === 'string' ? settings.colorLow : undefined;
  const legacyBiomeB = typeof settings.colorHigh === 'string' ? settings.colorHigh : undefined;
  const legacyPaint = settings.paint ?? {};

  const paint = {
    ...DEFAULT_TERRAIN_PAINT,
    ...legacyPaint,
    biomeAColor: legacyPaint.biomeAColor ?? legacyBiomeA ?? DEFAULT_TERRAIN_PAINT.biomeAColor,
    biomeBColor: legacyPaint.biomeBColor ?? legacyBiomeB ?? DEFAULT_TERRAIN_PAINT.biomeBColor,
    mellowSlopeColor: legacyPaint.mellowSlopeColor ?? DEFAULT_TERRAIN_PAINT.mellowSlopeColor,
    steepSlopeColor:
      legacyPaint.steepSlopeColor ??
      legacyPaint.mountainColor ??
      DEFAULT_TERRAIN_PAINT.steepSlopeColor,
    snowColor: legacyPaint.snowColor ?? DEFAULT_TERRAIN_PAINT.snowColor,
    slopeHeightStart:
      legacyPaint.slopeHeightStart ??
      legacyPaint.mountainHeightStart ??
      DEFAULT_TERRAIN_PAINT.slopeHeightStart,
    slopeHeightBlend:
      legacyPaint.slopeHeightBlend ??
      legacyPaint.mountainHeightBlend ??
      DEFAULT_TERRAIN_PAINT.slopeHeightBlend,
    snowHeightStart:
      legacyPaint.snowHeightStart ??
      legacyPaint.snowGradientStart ??
      DEFAULT_TERRAIN_PAINT.snowHeightStart,
    snowHeightBlend:
      legacyPaint.snowHeightBlend ??
      legacyPaint.snowGradientBlend ??
      DEFAULT_TERRAIN_PAINT.snowHeightBlend
  };

  paint.slopeHeightStart = clampUnit(paint.slopeHeightStart);
  paint.slopeHeightBlend = clampUnit(paint.slopeHeightBlend);
  paint.snowHeightStart = clampUnit(paint.snowHeightStart);
  paint.snowHeightBlend = clampUnit(paint.snowHeightBlend);
  paint.biomeNoiseFrequency = Math.max(0, paint.biomeNoiseFrequency);
  paint.blendNoiseFrequency = Math.max(0, paint.blendNoiseFrequency);
  paint.blendNoiseStrength = clampUnit(paint.blendNoiseStrength);

  return paint;
}

/**
 * Clamps a scalar to the 0–1 range.
 * Inputs: `value` number.
 * Outputs: clamped number.
 * Internal: used for height gate thresholds in paint settings.
 */
function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}
