import { createCoreScene, handleResize } from './src/setup/createCoreScene.js';
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import { createClient } from '@supabase/supabase-js';
import { createTerrainRenderer } from './src/terrain/createTerrainRenderer.js';
import { createTerrainControls } from './src/ui/createTerrainControls.js';
import { createLandscapeStoragePanel } from './src/ui/createLandscapeStoragePanel.js';
import { createWaterSystem } from './src/water/createWaterSystem.js';
import { createAuthOverlay } from './src/auth/createAuthOverlay.js';
import { getSupabaseConfig, isSupabaseConfigured } from './src/config/supabaseConfig.js';
import { createLandscapeStore } from './src/persistence/createLandscapeStore.js';

const { renderer, scene, camera } = createCoreScene();
renderer.setClearColor(0x8aa8c7, 1);

const terrainRenderer = createTerrainRenderer();
scene.add(terrainRenderer.mesh);
const waterSystem = createWaterSystem({
  renderer,
  scene,
  camera,
  width: terrainRenderer.settings.width,
  depth: terrainRenderer.settings.depth,
  seaLevel: terrainRenderer.settings.seaLevel
});
scene.add(waterSystem.water);

camera.position.set(4, 4.5, 7);
camera.lookAt(0, 0, 0);
const controls = setupCameraControls(camera, renderer.domElement);

const terrainControls = createTerrainControls(terrainRenderer.settings, (patch) => {
  terrainRenderer.update(patch);
  if (typeof patch.seaLevel === 'number') {
    waterSystem.updateSeaLevel(patch.seaLevel);
  }
});
let storagePanel = null;

initializeAuthentication();

handleResize(renderer, camera, () => {
  controls.update();
  waterSystem.resize(window.innerWidth, window.innerHeight);
});

/**
 * Configures orbital camera controls around the terrain.
 * Inputs: `camera` as `THREE.PerspectiveCamera`, `domElement` as renderer canvas element.
 * Outputs: configured `OrbitControls` instance with damping/zoom/pan constraints.
 * Internal: enables smooth inertia, limits polar angle to avoid flipping below terrain, and constrains zoom distance.
 */
function setupCameraControls(camera, domElement) {
  const orbitControls = new OrbitControls(camera, domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.06;
  orbitControls.enablePan = true;
  orbitControls.panSpeed = 0.9;
  orbitControls.zoomSpeed = 1.0;
  orbitControls.minDistance = 2.5;
  orbitControls.maxDistance = 25;
  orbitControls.maxPolarAngle = Math.PI * 0.495;
  orbitControls.target.set(0, 0.15, 0);
  orbitControls.update();
  return orbitControls;
}

/**
 * Drives one animation frame for the interactive terrain scene.
 * Inputs: none directly; uses module-level `renderer`, `scene`, and `camera`.
 * Outputs: schedules next frame and renders the current terrain state.
 * Internal: loops via `requestAnimationFrame` and renders directly with Three.js.
 */
function animate() {
  requestAnimationFrame(animate);
  const time = performance.now() * 0.001;
  controls.update();
  waterSystem.render(time);
  renderer.render(scene, camera);
}

animate();

/**
 * Initializes Supabase auth for cloud landscape storage only.
 * Inputs: none; reads runtime Supabase config and module-level scene/control instances.
 * Outputs: mounts auth widget/modal and landscape storage; editor stays interactive regardless of session.
 * Internal: builds Supabase client, wires storage enablement to session, and keeps terrain/orbit controls always on.
 */
function initializeAuthentication() {
  if (shouldBypassAuthForDevelopment()) {
    console.info('Development auth bypass enabled (localhost only).');
    setEditorChromeVisible(true);
    return;
  }

  if (!isSupabaseConfigured()) {
    const { url, anonKey } = getSupabaseConfig();
    console.warn('Supabase auth disabled. Set url/anonKey in src/config/supabaseConfig.js.', { url, anonKeyLength: anonKey.length });
    setEditorChromeVisible(true);
    return;
  }

  const { url, anonKey } = getSupabaseConfig();
  const supabase = createClient(url, anonKey);
  const landscapeStore = createLandscapeStore(supabase);
  const authActions = {
    openAuthModal: () => {},
    signOut: async () => {}
  };
  storagePanel = createLandscapeStoragePanel({
    store: landscapeStore,
    getCurrentConfig: getSerializableLandscapeConfig,
    applyConfig: applySavedLandscapeConfig,
    requestSignIn: () => authActions.openAuthModal(),
    signOut: () => authActions.signOut()
  });
  setEditorChromeVisible(true);
  const authUi = createAuthOverlay(supabase, async (isSignedIn) => {
    if (!storagePanel) {
      return;
    }

    storagePanel.setSignedIn(isSignedIn);
    if (isSignedIn) {
      await storagePanel.refresh();
    }
  });
  authActions.openAuthModal = authUi.openAuthModal;
  authActions.signOut = authUi.signOut;
}

/**
 * Shows or hides primary editor UI chrome (terrain panel and landscape storage when present).
 * Inputs: `isVisible` boolean.
 * Outputs: toggles terrain panel display; storage panel follows when it exists.
 * Internal: used for startup layout only; auth no longer hides these panels.
 */
function setEditorChromeVisible(isVisible) {
  const display = isVisible ? 'block' : 'none';
  terrainControls.element.style.display = display;
  if (storagePanel) {
    storagePanel.element.style.display = display;
  }
}

/**
 * Captures current terrain settings as a serializable config payload.
 * Inputs: none; reads active renderer settings from module scope.
 * Outputs: plain object containing terrain settings snapshot.
 * Internal: clones settings so persistence writes are not tied to mutable runtime references.
 */
function getSerializableLandscapeConfig() {
  return {
    terrainSettings: { ...terrainRenderer.settings }
  };
}

/**
 * Applies a saved landscape payload back into renderer, water system, and controls UI.
 * Inputs: `config` object loaded from persisted `config_json`.
 * Outputs: mutates scene state to match saved settings and updates visible control values.
 * Internal: validates payload shape, updates terrain first, then syncs dependent sea level and input widgets.
 */
function applySavedLandscapeConfig(config) {
  const terrainSettings = config?.terrainSettings;
  if (!terrainSettings || typeof terrainSettings !== 'object') {
    return;
  }

  terrainRenderer.update(terrainSettings);
  if (typeof terrainSettings.seaLevel === 'number') {
    waterSystem.updateSeaLevel(terrainSettings.seaLevel);
  }
  terrainControls.setValues(terrainSettings);
}

/**
 * Determines whether auth should be bypassed for local development only.
 * Inputs: none; reads browser location, URL query params, and localStorage.
 * Outputs: boolean indicating if auth overlay/gating should be skipped.
 * Internal: only returns true on localhost when `?devBypassAuth=1` is present or localStorage flag is set.
 */
function shouldBypassAuthForDevelopment() {
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1';
  if (!isLocalhost) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get('devBypassAuth');
  if (queryValue === '1' || queryValue === 'true') {
    localStorage.setItem('devBypassAuth', '1');
    return true;
  }

  return localStorage.getItem('devBypassAuth') === '1';
}