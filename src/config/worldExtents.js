/** Island terrain width/depth in world units (centered on origin). */
export const TERRAIN_EXTENT = 28;
export const TERRAIN_WIDTH = TERRAIN_EXTENT;
export const TERRAIN_DEPTH = TERRAIN_EXTENT;
/** Mesh subdivisions per world unit along each terrain axis. */
export const TERRAIN_SEGMENTS_PER_UNIT = 15;
/** Terrain segment count along width and depth (derived from extent × density). */
export const TERRAIN_SEGMENTS = Math.round(TERRAIN_EXTENT * TERRAIN_SEGMENTS_PER_UNIT);
/** Water plane size as a multiple of terrain extent (open sea margin around the island). */
export const WATER_SURFACE_MARGIN_SCALE = 9;
/** Default water surface width and depth in world units. */
export const WATER_SURFACE_WIDTH = TERRAIN_EXTENT * WATER_SURFACE_MARGIN_SCALE;
export const WATER_SURFACE_DEPTH = TERRAIN_EXTENT * WATER_SURFACE_MARGIN_SCALE;
