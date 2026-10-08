// Post-processing pipeline.
//
// Order:
//   RenderPass  — scene → RT (linear HDR, because all scene materials are
//                 custom ShaderMaterials that write raw colour without
//                 tone-mapping chunks).
//   SSAOPass    — adds ambient-occlusion shading in crevices. Depth comes
//                 from the scene; normals are derived from the geometry
//                 (not from the vertex displacement, so on this procedural
//                 terrain the AO is approximate — still helps, just not
//                 surface-accurate).
//   UnrealBloom — picks up bright pixels (sun glow, snow highlights, lava
//                 emission) and bleeds them outward.
//   ShaderPass  — colour grading (contrast + saturation) and a soft
//                 vignette.
//   OutputPass  — applies the renderer's tone mapping (ACES Filmic) and
//                 the sRGB output colour space.

import * as THREE                from 'three';
import { EffectComposer }        from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }            from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass }              from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass }       from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }            from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }            from 'three/addons/postprocessing/OutputPass.js';
import { renderer, scene, camera } from './render.js';

const w  = window.innerWidth;
const h  = window.innerHeight;
const dpr = Math.min(window.devicePixelRatio, 2);

export const composer = new EffectComposer(renderer);
composer.setPixelRatio(dpr);
composer.setSize(w, h);

// 1. Scene render to a HalfFloat RT (HDR linear).
composer.addPass(new RenderPass(scene, camera));

// 2. SSAO — disabled by default; SSAOPass is expensive (extra render
//    + multi-pass blur) and tanks FPS on slow GPUs. To re-enable on
//    fast hardware just set `ssaoPass.enabled = true`.
// const ssaoPass = new SSAOPass(scene, camera, w, h);
// ssaoPass.kernelRadius  = 14;
// ssaoPass.minDistance   = 0.002;
// ssaoPass.maxDistance   = 0.08;
// ssaoPass.enabled       = false;
// composer.addPass(ssaoPass);

// 3. Bloom — kept but at half resolution and gentler strength. With
//    the threshold at 0.95 only the sun corona, lava and brightest snow
//    highlights actually bleed. Anything else stays sharp.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(Math.floor(w * 0.5), Math.floor(h * 0.5)),
  0.32, // strength
  0.45, // radius
  0.95  // threshold (linear; ~0.95 in linear → ~0.97 in sRGB)
);
composer.addPass(bloomPass);

// 4. Colour grading + vignette in one ShaderPass.
const gradingShader = {
  uniforms: {
    tDiffuse:           { value: null },
    uSaturation:        { value: 1.08 },
    uContrast:          { value: 1.06 },
    uVignetteAmount:    { value: 0.45 },
    uVignetteFalloff:   { value: 0.55 },
    uTint:              { value: new THREE.Vector3(1.00, 1.00, 1.02) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignetteAmount;
    uniform float uVignetteFalloff;
    uniform vec3  uTint;
    varying vec2 vUv;

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);

      // Contrast around mid-grey.
      col.rgb = (col.rgb - 0.5) * uContrast + 0.5;

      // Subtle colour tint.
      col.rgb *= uTint;

      // Saturation — mix with luminance.
      float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb   = mix(vec3(lum), col.rgb, uSaturation);

      // Vignette — radial darkening from centre.
      vec2 c = vUv - 0.5;
      float r = length(c);
      float vig = smoothstep(uVignetteFalloff, uVignetteFalloff * 0.35, r);
      col.rgb *= mix(1.0, vig, uVignetteAmount);

      gl_FragColor = col;
    }
  `,
};
composer.addPass(new ShaderPass(gradingShader));

// 5. Output — tone mapping (renderer.toneMapping) + sRGB conversion.
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
  ssaoPass.setSize(window.innerWidth, window.innerHeight);
});

/** Single entry point used by `main.js` to present a frame. */
export function renderFrame() {
  composer.render();
}