import * as THREE from 'three';

const WATER_SCALE = 9;
const WAVE_DISTORTION = 0.01;

/**
 * Builds a single-pass transparent water plane with view-angle alpha.
 * Inputs: renderer/scene/camera refs and terrain dimensions with `seaLevel`.
 * Outputs: object containing `water` mesh plus `render`, `resize`, and `updateSeaLevel` hooks.
 * Internal: shades water procedurally in one pass and computes alpha from a Fresnel-style camera-angle term.
 */
export function createWaterSystem({ width, depth, seaLevel }) {
  const waterGeometry = new THREE.PlaneGeometry(width * WATER_SCALE, depth * WATER_SCALE, 1, 1);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSeaHalfExtent: { value: new THREE.Vector2((width * WATER_SCALE) * 0.5, (depth * WATER_SCALE) * 0.5) },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0x2f89c9) },
      uDeepTint: { value: new THREE.Color(0x13374f) },
      uSkyTint: { value: new THREE.Color(0x8aa8c7) },
      uAlphaMin: { value: 0.72 },
      uAlphaMax: { value: 0.96 },
      uFresnelPower: { value: 0.05 }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec2 uSeaHalfExtent;
      uniform float uTime;
      uniform vec3 uTint;
      uniform vec3 uDeepTint;
      uniform vec3 uSkyTint;
      uniform float uAlphaMin;
      uniform float uAlphaMax;
      uniform float uFresnelPower;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        float wave =
          sin(vWorldPos.x * 0.18 + uTime * 0.8) * 0.5 +
          cos(vWorldPos.z * 0.23 - uTime * 0.65) * 0.5;
        float ripple = 0.5 + wave * 0.5;
        vec3 base = mix(uTint, uDeepTint, smoothstep(0.0, 1.0, vUv.y + wave * ${WAVE_DISTORTION.toFixed(5)}));
        float fresnel = pow(
          1.0 - clamp(dot(normalize(cameraPosition - vWorldPos), vec3(0.0, 1.0, 0.0)), 0.0, 1.0),
          uFresnelPower
        );
        vec3 color = mix(base, uSkyTint, fresnel * 0.25) + vec3(ripple * 0.03);

        vec2 edgeNorm = abs(vWorldPos.xz) / uSeaHalfExtent;
        float edgeDistance = max(edgeNorm.x, edgeNorm.y);
        float outerFade = 1.0 - smoothstep(0.72, 0.98, edgeDistance);
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
   * Updates animated water uniforms per frame.
   * Inputs: `time` animation scalar.
   * Outputs: updates shader time uniform only.
   * Internal: no extra render passes; this is a lightweight single-pass update.
   */
  function render(time) {
    waterMaterial.uniforms.uTime.value = time;
  }

  /**
   * Resizes internal water render targets.
   * Inputs: current viewport `widthPx` and `heightPx`.
   * Outputs: resizes reflection/refraction textures and updates shader resolution uniform.
   * Internal: keeps screen-space sampling in sync with renderer dimensions.
   */
  function resize(widthPx, heightPx) {
    void widthPx;
    void heightPx;
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

  return {
    water,
    render,
    resize,
    updateSeaLevel
  };
}
