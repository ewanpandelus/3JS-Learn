import { createCoreScene, handleResize } from './src/setup/createCoreScene.js';
import { createTerrainRenderer } from './src/terrain/createTerrainRenderer.js';
import { createTerrainControls } from './src/ui/createTerrainControls.js';

const { renderer, scene, camera } = createCoreScene();
renderer.setClearColor(0x8aa8c7, 1);

const terrainRenderer = createTerrainRenderer();
scene.add(terrainRenderer.mesh);

camera.position.set(4, 4.5, 7);
camera.lookAt(0, 0, 0);

createTerrainControls(terrainRenderer.settings, (patch) => {
  terrainRenderer.update(patch);
});

handleResize(renderer, camera, () => {});

/**
 * Drives one animation frame for the interactive terrain scene.
 * Inputs: none directly; uses module-level `renderer`, `scene`, and `camera`.
 * Outputs: schedules next frame and renders the current terrain state.
 * Internal: loops via `requestAnimationFrame` and renders directly with Three.js.
 */
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

animate();