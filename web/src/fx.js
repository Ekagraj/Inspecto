// Display-only post-processing: bloom, neutral tone mapping, vignette and grain. Shadows and
// ambient occlusion are baked into the scene, so nothing costly runs here.
// The detector never sees this: capture() renders the plain scene, which is what it was trained on.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const Grade = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.03, 1.0, 0.95), 0.6);                       // warm grade
      c.rgb *= mix(0.72, 1.0, smoothstep(0.9, 0.3, length(vUv - 0.5)));            // vignette
      float n = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + time, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * 0.02;                                                   // grain
      gl_FragColor = c;
    }`,
};

export function createFx(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.07, 0.45, 3.0)); // threshold in linear HDR: windows and lamps only
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  return {
    setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
    render(time) {
      grade.uniforms.time.value = time % 10;
      // Neutral tone mapping keeps whites clean and UI colours true. The renderer's own
      // settings stay as they are for capture(), which the detector was trained on.
      const { toneMapping, toneMappingExposure } = renderer;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 0.8;
      composer.render();
      renderer.toneMapping = toneMapping;
      renderer.toneMappingExposure = toneMappingExposure;
    },
  };
}
