import * as THREE from 'three';
import { EffectComposer } from 'jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'jsm/postprocessing/ShaderPass.js';

const FOAM_TEXTURE_SIZE = 64;

/**
 * Builds a small tiled foam texture for stylized edge highlights.
 * Inputs: none.
 * Outputs: grayscale `THREE.DataTexture` with procedural bubble-like patches.
 * Internal: writes layered trigonometric noise into an RGBA buffer and marks it for repeat sampling.
 */
function createFoamTexture() {
  const size = FOAM_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const idx = (y * size + x) * 4;

      const layerA = 0.5 + 0.5 * Math.sin((u * 18.0 + v * 9.0) * Math.PI);
      const layerB = 0.5 + 0.5 * Math.sin((u * 33.0 - v * 21.0) * Math.PI);
      const combined = layerA * 0.6 + layerB * 0.4;
      const mask = combined > 0.63 ? 255 : 0;

      data[idx] = mask;
      data[idx + 1] = mask;
      data[idx + 2] = mask;
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  return texture;
}

/**
 * Creates depth rendering resources used by the water post pass.
 * Inputs: `width` and `height` in pixels.
 * Outputs: object containing `depthMaterial` and `depthTarget` render target.
 * Internal: sets up a depth-only material and render target with an attached float depth texture.
 */
function createDepthResources(width, height) {
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.depthPacking = THREE.RGBADepthPacking;
  depthMaterial.blending = THREE.NoBlending;

  const depthTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });
  depthTarget.texture.generateMipmaps = false;
  depthTarget.depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
  depthTarget.depthBuffer = true;

  return { depthMaterial, depthTarget };
}

/**
 * Builds the water shader pass used after the scene render pass.
 * Inputs: active `camera`, `planetCenter` vector, and numeric `planetRadius`.
 * Outputs: configured `ShaderPass` instance with depth-aware water uniforms/shaders.
 * Internal: reconstructs world position from depth, computes shell-based water masking, then blends absorption, waves, and foam.
 */
