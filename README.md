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

## GitHub Pages

**Pushing to GitHub does not build or deploy by itself.** You need either:

1. **This repo’s workflow** — [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) runs on pushes to **`main`**: `npm ci`, `npm run build`, then publishes **`dist/`** to Pages.
2. **Repo settings** — **Settings → Pages → Build and deployment**: choose **GitHub Actions** (not “Deploy from a branch”) so that workflow can deploy.
3. **Secrets (not the service role key)** — **Settings → Secrets and variables → Actions → New repository secret**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`  
   Use the same values as in `env/.env.local`. The workflow passes them into `npm run build` only on GitHub’s servers; they are **not** stored in the git tree. They still end up **inside the built JavaScript** anyone can download from your site—that is normal for the **anon / publishable** key; real protection is **RLS** in Supabase. Never put the **service_role** key in the frontend or in these secrets for this app.

The workflow sets **`VITE_BASE_PATH`** to `/<repository-name>/` so asset URLs work for project sites like `https://<user>.github.io/3JS-Learn/`. For a **user/org site** repo (`<user>.github.io`) with site at the domain root, adjust the workflow or set `VITE_BASE_PATH=/` for that build.

See [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-basics) and [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions).
