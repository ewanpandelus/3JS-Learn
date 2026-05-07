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
 * Initializes Supabase auth and gates editor interaction until signed in.
 * Inputs: none; reads runtime Supabase config and module-level scene/control instances.
 * Outputs: mounts auth overlay and toggles editor interactivity by session state.
 * Internal: builds Supabase client, checks config validity, and uses auth callback to lock/unlock controls.
 */
function initializeAuthentication() {
  if (!isSupabaseConfigured()) {
    const { url, anonKey } = getSupabaseConfig();
    console.warn('Supabase auth disabled. Set url/anonKey in src/config/supabaseConfig.js.', { url, anonKeyLength: anonKey.length });
    lockEditorForAuth(false);
    return;
  }

  const { url, anonKey } = getSupabaseConfig();
  const supabase = createClient(url, anonKey);
  const landscapeStore = createLandscapeStore(supabase);
  storagePanel = createLandscapeStoragePanel({
    store: landscapeStore,
    getCurrentConfig: getSerializableLandscapeConfig,
    applyConfig: applySavedLandscapeConfig
  });
  createAuthOverlay(supabase, async (isSignedIn) => {
    lockEditorForAuth(!isSignedIn);
    if (!storagePanel) {
      return;
    }

    storagePanel.setDisabled(!isSignedIn);
    if (isSignedIn) {
      await storagePanel.refresh();
    }
  });
}

/**
 * Toggles controls and UI visibility when authentication state changes.
 * Inputs: `isLocked` boolean indicating whether editor access should be blocked.
 * Outputs: enables/disables orbit controls and shows/hides terrain control panel.
 * Internal: centralizes lock state so both auth startup and session changes use one path.
 */
function lockEditorForAuth(isLocked) {
  controls.enabled = !isLocked;
  terrainControls.element.style.display = isLocked ? 'none' : 'block';
  if (storagePanel) {
    storagePanel.element.style.display = isLocked ? 'none' : 'block';
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