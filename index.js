import * as THREE from 'three';
import { createCoreScene, handleResize } from './src/setup/createCoreScene.js';
import { createPlanet } from './src/planet/createPlanet.js';
import { createAtmosphere } from './src/planet/createAtmosphere.js';
import { createWaterPost } from './src/postprocessing/createWaterPost.js';

const { renderer, scene, camera } = createCoreScene();

const { planet, radius } = createPlanet();
scene.add(planet);
const atmosphere = createAtmosphere(radius);
scene.add(atmosphere);

const waterPost = createWaterPost(renderer, scene, camera, {
  planetCenter: new THREE.Vector3(0, 0, 0),
  planetRadius: radius
});

handleResize(renderer, camera, (width, height) => {
  waterPost.resize(width, height);
});

let time = 0;

/**
 * Drives one animation frame for the planet scene.
 * Inputs: none directly; uses module-level state (`time`, `planet`, `waterPost`).
 * Outputs: schedules next frame, rotates planet, and renders the post chain.
 * Internal: increments time, applies a small Y rotation, then renders depth-aware water.
 */
function animate() {
  requestAnimationFrame(animate);

  time += 0.002;
  planet.rotation.y += 0.002;
  atmosphere.rotation.y += 0.002;

  // Render through the depth-aware water post chain.
  waterPost.render(time);
}

animate();