function createWaterPass(camera, planetCenter, planetRadius) {
  const foamTexture = createFoamTexture();

  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tFoam: { value: foamTexture },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      inverseProjectionMatrix: { value: new THREE.Matrix4() },
      cameraMatrixWorld: { value: new THREE.Matrix4() },
      planetCenter: { value: planetCenter.clone() },
      planetRadius: { value: planetRadius },
      waterThickness: { value: 0.09 },
      absorptionDensity: { value: 2.2 },
      waveScale: { value: 14.0 },
      waveSpeed: { value: 1.4 },
      foamStrength: { value: 0.85 },
      foamTiling: { value: 14.0 },
      foamScrollSpeed: { value: 0.35 },
      time: { value: 0.0 }
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tFoam;
      uniform float cameraNear;
      uniform float cameraFar;
      uniform mat4 inverseProjectionMatrix;
      uniform mat4 cameraMatrixWorld;
      uniform vec3 planetCenter;
      uniform float planetRadius;
      uniform float waterThickness;
      uniform float absorptionDensity;
      uniform float waveScale;
      uniform float waveSpeed;
      uniform float foamStrength;
      uniform float foamTiling;
      uniform float foamScrollSpeed;
      uniform float time;

      varying vec2 vUv;

      vec3 reconstructWorldPosition(vec2 uv, float depth) {
        vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 view = inverseProjectionMatrix * clip;
        view /= view.w;
        vec4 world = cameraMatrixWorld * view;
        return world.xyz;
      }

      void main() {
        vec3 baseColor = texture2D(tDiffuse, vUv).rgb;
        float depth = texture2D(tDepth, vUv).x;

        // Sky/background pixels do not carry useful scene depth.
        if (depth >= 0.999999) {
          gl_FragColor = vec4(baseColor, 1.0);
          return;
        }

        vec3 worldPos = reconstructWorldPosition(vUv, depth);
        vec3 fromCenter = worldPos - planetCenter;
        float distToCenter = length(fromCenter);

        float shellInner = planetRadius;
        float shellOuter = planetRadius + waterThickness;

        float waterMask = 1.0 - smoothstep(shellInner, shellOuter, distToCenter);
        waterMask = clamp(waterMask, 0.0, 1.0);

        vec3 normalFromCenter = normalize(fromCenter);
        float wave = sin(normalFromCenter.x * waveScale + time * waveSpeed) * 0.5 +
          sin(normalFromCenter.z * waveScale * 0.73 - time * waveSpeed * 1.2) * 0.5;
        wave *= 0.04;

        float shellDepth = clamp((shellOuter - distToCenter) / waterThickness, 0.0, 1.0);
        shellDepth = clamp(shellDepth + wave, 0.0, 1.0);

        // Beer-Lambert style absorption approximation.
        float absorb = 1.0 - exp(-shellDepth * absorptionDensity);

        vec3 shallowColor = vec3(0.10, 0.42, 0.75);
        vec3 deepColor = vec3(0.01, 0.08, 0.22);
        vec3 waterColor = mix(shallowColor, deepColor, absorb);

        float edgeMetric = fwidth(distToCenter);
        // Exaggerated edge zone so foam is clearly visible while tuning.
        float foamBand = 1.0 - smoothstep(0.0, edgeMetric * 9.0 + waterThickness * 0.25, abs(distToCenter - shellOuter));
        vec2 foamUv = normalFromCenter.xz * foamTiling + vec2(time * foamScrollSpeed, -time * foamScrollSpeed * 0.6);
        float foamPattern = texture2D(tFoam, foamUv).r;
        // Thresholded texture gives a stylized/cartoon foam chunk look.
        foamPattern = smoothstep(0.25, 0.55, foamPattern);
        float foam = foamBand * waterMask * foamPattern * foamStrength;

        vec3 finalColor = mix(baseColor, waterColor, waterMask * 0.7);
        finalColor = mix(finalColor, vec3(1.0, 1.0, 1.0), foam);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `
  });
}

/**
 * Creates the full post-processing pipeline for depth-aware water rendering.
 * Inputs: `renderer`, `scene`, `camera`, and options (`planetCenter`, `planetRadius`).
 * Outputs: object with `render(time)` and `resize(width, height)` functions.
 * Internal: wires render + shader passes, performs a depth pre-pass each frame, updates uniforms, then renders via composer.
 */
export function createWaterPost(renderer, scene, camera, options) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const { depthMaterial, depthTarget } = createDepthResources(width, height);
  const waterPass = createWaterPass(camera, options.planetCenter, options.planetRadius);
  composer.addPass(waterPass);

  /**
   * Renders the scene into the dedicated depth target.
   * Inputs: none.
   * Outputs: side effect of updating `depthTarget.depthTexture`.
   * Internal: temporarily overrides scene materials with depth-only material for a depth pre-pass.
   */
  const renderDepth = () => {
    scene.overrideMaterial = depthMaterial;
    renderer.setRenderTarget(depthTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    scene.overrideMaterial = null;
  };

  /**
   * Resizes post-processing resources to match viewport changes.
   * Inputs: `nextWidth` and `nextHeight` in pixels.
   * Outputs: side effect of resizing composer and depth target textures.
   * Internal: forwards new dimensions to all post-processing buffers.
   */
  const resize = (nextWidth, nextHeight) => {
    composer.setSize(nextWidth, nextHeight);
    depthTarget.setSize(nextWidth, nextHeight);
  };

  /**
   * Renders a frame with updated camera/depth/time uniforms.
   * Inputs: `timeValue` animation time scalar.
   * Outputs: side effect of drawing a final post-processed frame to screen.
   * Internal: refreshes shader uniforms from current camera state, runs depth pre-pass, then renders composer output.
   */
  const render = (timeValue) => {
    waterPass.uniforms.time.value = timeValue;
    waterPass.uniforms.tDepth.value = depthTarget.depthTexture;
    waterPass.uniforms.cameraNear.value = camera.near;
    waterPass.uniforms.cameraFar.value = camera.far;
    waterPass.uniforms.inverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
    waterPass.uniforms.cameraMatrixWorld.value.copy(camera.matrixWorld);

    renderDepth();
    composer.render();
  };

  return {
    render,
    resize
  };
}
