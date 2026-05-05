import * as THREE from 'three';
import { createNoise3D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

const FBM_DEFAULT_OCTAVES = 6;
const FBM_INITIAL_AMPLITUDE = 0.3;
const FBM_INITIAL_FREQUENCY = 2.0;
const FBM_AMPLITUDE_DECAY = 0.5;
const FBM_FREQUENCY_MULTIPLIER = 2.0;

const PLANET_BASE_RADIUS = 1.0;
const PLANET_DETAIL_LEVEL = 5;

const LIGHT_DIRECTION = new THREE.Vector3(5, 5, 5).normalize();

/**
 * Builds an fBm sampler from a provided 3D noise function.
 * Inputs: `noise3D(x, y, z)` function returning scalar noise.
 * Outputs: function `(x, y, z, octaves)` that returns normalized layered noise.
 * Internal: accumulates octave contributions while halving amplitude and doubling frequency each iteration.
 */
function createFbm(noise3D) {
  /**
   * Samples layered fractal noise at one point.
   * Inputs: `x`, `y`, `z` coordinates and optional `octaves` count.
   * Outputs: normalized noise scalar based on accumulated octave energy.
   * Internal: iterates octaves, aggregates weighted samples, then divides by total amplitude.
   */
  return (x, y, z, octaves = FBM_DEFAULT_OCTAVES) => {
    let value = 0;
    let amplitude = FBM_INITIAL_AMPLITUDE;
    let frequency = FBM_INITIAL_FREQUENCY;
    let maxAmplitude = 0;

    for (let i = 0; i < octaves; i += 1) {
      value += noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= FBM_AMPLITUDE_DECAY;
      frequency *= FBM_FREQUENCY_MULTIPLIER;
    }

    return value / maxAmplitude;
  };
}

/**
 * Creates the procedural terrain planet mesh and shader material.
 * Inputs: none.
 * Outputs: object with `planet` mesh and base `radius` used by post effects.
 * Internal: displaces an icosahedron using fBm noise, stores height attributes, computes normals, and applies a custom terrain shader.
 */
export function createPlanet() {
  const noise3D = createNoise3D();
  const fbm = createFbm(noise3D);

  const geometry = new THREE.IcosahedronGeometry(PLANET_BASE_RADIUS, PLANET_DETAIL_LEVEL);
  const pos = geometry.attributes.position;
  const heights = new Float32Array(pos.count);
  const vertex = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 1) {
    vertex.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();

    const elevation = fbm(vertex.x, vertex.y, vertex.z, FBM_DEFAULT_OCTAVES);
    heights[i] = elevation;

    vertex.multiplyScalar(1 + elevation);
    pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uLight: { value: LIGHT_DIRECTION }
    },
    vertexShader: `
      attribute float aHeight;
      varying float vHeight;
      varying vec3 vNormal;

      void main() {
        vHeight = aHeight;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vHeight;
      varying vec3 vNormal;
      uniform vec3 uLight;

      void main() {
        const vec3 LOW_COLOR = vec3(0.22, 0.16, 0.09);
        const vec3 HIGH_COLOR = vec3(0.48, 0.32, 0.16);
        const float HEIGHT_SCALE = 2.0;
        const float HEIGHT_BIAS = 0.5;
        const float LIGHT_SCALE = 0.5;
        const float LIGHT_BIAS = 0.5;

        vec3 terrainColor = mix(LOW_COLOR, HIGH_COLOR, vHeight * HEIGHT_SCALE + HEIGHT_BIAS);

        float lit = dot(normalize(vNormal), normalize(uLight));
        lit = lit * LIGHT_SCALE + LIGHT_BIAS;

        gl_FragColor = vec4(terrainColor * lit, 1.0);
      }
    `
  });

  const planet = new THREE.Mesh(geometry, material);

  return {
    planet,
    radius: PLANET_BASE_RADIUS
  };
}
