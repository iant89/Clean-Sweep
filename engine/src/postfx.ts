import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export interface PostFxOptions {
  /** Bloom on HDR highlights (LEDs, flames, sparkles). */
  bloom?: { strength: number; radius: number; threshold: number };
  /** 0..1 darkening toward the corners. */
  vignette?: number;
  /** 0..1 animated film grain. */
  grain?: number;
  /** Pixels of red/blue fringe at the screen edge. */
  aberration?: number;
  /** Shadow tint / highlight tint for a gentle split-tone grade (linear RGB, small values). */
  shadowTint?: [number, number, number];
  highlightTint?: [number, number, number];
  /** MSAA samples for the scene target (0 on weak GPUs). */
  samples?: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.04 },
    uAberration: { value: 1.2 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uShadow: { value: new THREE.Vector3(0.0, 0.01, 0.03) },
    uHigh: { value: new THREE.Vector3(0.03, 0.015, -0.01) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  // runs after the OutputPass, so it works on display-ready (tone mapped, sRGB) colour
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration;
    uniform vec2 uRes;
    uniform vec3 uShadow, uHigh;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // chromatic aberration grows toward the edges only
      vec2 off = c * r2 * uAberration * 8.0 / uRes;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // split tone: cool shadows, warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += uShadow * (1.0 - smoothstep(0.0, 0.45, l)) + uHigh * smoothstep(0.45, 1.0, l);
      // gentle S-curve for contrast
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      // vignette
      col *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2 * 1.6);
      // grain, strongest in the mid-tones
      float g = hash(vUv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
      col += g * uGrain * (1.0 - abs(l - 0.5) * 1.4);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Post-processing chain: scene (HDR, MSAA) -> bloom -> tone map + sRGB -> grade (vignette, split tone,
 * grain, edge fringe). The engine renders through this when it's enabled, and falls back to a plain
 * tone-mapped render when it isn't (weak devices, or when frames get slow).
 */
export class PostFx {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: PostFxOptions = {}) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: opts.samples ?? 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (opts.bloom) {
      const b = opts.bloom;
      // bloom works at half resolution internally; that's plenty for soft glow
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), b.strength, b.radius, b.threshold);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    const u = this.grade.uniforms;
    u.uVignette.value = opts.vignette ?? 0.35;
    u.uGrain.value = opts.grain ?? 0.035;
    u.uAberration.value = opts.aberration ?? 1;
    if (opts.shadowTint) u.uShadow.value.set(...opts.shadowTint);
    if (opts.highlightTint) u.uHigh.value.set(...opts.highlightTint);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.grade.uniforms.uTime.value = time;
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
    this.bloom?.dispose();
  }
}
