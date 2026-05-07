const DEFAULT_SUPABASE_URL = 'https://qbjtepsldolstmueanya.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Vc7PWeoRlJGh83-Ao4Z0Gg_mf68h7V6';

/**
 * Provides runtime Supabase connection settings for browser auth.
 * Inputs: none.
 * Outputs: immutable config object with `url` and `anonKey` strings.
 * Internal: reads optional `window.__SUPABASE_CONFIG__` overrides, then falls back to local defaults.
 */
export function getSupabaseConfig() {
  const runtimeConfig = globalThis?.__SUPABASE_CONFIG__ ?? {};
  const url = runtimeConfig.url ?? DEFAULT_SUPABASE_URL;
  const anonKey = runtimeConfig.anonKey ?? DEFAULT_SUPABASE_ANON_KEY;

  return Object.freeze({ url, anonKey });
}

/**
 * Validates that Supabase URL and anon key have been set.
 * Inputs: none.
 * Outputs: boolean indicating whether config appears usable for client auth calls.
 * Internal: rejects empty values and template placeholders.
 */
export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  const hasUrl = typeof url === 'string' && url.startsWith('https://');
  const hasAnonKey = typeof anonKey === 'string' && anonKey.length > 20 && !anonKey.includes('REPLACE_WITH_');
  return hasUrl && hasAnonKey;
}
