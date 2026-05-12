import * as THREE from 'three';

const WATER_SCALE = 9;
const WAVE_DISTORTION = 0.01;
const REFLECTION_BIAS = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0
);
const REFLECTION_MIN_SIZE = 2;
const EDGE_FADE_START = 0.62;
const EDGE_FADE_END = 0.99;
const REFLECTION_BASE = 0.08;
const REFLECTION_POWER = 2.4;
const REFRACTION_BASE = 0.85;
const REFLECTION_CLIP_OFFSET = 0.001;
const REFRACTION_CLIP_OFFSET = 0.001;

/**
 * Builds a water plane with an offscreen terrain reflection pass.
 * Inputs: `renderer`, `scene`, `camera`, terrain `width`/`depth`, and initial `seaLevel`.
 * Outputs: object containing `water` mesh plus `render`, `resize`, and `updateSeaLevel` hooks.
 * Internal: renders reflection/refraction textures with clip planes, then projects those textures in the water shader.
 */
export function createWaterSystem({ renderer, scene, camera, width, depth, seaLevel }) {
  const reflectionSize = getReflectionTargetSize(renderer);
  const reflectionTarget = new THREE.WebGLRenderTarget(reflectionSize.x, reflectionSize.y, {
    depthBuffer: true,
    stencilBuffer: false
  });
  const refractionTarget = new THREE.WebGLRenderTarget(reflectionSize.x, reflectionSize.y, {
    depthBuffer: true,
    stencilBuffer: false
  });
  reflectionTarget.texture.colorSpace = THREE.SRGBColorSpace;
  refractionTarget.texture.colorSpace = THREE.SRGBColorSpace;
  const reflectionCamera = camera.clone();
  reflectionCamera.matrixAutoUpdate = true;
  const reflectionMatrix = new THREE.Matrix4();
  const refractionMatrix = new THREE.Matrix4();
  const reflectionCameraPosition = new THREE.Vector3();
  const reflectionLookTarget = new THREE.Vector3();
  const mirroredCameraPosition = new THREE.Vector3();
  const mirroredLookTarget = new THREE.Vector3();
  const reflectionClipPlane = new THREE.Plane();
  const refractionClipPlane = new THREE.Plane();

  const waterGeometry = new THREE.PlaneGeometry(width * WATER_SCALE, depth * WATER_SCALE, 1, 1);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSeaHalfExtent: { value: new THREE.Vector2((width * WATER_SCALE) * 0.5, (depth * WATER_SCALE) * 0.5) },
      uTime: { value: 0 },
      uReflectionMap: { value: reflectionTarget.texture },
      uReflectionMatrix: { value: reflectionMatrix },
      uRefractionMap: { value: refractionTarget.texture },
      uRefractionMatrix: { value: refractionMatrix },
      uTint: { value: new THREE.Color(0x2f89c9) },
      uDeepTint: { value: new THREE.Color(0x13374f) },
      uSkyTint: { value: new THREE.Color(0x8aa8c7) },
      uAlphaMin: { value: 0.72 },
      uAlphaMax: { value: 0.96 },
      uFresnelPower: { value: REFLECTION_POWER }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying vec4 vReflectionCoord;
      varying vec4 vRefractionCoord;
      uniform mat4 uReflectionMatrix;
      uniform mat4 uRefractionMatrix;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vReflectionCoord = uReflectionMatrix * world;
        vRefractionCoord = uRefractionMatrix * world;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec2 uSeaHalfExtent;
      uniform float uTime;
      uniform sampler2D uReflectionMap;
      uniform sampler2D uRefractionMap;
      uniform vec3 uTint;
      uniform vec3 uDeepTint;
      uniform vec3 uSkyTint;
      uniform float uAlphaMin;
      uniform float uAlphaMax;
      uniform float uFresnelPower;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying vec4 vReflectionCoord;
      varying vec4 vRefractionCoord;

      void main() {
        float wave =
          sin(vWorldPos.x * 0.18 + uTime * 0.8) * 0.5 +
          cos(vWorldPos.z * 0.23 - uTime * 0.65) * 0.5;
        float ripple = 0.5 + wave * 0.5;
        vec3 base = mix(uTint, uDeepTint, smoothstep(0.0, 1.0, vUv.y + wave * ${WAVE_DISTORTION.toFixed(5)}));
        vec3 viewVector = normalize(cameraPosition - vWorldPos);
        float ndotv = clamp(dot(viewVector, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, uFresnelPower);
        vec2 reflectionUv = vReflectionCoord.xy / max(vReflectionCoord.w, 0.00001);
        vec2 refractionUv = vRefractionCoord.xy / max(vRefractionCoord.w, 0.00001);
        reflectionUv = clamp(reflectionUv, 0.001, 0.999);
        refractionUv = clamp(refractionUv, 0.001, 0.999);
        vec3 reflectionColor = texture2D(uReflectionMap, reflectionUv).rgb;
        vec3 refractionColor = texture2D(uRefractionMap, refractionUv).rgb;
        float reflectionWeight = clamp(${REFLECTION_BASE.toFixed(2)} + fresnel, 0.0, 1.0);
        float refractionWeight = clamp(${REFRACTION_BASE.toFixed(2)} * (1.0 - fresnel), 0.0, 1.0);
        vec3 refracted = mix(base, refractionColor, refractionWeight);
        vec3 reflectionBlend = mix(refracted, reflectionColor, reflectionWeight);
        vec3 color = mix(reflectionBlend, uSkyTint, fresnel * 0.12) + vec3(ripple * 0.025);

        vec2 edgeNorm = abs(vWorldPos.xz) / uSeaHalfExtent;
        float edgeDistance = max(edgeNorm.x, edgeNorm.y);
        float outerFade = 1.0 - smoothstep(${EDGE_FADE_START.toFixed(2)}, ${EDGE_FADE_END.toFixed(2)}, edgeDistance);
        float angleAlpha = mix(uAlphaMin, uAlphaMax, fresnel);
        float alpha = angleAlpha * outerFade;
        gl_FragColor = vec4(color, alpha);
      }
    `
  });

  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.y = seaLevel;
  water.receiveShadow = false;
  water.castShadow = false;

  /**
   * Updates one frame of reflection and animated water shading.
   * Inputs: `time` animation scalar.
   * Outputs: renders reflection texture and updates water shader uniforms.
   * Internal: mirrors active camera over water plane, hides water for offscreen pass, then restores renderer state.
   */
  function render(time) {
    waterMaterial.uniforms.uTime.value = time;
    renderReflectionTexture();
    renderRefractionTexture();
  }

  /**
   * Resizes internal reflection target when viewport changes.
   * Inputs: current viewport `widthPx` and `heightPx`.
   * Outputs: updates reflection render target dimensions.
   * Internal: scales offscreen target with pixel ratio and clamps to valid dimensions.
   */
  function resize(widthPx, heightPx) {
    const pixelRatio = renderer.getPixelRatio();
    const nextWidth = Math.max(REFLECTION_MIN_SIZE, Math.floor(widthPx * pixelRatio));
    const nextHeight = Math.max(REFLECTION_MIN_SIZE, Math.floor(heightPx * pixelRatio));
    reflectionTarget.setSize(nextWidth, nextHeight);
    refractionTarget.setSize(nextWidth, nextHeight);
  }

  /**
   * Moves water surface to a new sea level.
   * Inputs: numeric `nextSeaLevel`.
   * Outputs: updates water mesh world Y position.
   * Internal: direct assignment to mesh transform for immediate effect.
   */
  function updateSeaLevel(nextSeaLevel) {
    water.position.y = nextSeaLevel;
  }

  /**
   * Renders terrain and scene objects into reflection texture from mirrored viewpoint.
   * Inputs: none; uses current renderer/scene/camera state.
   * Outputs: refreshes reflection render target texture every frame.
   * Internal: mirrors camera position/target around water plane, renders with water hidden, and updates projection matrix uniform.
   */
  function renderReflectionTexture() {
    const currentSeaLevel = water.position.y;
    reflectionCameraPosition.copy(camera.position);
    reflectionLookTarget.copy(controlsTargetFromCamera(camera));

    mirrorPointAcrossWaterPlane(reflectionCameraPosition, currentSeaLevel, mirroredCameraPosition);
    mirrorPointAcrossWaterPlane(reflectionLookTarget, currentSeaLevel, mirroredLookTarget);

    reflectionCamera.position.copy(mirroredCameraPosition);
    reflectionCamera.up.copy(camera.up).multiplyScalar(-1);
    reflectionCamera.lookAt(mirroredLookTarget);
    reflectionCamera.near = camera.near;
    reflectionCamera.far = camera.far;
    reflectionCamera.fov = camera.fov;
    reflectionCamera.aspect = camera.aspect;
    reflectionCamera.updateProjectionMatrix();
    reflectionCamera.updateMatrixWorld(true);

    reflectionMatrix.multiplyMatrices(reflectionCamera.projectionMatrix, reflectionCamera.matrixWorldInverse);
    reflectionMatrix.premultiply(REFLECTION_BIAS);
    waterMaterial.uniforms.uReflectionMatrix.value.copy(reflectionMatrix);

    const previousRenderTarget = renderer.getRenderTarget();
    const previousXrEnabled = renderer.xr.enabled;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousClippingPlanes = renderer.clippingPlanes;
    const previousLocalClippingEnabled = renderer.localClippingEnabled;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.localClippingEnabled = true;
    reflectionClipPlane.set(new THREE.Vector3(0, 1, 0), -(currentSeaLevel + REFLECTION_CLIP_OFFSET));
    renderer.clippingPlanes = [reflectionClipPlane];

    water.visible = false;
    renderer.setRenderTarget(reflectionTarget);
    renderer.clear();
    renderer.render(scene, reflectionCamera);
    water.visible = true;

    renderer.xr.enabled = previousXrEnabled;
    renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
    renderer.clippingPlanes = previousClippingPlanes;
    renderer.localClippingEnabled = previousLocalClippingEnabled;
    renderer.setRenderTarget(previousRenderTarget);
  }

  /**
   * Renders below-water scene content into refraction texture from main camera.
   * Inputs: none; uses active camera and current sea-level plane.
   * Outputs: refreshes refraction target texture and projection matrix uniform.
   * Internal: clips geometry above water plane, hides water mesh for pass isolation, then restores renderer state.
   */
  function renderRefractionTexture() {
    const currentSeaLevel = water.position.y;
    refractionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    refractionMatrix.premultiply(REFLECTION_BIAS);
    waterMaterial.uniforms.uRefractionMatrix.value.copy(refractionMatrix);

    const previousRenderTarget = renderer.getRenderTarget();
    const previousXrEnabled = renderer.xr.enabled;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousClippingPlanes = renderer.clippingPlanes;
    const previousLocalClippingEnabled = renderer.localClippingEnabled;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.localClippingEnabled = true;
    refractionClipPlane.set(new THREE.Vector3(0, -1, 0), currentSeaLevel - REFRACTION_CLIP_OFFSET);
    renderer.clippingPlanes = [refractionClipPlane];

    water.visible = false;
    renderer.setRenderTarget(refractionTarget);
    renderer.clear();
    renderer.render(scene, camera);
    water.visible = true;

    renderer.xr.enabled = previousXrEnabled;
    renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
    renderer.clippingPlanes = previousClippingPlanes;
    renderer.localClippingEnabled = previousLocalClippingEnabled;
    renderer.setRenderTarget(previousRenderTarget);
  }

  return {
    water,
    render,
    resize,
    updateSeaLevel
  };
}

/**
 * Mirrors a world-space point across the horizontal water plane.
 * Inputs: `point` source vector, `seaLevel` plane Y value, and mutable `out` vector.
 * Outputs: reflected point in `out`.
 * Internal: preserves x/z and reflects y distance around the sea-level plane.
 */
function mirrorPointAcrossWaterPlane(point, seaLevel, out) {
  out.set(point.x, seaLevel - (point.y - seaLevel), point.z);
}

/**
 * Approximates camera look target from world direction and position.
 * Inputs: active `camera`.
 * Outputs: world-space target point one unit forward from camera.
 * Internal: converts local forward axis to world direction then offsets by camera position.
 */
function controlsTargetFromCamera(camera) {
  const lookDirection = new THREE.Vector3();
  camera.getWorldDirection(lookDirection);
  return lookDirection.add(camera.position);
}

/**
 * Computes initial reflection target size from renderer viewport and pixel ratio.
 * Inputs: active `renderer`.
 * Outputs: vector-like object containing `x` width and `y` height in pixels.
 * Internal: multiplies canvas dimensions by pixel ratio and clamps to a minimum size.
 */
function getReflectionTargetSize(renderer) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const pixelRatio = renderer.getPixelRatio();
  return {
    x: Math.max(REFLECTION_MIN_SIZE, Math.floor(size.x * pixelRatio)),
    y: Math.max(REFLECTION_MIN_SIZE, Math.floor(size.y * pixelRatio))
  };
}
