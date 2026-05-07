import { createCoreScene, handleResize } from './src/setup/createCoreScene.js';
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import { createTerrainRenderer } from './src/terrain/createTerrainRenderer.js';
import { createTerrainControls } from './src/ui/createTerrainControls.js';
import { createWaterSystem } from './src/water/createWaterSystem.js';

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

createTerrainControls(terrainRenderer.settings, (patch) => {
  terrainRenderer.update(patch);
  if (typeof patch.seaLevel === 'number') {
    waterSystem.updateSeaLevel(patch.seaLevel);
  }
});

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