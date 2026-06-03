import * as THREE from 'three';

import {
  WATER_SURFACE_DEPTH,
  WATER_SURFACE_MARGIN_SCALE,
  WATER_SURFACE_WIDTH
} from '../config/worldExtents.js';

/** Reference terrain extent used when deriving default water surface size. */
export const WATER_REFERENCE_TERRAIN_EXTENT = WATER_SURFACE_WIDTH / WATER_SURFACE_MARGIN_SCALE;
export const WATER_SURFACE_SCALE = WATER_SURFACE_MARGIN_SCALE;
export const DEFAULT_WATER_SURFACE_WIDTH = WATER_SURFACE_WIDTH;
export const DEFAULT_WATER_SURFACE_DEPTH = WATER_SURFACE_DEPTH;
const REFLECTION_BIAS = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0
);
const REFLECTION_MIN_SIZE = 2;
const OPEN_WATER_DEPTH_SAMPLE = 0.999;
const REFLECTION_CLIP_OFFSET = 0.001;
const REFRACTION_CLIP_OFFSET = 0.001;
/** Suppresses false shallow depth from depth-buffer silhouette noise (world units). */
const SHORELINE_DEPTH_EPSILON = 0.003;
/** Minimum shoreline fade band when fade-end slider is very tight (world units). */
const SHORELINE_MIN_FADE_WIDTH = 0.06;
/** Scales derivative-based widening of the shoreline fade. */
const SHORELINE_FWIDTH_SCALE = 1.25;
const DEPTH_SAMPLE_OFFSETS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

/**
 * Built-in defaults for water tuning (used when localStorage has no saved snapshot).
 * Inputs: none (edit this object to change repo defaults).
 * Outputs: plain settings object passed to the shader and water control panel.
 * Internal: single source of truth for numeric and hex colour defaults.
 */
export const DEFAULT_WATER_SETTINGS = {
  depthMultiplier: 8,
  alphaMultiplier: 23.5,
  shallowDepthFadeStart: 0,
  shallowDepthFadeEnd: 0.05,
  waterColourMix: 1,
  alphaMin: 0.34,
  alphaMax: 1,
  reflectionBase: 0,
  refractionBase: 0,
  fresnelPower: 0.6,
  waterColourShallow: '#80f7fa',
  waterColourDeep: '#0f0f33'
};

/**
 * Builds a water plane with an offscreen terrain reflection pass.
 * Inputs: `renderer`, `scene`, `camera`, water surface `width`/`depth`, initial `seaLevel`, optional `waterSettings` partial overrides.
 * Outputs: object with `water`, `render`, `resize`, `updateSeaLevel`, `getSettings`, and `updateSettings`.
 * Internal: renders reflection/refraction textures with clip planes, then projects those textures in the water shader.
 */
