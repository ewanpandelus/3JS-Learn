import * as THREE from 'three';

/**
 * Creates the renderer, base scene, camera, and default lighting.
 * Inputs: none.
 * Outputs: object containing `renderer`, `scene`, `camera`, and `sunLight`.
 * Internal: configures renderer sizing/pixel ratio, initializes scene and perspective camera, and adds ambient + directional lights.
 */
export function createCoreScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8aa8c7, 12, 34);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 6);

  // Soft baseline light plus a directional "sun" light.
  scene.add(new THREE.AmbientLight(0xf2f7ff, 0.35));
  const sunLight = new THREE.DirectionalLight(0xfff8e8, 1.2);
  sunLight.position.set(7, 12, 5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -12;
  sunLight.shadow.camera.right = 12;
  sunLight.shadow.camera.top = 12;
  sunLight.shadow.camera.bottom = -12;
  scene.add(sunLight);

  return { renderer, scene, camera, sunLight };
}

/**
 * Registers a window resize handler and updates camera + renderer dimensions.
 * Inputs: renderer (`THREE.WebGLRenderer`), camera (`THREE.PerspectiveCamera`), optional `onResize(width, height)` callback.
 * Outputs: side effect of attaching a resize listener; optionally invokes callback with new dimensions.
 * Internal: computes current viewport size, reapplies renderer size, updates camera aspect/projection, then calls the provided hook.
 */
export function handleResize(renderer, camera, onResize) {
  /**
   * Applies the latest viewport size to render resources.
   * Inputs: none; reads browser window dimensions.
   * Outputs: updates renderer/camera and triggers optional resize callback.
   * Internal: reads window dimensions and synchronizes dependent render state.
   */
  const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (onResize) {
      onResize(width, height);
    }
  };

  window.addEventListener('resize', resize);
}
