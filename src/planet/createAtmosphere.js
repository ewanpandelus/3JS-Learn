import * as THREE from 'three';

const ATMOSPHERE_RADIUS_SCALE = 1.16;
const ATMOSPHERE_INTENSITY = 1.35;
const ATMOSPHERE_FALLOFF = 3.0;
const ATMOSPHERE_COLOR = new THREE.Color(0.24, 0.56, 1.0);

/**
 * Creates an additive atmospheric scattering shell around the planet.
 * Inputs: `planetRadius` as the base radius for the atmosphere sphere.
 * Outputs: `THREE.Mesh` configured as a glowing outer shell.
 * Internal: renders the back side of a slightly larger sphere and boosts rim glow based on view-angle and light direction.
 */
export function createAtmosphere(planetRadius) {
  const geometry = new THREE.IcosahedronGeometry(
    planetRadius * ATMOSPHERE_RADIUS_SCALE,
    5
  );

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtmosphereColor: { value: ATMOSPHERE_COLOR },
      uSunDirection: { value: new THREE.Vector3(5, 5, 5).normalize() },
      uIntensity: { value: ATMOSPHERE_INTENSITY },
      uFalloff: { value: ATMOSPHERE_FALLOFF }
    },
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPosition = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uAtmosphereColor;
      uniform vec3 uSunDirection;
      uniform float uIntensity;
      uniform float uFalloff;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float horizon = 1.0 - max(dot(normalize(vWorldNormal), viewDir), 0.0);
        float rim = pow(horizon, uFalloff);

        float sunFacing = max(dot(normalize(vWorldNormal), normalize(uSunDirection)), 0.0);
        float scatter = rim * (0.45 + sunFacing * 0.55) * uIntensity;

        gl_FragColor = vec4(uAtmosphereColor * scatter, scatter);
      }
    `
  });

  return new THREE.Mesh(geometry, material);
}
