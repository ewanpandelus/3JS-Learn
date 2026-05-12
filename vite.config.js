import { defineConfig } from 'vite';

/**
 * Vite config for local dev and production builds with env-based Supabase settings.
 * Inputs: none (uses defaults for port and output dir).
 * Outputs: Vite configuration object.
 * Internal: serves the existing root `index.html` entry, loads `.env*` from `env/` via `envDir`, optional `VITE_BASE_PATH` for subdirectory hosts (e.g. GitHub Pages project sites), and writes static assets to `dist/`.
 */
export default defineConfig({
  envDir: 'env',
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 4173,
    open: false
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
