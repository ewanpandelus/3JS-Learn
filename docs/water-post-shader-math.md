# Post-Process Water Shader: Technical Design

This document explains the math in the current depth-aware water post pass used in `src/postprocessing/createWaterPost.js` [1][2][3].

## Design Goal

Tint pixels near the planet surface as a spherical water shell, with depth-based color absorption, animated wave perturbation, and subtle foam near shell boundaries.

## 1) Inputs and Uniforms

- `tDiffuse` (`sampler2D`): Base color from `RenderPass` [1][2]
- `tDepth` (`sampler2D`): Depth buffer sampled per screen UV [3]
- `cameraNear` / `cameraFar` (`float`): Perspective depth linearization
- `inverseProjectionMatrix` (`mat4`): Clip-space to view-space reconstruction
- `cameraMatrixWorld` (`mat4`): View-space to world-space reconstruction
- `planetCenter` / `planetRadius` (`vec3` / `float`): Defines spherical ocean anchor
- `waterThickness` (`float`): Shell width from radius to outer boundary
- `absorptionDensity` (`float`): Controls deep-water darkening strength
- `waveScale` / `waveSpeed` (`float`): Controls wave frequency and temporal motion
- `foamStrength` (`float`): Controls white edge contribution
- `time` (`float`): Animation phase driver

## 2) Depth and Position Reconstruction

### Depth linearization

GPU depth is non-linear in perspective projection. The shader converts sampled depth to linear camera-space distance [4][5].

```text
z_ndc = depth * 2 - 1
linearDepth = (2 * near * far) / (far + near - z_ndc * (far - near))
```

### World position per pixel

Each screen pixel is reconstructed from UV and depth by reversing projection and then transforming into world space [6][7].

```text
clip = vec4(uv * 2 - 1, depth * 2 - 1, 1)
view = inverseProjectionMatrix * clip
view = view / view.w
world = cameraMatrixWorld * view
```

Background guard: if depth is near `1.0`, treat as sky/background and return base color [3].

## 3) Spherical Water Shell Mask

Let `fromCenter = worldPos - planetCenter` and `dist = length(fromCenter)`.

```text
shellInner = planetRadius
shellOuter = planetRadius + waterThickness
waterMask = 1 - smoothstep(shellInner, shellOuter, dist)
```

Interpretation: pixels on terrain near the shell interior receive higher water influence; influence falls smoothly to zero near shell outer radius. This follows common signed-distance/smooth-threshold shaping patterns used in screen-space effects [6].

## 4) Depth-Driven Color Absorption

A normalized shell depth estimate is computed, then converted to absorption using a Beer-Lambert style approximation [8][9].

```text
shellDepth = clamp((shellOuter - dist) / waterThickness, 0, 1)
absorb = 1 - exp(-shellDepth * absorptionDensity)
waterColor = mix(shallowColor, deepColor, absorb)
```

Larger `shellDepth` results in darker/deeper water tones [8][10].

## 5) Wave Perturbation and Foam

### Wave perturbation

A small procedural offset is added to shell depth from sinusoidal terms over normalized radial direction [9][10].

```text
n = normalize(fromCenter)
wave = 0.5 * sin(n.x * waveScale + time * waveSpeed)
     + 0.5 * sin(n.z * waveScale * 0.73 - time * waveSpeed * 1.2)
shellDepth = clamp(shellDepth + wave * 0.04, 0, 1)
```

### Foam band

A narrow edge band near shell outer radius is estimated via screen-space derivatives and scaled by water mask and foam strength. This is a practical approximation for shoreline highlights [10].

```text
edgeMetric = fwidth(dist)
foamBand = 1 - smoothstep(0, edgeMetric * 2.2, abs(dist - shellOuter))
foam = foamBand * waterMask * foamStrength
```

## 6) Final Compositing Equation

```text
baseToWater = waterMask * 0.7
finalColor = mix(baseColor, waterColor, baseToWater)
finalColor = mix(finalColor, vec3(0.9, 0.95, 1.0), foam)
```

This keeps underlying terrain readable while layering a depth-reactive ocean tint and edge highlights [2][9][10].

## 7) Assumptions, Limits, and Extensions

- **Depth source:** Depth pre-pass per frame  
  **Upgrade:** Share depth from MRT or packed G-buffer
- **Water geometry:** Screen-space shell approximation  
  **Upgrade:** True water mesh with refraction
- **Scattering:** Simple absorption model  
  **Upgrade:** Multi-order scattering / atmospheric coupling
- **Wave model:** Two sinusoidal bands  
  **Upgrade:** Noise textures + normal perturbation
- **Foam:** Derivative-based ring  
  **Upgrade:** Curvature/slope-aware shoreline foam

## References

[1] Three.js Manual: Post Processing  
https://threejs.org/manual/en/post-processing.html

[2] Three.js Docs: EffectComposer  
https://threejs.org/docs/pages/EffectComposer.html

[3] Three.js Docs: DepthTexture  
https://threejs.org/docs/pages/DepthTexture.html

[4] LearnOpenGL: Depth Testing  
https://learnopengl.com/Advanced-OpenGL/Depth-testing

[5] LearnOpenGL: Depth (Advanced OpenGL)  
https://learnopengl.com/Advanced-OpenGL/Depth-

[6] MJP: Reconstructing Position From Depth  
https://therealmjp.github.io/posts/reconstructing-position-from-depth/

[7] MJP: Reconstructing Position From Depth, Continued  
https://therealmjp.github.io/posts/reconstructing-position-from-depth-continued/

[8] GPU Gems: Effective Water Simulation from Physical Models  
https://developer.nvidia.com/gpugems/GPUGems/gpugems_ch01.html

[9] GPU Gems 2: Generic Refraction Simulation  
https://developer.nvidia.com/gpugems/GPUGems2/gpugems2_chapter19.html

[10] GPU Gems: Rendering Water Caustics  
http://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-2-rendering-water-caustics