export function createWaterSystem({ renderer, scene, camera, width, depth, seaLevel, waterSettings = {} }) {
  const resolvedWater = { ...DEFAULT_WATER_SETTINGS, ...waterSettings };
  const reflectionSize = getReflectionTargetSize(renderer);
  const reflectionTarget = new THREE.WebGLRenderTarget(reflectionSize.x, reflectionSize.y, {
    depthBuffer: true,
    stencilBuffer: false
  });
  const refractionDepthTexture = new THREE.DepthTexture(reflectionSize.x, reflectionSize.y);
  refractionDepthTexture.format = THREE.DepthFormat;
  refractionDepthTexture.type = THREE.UnsignedShortType;
  const refractionTarget = new THREE.WebGLRenderTarget(reflectionSize.x, reflectionSize.y, {
    depthBuffer: true,
    depthTexture: refractionDepthTexture,
    stencilBuffer: false
  });
  reflectionTarget.texture.colorSpace = THREE.SRGBColorSpace;
  refractionTarget.texture.colorSpace = THREE.SRGBColorSpace;
  configureWaterRenderTargetTexture(reflectionTarget.texture);
  configureWaterRenderTargetTexture(refractionTarget.texture);
  const depthTexelSize = new THREE.Vector2(1 / reflectionSize.x, 1 / reflectionSize.y);
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

  const waterGeometry = new THREE.PlaneGeometry(width, depth, 1, 1);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uReflectionMap: { value: reflectionTarget.texture },
      uReflectionMatrix: { value: reflectionMatrix },
      uRefractionMap: { value: refractionTarget.texture },
      uRefractionMatrix: { value: refractionMatrix },
      uDepthMap: { value: refractionDepthTexture },
      uDepthTexelSize: { value: depthTexelSize },
      uCameraNear: { value: camera.near },
      uCameraFar: { value: camera.far },
      uCameraInverseProjectionMatrix: { value: new THREE.Matrix4() },
      uCameraMatrixWorld: { value: new THREE.Matrix4() },
      uSeaLevel: { value: seaLevel },
      uDepthMultiplier: { value: resolvedWater.depthMultiplier },
      uAlphaMultiplier: { value: resolvedWater.alphaMultiplier },
      uShallowDepthFadeStart: { value: resolvedWater.shallowDepthFadeStart },
      uShallowDepthFadeEnd: { value: resolvedWater.shallowDepthFadeEnd },
      uWaterColourShallow: { value: new THREE.Color(resolvedWater.waterColourShallow) },
      uWaterColourDeep: { value: new THREE.Color(resolvedWater.waterColourDeep) },
      uWaterColourMix: { value: resolvedWater.waterColourMix },
      uSkyTint: { value: new THREE.Color(0x8aa8c7) },
      uAlphaMin: { value: resolvedWater.alphaMin },
      uAlphaMax: { value: resolvedWater.alphaMax },
      uFresnelPower: { value: resolvedWater.fresnelPower },
      uReflectionBase: { value: resolvedWater.reflectionBase },
      uRefractionBase: { value: resolvedWater.refractionBase }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying vec4 vClipSpace;
      varying vec4 vReflectionCoord;
      varying vec4 vRefractionCoord;
      uniform mat4 uReflectionMatrix;
      uniform mat4 uRefractionMatrix;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vClipSpace = projectionMatrix * viewMatrix * world;
        vReflectionCoord = uReflectionMatrix * world;
        vRefractionCoord = uRefractionMatrix * world;
        gl_Position = vClipSpace;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform sampler2D uReflectionMap;
      uniform sampler2D uRefractionMap;
      uniform sampler2D uDepthMap;
      uniform vec2 uDepthTexelSize;
      uniform float uCameraNear;
      uniform float uCameraFar;
      uniform mat4 uCameraInverseProjectionMatrix;
      uniform mat4 uCameraMatrixWorld;
      uniform float uSeaLevel;
      uniform float uDepthMultiplier;
      uniform float uAlphaMultiplier;
      uniform float uShallowDepthFadeStart;
      uniform float uShallowDepthFadeEnd;
      uniform vec3 uWaterColourShallow;
      uniform vec3 uWaterColourDeep;
      uniform float uWaterColourMix;
      uniform vec3 uSkyTint;
      uniform float uAlphaMin;
      uniform float uAlphaMax;
      uniform float uFresnelPower;
      uniform float uReflectionBase;
      uniform float uRefractionBase;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying vec4 vClipSpace;
      varying vec4 vReflectionCoord;
      varying vec4 vRefractionCoord;

      float columnDepthFromPacked(const in vec2 depthUv, const in float packedDepth) {
        if (packedDepth >= ${OPEN_WATER_DEPTH_SAMPLE.toFixed(3)}) {
          return uShallowDepthFadeEnd + 1.0;
        }
        vec2 ndcXY = depthUv * 2.0 - 1.0;
        float ndcZ = packedDepth * 2.0 - 1.0;
        vec4 clipPos = vec4(ndcXY, ndcZ, 1.0);
        vec4 viewPos = uCameraInverseProjectionMatrix * clipPos;
        viewPos /= viewPos.w;
        vec4 worldPos = uCameraMatrixWorld * viewPos;
        return uSeaLevel - worldPos.y;
      }

      float sampleWaterColumnDepth(const in vec2 depthUv) {
        float shallowestColumn = columnDepthFromPacked(
          depthUv,
          texture2D(uDepthMap, depthUv).r
        );
        ${DEPTH_SAMPLE_OFFSETS.slice(1).map(
          ([offsetX, offsetY]) => {
            const offsetGlsl = `vec2(${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`;
            return `{
          vec2 tapUv = depthUv + uDepthTexelSize * ${offsetGlsl};
          float tapColumn = columnDepthFromPacked(tapUv, texture2D(uDepthMap, tapUv).r);
          shallowestColumn = min(shallowestColumn, tapColumn);
        }`;
          }
        ).join('\n        ')}
        return shallowestColumn;
      }

      void main() {
        vec2 depthUv = (vClipSpace.xy / vClipSpace.w) * 0.5 + 0.5;
        depthUv = clamp(depthUv, uDepthTexelSize * 2.0, 1.0 - uDepthTexelSize * 2.0);

        float waterColumnDepth = max(
          sampleWaterColumnDepth(depthUv) - ${SHORELINE_DEPTH_EPSILON.toFixed(3)},
          0.0
        );
        float shoreBand = max(
          uShallowDepthFadeEnd - uShallowDepthFadeStart,
          ${SHORELINE_MIN_FADE_WIDTH.toFixed(2)}
        );
        float shoreAA = fwidth(waterColumnDepth) * ${SHORELINE_FWIDTH_SCALE.toFixed(1)};
        float shoreFade = smoothstep(
          uShallowDepthFadeStart - shoreAA,
          uShallowDepthFadeStart + shoreBand + shoreAA,
          waterColumnDepth
        );
        float opticalDepth = 1.0 - exp(-waterColumnDepth * uDepthMultiplier);
        float depthAlpha = (1.0 - exp(-waterColumnDepth * uAlphaMultiplier)) * shoreFade;

        vec3 waterColour = mix(uWaterColourShallow, uWaterColourDeep, opticalDepth);

        float wave =
          sin(vWorldPos.x * 0.18 + uTime * 0.8) * 0.5 +
          cos(vWorldPos.z * 0.23 - uTime * 0.65) * 0.5;
        float ripple = 0.5 + wave * 0.5;

        vec3 viewVector = normalize(cameraPosition - vWorldPos);
        float ndotv = clamp(dot(viewVector, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, uFresnelPower);
        float refractiveFactor = pow(ndotv, 2.0);

        vec2 reflectionUv = vReflectionCoord.xy / max(vReflectionCoord.w, 0.00001);
        vec2 refractionUv = vRefractionCoord.xy / max(vRefractionCoord.w, 0.00001);
        reflectionUv = clamp(reflectionUv, 0.001, 0.999);
        refractionUv = clamp(refractionUv, 0.001, 0.999);

        vec3 reflectionColor = texture2D(uReflectionMap, reflectionUv).rgb;
        vec3 refractionColor = texture2D(uRefractionMap, refractionUv).rgb;

        float reflectionWeight = clamp(uReflectionBase + fresnel, 0.0, 1.0);
        float refractionWeight = clamp(uRefractionBase * (1.0 - fresnel), 0.0, 1.0);
        vec3 refracted = mix(waterColour, refractionColor, refractionWeight);
        vec3 color = mix(refracted, reflectionColor, reflectionWeight);
        color = mix(color, uSkyTint, fresnel * 0.12) + vec3(ripple * 0.025);

        float angleAlpha = mix(uAlphaMin, uAlphaMax, fresnel);
        float alpha = angleAlpha * depthAlpha;
        gl_FragColor = vec4(color, alpha);
      }
    `
  });

  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.y = seaLevel;
  water.renderOrder = 1;
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
    updateDepthUniforms();
  }

  /**
   * Syncs camera matrices and sea level for world-space depth reconstruction.
   * Inputs: none; reads active `camera` and water mesh position.
   * Outputs: updates depth-related uniforms on `waterMaterial`.
   * Internal: copies inverse projection, world matrix, clip distances, and sea level each frame.
   */
  function updateDepthUniforms() {
    waterMaterial.uniforms.uCameraNear.value = camera.near;
    waterMaterial.uniforms.uCameraFar.value = camera.far;
    waterMaterial.uniforms.uCameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
    waterMaterial.uniforms.uCameraMatrixWorld.value.copy(camera.matrixWorld);
    waterMaterial.uniforms.uSeaLevel.value = water.position.y;
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
    waterMaterial.uniforms.uDepthTexelSize.value.set(1 / nextWidth, 1 / nextHeight);
  }

  /**
   * Moves water surface to a new sea level.
   * Inputs: numeric `nextSeaLevel`.
   * Outputs: updates water mesh world Y position.
   * Internal: direct assignment to mesh transform for immediate effect.
   */
  function updateSeaLevel(nextSeaLevel) {
    water.position.y = nextSeaLevel;
    waterMaterial.uniforms.uSeaLevel.value = nextSeaLevel;
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

  /**
   * Reads current tunable water shader values.
   * Inputs: none.
   * Outputs: plain settings object matching `DEFAULT_WATER_SETTINGS` keys.
   * Internal: copies live uniform values and encodes colours as hex strings.
   */
  function getSettings() {
    const uniforms = waterMaterial.uniforms;
    return {
      depthMultiplier: uniforms.uDepthMultiplier.value,
      alphaMultiplier: uniforms.uAlphaMultiplier.value,
      shallowDepthFadeStart: uniforms.uShallowDepthFadeStart.value,
      shallowDepthFadeEnd: uniforms.uShallowDepthFadeEnd.value,
      waterColourMix: uniforms.uWaterColourMix.value,
      alphaMin: uniforms.uAlphaMin.value,
      alphaMax: uniforms.uAlphaMax.value,
      reflectionBase: uniforms.uReflectionBase.value,
      refractionBase: uniforms.uRefractionBase.value,
      fresnelPower: uniforms.uFresnelPower.value,
      waterColourShallow: `#${uniforms.uWaterColourShallow.value.getHexString()}`,
      waterColourDeep: `#${uniforms.uWaterColourDeep.value.getHexString()}`
    };
  }

  /**
   * Applies partial water settings to shader uniforms.
   * Inputs: `patch` object with any subset of tunable water keys.
   * Outputs: mutates `waterMaterial` uniforms immediately.
   * Internal: maps each known key to its matching uniform value or colour object.
   */
  function updateSettings(patch) {
    const uniforms = waterMaterial.uniforms;
    if (typeof patch.depthMultiplier === 'number') {
      uniforms.uDepthMultiplier.value = patch.depthMultiplier;
    }
    if (typeof patch.alphaMultiplier === 'number') {
      uniforms.uAlphaMultiplier.value = patch.alphaMultiplier;
    }
    if (typeof patch.shallowDepthFadeStart === 'number') {
      uniforms.uShallowDepthFadeStart.value = patch.shallowDepthFadeStart;
    }
    if (typeof patch.shallowDepthFadeEnd === 'number') {
      uniforms.uShallowDepthFadeEnd.value = patch.shallowDepthFadeEnd;
    }
    if (typeof patch.waterColourMix === 'number') {
      uniforms.uWaterColourMix.value = patch.waterColourMix;
    }
    if (typeof patch.alphaMin === 'number') {
      uniforms.uAlphaMin.value = patch.alphaMin;
    }
    if (typeof patch.alphaMax === 'number') {
      uniforms.uAlphaMax.value = patch.alphaMax;
    }
    if (typeof patch.reflectionBase === 'number') {
      uniforms.uReflectionBase.value = patch.reflectionBase;
    }
    if (typeof patch.refractionBase === 'number') {
      uniforms.uRefractionBase.value = patch.refractionBase;
    }
    if (typeof patch.fresnelPower === 'number') {
      uniforms.uFresnelPower.value = patch.fresnelPower;
    }
    if (typeof patch.waterColourShallow === 'string') {
      uniforms.uWaterColourShallow.value.set(patch.waterColourShallow);
    }
    if (typeof patch.waterColourDeep === 'string') {
      uniforms.uWaterColourDeep.value.set(patch.waterColourDeep);
    }
  }

  return {
    water,
    render,
    resize,
    updateSeaLevel,
    getSettings,
    updateSettings
  };
}

/**
 * Configures offscreen water textures for stable edge sampling.
 * Inputs: `texture` as `THREE.Texture` attached to a water render target.
 * Outputs: mutates wrap/filter/mipmap settings on the texture.
 * Internal: clamps colour UVs at edges and disables mipmaps to avoid streaks (not used on depth).
 */
function configureWaterRenderTargetTexture(texture) {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
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
