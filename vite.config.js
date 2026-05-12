import { defineConfig } from 'vite';

/**
 * Vite config for local dev and production builds with env-based Supabase settings.
 * Inputs: none (uses defaults for port and output dir).
 * Outputs: Vite configuration object.
 * Internal: serves the existing root `index.html` entry, loads `.env*` from `env/` via `envDir`, and writes static assets to `dist/`.
 */
export default defineConfig({
  envDir: 'env',
  server: {
    port: 4173,
    open: false
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
