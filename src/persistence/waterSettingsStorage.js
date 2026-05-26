import { DEFAULT_WATER_SETTINGS } from '../water/createWaterSystem.js';

const WATER_SETTINGS_STORAGE_KEY = '3js-learn-water-settings';

/**
 * Loads persisted water tuning from localStorage (if valid JSON).
 * Inputs: none; reads `localStorage` under a fixed app key.
 * Outputs: partial settings object or empty object when missing/invalid.
 * Internal: parses JSON and keeps only keys/types that match `DEFAULT_WATER_SETTINGS`.
 */
export function loadWaterSettings() {
  try {
    const raw = localStorage.getItem(WATER_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const out = {};
    for (const key of Object.keys(DEFAULT_WATER_SETTINGS)) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
        continue;
      }
      const template = DEFAULT_WATER_SETTINGS[key];
      const value = parsed[key];
      if (typeof template === typeof value) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Persists full water settings snapshot to localStorage.
 * Inputs: `settings` object matching tunable water keys (typically from `getSettings()`).
 * Outputs: writes JSON string; no throw on quota errors (silent catch).
 * Internal: serializes the object for reload on next visit.
 */
export function saveWaterSettings(settings) {
  try {
    localStorage.setItem(WATER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Clears persisted water tuning so the next load uses `DEFAULT_WATER_SETTINGS` from code.
 * Inputs: none.
 * Outputs: removes the app key from `localStorage`.
 * Internal: used when you want repo defaults instead of a saved snapshot.
 */
export function clearWaterSettingsStorage() {
  try {
    localStorage.removeItem(WATER_SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
}
