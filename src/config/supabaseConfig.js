const GLOBAL = typeof globalThis !== 'undefined' ? globalThis : {};

/**
 * Provides Supabase URL and anon key for the browser client (never hardcoded in source).
 * Inputs: none.
 * Outputs: frozen `{ url, anonKey }` strings; empty when unset (see `isSupabaseConfigured`).
 * Internal: prefers `globalThis.__SUPABASE_CONFIG__` for runtime overrides, then `import.meta.env` from Vite (files under `env/`, CI env, etc.).
 */
export function getSupabaseConfig() {
  const runtime = GLOBAL.__SUPABASE_CONFIG__;
  const urlFromRuntime = typeof runtime?.url === 'string' ? runtime.url.trim() : '';
  const keyFromRuntime = typeof runtime?.anonKey === 'string' ? runtime.anonKey.trim() : '';

  const urlFromEnv = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const keyFromEnv = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

  const url = urlFromRuntime || urlFromEnv;
  const anonKey = keyFromRuntime || keyFromEnv;

  return Object.freeze({ url, anonKey });
}

/**
 * Validates that Supabase URL and anon key are present and look usable.
 * Inputs: none.
 * Outputs: boolean indicating whether client auth and DB calls should be enabled.
 * Internal: rejects empty values and obvious template placeholders.
 */
export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  const hasUrl = typeof url === 'string' && url.startsWith('https://');
  const hasAnonKey =
    typeof anonKey === 'string' &&
    anonKey.length > 20 &&
    !anonKey.includes('REPLACE_WITH_') &&
    !anonKey.includes('your-anon-key');
  return hasUrl && hasAnonKey;
}
