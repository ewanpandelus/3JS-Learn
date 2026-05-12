# 3JS-Learn

Three.js terrain playground with optional Supabase-backed landscape saves.

## Local development

1. Install dependencies: `npm install`
2. Copy [`env/.env.example`](./env/.env.example) to **`env/.env.local`** (gitignored) and set **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`** from the Supabase dashboard (Settings → API).
3. Run **`npm run dev`** (Vite on port **4173**). Vite loads env files from the **`env/`** directory.

If the project URL or anon key was ever committed to git, **rotate the anon key** in Supabase before using the new `env/.env.local` values — see [Issue #1: hardcoded credentials](https://github.com/ewanpandelus/3JS-Learn/issues/1).

### Without `env/.env.local`

Cloud saves stay disabled; the editor still runs. For advanced cases you can set `globalThis.__SUPABASE_CONFIG__ = { url, anonKey }` before the app module loads.

## Production build

`npm run build` emits static files under **`dist/`**, with env vars baked in from the build environment (set the same `VITE_*` variables in CI or the host). Preview locally with `npm run preview` or `npm run static` (serves `dist/` via `serve`).
