import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  COLS, DOCK, DOORS, FURNITURE, Facing, FurnDef, LEVEL, ROOMS, ROWS, RUGS, SECRET_DOORS, TILE, WALL_H, WORLD_H, WORLD_W,
} from './constants';
import { makeRng } from './dirt';

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
export interface CutUniforms { uRoomba: { value: THREE.Vector3 }; uCut: { value: number } }

export function buildGrid() {
  const g = new Int8Array(COLS * ROWS).fill(-1);
  if (LEVEL.map) {
    // drawn as text: an upper-case letter is that room's floor, lower-case is a doorway belonging to it
    const idx = new Map(ROOMS.map((r, i) => [r.key, i]));
    LEVEL.map.forEach((row, r) => {
      for (let c = 0; c < COLS; c++) {
        const ch = row[c];
        if (ch && ch !== '#') g[r * COLS + c] = idx.get(ch.toUpperCase()) ?? -1;
      }
    });
    for (const [c0, r0, w, h, key] of DOORS) {
      const id = idx.get(key) ?? -1;
      for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) g[y * COLS + x] = id;
    }
    return g;
  }
  ROOMS.forEach((r, i) => {
    const [c0, r0, w, h] = r.rect;
    for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) g[y * COLS + x] = i;
  });
  for (const [c0, r0, w, h, key] of DOORS) {
    const id = ROOMS.findIndex((r) => r.key === key);
    for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) g[y * COLS + x] = id;
  }
  return g;
}

// ---------------------------------------------------------------- shader patching
export function patchCutaway(mat: THREE.Material, cut: CutUniforms, darkBack = false) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRoomba = cut.uRoomba;
    shader.uniforms.uCut = cut.uCut;
    shader.vertexShader = 'varying vec3 vCutW;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 cutW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cutW = instanceMatrix * cutW;
      #endif
      vCutW = (modelMatrix * cutW).xyz;`,
    );
    shader.fragmentShader = 'uniform vec3 uRoomba;\nuniform float uCut;\nvarying vec3 vCutW;\n' + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      if (uCut > 0.5) {
        float dz = vCutW.z - uRoomba.z;
        float dx = abs(vCutW.x - uRoomba.x);
        float band = smoothstep(-0.9, 0.2, dz) * (1.0 - smoothstep(9.0, 12.5, dz));
        float wx = 3.2 + max(dz, 0.0) * 0.6;
        float side = 1.0 - smoothstep(wx, wx + 2.5, dx);
        float cutH = mix(14.0, 0.6, band * side);
        if (vCutW.y > cutH) discard;
      }`,
    );
    if (darkBack) {
      // Where the cut opens a wall up, its inside faces stand in for the cut cross-section: shade them
      // as a flat, upward-facing slab in the wall-top colour, lit like the real wall tops around them,
      // so a sliced wall reads as solid masonry rather than a hollow box.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.0085, 0.0058, 0.0102);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (!gl_FrontFacing) normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
    }
  };
  mat.customProgramCacheKey = () => (darkBack ? 'cutD' : 'cut');
}

// Furniture: fragments that cover the roomba on screen and sit in front of it (i.e. pieces hiding it) are
// faded to see-through with an ordered dither, which needs no sorting and works on merged meshes.
// occFade() is shared with the outline material so edges show exactly where the furniture fades.
const OCC_FADE_GLSL = `
uniform vec3 uRoomba;
uniform float uCut;
float occFade(vec3 w) {
  if (uCut < 0.5 || w.y <= 0.35) return 0.0;
  vec3 ray = vec3(uRoomba.x, 0.25, uRoomba.z) - cameraPosition;
  float len = length(ray);
  vec3 dir = ray / len;
  vec3 rel = w - cameraPosition;
  float t = dot(rel, dir);
  if (t <= 0.0) return 0.0;
  // Compare in screen space: scale the lateral offset to the roomba's depth, so only fragments
  // whose projection actually lands on (or just around) the roomba fade - not things merely near it.
  float perp = length(rel - dir * t) * len / t;
  return (1.0 - smoothstep(0.8, 1.35, perp)) * (1.0 - smoothstep(len - 0.9, len - 0.45, t));
}
`;

export function patchOccluderFade(mat: THREE.Material, cut: CutUniforms) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRoomba = cut.uRoomba;
    shader.uniforms.uCut = cut.uCut;
    shader.vertexShader = 'varying vec3 vCutW;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = 'varying vec3 vCutW;\n' + OCC_FADE_GLSL + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      float fade = occFade(vCutW);`,
    ).replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      // silhouette rim: where the surface turns away from the camera (sides of curved shapes) stays solid
      float occRim = 0.0;
      if (fade > 0.0) {
        occRim = smoothstep(0.72, 0.9, 1.0 - abs(dot(normal, normalize(vViewPosition)))) * fade;
        const float bayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
        ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
        float thr = (bayer[bp.x + bp.y * 4] + 0.5) / 16.0;
        if (occRim < 0.5 && 1.0 - 0.6 * fade < thr) discard;
      }`,
    ).replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.57), occRim * 0.4);`,
    );
  };
  mat.customProgramCacheKey = () => 'fade';
}

// Edge lines for faded furniture: invisible normally, drawn only where occFade() is active, so a
// see-through object keeps a crisp outline.
function makeOutlineMaterial(cut: CutUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uRoomba: cut.uRoomba, uCut: cut.uCut, uColor: { value: new THREE.Color(0xc8c8c8) } },
    vertexShader: `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z -= 0.002 * gl_Position.w; // pull lines just in front of their own faces
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec3 vW;
      ${OCC_FADE_GLSL}
      void main() {
        float fade = occFade(vW);
        if (fade < 0.02) discard;
        gl_FragColor = vec4(uColor, 0.4 * fade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------- static builder
class SB {
  map = new Map<THREE.Material, THREE.BufferGeometry[]>();
  m = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  private p = new THREE.Vector3();
  /** Tip-over angle (rad) applied around local X by frame(); cleared in reset(). */
  tip = 0;
  /** Vertical lift added to the frame translation so a tipped object rests on the ground. */
  tipY = 0;

  place(g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.p.set(x, y, z);
    this.tmp.compose(this.p, this.q, this.s);
    g.applyMatrix4(this.tmp);
    g.applyMatrix4(this.m);
    let arr = this.map.get(mat);
    if (!arr) { arr = []; this.map.set(mat, arr); }
    arr.push(g);
  }
  box(mat: THREE.Material, cx: number, y0: number, cz: number, w: number, h: number, d: number, ry = 0, rx = 0, rz = 0) {
    this.place(new THREE.BoxGeometry(w, h, d), mat, cx, y0 + h / 2, cz, rx, ry, rz);
  }
  cyl(mat: THREE.Material, cx: number, y0: number, cz: number, rt: number, rb: number, h: number, seg = 12, rx = 0, rz = 0) {
    this.place(new THREE.CylinderGeometry(rt, rb, h, seg), mat, cx, y0 + h / 2, cz, rx, 0, rz);
  }
  sph(mat: THREE.Material, cx: number, cy: number, cz: number, r: number, seg = 10) {
    this.place(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3)), mat, cx, cy, cz);
  }
  torus(mat: THREE.Material, cx: number, cy: number, cz: number, r: number, t: number, seg = 20) {
    this.place(new THREE.TorusGeometry(r, t, 6, seg), mat, cx, cy, cz, Math.PI / 2);
  }
  /** Box with rounded edges (radius clamped to fit), bottom at y0 like box(). */
  rbox(mat: THREE.Material, cx: number, y0: number, cz: number, w: number, h: number, d: number, r: number, ry = 0, rx = 0, rz = 0) {
    const rr = Math.max(0.002, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
    this.place(new RoundedBoxGeometry(w, h, d, 1, rr), mat, cx, y0 + h / 2, cz, rx, ry, rz);
  }
  /** Turned profile (radius, height) pairs, bottom at y0: legs, balusters, pots, finials. */
  lathe(mat: THREE.Material, cx: number, y0: number, cz: number, prof: [number, number][], seg = 12) {
    this.place(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat, cx, y0, cz);
  }
  frame(x: number, z: number, ry: number, y = 0) {
    this.m.makeRotationY(ry);
    if (this.tip) { // tip around local X at the base, before yaw+translation
      this.tmp.makeRotationX(this.tip);
      this.m.multiply(this.tmp);
    }
    this.m.setPosition(x, y + this.tipY, z);
  }
  reset() { this.m.identity(); this.tip = 0; this.tipY = 0; }
  /**
   * Merge everything placed so far into one mesh per material per CHUNK×CHUNK patch of floor plan.
   * Merging keeps draw calls low; splitting by area keeps each mesh small enough for the camera and
   * each shadow-casting light to skip the parts of the house it can't see.
   */
  build(parent: THREE.Object3D) {
    const box = new THREE.Box3(), c = new THREE.Vector3();
    for (const [mat, geos] of this.map) {
      const cells = new Map<string, THREE.BufferGeometry[]>();
      for (const g of geos) {
        g.computeBoundingBox();
        box.copy(g.boundingBox!).getCenter(c);
        const key = `${Math.floor(c.x / SB.CHUNK)},${Math.floor(c.z / SB.CHUNK)}`;
        let arr = cells.get(key);
        if (!arr) { arr = []; cells.set(key, arr); }
        arr.push(g);
      }
      for (const raw of cells.values()) {
        // some shapes (rounded boxes, polyhedra) come without an index; merging needs all or none,
        // so weld those into indexed form (identical vertices only, so normals are kept)
        const part = raw.some((g) => g.index) ? raw.map((g) => (g.index ? g : mergeVertices(g))) : raw;
        const merged = mergeGeometries(part, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.matrixAutoUpdate = false;
        parent.add(mesh);
      }
      geos.forEach((g) => g.dispose());
    }
    this.map.clear();
  }
  static readonly CHUNK = 16;
}

const facingRot = (f: Facing | undefined) => (f === 'n' ? Math.PI : f === 'e' ? Math.PI / 2 : f === 'w' ? -Math.PI / 2 : 0);
/** Full yaw rotation for a furniture piece: free ry when set, otherwise the cardinal facing. */
const furnRot = (f: FurnDef) => f.ry ?? facingRot(f.f);
const rotXZ = (lx: number, lz: number, a: number) => [lx * Math.cos(a) + lz * Math.sin(a), -lx * Math.sin(a) + lz * Math.cos(a)];

// ---------------------------------------------------------------- textures
function portraitTexture(seed: number) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const g = c.getContext('2d')!;
  const rng = makeRng(seed);
  const bgs = ['#2b1d16', '#1c2430', '#2a1a24', '#1d2a1f'];
  g.fillStyle = bgs[seed % 4];
  g.fillRect(0, 0, 128, 160);
  const grd = g.createRadialGradient(64, 60, 10, 64, 80, 100);
  grd.addColorStop(0, 'rgba(255,220,160,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 160);
  if (seed % 3 === 2) {
    // landscape: moon over hills
    g.fillStyle = '#e8e0c0'; g.beginPath(); g.arc(90, 40, 14, 0, 7); g.fill();
    g.fillStyle = '#10140f';
    g.beginPath(); g.moveTo(0, 160); g.lineTo(0, 110); g.quadraticCurveTo(50, 70, 128, 115); g.lineTo(128, 160); g.fill();
  } else {
    // portrait silhouette
    const skin = ['#c9a98a', '#b89070', '#d8bca0'][Math.floor(rng() * 3)];
    g.fillStyle = ['#2a0f12', '#0f1a2a', '#1a1a1a'][Math.floor(rng() * 3)];
    g.beginPath(); g.ellipse(64, 150, 50, 46, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(64, 72, 22, 28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a120c';
    g.beginPath(); g.ellipse(64, 52, 24, 14, 0, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = '#000'; g.fillRect(53, 70, 6, 3); g.fillRect(69, 70, 6, 3);
    g.fillStyle = 'rgba(80,20,20,0.6)'; g.fillRect(58, 88, 12, 2);
  }
  // cracks / grime
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(rng() * 128, rng() * 160); g.lineTo(rng() * 128, rng() * 160); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blobTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** A ghostly sprite texture: a floating sheet-like figure with waving arms, hollow eyes, and a wispy tail. */
export function ghostTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  // translucent body fill with a soft radial core
  const grd = g.createRadialGradient(64, 52, 4, 64, 60, 56);
  grd.addColorStop(0, 'rgba(230,225,255,0.95)');
  grd.addColorStop(0.5, 'rgba(200,190,245,0.7)');
  grd.addColorStop(1, 'rgba(160,150,230,0.0)');
  g.fillStyle = grd;
  // ghost silhouette: rounded head top, body, wavy bottom hem
  g.beginPath();
  g.moveTo(28, 88);
  g.quadraticCurveTo(20, 50, 64, 24);          // left shoulder up to crown
  g.quadraticCurveTo(108, 50, 100, 88);         // crown down to right shoulder
  // wavy bottom hem (4 humps)
  g.quadraticCurveTo(92, 78, 82, 88);
  g.quadraticCurveTo(74, 78, 64, 88);
  g.quadraticCurveTo(54, 78, 46, 88);
  g.quadraticCurveTo(38, 78, 28, 88);
  g.closePath();
  g.fill();
  // two waving arm tendrils on the sides
  g.beginPath();
  g.moveTo(26, 70); g.quadraticCurveTo(8, 64, 14, 50);
  g.quadraticCurveTo(20, 58, 30, 64);
  g.fill();
  g.beginPath();
  g.moveTo(102, 70); g.quadraticCurveTo(120, 64, 114, 50);
  g.quadraticCurveTo(108, 58, 98, 64);
  g.fill();
  // hollow eyes (dark ovals with a faint inner glow)
  g.fillStyle = 'rgba(20,10,40,0.85)';
  g.beginPath(); g.ellipse(52, 52, 6, 9, -0.15, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(76, 52, 6, 9, 0.15, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(180,170,255,0.5)';
  g.beginPath(); g.ellipse(52, 50, 2.5, 4, -0.15, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(76, 50, 2.5, 4, 0.15, 0, Math.PI * 2); g.fill();
  // small mouth
  g.fillStyle = 'rgba(30,15,50,0.6)';
  g.beginPath(); g.ellipse(64, 68, 5, 7, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function globeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a6a8a';
  g.fillRect(0, 0, 128, 64);
  const rng = makeRng(7);
  g.fillStyle = '#5f8a4a';
  for (let k = 0; k < 9; k++) {
    const cx = rng() * 128, cy = 12 + rng() * 40;
    for (let j = 0; j < 6; j++) {
      g.beginPath();
      g.ellipse(cx + (rng() - 0.5) * 18, cy + (rng() - 0.5) * 12, 4 + rng() * 8, 3 + rng() * 6, rng() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const makeBlobTexture = blobTexture;

/** grid: as the player first sees it (secret doorways closed), for wall shading; full: every room's real tiles. */
function floorTexture(grid: Int8Array, full: Int8Array) {
  const S = 16;
  const W = WORLD_W * S, H = WORLD_H * S;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const rng = makeRng(1234);
  g.fillStyle = '#120c0a';
  g.fillRect(0, 0, W, H);

  const shade = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * k)) | 0;
    const gg = Math.min(255, Math.max(0, ((n >> 8) & 255) * k)) | 0;
    const b = Math.min(255, Math.max(0, (n & 255) * k)) | 0;
    return `rgb(${r},${gg},${b})`;
  };
  const planks = (x0: number, z0: number, x1: number, z1: number, alongX: boolean, pw: number, base: string) => {
    if (alongX) {
      for (let z = z0; z < z1; z += pw) {
        let x = x0 - rng() * 3;
        while (x < x1) {
          const len = 2 + rng() * 3;
          g.fillStyle = shade(base, 0.82 + rng() * 0.36);
          g.fillRect(x * S, z * S, len * S, pw * S);
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(x * S, z * S, 1, pw * S);
          x += len;
        }
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(x0 * S, z * S, (x1 - x0) * S, 1);
      }
    } else {
      for (let x = x0; x < x1; x += pw) {
        let z = z0 - rng() * 3;
        while (z < z1) {
          const len = 2 + rng() * 3;
          g.fillStyle = shade(base, 0.82 + rng() * 0.36);
          g.fillRect(x * S, z * S, pw * S, len * S);
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(x * S, z * S, pw * S, 1);
          z += len;
        }
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(x * S, z0 * S, 1, (z1 - z0) * S);
      }
    }
  };
  const checker = (x0: number, z0: number, x1: number, z1: number, size: number, a: string, b: string, veins: boolean) => {
    for (let z = Math.floor(z0 / size) * size; z < z1; z += size) {
      for (let x = Math.floor(x0 / size) * size; x < x1; x += size) {
        const odd = (Math.round(x / size) + Math.round(z / size)) % 2 === 0;
        g.fillStyle = shade(odd ? a : b, 0.93 + rng() * 0.12);
        g.fillRect(x * S, z * S, size * S, size * S);
        if (veins) {
          g.strokeStyle = odd ? 'rgba(120,100,90,0.35)' : 'rgba(200,190,170,0.12)';
          g.lineWidth = 1;
          g.beginPath();
          let vx = x + rng() * size, vz = z;
          g.moveTo(vx * S, vz * S);
          for (let k = 0; k < 5; k++) { vx += (rng() - 0.5) * size * 0.6; vz += size / 5; g.lineTo(vx * S, vz * S); }
          g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x * S, z * S, size * S, 1);
        g.fillRect(x * S, z * S, 1, size * S);
      }
    }
  };
  const carpet = (x0: number, z0: number, x1: number, z1: number, col: string, border: string) => {
    g.fillStyle = col;
    g.fillRect(x0 * S, z0 * S, (x1 - x0) * S, (z1 - z0) * S);
    g.strokeStyle = border;
    g.lineWidth = S * 0.25;
    g.strokeRect((x0 + 0.4) * S, (z0 + 0.4) * S, (x1 - x0 - 0.8) * S, (z1 - z0 - 0.8) * S);
    g.lineWidth = 2;
    g.strokeRect((x0 + 0.9) * S, (z0 + 0.9) * S, (x1 - x0 - 1.8) * S, (z1 - z0 - 1.8) * S);
  };
  const diamonds = (x0: number, z0: number, x1: number, z1: number, col: string) => {
    g.fillStyle = col;
    for (let z = z0 + 1.5; z < z1 - 1; z += 1.5) {
      for (let x = x0 + 1.5; x < x1 - 1; x += 1.5) {
        g.beginPath();
        g.moveTo(x * S, (z - 0.4) * S); g.lineTo((x + 0.4) * S, z * S); g.lineTo(x * S, (z + 0.4) * S); g.lineTo((x - 0.4) * S, z * S);
        g.fill();
      }
    }
  };

  ROOMS.forEach((room, ri) => {
    // clip to exactly this room's tiles (rooms can be L-shaped), and pattern over their bounding box
    let cMin = COLS, rMin = ROWS, cMax = -1, rMax = -1;
    g.save();
    g.beginPath();
    for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
      if (full[r * COLS + cc] !== ri) continue;
      g.rect(cc * TILE * S, r * TILE * S, TILE * S, TILE * S);
      cMin = Math.min(cMin, cc); cMax = Math.max(cMax, cc); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    }
    if (cMax < 0) { g.restore(); return; }
    g.clip();
    const c0 = cMin, r0 = rMin, w = cMax - cMin + 1, h = rMax - rMin + 1;
    // bounding box incl doors
    const x0 = (c0 - 1) * TILE, z0 = (r0 - 1) * TILE, x1 = (c0 + w + 1) * TILE, z1 = (r0 + h + 1) * TILE;
    switch (room.floor) {
      case 'marble': checker(x0, z0, x1, z1, 2, '#d8cfbd', '#2b2527', true); break;
      case 'darkwood': planks(x0, z0, x1, z1, true, 0.5, '#4a2e1c'); break;
      case 'lightwood': planks(x0, z0, x1, z1, false, 0.5, '#a8784a'); break;
      case 'checker': checker(x0, z0, x1, z1, 1, '#e4e0d6', '#1e1c1f', false); break;
      case 'terracotta': checker(x0, z0, x1, z1, 1.5, '#a5583a', '#93492e', false); break;
      case 'greencarpet': carpet(x0 + 2, z0 + 2, x1 - 2, z1 - 2, '#2c4434', '#a48a4a'); break;
      case 'parquet': {
        for (let z = z0; z < z1; z += 2) for (let x = x0; x < x1; x += 2) {
          const vert = (Math.round(x / 2) + Math.round(z / 2)) % 2 === 0;
          for (let k = 0; k < 4; k++) {
            g.fillStyle = shade('#7a4f2c', 0.8 + rng() * 0.4);
            if (vert) g.fillRect((x + k * 0.5) * S, z * S, 0.5 * S - 1, 2 * S - 1);
            else g.fillRect(x * S, (z + k * 0.5) * S, 2 * S - 1, 0.5 * S - 1);
          }
        }
        break;
      }
      case 'carpetV':
      case 'carpetH': {
        planks(x0, z0, x1, z1, room.floor === 'carpetH', 0.5, '#3e2718');
        const cx = (c0 + w / 2) * TILE, cz = (r0 + h / 2) * TILE;
        if (room.floor === 'carpetV') {
          carpet(cx - 2.6, z0 + 2.8, cx + 2.6, z1 - 0.5, '#6a161e', '#c09a4a');
        } else {
          carpet(x0 + 2.8, cz - 2.4, x1 - 2.8, cz + 2.4, '#6a161e', '#c09a4a');
        }
        break;
      }
    }
    void ri;
    g.restore();
  });
  // rugs
  for (const [x0, z0, x1, z1, kind] of RUGS) {
    const col = kind === 'red' ? '#5e1219' : kind === 'blue' ? '#1b2748' : '#22402c';
    carpet(x0, z0, x1, z1, col, '#c4a050');
    diamonds(x0 + 1, z0 + 1, x1 - 1, z1 - 1, 'rgba(196,160,80,0.35)');
  }
  // grain + wall occlusion
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const gr = makeRng(77);
  for (let py = 0; py < H; py++) {
    const z = (py + 0.5) / S;
    const r = Math.floor(z / TILE);
    const lz = z - r * TILE;
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / S;
      const c = Math.floor(x / TILE);
      const lx = x - c * TILE;
      let ao = 1;
      if (grid[r * COLS + c] >= 0) {
        const dl = grid[r * COLS + c - 1] < 0 ? lx : 9;
        const dr = grid[r * COLS + c + 1] < 0 ? TILE - lx : 9;
        const du = grid[(r - 1) * COLS + c] < 0 ? lz : 9;
        const dd = grid[(r + 1) * COLS + c] < 0 ? TILE - lz : 9;
        const m = Math.min(dl, dr, du, dd);
        if (m < 0.9) ao = 0.55 + 0.45 * (m / 0.9);
      }
      const k = (py * W + px) * 4;
      const n = (gr() - 0.5) * 14;
      d[k] = Math.max(0, Math.min(255, d[k] * ao + n));
      d[k + 1] = Math.max(0, Math.min(255, d[k + 1] * ao + n));
      d[k + 2] = Math.max(0, Math.min(255, d[k + 2] * ao + n));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- roomba
export interface RoombaModel {
  group: THREE.Group;
  body: THREE.Group;
  ledMat: THREE.MeshBasicMaterial;
  eyeMat: THREE.MeshBasicMaterial;
  eyes: THREE.Mesh[];
  brushes: THREE.Group[];
  light: THREE.PointLight;
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  shell: THREE.MeshPhysicalMaterial;
  top: THREE.MeshPhysicalMaterial;
  /** Machine-specific extras (mop pad, canister, scrub deck, hover ring); rebuilt by setMachineLook. */
  extras: THREE.Group;
  /** Flashing beacon / hover ring material, driven from the game loop; null when the machine has none. */
  beacon: THREE.MeshBasicMaterial | null;
  machine: number;
}

/**
 * Dress the robot as one of the machines (0 robo vacuum … 4 hover cleaner). The round base, face and
 * side brushes stay; colours change and each machine bolts its own kit on top.
 */
export function setMachineLook(r: RoombaModel, machine: number) {
  r.machine = machine;
  r.body.remove(r.extras);
  r.extras.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material && m.material !== r.ledMat) (m.material as THREE.Material).dispose();
  });
  const x = new THREE.Group();
  r.extras = x;
  r.beacon = null;
  r.body.add(x);
  // glossy moulded plastic by default; parts override roughness/metalness where they're rubber or metal
  const phong = (color: number, opts: THREE.MeshPhysicalMaterialParameters = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, ...opts });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.set(rx, ry, rz);
    x.add(m);
    return m;
  };
  const colours: [number, number][] = [[0x1d1f24, 0x2f333b], [0xe6ecf0, 0xb4c3cc], [0xf2b705, 0x2a2a2e], [0xb3261e, 0x34302e], [0x2b2152, 0x5b3fd1]];
  const [shell, top] = colours[Math.min(machine, colours.length - 1)];
  r.shell.color.setHex(shell);
  r.top.color.setHex(top);
  r.brushes.forEach((b) => (b.visible = machine < 4));
  r.body.position.y = 0;
  switch (machine) {
    case 1: { // mop & sweep: clear water tank on top, blue mop pad trailing behind
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 20), phong(0x6fc3ff, { transparent: true, opacity: 0.55, roughness: 0.05, transmission: 0 }), 0, 0.42, -0.2);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), phong(0xffffff), 0, 0.52, -0.2);
      add(new THREE.BoxGeometry(0.95, 0.04, 0.34), phong(0x2f7fd8, { roughness: 0.95, clearcoat: 0 }), 0, 0.025, -0.5);
      add(new THREE.BoxGeometry(0.9, 0.06, 0.06), phong(0x8a9aa6, { metalness: 0.8, roughness: 0.3, clearcoat: 0 }), 0, 0.07, -0.36);
      break;
    }
    case 2: { // auto shop vac: canister, lid, hose arching to a wide front nozzle
      const yellow = phong(0xf2b705), black = phong(0x1b1b1f, { roughness: 0.6, clearcoat: 0.2 });
      add(new THREE.CylinderGeometry(0.27, 0.3, 0.5, 24), yellow, 0, 0.59, -0.2);
      add(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 24), black, 0, 0.88, -0.2);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), black, 0, 0.96, -0.2);
      add(new THREE.TorusGeometry(0.3, 0.045, 8, 16, Math.PI), black, 0.32, 0.36, -0.02, 0, Math.PI / 2, 0);
      add(new THREE.BoxGeometry(0.85, 0.07, 0.14), black, 0, 0.04, 0.55);
      break;
    }
    case 3: { // floor scrubber: tall housing, squeegee bar, orange beacon
      const red = phong(0xb3261e), dark = phong(0x232124, { roughness: 0.55, clearcoat: 0.2 });
      add(new THREE.BoxGeometry(0.62, 0.36, 0.5), red, 0, 0.52, -0.16);
      add(new THREE.BoxGeometry(0.66, 0.05, 0.54), dark, 0, 0.72, -0.16);
      add(new THREE.BoxGeometry(1.35, 0.07, 0.09), dark, 0, 0.05, -0.62);
      add(new THREE.BoxGeometry(0.06, 0.06, 0.25), dark, -0.45, 0.08, -0.5);
      add(new THREE.BoxGeometry(0.06, 0.06, 0.25), dark, 0.45, 0.08, -0.5);
      r.beacon = new THREE.MeshBasicMaterial({ color: 0xff9a1a });
      add(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12), r.beacon, 0.2, 0.81, -0.3);
      break;
    }
    case 4: { // hover cleaner: glowing thruster ring underneath, fins, a little dome
      r.beacon = new THREE.MeshBasicMaterial({ color: 0x7af0ff });
      add(new THREE.TorusGeometry(0.46, 0.05, 8, 40), r.beacon, 0, 0.02, 0, Math.PI / 2);
      add(new THREE.SphereGeometry(0.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), phong(0x9fe8ff, { transparent: true, opacity: 0.5, roughness: 0.04 }), 0, 0.34, -0.12);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.18, 0.3), phong(0x5b3fd1), sx * 0.5, 0.3, -0.3, 0, 0, sx * -0.4);
      break;
    }
    default: break;
  }
}

function makeRoomba(): RoombaModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  // ---- materials: clear-coated plastic shell, smoked-glass deck, rubber bumper, brushed metal
  const shell = new THREE.MeshPhysicalMaterial({ color: 0x1d1f24, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 });
  const top = new THREE.MeshPhysicalMaterial({ color: 0x2f333b, roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x5c616b, roughness: 0.7 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.28, metalness: 1 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x05070a, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 });
  // LEDs are unlit; the game drives their colour in HDR so the bloom catches them
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xbffcff });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };

  // shell: a turned profile with a soft lower radius and a chamfered top edge
  const prof = [
    [0, 0.045], [0.5, 0.045], [0.535, 0.06], [0.55, 0.09], [0.552, 0.24], [0.545, 0.275], [0.525, 0.3], [0.495, 0.312], [0, 0.312],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  add(new THREE.LatheGeometry(prof, 64), shell, 0, 0, 0);
  // smoked-glass deck, slightly proud of the shell, with a fine bevel
  const deck = [[0, 0.335], [0.455, 0.335], [0.47, 0.328], [0.478, 0.312]].map(([x, y]) => new THREE.Vector2(x, y));
  add(new THREE.LatheGeometry(deck, 64), top, 0, 0, 0);
  // front bumper: rubber band around the front half, with a dark seam above and below
  add(new THREE.CylinderGeometry(0.566, 0.566, 0.13, 48, 1, true, -Math.PI * 0.55, Math.PI * 1.1), rubber, 0, 0.165, 0);
  for (const y of [0.098, 0.232]) add(new THREE.TorusGeometry(0.556, 0.006, 4, 64, Math.PI * 1.1), seam, 0, y, 0, Math.PI / 2, 0, Math.PI * 0.45 + Math.PI);
  // dust-bin door at the back: a darker panel with a grip slot
  add(new THREE.CylinderGeometry(0.554, 0.554, 0.12, 24, 1, true, Math.PI * 0.72, Math.PI * 0.56), seam, 0, 0.17, 0);
  add(new THREE.BoxGeometry(0.16, 0.012, 0.03), metal, 0, 0.27, -0.53);
  // LED ring + centre button (brushed metal cap inside a glowing ring)
  add(new THREE.TorusGeometry(0.34, 0.016, 8, 72), ledMat, 0, 0.338, 0, Math.PI / 2);
  add(new THREE.TorusGeometry(0.105, 0.012, 8, 40), ledMat, 0, 0.34, -0.1, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.09, 0.095, 0.02, 32), metal, 0, 0.34, -0.1);
  // face: two rounded eye LEDs (scale.z is the blink) and a sensor window under them
  const eyes: THREE.Mesh[] = [];
  for (const sx of [-0.13, 0.13]) {
    const e = add(new THREE.CylinderGeometry(0.052, 0.056, 0.024, 24), eyeMat, sx, 0.346, 0.2);
    eyes.push(e);
  }
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 32, 1, true, -0.42, 0.84), lens, 0, 0.255, 0, 0, 0, 0).scale.set(2.52, 1, 2.52);
  // drive wheels peeking out under the shell, plus a front caster
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 20), tyre, sx * 0.43, 0.075, -0.02, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.052, 12), metal, sx * 0.43, 0.075, -0.02, 0, 0, Math.PI / 2);
  }
  add(new THREE.SphereGeometry(0.035, 12, 8), metal, 0, 0.035, 0.36);

  // side brushes: a hub with three arms, each ending in a fanned tuft of bristles
  const brushMat = new THREE.MeshStandardMaterial({ color: 0xd8cfae, roughness: 0.8 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.5 });
  const bristle = new THREE.ConeGeometry(0.012, 0.2, 4);
  bristle.rotateZ(-Math.PI / 2);
  bristle.translate(0.1, 0, 0);
  const brushes: THREE.Group[] = [];
  for (const sx of [-0.36, 0.36]) {
    const b = new THREE.Group();
    add(new THREE.CylinderGeometry(0.05, 0.055, 0.025, 16), hubMat, 0, 0.012, 0, 0, 0, 0, b);
    for (let k = 0; k < 3; k++) {
      const arm = new THREE.Group();
      arm.rotation.y = (k * Math.PI * 2) / 3;
      add(new THREE.BoxGeometry(0.12, 0.012, 0.022), hubMat, 0.07, 0.006, 0, 0, 0, 0, arm);
      for (let f = -2; f <= 2; f++) add(bristle, brushMat, 0.11, 0.004, 0, 0, f * 0.09, -0.04, arm);
      b.add(arm);
    }
    b.position.set(sx, 0.02, 0.36);
    group.add(b);
    brushes.push(b);
  }

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.7),
    new THREE.MeshBasicMaterial({ map: blobTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  group.add(shadow);
  // Glow lies flat on the floor as a halo: a camera-facing sprite sank half into the floor and got clipped.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: blobTexture('rgba(120,240,255,0.3)', 'rgba(0,200,255,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.scale.set(2.4, 2.4, 1);
  glow.position.y = 0.02;
  glow.renderOrder = 2;
  group.add(glow);
  const light = new THREE.PointLight(0x9feaff, 0, 15, 2);
  light.position.set(0, 2.6, 0.4);
  group.add(light);
  const extras = new THREE.Group();
  body.add(extras);
  return { group, body, ledMat, eyeMat, eyes, brushes, light, glow, shell, top, extras, beacon: null, machine: 0 };
}

// ---------------------------------------------------------------- dock
export interface DockModel { group: THREE.Group; ring: THREE.Mesh; stripMat: THREE.MeshBasicMaterial; ringMat: THREE.MeshBasicMaterial }
function makeDock(): DockModel {
  const group = new THREE.Group();
  const body = new THREE.MeshPhysicalMaterial({ color: 0x1b1d22, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x07080b, roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9ad4a, roughness: 0.25, metalness: 1, emissive: 0x2a1800 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    group.add(m);
    return m;
  };
  // base plate with rounded corners and a shallow ramp the robot drives up
  add(new RoundedBoxGeometry(1.7, 0.06, 1.5, 3, 0.03), plate, 0, 0.03, 0.2);
  add(new THREE.BoxGeometry(1.5, 0.02, 0.3), plate, 0, 0.012, -0.62, -0.12);
  // tower: rounded, glossy, with a smoked glass face
  add(new RoundedBoxGeometry(1.5, 0.56, 0.42, 4, 0.08), body, 0, 0.3, 1.05);
  add(new RoundedBoxGeometry(1.2, 0.3, 0.02, 2, 0.01), glass, 0, 0.32, 0.835);
  // status strip behind the glass (the game pulses it) and two small indicator dots
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x35ff9a });
  add(new RoundedBoxGeometry(0.9, 0.05, 0.01, 2, 0.02), stripMat, 0, 0.3, 0.824);
  for (const sx of [-0.5, 0.5]) add(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 12), stripMat, sx, 0.42, 0.824, Math.PI / 2);
  // brass charging contacts on raised pads
  for (const sx of [-0.35, 0.35]) {
    add(new RoundedBoxGeometry(0.24, 0.03, 0.36, 2, 0.012), plate, sx, 0.07, 0.55);
    add(new RoundedBoxGeometry(0.16, 0.02, 0.28, 2, 0.008), brass, sx, 0.09, 0.55);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x35ff9a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.2, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  group.position.set(DOCK.x, 0, DOCK.z);
  return { group, ring, stripMat, ringMat };
}

// ---------------------------------------------------------------- world
// ---------------------------------------------------------------- mess (out-of-place objects)
export interface Pose { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
export interface MessPart { obj: THREE.Object3D; from: Pose; to: Pose; delay: number }
export interface MessItem {
  kind: 'books' | 'vase' | 'pots' | 'frame';
  room: number;
  parts: MessPart[];
  messyBoxes: Box[];
  tidyBoxes: Box[];
  tidy: boolean;
  /** Where the cutscene camera should look, and how far apart the messy/tidy spots are. */
  focus: THREE.Vector3;
  spread: number;
  /** Seconds this item's tidy animation takes (part animation + the last part's delay). */
  duration: number;
}
/** Seconds one part takes to lift, travel and settle. */
export const PART_ANIM = 1.5;

const poseOf = (m: THREE.Matrix4): Pose => {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q, s };
};
const applyPose = (o: THREE.Object3D, ps: Pose) => { o.position.copy(ps.p); o.quaternion.copy(ps.q); o.scale.copy(ps.s); };
const localM = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sc = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sc, sc, sc));
const frameM = (x: number, z: number, ry: number, y = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);

export interface SecretDoor {
  room: number;
  c: number;
  r: number;
  /** Tile index in the grid. */
  idx: number;
  group: THREE.Group;
  box: Box;
  /** Centre of the visible wall face (where the hint draft wisps out). */
  fx: number;
  fz: number;
  /** Direction from the wall face into the room it's found from. */
  nx: number;
  /** Block filling the secret room so the overhead camera can't peek in before it's found. */
  roof: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
}

export interface World {
  scene: THREE.Scene;
  grid: Int8Array;
  boxes: Box[];
  roomba: RoombaModel;
  dock: DockModel;
  cut: CutUniforms;
  introGroup: THREE.Group;
  floorMat: THREE.MeshStandardMaterial;
  /** Ceiling lights. bulbs: emissive materials of the visible bulbs fed by that light; flaky: how unreliable the bulb is. */
  lights: { light: THREE.PointLight; base: number; bulbs: THREE.MeshStandardMaterial[]; flaky: number }[];
  /** Fake walls hiding the secret rooms; `group` sinks into the floor once found. */
  secrets: SecretDoor[];
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  /** Grandfather clocks: position and pendulum phase (pendulum angle ~ sin(t*PI + phase)). */
  clocks: { x: number; z: number; phase: number }[];
  /** Out-of-place objects that get tidied away in a cutscene once their room is spotless. */
  mess: MessItem[];
  /** Snap an item fully messy or fully tidy (pose + collision boxes). */
  setMessState(item: MessItem, tidy: boolean): void;
  /** Positions of looping ambient sound sources (fireplace crackle, fountain water). */
  soundSources: { kind: 'fire' | 'water'; x: number; z: number }[];
  /** Drive animated furniture. t: seconds; hours: in-game clock time in hours (12 = midnight). */
  animate(t: number, hours: number): void;
  /** Animated furniture parts (clock hands, flames, globes...), which move every frame. */
  animRoot: THREE.Group;
}

/** wetTex: how freshly mopped each bit of floor is (see DirtMap.wet). */
export function buildWorld(dirtTex: THREE.Texture, grid: Int8Array, wetTex: THREE.Texture): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07050a);
  scene.fog = new THREE.Fog(0x07050a, 24, 70);
  const cut: CutUniforms = { uRoomba: { value: new THREE.Vector3(DOCK.x, 0, DOCK.z) }, uCut: { value: 0 } };
  const boxes: Box[] = [];
  const addBox = (cx: number, cz: number, w: number, d: number) => boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

  // Walls (and things hung on them) get the cutaway so they never hide the roomba; furniture uses
  // an otherwise identical material set that instead fades see-through only where it blocks the roomba.
  const fadeMats = new Set<THREE.Material>();
  const makeMats = (cutaway: boolean) => {
  // PBR throughout: every surface gets a roughness/metalness that fits what it is
  const L = (color: number, opts: THREE.MeshStandardMaterialParameters = {}, dark = false) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
    if (cutaway) patchCutaway(m, cut, dark);
    else { patchOccluderFade(m, cut); fadeMats.add(m); }
    return m;
  };
  const M = {
    wallpaper: L(LEVEL.walls.paper, { side: THREE.DoubleSide, roughness: 0.92 }, true),
    wainscot: L(LEVEL.walls.wainscot, { side: THREE.DoubleSide, roughness: 0.55 }, true),
    cap: L(0x17111a, { side: THREE.DoubleSide, roughness: 0.9 }, true),
    trim: L(0x8a6a3a, { roughness: 0.45, metalness: 0.1 }),
    woodDark: L(0x3b2416, { roughness: 0.5 }),
    woodMed: L(0x6b4426, { roughness: 0.55 }),
    woodLight: L(0x9a6b3e, { roughness: 0.6 }),
    red: L(0x7a1d27, { roughness: 0.95 }),
    green: L(0x2f5038, { roughness: 0.95 }),
    blue: L(0x2a3d66, { roughness: 0.95 }),
    wicker: L(0xa8875a, { roughness: 0.9 }),
    gold: L(0xc69a3e, { emissive: 0x2a1a00, roughness: 0.32, metalness: 0.9 }),
    stone: L(0x9a958a, { roughness: 0.88 }),
    marbleW: L(0xd8d2c4, { roughness: 0.22 }),
    white: L(0xdcd8cc, { roughness: 0.45 }),
    black: L(0x17151a, { roughness: 0.4 }),
    steel: L(0x8c9096, { roughness: 0.35, metalness: 0.85 }),
    plant: L(0x2f6b34, { roughness: 0.7 }),
    plant2: L(0x3f8a3c, { roughness: 0.7 }),
    pot: L(0xa0522d, { roughness: 0.75 }),
    books: [L(0x7a1d27), L(0x22406a), L(0x2f5a34), L(0xb08a50), L(0x4a2a5a)],
    // emissive parts glow above 1.0 so the bloom picks them up
    flame: L(0xffd080, { emissive: 0xffb040, emissiveIntensity: 2.4 }),
    ember: L(0xff6020, { emissive: 0xff4010, emissiveIntensity: 2 }),
    water: L(0x3a7fa0, { emissive: 0x0a3550, roughness: 0.06, metalness: 0.1 }),
    window: L(0x24345e, { emissive: 0x1a2a55, emissiveIntensity: 1.6, side: THREE.DoubleSide, roughness: 0.08, metalness: 0.2 }),
    lamp: L(0xffe0a0, { emissive: 0xffc060, emissiveIntensity: 2.2 }),
    globe: L(0x2a6a8a, { roughness: 0.4 }),
    crystal: L(0xe6f0ff, { emissive: 0x1a2230, roughness: 0.04, metalness: 0.15 }),
    linen: L(0xe9e2d0, { roughness: 0.9 }),
    lacquer: L(0x0b0a0d, { roughness: 0.12 }),
    ivory: L(0xf1ead8, { roughness: 0.35 }),
    leather: L(0x234a33, { roughness: 0.6 }),
    iron: L(0x2a2a2e, { roughness: 0.55, metalness: 0.7 }),
    glassGreen: L(0x1f7a3a, { emissive: 0x0f5a24, emissiveIntensity: 1.6, roughness: 0.15 }),
  };
  const portraits = [0, 1, 2, 3, 4, 5].map((i) => L(0xffffff, { map: portraitTexture(i + 1), side: THREE.DoubleSide, roughness: 0.55 }));
  return { M, portraits };
  };
  let { M, portraits } = makeMats(true);
  const wallM = M, wallPortraits = portraits; // cutaway set, kept for the secret doors

  // ---- floor
  // the floor texture treats the secret doorways as walls, so their wall-edge shading gives nothing away
  const closedGrid = grid.slice();
  for (const [c, r] of SECRET_DOORS) closedGrid[r * COLS + c] = -1;
  const floorTex = floorTexture(closedGrid, grid);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 });
  floorMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFloor = { value: floorTex };
    shader.uniforms.uDirt = { value: dirtTex };
    shader.uniforms.uWet = { value: wetTex };
    shader.uniforms.uWorld = { value: new THREE.Vector2(WORLD_W, WORLD_H) };
    shader.vertexShader = 'uniform vec2 uWorld;\nvarying vec2 vDUv;\nvarying vec2 vDW;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 dwp = modelMatrix * vec4(position, 1.0);
      vDW = dwp.xz;
      vDUv = dwp.xz / uWorld;`,
    );
    shader.fragmentShader = `uniform sampler2D uFloor;
uniform sampler2D uDirt;
uniform sampler2D uWet;
varying vec2 vDUv;
varying vec2 vDW;
float dh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(dh(i), dh(i+vec2(1.0,0.0)), f.x), mix(dh(i+vec2(0.0,1.0)), dh(i+vec2(1.0,1.0)), f.x), f.y); }
` + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `vec4 flc = texture2D(uFloor, vDUv);
        diffuseColor.rgb *= flc.rgb;
        float dd = texture2D(uDirt, vDUv).r;
        float n1 = dn(vDW * 2.3);
        float n2 = dn(vDW * 9.0);
        float dirtA = smoothstep(0.02, 0.5, dd) * (0.82 + 0.18 * n2);
        vec3 mud = mix(vec3(0.13, 0.085, 0.045), vec3(0.29, 0.2, 0.11), n1 * 0.6 + n2 * 0.4);
        mud *= 0.75 + 0.5 * dd;
        diffuseColor.rgb = mix(diffuseColor.rgb, mud, dirtA);
        // freshly mopped tile: darker, a touch cooler and glossy; the edge dries back unevenly
        float ww = texture2D(uWet, vDUv).r;
        float wetA = smoothstep(0.08 + 0.3 * dn(vDW * 1.7), 0.55, ww) * (1.0 - dirtA);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.58, 0.66), wetA);`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // polish varies a little across the floor; mud is fully matte, wet tile turns to a mirror
        roughnessFactor *= 0.85 + 0.3 * n1;
        roughnessFactor = mix(roughnessFactor, 1.0, dirtA);
        roughnessFactor = mix(roughnessFactor, 0.05, wetA);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // faint cool sheen with mop streaks, so wet tile reads even away from the lights
        totalEmissiveRadiance += vec3(0.05, 0.075, 0.11) * wetA * (0.55 + 0.45 * dn(vec2(vDW.x * 0.6, vDW.y * 7.0)));`)
;
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(WORLD_W / 2, 0, WORLD_H / 2);
  scene.add(floor);

  const sb = new SB();

  // ---- walls (greedy rect merge)
  const need = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (grid[r * COLS + c] >= 0) continue;
    // every non-floor tile is solid wall, so unused space between rooms reads as thick masonry rather than a pit
    need[r * COLS + c] = 1;
  }
  const used = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    if (!need[i] || used[i]) continue;
    let w = 1;
    while (c + w < COLS && need[r * COLS + c + w] && !used[r * COLS + c + w]) w++;
    let h = 1;
    outer: while (r + h < ROWS) {
      for (let k = 0; k < w; k++) { const j = (r + h) * COLS + c + k; if (!need[j] || used[j]) break outer; }
      h++;
    }
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) used[y * COLS + x] = 1;
    // one cap quad over each merged rectangle of wall
    sb.place(new THREE.PlaneGeometry(w * TILE, h * TILE), M.cap, (c + w / 2) * TILE, WALL_H, (r + h / 2) * TILE, -Math.PI / 2);
  }
  // Side faces only where wall meets floor (or the map edge), merged into runs and split into the
  // panelling / wallpaper / cap bands. Building the walls as one shell, with no faces inside the
  // masonry, means the cutaway never exposes coincident faces that would fight and flicker.
  const isWallTile = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS && need[r * COLS + c] === 1;
  const bands: [THREE.Material, number, number][] = [[M.wainscot, 0, 1.3], [M.wallpaper, 1.3, WALL_H - 0.15], [M.cap, WALL_H - 0.15, WALL_H]];
  const sideRun = (x: number, z: number, len: number, ry: number) => {
    for (const [mat, y0, y1] of bands) sb.place(new THREE.PlaneGeometry(len, y1 - y0), mat, x, (y0 + y1) / 2, z, 0, ry, 0);
  };
  // faces looking south (+z) and north (-z): scan each row
  for (const [dr, ry] of [[1, 0], [-1, Math.PI]] as const) {
    for (let r = 0; r < ROWS; r++) {
      let start = -1;
      for (let c = 0; c <= COLS; c++) {
        const exposed = c < COLS && isWallTile(c, r) && !isWallTile(c, r + dr);
        if (exposed && start < 0) start = c;
        if (!exposed && start >= 0) {
          sideRun(((start + c) / 2) * TILE, (dr > 0 ? r + 1 : r) * TILE, (c - start) * TILE, ry);
          start = -1;
        }
      }
    }
  }
  // faces looking east (+x) and west (-x): scan each column
  for (const [dc, ry] of [[1, Math.PI / 2], [-1, -Math.PI / 2]] as const) {
    for (let c = 0; c < COLS; c++) {
      let start = -1;
      for (let r = 0; r <= ROWS; r++) {
        const exposed = r < ROWS && isWallTile(c, r) && !isWallTile(c + dc, r);
        if (exposed && start < 0) start = r;
        if (!exposed && start >= 0) {
          sideRun((dc > 0 ? c + 1 : c) * TILE, ((start + r) / 2) * TILE, (r - start) * TILE, ry);
          start = -1;
        }
      }
    }
  }

  // ---- wall decor: paintings & windows
  const painting = (x: number, z: number, ry: number, w: number, h: number, idx: number) => {
    sb.frame(x, z, ry);
    sb.box(M.gold, 0, 2.6 - h / 2 - 0.12, 0.03, w + 0.24, h + 0.24, 0.06);
    sb.place(new THREE.PlaneGeometry(w, h), portraits[idx % portraits.length], 0, 2.6, 0.065);
    sb.reset();
  };
  for (const [x, z, ry, w, h, idx] of LEVEL.paintings) painting(x, z, ry, w, h, idx);
  const windowAt = (x: number, z: number, ry: number) => {
    sb.frame(x, z, ry);
    sb.box(M.window, 0, 1.1, 0.03, 1.6, 2.6, 0.04);
    sb.box(M.woodDark, 0, 1.0, 0.06, 1.9, 0.12, 0.1);
    sb.box(M.woodDark, 0, 3.7, 0.06, 1.9, 0.12, 0.1);
    sb.box(M.woodDark, 0, 1.1, 0.07, 0.08, 2.6, 0.06);
    sb.box(M.woodDark, 0, 2.35, 0.07, 1.6, 0.08, 0.06);
    sb.reset();
  };
  for (const [x, z, ry] of LEVEL.windows) windowAt(x, z, ry);

  // ---- furniture (fades when blocking the roomba, never cut away)
  // Moving parts are real meshes (not merged into the statics) and are driven by animate().
  const animators: ((t: number, hours: number) => void)[] = [];
  const clocks: World['clocks'] = [];
  const soundSources: World['soundSources'] = [];
  const animRoot = new THREE.Group();
  scene.add(animRoot);
  const anchor = (x: number, z: number, ry: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    animRoot.add(g);
    return g;
  };
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  const globeMat = new THREE.MeshStandardMaterial({ map: globeTexture(), roughness: 0.35 });
  patchOccluderFade(globeMat, cut);
  const flameMats = [0xff7a1a, 0xffc040].map((color) => new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(2.6), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const rippleMat = () => new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  ({ M, portraits } = makeMats(false));
  const rng = makeRng(42);
  const legsCollide = (x: number, z: number, a: number, pts: [number, number][], s = 0.3) => {
    for (const [lx, lz] of pts) { const [wx, wz] = rotXZ(lx, lz, a); addBox(x + wx, z + wz, s, s); }
  };
  const fullBox = (f: FurnDef, w: number, d: number) => {
    const a = furnRot(f);
    const swap = Math.abs(Math.sin(a)) > 0.5;
    addBox(f.x, f.z, swap ? d : w, swap ? w : d);
  };
  // ---- mess: each out-of-place object is built from separate meshes with a messy pose and a tidy pose
  const mess: MessItem[] = [];
  const messRoot = new THREE.Group();
  scene.add(messRoot);
  const mkBox = (cx: number, cz: number, w: number, d: number): Box => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  const roomAt = (x: number, z: number) => {
    const c = Math.floor(x / TILE), r = Math.floor(z / TILE);
    return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : grid[r * COLS + c];
  };
  const newItem = (kind: MessItem['kind'], x: number, z: number): MessItem => {
    const it: MessItem = { kind, room: roomAt(x, z), parts: [], messyBoxes: [], tidyBoxes: [], tidy: false, focus: new THREE.Vector3(), spread: 0, duration: PART_ANIM };
    mess.push(it);
    return it;
  };
  const addPart = (it: MessItem, obj: THREE.Object3D, from: THREE.Matrix4, to: THREE.Matrix4, delay = 0) => {
    const part = { obj, from: poseOf(from), to: poseOf(to), delay };
    applyPose(obj, part.from);
    messRoot.add(obj);
    it.parts.push(part);
  };
  const finishItem = (it: MessItem) => {
    for (const b of it.messyBoxes) boxes.push(b);
    const a = new THREE.Vector3(), b2 = new THREE.Vector3();
    for (const pt of it.parts) { a.add(pt.from.p); b2.add(pt.to.p); }
    a.divideScalar(it.parts.length); b2.divideScalar(it.parts.length);
    it.focus.copy(a).add(b2).multiplyScalar(0.5).setY(0);
    it.spread = Math.hypot(a.x - b2.x, a.z - b2.z);
    it.duration = PART_ANIM + Math.max(...it.parts.map((pt) => pt.delay));
  };
  const geoMesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => new THREE.Mesh(geo, mat);
  // ---- shapes for the tidy-up items (same sizes as the plain boxes and cylinders they replace)
  const bookGeo = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(0.02, h / 2 - 0.002));
  /** Baluster vase 0.9 tall centred on its middle; `stub` is the broken lower half lying on the floor. */
  const vaseGeo = (stub: boolean) => {
    const full: [number, number][] = [[0, -0.45], [0.19, -0.45], [0.22, -0.4], [0.31, -0.15], [0.33, 0.02], [0.27, 0.2], [0.17, 0.32], [0.16, 0.38], [0.23, 0.45], [0.2, 0.45], [0.13, 0.38]];
    const prof = stub ? full.filter(([, y]) => y <= 0.05).map(([r, y]) => [r, y + 0.15] as [number, number]) : full;
    if (stub) prof.push([0.3, 0.2]);
    return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, stub ? y - 0.15 : y)), 24);
  };
  /** Irregular porcelain chips, each a different shape, about the size of the old flat ones. */
  const shardGeo = (k: number) => {
    const g = new THREE.OctahedronGeometry(0.1);
    g.scale(0.9 + (k % 3) * 0.25, 0.25, 0.6 + ((k + 1) % 2) * 0.3);
    g.rotateY(k * 0.9);
    return g;
  };
  /** Stock pot with side handles, a long-handled saucepan, or a domed lid with a knob. */
  const potGeo = (kind: 'stock' | 'sauce' | 'lid') => {
    if (kind === 'lid') {
      const g = new THREE.LatheGeometry([[0, 0.04], [0.06, 0.04], [0.05, 0.02], [0.12, 0.0], [0.25, -0.03], [0.26, -0.04], [0, -0.04]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
      return g;
    }
    const [r, h] = kind === 'stock' ? [0.34, 0.5] : [0.29, 0.35];
    const body = new THREE.LatheGeometry([[0, -h / 2], [r - 0.04, -h / 2], [r, -h / 2 + 0.04], [r, h / 2 - 0.02], [r + 0.02, h / 2], [r - 0.02, h / 2], [r - 0.02, -h / 2 + 0.03], [0, -h / 2 + 0.03]].map(([a, b]) => new THREE.Vector2(a, b)), 20);
    const parts: THREE.BufferGeometry[] = [body];
    if (kind === 'stock') {
      for (const sx of [-1, 1]) {
        const handle = new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI);
        handle.rotateY(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        handle.translate(sx * (r + 0.005), h / 2 - 0.12, 0);
        parts.push(handle);
      }
    } else {
      const handle = new THREE.BoxGeometry(0.55, 0.04, 0.07);
      handle.translate(r + 0.27, h / 2 - 0.06, 0);
      parts.push(handle);
    }
    return mergeGeometries(parts, false) ?? body;
  };
  /** Gilt picture frame 1.7 × 1.3 lying flat (face up), 0.1 deep: moulded bars around a sunken slip. */
  const frameGeo = () => {
    const bar = (w: number, d: number, x: number, z: number) => { const g = new RoundedBoxGeometry(w, 0.1, d, 2, 0.03); g.translate(x, 0.05, z); return g; };
    const slip = (w: number, d: number, x: number, z: number) => { const g = new RoundedBoxGeometry(w, 0.06, d, 1, 0.015); g.translate(x, 0.07, z); return g; };
    return mergeGeometries([
      bar(1.7, 0.16, 0, 0.57), bar(1.7, 0.16, 0, -0.57), bar(0.16, 1.3, 0.77, 0), bar(0.16, 1.3, -0.77, 0),
      slip(1.42, 0.05, 0, 0.5), slip(1.42, 0.05, 0, -0.5), slip(0.05, 1.04, 0.69, 0), slip(0.05, 1.04, -0.69, 0),
    ], false)!;
  };
  // flat tops things can be put back onto
  type Surf = { t: string; x: number; z: number; hw: number; hd: number; top: number; r: number; room: number };
  const surfaces: Surf[] = FURNITURE.filter((f) => ['table', 'desk', 'roundtable', 'counter', 'stove', 'island'].includes(f.t)).map((f) => {
    const w = f.w ?? 1, d = f.d ?? 1;
    const swap = Math.abs(Math.sin(furnRot(f))) > 0.5;
    const top = f.t === 'table' ? (f.h ?? 1.6) : f.t === 'desk' ? 1.65 : f.t === 'roundtable' ? 1.74 : 1.77;
    return { t: f.t, x: f.x, z: f.z, hw: (swap ? d : w) / 2, hd: (swap ? w : d) / 2, top, r: f.t === 'roundtable' ? w / 2 : 0, room: roomAt(f.x, f.z) };
  });
  const surfDist = (sf: Surf, x: number, z: number) => sf.r
    ? Math.max(0, Math.hypot(x - sf.x, z - sf.z) - sf.r)
    : Math.hypot(Math.max(0, Math.abs(x - sf.x) - sf.hw), Math.max(0, Math.abs(z - sf.z) - sf.hd));
  /** Nearest surface of the given kinds in the same room (long set dining tables excluded). */
  const nearestSurf = (x: number, z: number, kinds: string[], maxD = Infinity) => {
    const room = roomAt(x, z);
    let best: Surf | null = null, bd = maxD;
    for (const sf of surfaces) {
      if (sf.room !== room || !kinds.includes(sf.t) || (sf.t === 'table' && sf.hw * 2 > 6 && kinds.length > 3)) continue;
      const d = surfDist(sf, x, z);
      if (d < bd) { bd = d; best = sf; }
    }
    return best;
  };
  /** A point on a surface's top near (x, z), at least `margin` in from its edge. */
  const pointOn = (sf: Surf, x: number, z: number, margin: number): [number, number] => {
    if (sf.r) {
      const a = Math.atan2(z - sf.z, x - sf.x), rr = Math.max(0.9, sf.r - margin);
      return [sf.x + Math.cos(a) * rr, sf.z + Math.sin(a) * rr];
    }
    const mx = Math.max(0, sf.hw - margin), mz = Math.max(0, sf.hd - margin);
    return [Math.max(sf.x - mx, Math.min(sf.x + mx, x)), Math.max(sf.z - mz, Math.min(sf.z + mz, z))];
  };
  /** Nearest north/west/east wall spot of the room to hang a fallen painting: [x, z, ry]. */
  const wallSpot = (x: number, z: number): [number, number, number] | null => {
    const room = roomAt(x, z);
    const c0 = Math.floor(x / TILE), r0 = Math.floor(z / TILE);
    const isRoom = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS && grid[r * COLS + c] === room;
    const isWall = (c: number, r: number) => c < 0 || r < 0 || c >= COLS || r >= ROWS || grid[r * COLS + c] < 0;
    let best: [number, number, number] | null = null, bd = Infinity;
    for (const [dc, dr, ry] of [[0, -1, 0], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]] as const) {
      let c = c0, r = r0;
      while (isRoom(c + dc, r + dr)) { c += dc; r += dr; }
      if (!isWall(c + dc, r + dr)) continue; // runs into a doorway
      // wall must continue on both sides, with this room's floor in front (no doorway next to it)
      const pc = dr !== 0 ? 1 : 0, pr = dc !== 0 ? 1 : 0;
      if (![-1, 1].every((k) => isWall(c + dc + pc * k, r + dr + pr * k) && isRoom(c + pc * k, r + pr * k))) continue;
      const spot: [number, number, number] = dr !== 0 ? [x, r * TILE, ry] : [dc < 0 ? c * TILE : (c + 1) * TILE, z, ry];
      const d = Math.hypot(spot[0] - x, spot[1] - z);
      if (d < bd) { bd = d; best = spot; }
    }
    return best;
  };
  /** Turned leg profile scaled to a height: foot, swell, waist, collar. */
  const legProf = (h: number, r: number): [number, number][] => [
    [0, 0], [r * 0.75, 0], [r * 0.8, h * 0.06], [r * 0.65, h * 0.12], [r * 0.95, h * 0.3], [r * 0.6, h * 0.55],
    [r * 0.75, h * 0.7], [r, h * 0.78], [r, h * 0.97], [0, h],
  ];
  // Upholstered side chair: turned front legs, back posts running up into a carved top rail with
  // brass finials, stretchers, a padded seat and an upholstered back panel.
  const chairParts = (seatMat: THREE.Material) => {
    for (const lx of [-0.38, 0.38]) {
      sb.lathe(M.woodDark, lx, 0, 0.38, legProf(0.86, 0.075), 7);
      sb.rbox(M.woodDark, lx, 0, -0.4, 0.12, 2.12, 0.12, 0.03);
      sb.sph(M.gold, lx, 2.17, -0.4, 0.07, 6);
    }
    for (const lz of [-0.38, 0.38]) sb.box(M.woodDark, 0, 0.3, lz, 0.68, 0.05, 0.05);
    for (const lx of [-0.38, 0.38]) sb.box(M.woodDark, lx, 0.3, 0, 0.05, 0.05, 0.68);
    sb.rbox(M.woodMed, 0, 0.82, 0, 0.98, 0.13, 0.98, 0.04);
    sb.rbox(seatMat, 0, 0.93, 0.03, 0.86, 0.14, 0.84, 0.07);
    sb.rbox(M.woodMed, 0, 1.93, -0.4, 0.94, 0.2, 0.11, 0.05);
    sb.rbox(M.woodMed, 0, 1.08, -0.4, 0.8, 0.08, 0.09, 0.03);
    sb.rbox(seatMat, 0, 1.18, -0.37, 0.66, 0.72, 0.08, 0.04);
  };
  // Chesterfield-style sofa / armchair: bun feet, rounded body, rolled arms, loose seat and back cushions.
  const sofaParts = (w: number, d: number, mat: THREE.Material) => {
    for (const lx of [-w / 2 + 0.2, w / 2 - 0.2]) for (const lz of [-d / 2 + 0.2, d / 2 - 0.2]) {
      sb.lathe(M.woodDark, lx, 0, lz, [[0, 0], [0.07, 0], [0.09, 0.06], [0.08, 0.15], [0.06, 0.2], [0, 0.2]], 10);
    }
    sb.rbox(mat, 0, 0.2, 0, w, 0.5, d, 0.08);
    sb.rbox(mat, 0, 0.2, -d / 2 + 0.22, w, 1.3, 0.44, 0.16);
    for (const sx of [-1, 1]) {
      const ax = sx * (w / 2 - 0.2);
      sb.rbox(mat, ax, 0.2, 0.05, 0.4, 0.8, d - 0.1, 0.08);
      sb.place(new THREE.CylinderGeometry(0.23, 0.23, d - 0.1, 16), mat, ax, 1.0, 0.05, Math.PI / 2);
    }
    const n = Math.max(1, Math.round((w - 0.8) / 1.3));
    const cw = (w - 0.8) / n;
    for (let k = 0; k < n; k++) {
      const cx = -w / 2 + 0.4 + cw * (k + 0.5);
      sb.rbox(mat, cx, 0.68, 0.14, cw - 0.06, 0.24, d - 0.6, 0.1);
      sb.rbox(mat, cx, 0.86, -d / 2 + 0.52, cw - 0.08, 0.68, 0.22, 0.1, 0, -0.12);
    }
  };

  for (const f of FURNITURE) {
    const a = furnRot(f);
    const w = f.w ?? 1, d = f.d ?? 1;
    // Fallen / out of place: rotate around local X so the object falls forward onto its front,
    // lifted by d/2 so it rests on the ground instead of sinking through it.
    if (f.fallen) { sb.tip = -Math.PI / 2; sb.tipY = d / 2; }
    switch (f.t) {
      case 'table': {
        const h = f.h ?? 1.6;
        sb.frame(f.x, f.z, 0);
        // moulded top with a thin dark lip, deep apron, turned legs
        sb.rbox(M.woodMed, 0, h - 0.14, 0, w, 0.14, d, 0.05);
        sb.rbox(M.woodDark, 0, h - 0.17, 0, w - 0.08, 0.04, d - 0.08, 0.02);
        sb.rbox(M.woodDark, 0, h - 0.34, 0, w - 0.3, 0.2, d - 0.3, 0.03);
        const pts: [number, number][] = [];
        const nx = w > 6 ? 3 : 2;
        for (let k = 0; k < nx; k++) for (const lz of [-d / 2 + 0.22, d / 2 - 0.22]) {
          pts.push([-w / 2 + 0.22 + (k * (w - 0.44)) / (nx - 1), lz]);
        }
        for (const [lx, lz] of pts) sb.lathe(M.woodDark, lx, 0, lz, legProf(h - 0.14, 0.12), 8);
        if (w > 6) {
          // a linen runner and brass candlesticks with lit candles
          sb.box(M.linen, 0, h, 0, w - 1, 0.02, 1.2);
          for (const lx of [-3, 0, 3]) {
            sb.lathe(M.gold, lx, h, 0, [[0, 0], [0.16, 0], [0.16, 0.04], [0.06, 0.1], [0.04, 0.35], [0.08, 0.45], [0.09, 0.52], [0.06, 0.6], [0, 0.6]], 12);
            sb.cyl(M.white, lx, h + 0.6, 0, 0.045, 0.05, 0.3, 10);
            sb.sph(M.flame, lx, h + 0.95, 0, 0.05, 8);
          }
        } else if (w > 2) {
          sb.rbox(M.books[1], -0.6, h, 0.2, 0.7, 0.12, 0.5, 0.02, 0.3);
          sb.lathe(M.gold, 0.8, h, -0.3, [[0, 0], [0.12, 0], [0.12, 0.03], [0.04, 0.08], [0.03, 0.32], [0, 0.32]], 10);
          sb.lathe(M.lamp, 0.8, h + 0.3, -0.3, [[0.05, 0], [0.18, 0.02], [0.13, 0.22], [0.05, 0.24]], 14);
        }
        sb.reset();
        legsCollide(f.x, f.z, 0, pts, 0.3);
        break;
      }
      case 'roundtable': {
        sb.frame(f.x, f.z, 0);
        // tripod-footed pedestal, bevelled top, a porcelain vase of roses
        sb.lathe(M.woodDark, 0, 0, 0, [[0, 0], [0.85, 0], [0.9, 0.05], [0.7, 0.2], [0.4, 0.3], [0.28, 0.45], [0.36, 0.7], [0.22, 1.0], [0.26, 1.3], [0.4, 1.4], [0.42, 1.48], [0, 1.48]], 16);
        sb.cyl(M.woodDark, 0, 1.48, 0, w / 2 - 0.08, w / 2 - 0.2, 0.12, 32);
        sb.lathe(M.woodMed, 0, 1.6, 0, [[0, 0], [w / 2 - 0.03, 0], [w / 2, 0.04], [w / 2, 0.11], [w / 2 - 0.03, 0.14], [0, 0.14]], 36);
        sb.lathe(M.marbleW, 0, 1.74, 0, [[0, 0], [0.18, 0], [0.2, 0.04], [0.33, 0.35], [0.3, 0.6], [0.16, 0.78], [0.2, 0.9], [0.16, 0.9], [0.14, 0.8], [0, 0.8]], 32);
        // a loose bouquet: small red and white roses on a dome, a few leaves tucked under
        for (let k = 0; k < 11; k++) {
          const an = k * 2.4, rr = k === 0 ? 0 : 0.1 + 0.11 * Math.sqrt(k / 10);
          sb.sph(k % 3 === 2 ? M.white : M.red, Math.cos(an) * rr, 2.78 - rr * 0.6, Math.sin(an) * rr, 0.085, 8);
        }
        for (let k = 0; k < 6; k++) {
          const an = k * 1.05 + 0.5;
          const leaf = new THREE.SphereGeometry(0.5, 8, 6);
          leaf.scale(0.09, 0.3, 0.03);
          leaf.translate(0, 0.15, 0);
          sb.place(leaf, M.plant, Math.cos(an) * 0.12, 2.58, Math.sin(an) * 0.12, 0, -an, -1.1);
        }
        sb.reset();
        addBox(f.x, f.z, 1.7, 1.7);
        break;
      }
      case 'chair':
      case 'tipchair': { // legacy tipchair → regular chair with fallen forced on
        if (f.t === 'tipchair') f.fallen = true;
        sb.frame(f.x, f.z, a);
        chairParts(M.red);
        sb.reset();
        legsCollide(f.x, f.z, a, [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]], 0.22);
        break;
      }
      case 'sofa':
      case 'armchair': {
        const sw = f.t === 'armchair' ? 1.8 : w, sd = f.t === 'armchair' ? 1.7 : d;
        sb.frame(f.x, f.z, a);
        sofaParts(sw, sd, f.v === 1 ? M.wicker : f.t === 'armchair' ? M.green : M.red);
        sb.reset();
        fullBox(f, sw, sd);
        break;
      }
      case 'shelf': {
        const h = 4.2;
        sb.frame(f.x, f.z, a);
        // carcass: back, sides, plinth and a stepped crown moulding
        sb.box(M.woodDark, 0, 0, -d / 2 + 0.06, w, h, 0.12);
        sb.rbox(M.woodDark, -w / 2 + 0.07, 0, 0, 0.14, h, d, 0.03);
        sb.rbox(M.woodDark, w / 2 - 0.07, 0, 0, 0.14, h, d, 0.03);
        sb.rbox(M.woodDark, 0, 0, 0.02, w + 0.06, 0.25, d + 0.04, 0.03);
        sb.rbox(M.woodDark, 0, h - 0.14, 0, w, 0.14, d, 0.03);
        sb.rbox(M.woodMed, 0, h, 0.03, w + 0.12, 0.08, d + 0.08, 0.03);
        sb.rbox(M.woodDark, 0, h + 0.08, 0.05, w + 0.22, 0.1, d + 0.14, 0.04);
        for (let row = 0; row < 4; row++) {
          const y = 0.25 + row * 0.98;
          sb.rbox(M.woodMed, 0, y + 0.86, 0, w - 0.2, 0.08, d - 0.1, 0.02);
          sb.box(M.gold, 0, y + 0.86, d / 2 - 0.06, w - 0.24, 0.02, 0.012);
          let x = -w / 2 + 0.18;
          let bi = 0;
          while (x < w / 2 - 0.3) {
            const bw = 0.25 + rng() * 0.45;
            const bh = 0.55 + rng() * 0.28;
            if (rng() > 0.12) {
              const mat = M.books[Math.floor(rng() * 5)];
              // every few books one leans on its neighbour; spines get a gilt band
              const lean = (bi + row) % 7 === 3 ? 0.18 : 0;
              sb.box(mat, x + bw / 2 + lean * 0.5, y + (lean ? 0.03 : 0), 0.05, bw - 0.03, bh, d - 0.35, 0, 0, -lean);
              if (!lean && bw > 0.32) sb.box(M.gold, x + bw / 2, y + bh * 0.78, (d - 0.35) / 2 + 0.051, bw - 0.05, 0.03, 0.01);
            }
            x += bw;
            bi++;
          }
        }
        sb.reset();
        fullBox(f, w, d);
        break;
      }
      case 'counter':
      case 'stove':
      case 'island': {
        sb.frame(f.x, f.z, a);
        const baseMat = f.v === 1 ? M.woodDark : M.white;
        sb.box(M.black, 0, 0, 0.05, w - 0.1, 0.15, d - 0.2);
        sb.rbox(f.t === 'stove' ? M.black : baseMat, 0, 0.15, 0, w, 1.5, d, 0.03);
        sb.rbox(f.v === 1 ? M.woodMed : M.marbleW, 0, 1.65, 0, w + 0.1, 0.12, d + 0.1, 0.035);
        if (f.t === 'stove') {
          const burnerMat = f.v === 1 ? M.ember : M.steel;
          for (const lx of [-0.6, 0.6]) for (const lz of [-0.35, 0.35]) {
            sb.cyl(M.black, lx, 1.77, lz, 0.3, 0.3, 0.02, 18);
            sb.torus(burnerMat, lx, 1.81, lz, 0.2, 0.03, 18);
            sb.cyl(burnerMat, lx, 1.77, lz, 0.08, 0.08, 0.05, 12);
          }
          sb.rbox(M.steel, 0, 0.35, d / 2 + 0.005, w - 0.4, 0.9, 0.04, 0.02);
          for (const lx of [-0.75, -0.25, 0.25, 0.75]) sb.cyl(M.steel, lx, 1.3, d / 2 + 0.02, 0.06, 0.06, 0.08, 12, Math.PI / 2);
        } else {
          // panelled cupboard doors with brass/steel pulls
          const n = Math.max(1, Math.round(w / 1.2));
          const dw = w / n;
          for (let k = 0; k < n; k++) {
            const cx = -w / 2 + dw * (k + 0.5);
            sb.rbox(baseMat, cx, 0.24, d / 2 + 0.005, dw - 0.08, 1.3, 0.04, 0.015);
            sb.box(f.v === 1 ? M.woodMed : M.marbleW, cx, 0.42, d / 2 + 0.026, dw - 0.36, 0.9, 0.01);
            sb.rbox(f.v === 1 ? M.gold : M.steel, cx, 1.25, d / 2 + 0.04, 0.4, 0.05, 0.05, 0.02);
          }
          if (f.t === 'island') {
            sb.lathe(M.pot, -2, 1.77, 0, [[0, 0], [0.22, 0], [0.32, 0.18], [0.28, 0.4], [0.2, 0.45], [0, 0.45]], 14);
            sb.sph(M.plant2, -2, 2.3, 0, 0.26, 10);
            sb.cyl(M.steel, 2, 1.77, 0.2, 0.35, 0.3, 0.4, 16);
          } else if (f.v === 1) {
            sb.lathe(M.gold, -1.5, 1.77, 0, [[0, 0], [0.18, 0], [0.12, 0.2], [0.06, 0.5], [0.1, 0.7], [0, 0.7]], 12);
            sb.lathe(M.marbleW, 1.2, 1.77, 0, [[0, 0], [0.15, 0], [0.26, 0.4], [0.2, 0.7], [0.12, 0.8], [0, 0.8]], 14);
          }
        }
        sb.reset();
        fullBox(f, w, d);
        break;
      }
      case 'fridge': {
        sb.frame(f.x, f.z, a);
        // rounded enamel cabinet: freezer and fridge doors split by a shadow gap, chrome bar handles
        sb.box(M.black, 0, 0, 0, w - 0.1, 0.12, d - 0.1);
        sb.rbox(M.white, 0, 0.1, 0, w, 3.7, d, 0.08);
        if (f.v === 1) {
          // doors swung open: two panels hinged at the sides, angled outward; shelves visible inside
          sb.box(M.steel, 0, 0.3, d / 2 - 0.02, w - 0.2, 3.3, 0.02);
          for (const y of [0.9, 1.7, 2.5]) sb.box(M.linen, 0, y, d / 2 - 0.25, w - 0.25, 0.04, 0.5);
          sb.rbox(M.white, -w / 2 - 0.35, 1.9, d / 2 + 0.05, 0.7, 3.6, 0.08, 0.03, 0, 0, 0.5);
          sb.rbox(M.white, w / 2 + 0.35, 1.9, d / 2 + 0.05, 0.7, 3.6, 0.08, 0.03, 0, 0, -0.5);
          sb.rbox(M.steel, -w / 2 - 0.05, 1.5, d / 2 + 0.1, 0.08, 1.4, 0.08, 0.03);
          sb.rbox(M.steel, w / 2 + 0.05, 1.5, d / 2 + 0.1, 0.08, 1.4, 0.08, 0.03);
        } else {
          sb.box(M.black, 0, 2.6, d / 2 + 0.002, w - 0.04, 0.04, 0.01);
          sb.rbox(M.steel, w / 2 - 0.3, 1.1, d / 2 + 0.06, 0.08, 1.3, 0.08, 0.03);
          sb.rbox(M.steel, w / 2 - 0.3, 2.75, d / 2 + 0.06, 0.08, 0.7, 0.08, 0.03);
          for (const y of [1.1, 2.4, 2.75, 3.45]) sb.box(M.steel, w / 2 - 0.3, y, d / 2 + 0.03, 0.05, 0.05, 0.06);
        }
        sb.reset();
        fullBox(f, w, d);
        break;
      }
      case 'piano': {
        sb.frame(f.x, f.z, a);
        const pts: [number, number][] = [[-1.4, -0.9], [1.4, -0.9], [0.6, 1.0]];
        for (const [lx, lz] of pts) {
          sb.lathe(M.lacquer, lx, 0, lz, [[0, 0], [0.1, 0], [0.11, 0.05], [0.08, 0.12], [0.1, 0.6], [0.14, 0.95], [0.16, 1.1], [0, 1.1]], 12);
          sb.lathe(M.gold, lx, 0, lz, [[0, 0], [0.11, 0], [0.11, 0.05], [0, 0.05]], 12);
        }
        // the grand's case: straight spine on +x, curved bentside sweeping into the tail
        const outline = (inset: number) => {
          const sh = new THREE.Shape();
          // shape y = -world z (the extrusion is turned to stand up)
          sh.moveTo(-1.7 + inset, 1.3 - inset);
          sh.lineTo(1.7 - inset, 1.3 - inset);
          sh.lineTo(1.7 - inset, -1.3 + inset);
          sh.lineTo(0.9, -1.3 + inset);
          sh.bezierCurveTo(0.2, -1.3 + inset, -0.1, -0.5, -0.6, -0.15);
          sh.bezierCurveTo(-1.1, 0.2, -1.7 + inset, 0.1, -1.7 + inset, -0.3);
          sh.lineTo(-1.7 + inset, 1.3 - inset);
          return sh;
        };
        const slab = (inset: number, depth: number, bevel: number) => {
          const g = new THREE.ExtrudeGeometry(outline(inset), { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 16 });
          g.rotateX(-Math.PI / 2);
          return g;
        };
        sb.place(slab(0, 0.56, 0.03), M.lacquer, 0, 1.1, 0);
        // keyboard: keybed, ivory keys, ebony sharps in groups of two and three, cheek blocks, fallboard
        sb.rbox(M.lacquer, 0, 1.15, -1.48, 3.2, 0.3, 0.42, 0.03);
        sb.rbox(M.ivory, 0, 1.44, -1.48, 2.9, 0.06, 0.32, 0.01);
        for (let k = 0; k < 20; k++) {
          if (k % 7 === 2 || k % 7 === 6) continue;
          sb.box(M.lacquer, -1.38 + k * 0.145, 1.5, -1.42, 0.07, 0.05, 0.2);
        }
        for (const sx of [-1.52, 1.52]) sb.rbox(M.lacquer, sx, 1.44, -1.48, 0.14, 0.14, 0.34, 0.03);
        sb.rbox(M.lacquer, 0, 1.5, -1.25, 2.95, 0.22, 0.05, 0.02);
        sb.box(M.gold, 0, 1.56, -1.275, 0.6, 0.03, 0.005);
        // music desk
        sb.rbox(M.lacquer, 0, 1.68, -1.05, 1.6, 0.5, 0.04, 0.02, 0, -0.25);
        // pedal lyre
        sb.rbox(M.lacquer, 0, 0.25, -0.95, 0.5, 0.85, 0.1, 0.04);
        for (const sx of [-0.1, 0, 0.1]) sb.box(M.gold, sx, 0.1, -1.05, 0.05, 0.03, 0.16);
        if (f.v === 1) {
          // lid propped open on its stick, hinged along the straight side
          const lid = slab(0.02, 0.04, 0.01);
          lid.translate(-1.7, 0, 0);
          lid.rotateZ(-0.55);
          lid.translate(1.7, 0, 0);
          sb.place(lid, M.lacquer, 0, 1.69, 0);
          sb.cyl(M.woodDark, -1.0, 1.66, 0.25, 0.02, 0.02, 1.2, 6, 0, 0.3);
        } else {
          sb.place(slab(0.02, 0.04, 0.01), M.lacquer, 0, 1.69, 0);
        }
        // tufted bench
        for (const lx of [-0.55, 0.55]) for (const lz of [-0.18, 0.18]) sb.lathe(M.lacquer, lx, 0, -2.3 + lz, [[0, 0], [0.05, 0], [0.04, 0.3], [0.06, 0.55], [0, 0.55]], 8);
        sb.rbox(M.lacquer, 0, 0.5, -2.3, 1.4, 0.1, 0.55, 0.03);
        sb.rbox(M.red, 0, 0.6, -2.3, 1.32, 0.15, 0.48, 0.06);
        sb.reset();
        legsCollide(f.x, f.z, a, pts, 0.35);
        const [bx, bz] = rotXZ(0, -2.3, a);
        addBox(f.x + bx, f.z + bz, 1.4, 0.55);
        break;
      }
      case 'pillar': {
        sb.frame(f.x, f.z, 0);
        // classical column: square plinth, torus base, fluted tapering shaft, echinus and abacus
        sb.rbox(M.marbleW, 0, 0, 0, 1.4, 0.22, 1.4, 0.03);
        sb.lathe(M.marbleW, 0, 0.22, 0, [[0, 0], [0.62, 0], [0.66, 0.06], [0.62, 0.12], [0.58, 0.14], [0.6, 0.2], [0.56, 0.24], [0, 0.24]], 32);
        const shaftH = WALL_H - 1.0;
        const shaft = new THREE.CylinderGeometry(0.49, 0.56, shaftH, 64, 6, true);
        const pos = shaft.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), z = pos.getZ(i);
          const k = 1 - 0.045 * Math.pow(0.5 + 0.5 * Math.cos(Math.atan2(x, z) * 20), 2);
          pos.setX(i, x * k); pos.setZ(i, z * k);
        }
        shaft.computeVertexNormals();
        sb.place(shaft, M.marbleW, 0, 0.46 + shaftH / 2, 0);
        sb.lathe(M.marbleW, 0, WALL_H - 0.54, 0, [[0, 0], [0.5, 0], [0.54, 0.04], [0.5, 0.08], [0.56, 0.12], [0.66, 0.22], [0.7, 0.26], [0, 0.26]], 32);
        sb.rbox(M.marbleW, 0, WALL_H - 0.28, 0, 1.4, 0.28, 1.4, 0.03);
        sb.reset();
        addBox(f.x, f.z, 1.4, 1.4);
        break;
      }
      case 'plant': {
        sb.frame(f.x, f.z, a);
        // glazed urn with a rolled rim, dark soil, and a spray of drooping leaves in two greens
        sb.lathe(M.pot, 0, 0, 0, [[0, 0], [0.32, 0], [0.36, 0.06], [0.3, 0.12], [0.42, 0.45], [0.48, 0.78], [0.44, 0.84], [0.52, 0.9], [0.5, 0.96], [0.42, 0.94], [0, 0.94]], 12);
        sb.cyl(M.woodDark, 0, 0.9, 0, 0.42, 0.42, 0.03, 16);
        const seed = Math.abs(Math.round(f.x * 13 + f.z * 7)) % 5;
        for (let k = 0; k < 11; k++) {
          const an = k * 2.4 + seed, tall = k < 4;
          const len = tall ? 0.95 : 0.8, tilt = tall ? 0.45 : 1.05;
          const leaf = new THREE.SphereGeometry(0.5, 6, 4);
          leaf.scale(0.2, len, 0.06);
          leaf.translate(0, len * 0.5, 0);
          sb.place(leaf, k % 3 ? M.plant : M.plant2, 0, 0.92, 0, 0, -an, -tilt);
        }
        // an inner crown of young upright leaves fills the centre
        for (let k = 0; k < 3; k++) {
          const leaf = new THREE.SphereGeometry(0.5, 6, 4);
          leaf.scale(0.16, 0.85, 0.05);
          leaf.translate(0, 0.42, 0);
          sb.place(leaf, M.plant2, 0, 0.92, 0, 0, -(k * 2.1 + seed), -0.15);
        }
        sb.reset();
        addBox(f.x, f.z, 1.0, 1.0);
        break;
      }
      case 'statue': {
        sb.frame(f.x, f.z, a);
        // panelled stone pedestal with a moulded cap, bearing a classical marble bust
        sb.rbox(M.stone, 0, 0, 0, 1.3, 0.18, 1.3, 0.03);
        sb.rbox(M.stone, 0, 0.18, 0, 1.16, 1.12, 1.16, 0.03);
        for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const panel = new THREE.BoxGeometry(0.8, 0.75, 0.03);
          panel.translate(0, 0.74, 0.585);
          sb.place(panel, M.marbleW, 0, 0, 0, 0, ry, 0);
        }
        sb.rbox(M.stone, 0, 1.3, 0, 1.35, 0.1, 1.35, 0.03);
        sb.rbox(M.stone, 0, 1.4, 0, 1.25, 0.06, 1.25, 0.02);
        sb.lathe(M.marbleW, 0, 1.46, 0, [[0, 0], [0.3, 0], [0.32, 0.04], [0.2, 0.1], [0.16, 0.18], [0, 0.18]], 20);
        // bust: a tapered, rounded torso with sloping shoulders, neck, head with chin and nose, curls
        sb.rbox(M.marbleW, 0, 1.6, 0, 0.62, 0.3, 0.36, 0.12);
        const shoulders = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        shoulders.scale(0.98, 0.34, 0.44);
        sb.place(shoulders, M.marbleW, 0, 1.78, 0);
        sb.cyl(M.marbleW, 0, 1.86, 0.01, 0.095, 0.12, 0.26, 16);
        const head = new THREE.SphereGeometry(0.5, 16, 12);
        head.scale(0.38, 0.48, 0.44);
        sb.place(head, M.marbleW, 0, 2.32, 0.02);
        const jaw = new THREE.SphereGeometry(0.5, 16, 10);
        jaw.scale(0.26, 0.24, 0.3);
        sb.place(jaw, M.marbleW, 0, 2.17, 0.06);
        const nose = new THREE.ConeGeometry(0.04, 0.12, 4);
        nose.rotateX(0.5);
        sb.place(nose, M.marbleW, 0, 2.3, 0.225, 0, Math.PI / 4, 0);
        for (const sx of [-1, 1]) {
          const ear = new THREE.SphereGeometry(0.5, 8, 6);
          ear.scale(0.04, 0.11, 0.07);
          sb.place(ear, M.marbleW, sx * 0.185, 2.3, 0, 0, 0, sx * 0.2);
        }
        // curls sit on the skull's surface over the crown and down the back
        for (let k = 0; k < 20; k++) {
          const yk = 1 - (k + 0.5) / 20 * 1.25; // from the crown down past the equator
          const rr = Math.sqrt(Math.max(0, 1 - yk * yk)), an = k * 2.4;
          const dx = Math.sin(an) * rr, dz = Math.cos(an) * rr;
          if (dz > 0.35 && yk < 0.55) continue; // keep the face clear
          sb.sph(M.marbleW, dx * 0.185, 2.33 + yk * 0.235, 0.02 + dz * 0.215, 0.055, 5);
        }
        sb.reset();
        addBox(f.x, f.z, 1.3, 1.3);
        break;
      }
      case 'clock': {
        sb.frame(f.x, f.z, a);
        // longcase: plinth, narrow waist with a glazed pendulum door, hood with an arched pediment
        sb.rbox(M.woodDark, 0, 0, 0, 1.3, 0.55, 0.85, 0.03);
        sb.rbox(M.woodMed, 0, 0.55, 0.02, 1.24, 0.08, 0.82, 0.02);
        sb.rbox(M.woodDark, 0, 0.63, 0, 1.08, 1.97, 0.76, 0.03);
        sb.rbox(M.woodMed, 0, 2.6, 0.02, 1.24, 0.1, 0.82, 0.02);
        sb.rbox(M.woodDark, 0, 2.7, 0, 1.2, 0.95, 0.8, 0.04);
        sb.place(new THREE.CylinderGeometry(0.5, 0.5, 0.84, 24, 1, false, -Math.PI / 2, Math.PI), M.woodMed, 0, 3.65, 0, -Math.PI / 2, 0, 0);
        for (const sx of [-0.5, 0, 0.5]) sb.lathe(M.gold, sx, sx ? 3.65 : 4.15, 0.1, [[0, 0], [0.07, 0], [0.05, 0.05], [0.08, 0.12], [0, 0.22]], 8);
        for (const sx of [-0.5, 0.5]) sb.cyl(M.woodMed, sx, 2.75, 0.38, 0.06, 0.06, 0.9, 10);
        // dial: brass bezel around an ivory face (the hands are added separately and animate)
        sb.place(new THREE.TorusGeometry(0.4, 0.035, 5, 24), M.gold, 0, 3.2, 0.43);
        sb.place(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 24), M.white, 0, 3.2, 0.43, Math.PI / 2);
        for (let k = 0; k < 12; k++) {
          const an = (k / 12) * Math.PI * 2;
          sb.box(M.black, Math.sin(an) * 0.31, 3.2 + Math.cos(an) * 0.31 - 0.03, 0.447, 0.025, 0.06, 0.005, 0, 0, -an);
        }
        // pendulum door: dark glass in a brass frame
        sb.box(M.black, 0, 0.8, 0.39, 0.6, 1.7, 0.04);
        for (const [x, y, w2, h2] of [[0, 0.78, 0.68, 0.04], [0, 2.48, 0.68, 0.04], [-0.32, 0.8, 0.04, 1.7], [0.32, 0.8, 0.04, 1.7]] as const) sb.box(M.gold, x, y, 0.4, w2, h2, 0.03);
        sb.reset();
        fullBox(f, 1.2, 0.8);
        {
          const g = anchor(f.x, f.z, a);
          // hands, pivoting at the dial centre and following the in-game night clock
          const hub = new THREE.Group();
          hub.position.set(0, 3.2, 0.455);
          const hourHand = new THREE.Group();
          hourHand.add(part(new THREE.BoxGeometry(0.06, 0.22, 0.015), M.black, 0, 0.09, 0));
          const minHand = new THREE.Group();
          minHand.add(part(new THREE.BoxGeometry(0.035, 0.33, 0.015), M.black, 0, 0.14, 0.015));
          hub.add(hourHand, minHand, part(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), M.gold, 0, 0, 0.01));
          hub.children[2].rotation.x = Math.PI / 2;
          // pendulum swinging behind the glass, one tick per second
          const pend = new THREE.Group();
          pend.position.set(0, 2.4, 0.43);
          pend.add(part(new THREE.BoxGeometry(0.03, 1.25, 0.02), M.gold, 0, -0.625, 0));
          const bob = part(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 16), M.gold, 0, -1.4, 0);
          bob.rotation.x = Math.PI / 2;
          pend.add(bob);
          g.add(hub, pend);
          const phase = (f.x * 7.3 + f.z * 3.1) % 6;
          clocks.push({ x: f.x, z: f.z, phase });
          animators.push((t, hours) => {
            const h = hours % 12;
            hourHand.rotation.z = -(h / 12) * Math.PI * 2;
            minHand.rotation.z = -(h % 1) * Math.PI * 2;
            pend.rotation.z = 0.2 * Math.sin(t * Math.PI + phase);
          });
        }
        break;
      }
      case 'fireplace': {
        sb.frame(f.x, f.z, a);
        // stone surround: piers either side of a recessed firebox, a lintel with a keystone,
        // a marble hearth, logs on brass andirons and a moulded mantel shelf with candlesticks
        const ow = w * 0.55, pw = (w - ow) / 2;
        for (const sx of [-1, 1]) {
          sb.rbox(M.stone, sx * (ow / 2 + pw / 2), 0, 0, pw, 3, d, 0.04);
          sb.rbox(M.stone, sx * (ow / 2 + pw / 2), 0, d / 2 - 0.02, pw + 0.08, 0.3, 0.1, 0.03);
        }
        sb.rbox(M.stone, 0, 1.6, 0, ow + 0.02, 1.4, d, 0.03);
        sb.box(M.stone, 0, 0, -0.275, ow, 1.6, d - 0.55);
        sb.box(M.black, 0, 0, d / 2 - 0.53, ow, 1.6, 0.02);
        for (const sx of [-1, 1]) sb.box(M.black, sx * (ow / 2 - 0.01), 0, d / 2 - 0.275, 0.02, 1.6, 0.55);
        sb.box(M.black, 0, 1.58, d / 2 - 0.275, ow, 0.02, 0.55);
        sb.rbox(M.marbleW, 0, 1.6, d / 2 + 0.01, 0.34, 0.36, 0.08, 0.02);
        sb.rbox(M.marbleW, 0, 0, d / 2 + 0.25, ow + 1.0, 0.07, 0.6, 0.02);
        sb.box(M.ember, 0, 0, d / 2 - 0.2, w * 0.4, 0.3, 0.4);
        for (const [lz, lr] of [[d / 2 - 0.3, 0.12], [d / 2 - 0.12, 0.1]] as const) sb.place(new THREE.CylinderGeometry(lr, lr, ow * 0.7, 10), M.woodDark, 0, 0.3 + lr * 0.4, lz, 0, 0, Math.PI / 2);
        for (const sx of [-1, 1]) sb.lathe(M.gold, sx * ow * 0.36, 0, d / 2 - 0.02, [[0, 0], [0.07, 0], [0.05, 0.06], [0.03, 0.3], [0.06, 0.36], [0, 0.42]], 10);
        sb.rbox(M.woodDark, 0, 2.82, 0.05, w + 0.2, 0.18, d + 0.06, 0.04);
        sb.rbox(M.woodMed, 0, 3, 0.1, w + 0.4, 0.18, d + 0.2, 0.05);
        for (const sx of [-1, 1]) {
          sb.lathe(M.gold, sx * w * 0.36, 3.18, 0.1, [[0, 0], [0.12, 0], [0.12, 0.03], [0.05, 0.08], [0.035, 0.4], [0.07, 0.48], [0, 0.48]], 10);
          sb.cyl(M.white, sx * w * 0.36, 3.66, 0.1, 0.035, 0.04, 0.2, 8);
          sb.sph(M.flame, sx * w * 0.36, 3.9, 0.1, 0.04, 6);
        }
        sb.reset();
        fullBox(f, w, d);
        {
          const g = anchor(f.x, f.z, a);
          const flames: { m: THREE.Mesh; k: number; base: number }[] = [];
          const n = 5;
          for (let k = 0; k < n; k++) {
            const inner = k % 2 === 1;
            const geo = new THREE.ConeGeometry(inner ? 0.12 : 0.18, 1, 8);
            geo.translate(0, 0.5, 0); // scale from the base
            const m = part(geo, flameMats[inner ? 1 : 0], (k / (n - 1) - 0.5) * w * 0.3, 0.3, d / 2 - 0.2 + (inner ? 0.06 : 0));
            g.add(m);
            flames.push({ m, k, base: inner ? 0.45 : 0.65 });
          }
          soundSources.push({ kind: 'fire', x: f.x, z: f.z });
          const ember = M.ember as THREE.MeshStandardMaterial;
          animators.push((t) => {
            for (const fl of flames) {
              const n1 = Math.sin(t * 9 + fl.k * 1.7) * 0.5 + Math.sin(t * 15.3 + fl.k * 4.1) * 0.3;
              fl.m.scale.set(1 + n1 * 0.15, fl.base * (1 + n1 * 0.35), 1 + n1 * 0.15);
              fl.m.rotation.z = Math.sin(t * 5 + fl.k) * 0.08;
            }
            ember.emissiveIntensity = 2 * (0.75 + 0.25 * Math.sin(t * 6.3) * Math.sin(t * 2.9));
          });
        }
        break;
      }
      case 'desk': {
        sb.frame(f.x, f.z, a);
        // partners' pedestal desk: plinths, three drawers a side with brass pulls, leather-inset top,
        // a green banker's lamp, papers, an inkwell and quill
        for (const sx of [-1, 1]) {
          const px = sx * (w / 2 - 0.6);
          sb.rbox(M.woodDark, px, 0, 0, 1.16, 0.12, d - 0.04, 0.02);
          sb.rbox(M.woodDark, px, 0.12, 0, 1.1, 1.38, d - 0.1, 0.03);
          for (let k = 0; k < 3; k++) {
            const y = 0.2 + k * 0.42;
            sb.rbox(M.woodMed, px, y, d / 2 - 0.04, 0.96, 0.36, 0.04, 0.015);
            sb.rbox(M.gold, px, y + 0.15, d / 2 - 0.005, 0.24, 0.04, 0.04, 0.015);
          }
        }
        sb.rbox(M.woodDark, 0, 1.3, 0.02, w - 2.3, 0.2, d - 0.16, 0.02);
        sb.rbox(M.woodMed, 0, 1.5, 0, w, 0.15, d, 0.04);
        sb.box(M.leather, 0, 1.65, 0, w - 0.5, 0.006, d - 0.4);
        // lamp
        sb.lathe(M.gold, 1.6, 1.65, -0.5, [[0, 0], [0.2, 0], [0.2, 0.04], [0.06, 0.08], [0.035, 0.55], [0.05, 0.6], [0, 0.6]], 12);
        const shade = new THREE.CylinderGeometry(0.16, 0.16, 0.42, 16, 1, false, 0, Math.PI);
        shade.rotateZ(Math.PI / 2);
        sb.place(shade, M.glassGreen, 1.6, 2.28, -0.5, 0, Math.PI / 2, 0);
        sb.sph(M.lamp, 1.6, 2.24, -0.5, 0.06, 8);
        // papers, inkwell, quill
        sb.box(M.white, -0.5, 1.65, 0.1, 1.0, 0.03, 0.7, 0.2);
        sb.box(M.linen, -0.42, 1.68, 0.05, 0.9, 0.02, 0.64, -0.1);
        sb.lathe(M.black, 0.6, 1.65, 0.2, [[0, 0], [0.1, 0], [0.1, 0.1], [0.04, 0.14], [0.04, 0.17], [0, 0.17]], 10);
        sb.cyl(M.white, 0.62, 1.78, 0.2, 0.008, 0.015, 0.5, 4, 0.3, -0.35);
        sb.reset();
        addBox(f.x, f.z, w, d);
        break;
      }
      case 'globe': {
        sb.frame(f.x, f.z, 0);
        // turned stand with three splayed feet and a brass meridian cradle
        for (let k = 0; k < 3; k++) {
          const leg = new THREE.BoxGeometry(0.08, 0.06, 0.45);
          leg.translate(0, 0.08, 0.2);
          leg.rotateX(0.25);
          sb.place(leg, M.woodDark, 0, 0, 0, 0, (k * Math.PI * 2) / 3, 0);
        }
        sb.lathe(M.woodDark, 0, 0, 0, [[0, 0.12], [0.12, 0.12], [0.1, 0.2], [0.05, 0.35], [0.08, 0.6], [0.04, 0.85], [0.06, 1.02], [0.1, 1.07], [0, 1.07]], 12);
        sb.place(new THREE.TorusGeometry(0.58, 0.02, 6, 32, Math.PI), M.gold, 0, 1.5, 0, 0, 0, Math.PI);
        sb.reset();
        addBox(f.x, f.z, 0.85, 0.85);
        {
          const g = anchor(f.x, f.z, 0);
          const tilt = new THREE.Group();
          tilt.position.y = 1.5;
          tilt.rotation.z = 0.41; // axial tilt
          const sphere = part(new THREE.SphereGeometry(0.45, 20, 14), globeMat);
          tilt.add(sphere, part(new THREE.TorusGeometry(0.52, 0.025, 6, 28), M.gold));
          g.add(tilt);
          const spin = 0.35 + ((f.x + f.z) % 1) * 0.2;
          animators.push((t) => { sphere.rotation.y = t * spin; });
        }
        break;
      }
      case 'fountain': {
        sb.frame(f.x, f.z, 0);
        // carved basin with a rolled lip, a baluster column, a scalloped upper bowl and a finial
        sb.lathe(M.stone, 0, 0, 0, [[0, 0], [1.82, 0], [1.84, 0.08], [1.74, 0.16], [1.72, 0.58], [1.8, 0.62], [1.82, 0.72], [1.72, 0.76], [1.6, 0.74], [1.55, 0.68], [0, 0.68]], 40);
        sb.cyl(M.water, 0, 0.7, 0, 1.55, 1.55, 0.03, 40);
        sb.lathe(M.stone, 0, 0.7, 0, [[0.34, 0], [0.32, 0.08], [0.2, 0.2], [0.28, 0.5], [0.16, 0.85], [0.22, 1.05], [0.14, 1.2], [0, 1.2]], 18);
        sb.lathe(M.stone, 0, 1.88, 0, [[0, 0], [0.14, 0], [0.3, 0.06], [0.6, 0.2], [0.74, 0.3], [0.72, 0.34], [0.62, 0.32], [0, 0.31]], 28);
        sb.cyl(M.water, 0, 2.2, 0, 0.62, 0.62, 0.02, 28);
        sb.lathe(M.stone, 0, 2.18, 0, [[0.1, 0], [0.08, 0.12], [0.14, 0.24], [0.05, 0.36], [0, 0.44]], 12);
        sb.reset();
        addBox(f.x, f.z, 3.4, 3.4);
        {
          soundSources.push({ kind: 'water', x: f.x, z: f.z });
          const g = anchor(f.x, f.z, 0);
          // ripples spreading out from the column on the lower basin, and gently in the top bowl
          const rings: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; r0: number; r1: number; off: number; peak: number }[] = [];
          const ring = (y: number, r0: number, r1: number, off: number, peak: number) => {
            const mat = rippleMat();
            const m = part(new THREE.RingGeometry(0.92, 1, 40), mat, 0, y, 0);
            m.rotation.x = -Math.PI / 2;
            g.add(m);
            rings.push({ m, mat, r0, r1, off, peak });
          };
          for (let k = 0; k < 3; k++) ring(0.74, 0.35, 1.45, k / 3, 0.45);
          for (let k = 0; k < 2; k++) ring(2.225, 0.1, 0.55, k / 2, 0.35);
          animators.push((t) => {
            for (const r of rings) {
              const p = (t / 2.6 + r.off) % 1;
              const s = r.r0 + (r.r1 - r.r0) * p;
              r.m.scale.set(s, s, 1);
              r.mat.opacity = r.peak * Math.sin(p * Math.PI);
            }
          });
        }
        break;
      }
      case 'books': {
        const ang = f.ry != null ? f.ry : rng() * 6;
        const it = newItem('books', f.x, f.z);
        it.messyBoxes.push(mkBox(f.x, f.z, 1.1, 1.1));
        const F = frameM(f.x, f.z, ang);
        const books: [THREE.Matrix4, number, number, number][] = [];
        for (let k = 0; k < 5; k++) books.push([localM((rng() - 0.5) * 0.4, k * 0.12 + 0.055, (rng() - 0.5) * 0.4, 0, rng() * 3), 0.6, 0.11, 0.45]);
        books.push([localM(0.6, 0.05, 0.3, 0, 0.6), 0.55, 0.1, 0.42]);
        // a neat stack on the nearest table/desk in the room, or on the floor if there is none
        const sf = nearestSurf(f.x, f.z, ['table', 'desk', 'roundtable', 'counter', 'island']);
        let tx = f.x, tz = f.z, top = 0, base = 0;
        if (sf) {
          [tx, tz] = pointOn(sf, f.x, f.z, 0.6);
          top = sf.top;
          if (sf.r) base = Math.atan2(tx - sf.x, tz - sf.z);
        } else {
          it.tidyBoxes.push(mkBox(f.x, f.z, 0.8, 0.8));
        }
        let y = top;
        books.forEach(([m, w, h, d], k) => {
          y += h / 2;
          addPart(it, geoMesh(bookGeo(w, h, d), M.books[k === 5 ? 2 : k % 5]), F.clone().multiply(m), localM(tx, y, tz, 0, base + (k % 2 ? 0.07 : -0.05)), k * 0.12);
          y += h / 2;
        });
        finishItem(it);
        break;
      }
      case 'vase': {
        if (f.v === 1) {
          // permanently broken: static shards on the floor, no tidy cutscene
          sb.frame(f.x, f.z, a);
          sb.place(vaseGeo(true), M.marbleW, 0, 0.3, 0, 0, 0, Math.PI / 2);
          for (let k = 0; k < 6; k++) {
            const lx = (rng() - 0.5) * 1.6, lz = (rng() - 0.5) * 1.6;
            sb.box(M.marbleW, lx, 0.025, lz, 0.18, 0.05, 0.12, 0, rng() * 3, 0);
          }
          sb.reset();
          addBox(f.x, f.z, 0.9, 0.9);
          break;
        }
        const ang = f.ry != null ? f.ry : rng() * 6;
        const it = newItem('vase', f.x, f.z);
        it.messyBoxes.push(mkBox(f.x, f.z, 0.9, 0.9));
        it.tidyBoxes.push(mkBox(f.x, f.z, 0.65, 0.65));
        const F = frameM(f.x, f.z, ang);
        // stands back up, the shards fly back in, and the plant goes back on top
        addPart(it, geoMesh(vaseGeo(false), M.marbleW), F.clone().multiply(localM(0, 0.3, 0, 0, 0, Math.PI / 2)), frameM(f.x, f.z, ang, 0.45));
        for (let k = 0; k < 6; k++) {
          const m = localM((rng() - 0.5) * 1.6, 0.025, (rng() - 0.5) * 1.6, 0, rng() * 3);
          addPart(it, geoMesh(shardGeo(k), M.marbleW), F.clone().multiply(m), localM(f.x, 0.75, f.z, 0, 0, 0, 0.01), 0.25 + k * 0.08);
        }
        addPart(it, geoMesh(new THREE.SphereGeometry(0.18, 10, 7), M.plant2), F.clone().multiply(localM(0.7, 0.2, 0.1)), localM(f.x, 0.98, f.z), 0.8);
        finishItem(it);
        break;
      }
      case 'pots': {
        const ang = f.ry != null ? f.ry : rng() * 6;
        const it = newItem('pots', f.x, f.z);
        it.messyBoxes.push(mkBox(f.x, f.z, 1.4, 1.2));
        const F = frameM(f.x, f.z, ang);
        // lined up on the nearest kitchen counter, or neatly in a row where they fell
        const sf = nearestSurf(f.x, f.z, ['counter', 'stove', 'island']);
        let tx = f.x, tz = f.z, top = 0, ry = 0;
        if (sf) {
          [tx, tz] = pointOn(sf, f.x, f.z, 1.0);
          top = sf.top;
          ry = sf.hw >= sf.hd ? 0 : Math.PI / 2;
        } else {
          it.tidyBoxes.push(mkBox(f.x, f.z, 2.3, 0.8));
        }
        const T = frameM(tx, tz, ry, top);
        addPart(it, geoMesh(potGeo('stock'), M.steel), F.clone().multiply(localM(0, 0.35, 0, 0, 0, Math.PI / 2)), T.clone().multiply(localM(-0.75, 0.25, 0)), 0);
        addPart(it, geoMesh(potGeo('sauce'), M.steel), F.clone().multiply(localM(0.6, 0.175, 0.4)), T.clone().multiply(localM(0, 0.175, 0)), 0.15);
        addPart(it, geoMesh(potGeo('lid'), M.black), F.clone().multiply(localM(-0.5, 0.04, 0.5)), T.clone().multiply(localM(0.72, 0.04, 0)), 0.3);
        finishItem(it);
        break;
      }
      case 'frame': {
        const ang = f.ry != null ? f.ry : rng() * 6;
        const it = newItem('frame', f.x, f.z);
        it.messyBoxes.push(mkBox(f.x, f.z, 1.6, 1.6));
        const g = new THREE.Group();
        const fb = geoMesh(frameGeo(), M.gold);
        const pic = geoMesh(new THREE.PlaneGeometry(1.4, 1.0), portraits[2]);
        pic.position.y = 0.075;
        pic.rotation.x = -Math.PI / 2;
        g.add(fb, pic);
        // hung back on the nearest side/back wall (face-up local +y becomes the wall's outward normal)
        const spot = wallSpot(f.x, f.z);
        let to = frameM(f.x, f.z, ang);
        if (spot) to = frameM(spot[0] + Math.sin(spot[2]) * 0.02, spot[1] + Math.cos(spot[2]) * 0.02, spot[2], 2.6).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        else it.tidyBoxes.push(mkBox(f.x, f.z, 1.6, 1.6));
        addPart(it, g, frameM(f.x, f.z, ang), to);
        finishItem(it);
        break;
      }
      case 'crate': {
        // shipping crate: planked sides, framed edges, a diagonal brace each face, steel corner caps
        const h = f.h ?? 1.8;
        sb.frame(f.x, f.z, a);
        sb.rbox(M.woodMed, 0, 0, 0, w, h, d, 0.02);
        const planks = Math.max(3, Math.round(h / 0.32));
        for (let k = 1; k < planks; k++) {
          const y = (k * h) / planks;
          sb.box(M.woodDark, 0, y - 0.012, 0, w + 0.004, 0.024, d + 0.004);
        }
        sb.rbox(M.woodDark, 0, h - 0.18, 0, w + 0.08, 0.18, d + 0.08, 0.02);
        sb.rbox(M.woodDark, 0, 0, 0, w + 0.08, 0.18, d + 0.08, 0.02);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          sb.rbox(M.woodDark, sx * (w / 2 - 0.16), 0, sz * (d / 2 + 0.02), 0.32, h, 0.08, 0.015);
          sb.box(M.iron, sx * (w / 2 + 0.03), h - 0.24, sz * (d / 2 + 0.03), 0.14, 0.28, 0.14);
          sb.box(M.iron, sx * (w / 2 + 0.03), -0.02, sz * (d / 2 + 0.03), 0.14, 0.28, 0.14);
        }
        const brace = Math.hypot(w - 0.64, h - 0.36);
        for (const sz of [-1, 1]) sb.rbox(M.woodDark, 0, h / 2 - 0.09, sz * (d / 2 + 0.02), brace, 0.18, 0.06, 0.015, 0, 0, Math.atan2(h - 0.36, w - 0.64) * sz);
        sb.reset();
        fullBox(f, w, d);
        break;
      }
      case 'barrel': {
        // 55-gallon drum: rolled chimes top and bottom, two swaged rolling hoops, lid with bungs
        sb.frame(f.x, f.z, 0);
        sb.lathe(M.steel, 0, 0, 0, [
          [0, 0.02], [0.66, 0.02], [0.7, 0.06], [0.7, 0.62], [0.74, 0.66], [0.74, 0.72], [0.7, 0.76], [0.7, 1.44],
          [0.74, 1.48], [0.74, 1.54], [0.7, 1.58], [0.7, 2.14], [0.66, 2.18], [0, 2.18],
        ], 20);
        sb.torus(M.iron, 0, 0.04, 0, 0.69, 0.045, 20);
        sb.torus(M.iron, 0, 2.17, 0, 0.69, 0.045, 20);
        sb.cyl(M.iron, 0.36, 2.18, 0.1, 0.09, 0.09, 0.04, 12);
        sb.cyl(M.iron, -0.3, 2.18, -0.25, 0.06, 0.06, 0.04, 10);
        sb.reset();
        addBox(f.x, f.z, 1.4, 1.4);
        break;
      }
      case 'machine': {
        // industrial press: riveted steel body, dark housing, gauges, pipework, a stack and a glowing pilot lamp
        sb.frame(f.x, f.z, a);
        sb.rbox(M.iron, 0, 0, 0, w + 0.1, 0.2, d + 0.1, 0.03);
        sb.rbox(M.steel, 0, 0.2, 0, w, 1.6, d, 0.05);
        for (const sx of [-1, 1]) sb.box(M.iron, sx * w * 0.25, 0.35, d / 2 + 0.002, 0.02, 1.3, 0.01);
        for (let k = 0; k < 6; k++) for (const sy of [0.32, 1.68]) sb.sph(M.iron, -w / 2 + 0.2 + (k * (w - 0.4)) / 5, sy, d / 2 + 0.01, 0.03, 4);
        sb.rbox(M.iron, 0, 1.8, 0, w * 0.7, 0.9, d * 0.7, 0.06);
        sb.cyl(M.steel, w * 0.25, 2.7, 0, 0.2, 0.22, 1.25, 16);
        sb.cyl(M.iron, w * 0.25, 3.92, 0, 0.26, 0.24, 0.12, 16);
        sb.cyl(M.gold, -w * 0.25, 1.8, 0, 0.12, 0.12, 1.0, 12);
        sb.torus(M.iron, -w * 0.25, 2.2, 0, 0.13, 0.025, 14);
        sb.torus(M.iron, -w * 0.25, 2.6, 0, 0.13, 0.025, 14);
        // pipe looping from the housing down into the body
        sb.place(new THREE.TubeGeometry(new THREE.CubicBezierCurve3(
          new THREE.Vector3(-w * 0.35, 2.3, -d * 0.2), new THREE.Vector3(-w * 0.55, 2.3, -d * 0.2),
          new THREE.Vector3(-w * 0.55, 1.5, -d * 0.2), new THREE.Vector3(-w * 0.5, 1.2, -d * 0.2),
        ), 12, 0.07, 8), M.gold, 0, 0, 0);
        // control panel: two gauges and the pilot lamp
        sb.rbox(M.red, 0, 0.95, d / 2 + 0.02, 0.9, 0.55, 0.06, 0.02);
        for (const gx of [-0.22, 0.12]) {
          sb.place(new THREE.TorusGeometry(0.11, 0.02, 6, 20), M.gold, gx, 1.22, d / 2 + 0.06);
          sb.place(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), M.ivory, gx, 1.22, d / 2 + 0.055, Math.PI / 2);
          sb.box(M.black, gx + 0.03, 1.21, d / 2 + 0.068, 0.07, 0.012, 0.005, 0, 0, 0.6);
        }
        sb.sph(M.ember, 0.34, 1.22, d / 2 + 0.06, 0.05, 10);
        sb.rbox(M.black, 0, 0.2, d / 2 + 0.02, w * 0.8, 0.25, 0.06, 0.02);
        sb.reset();
        fullBox(f, w, d);
        break;
      }
      case 'bed': {
        // panelled headboard and footboard with turned posts, a deep mattress, a turned-down
        // sheet over the blanket, and a plump pillow (head at -z)
        sb.frame(f.x, f.z, a);
        sb.rbox(M.woodDark, 0, 0.12, 0, w, 0.23, d, 0.03);
        for (const lx of [-w / 2 + 0.08, w / 2 - 0.08]) {
          sb.lathe(M.woodDark, lx, 0, -d / 2 + 0.08, [[0, 0], [0.08, 0], [0.08, 0.6], [0.06, 0.75], [0.08, 1.35], [0.1, 1.4], [0.05, 1.5], [0, 1.55]], 10);
          sb.lathe(M.woodDark, lx, 0, d / 2 - 0.08, [[0, 0], [0.08, 0], [0.08, 0.5], [0.06, 0.6], [0.08, 0.85], [0.1, 0.9], [0, 0.98]], 10);
        }
        sb.rbox(M.woodDark, 0, 0.35, -d / 2 + 0.08, w - 0.2, 1.05, 0.1, 0.03);
        sb.rbox(M.woodMed, 0, 0.6, -d / 2 + 0.135, w - 0.5, 0.6, 0.02, 0.01);
        sb.rbox(M.woodDark, 0, 0.35, d / 2 - 0.08, w - 0.2, 0.5, 0.1, 0.03);
        sb.rbox(M.white, 0, 0.35, 0, w - 0.2, 0.33, d - 0.3, 0.07);
        sb.rbox(f.v === 1 ? M.blue : M.red, 0, 0.62, d * 0.12, w - 0.1, 0.14, d * 0.66, 0.06);
        sb.rbox(M.linen, 0, 0.7, d * 0.12 - d * 0.33 + 0.12, w - 0.1, 0.08, 0.3, 0.04);
        sb.rbox(M.white, 0, 0.66, -d / 2 + 0.55, w - 0.6, 0.24, 0.72, 0.11);
        sb.reset();
        fullBox(f, w, d);
        break;
      }
    }
  }
  const statics = new THREE.Group();
  sb.build(statics);
  // outline edges for every furniture mesh (only drawn while that furniture is faded)
  // (all in one LineSegments: one draw call, since the shader discards everything not being faded)
  const outlineMat = makeOutlineMaterial(cut);
  const edgeGeos: THREE.BufferGeometry[] = [];
  for (const child of statics.children) {
    if (!(child instanceof THREE.Mesh) || !fadeMats.has(child.material)) continue;
    edgeGeos.push(new THREE.EdgesGeometry(child.geometry, 35));
  }
  if (edgeGeos.length) {
    const edges = new THREE.LineSegments(mergeGeometries(edgeGeos, false)!, outlineMat);
    edgeGeos.forEach((g) => g.dispose());
    edges.matrixAutoUpdate = false;
    edges.renderOrder = 5;
    statics.add(edges);
  }
  scene.add(statics);

  // ---- intro-only decor: ceiling & chandeliers
  const introGroup = new THREE.Group();
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), new THREE.MeshLambertMaterial({ color: 0x1e1512 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(WORLD_W / 2, WALL_H, WORLD_H / 2);
  introGroup.add(ceil);
  const lights: World['lights'] = [];
  const bulbMat = () => {
    const m = M.flame.clone();
    m.onBeforeCompile = M.flame.onBeforeCompile;
    return m;
  };
  const chandBulbs = LEVEL.lights.map(bulbMat);
  const chand = (x: number, z: number, r: number, li: number) => {
    const flame = chandBulbs[li];
    sb.frame(x, z, 0);
    // chain down from the ceiling rose
    sb.lathe(M.gold, 0, WALL_H - 0.12, 0, [[0, 0], [0.3, 0], [0.32, 0.05], [0.2, 0.12], [0, 0.12]], 16);
    for (let y = 3.95; y < WALL_H - 0.15; y += 0.16) sb.place(new THREE.TorusGeometry(0.05, 0.012, 4, 10), M.gold, 0, y, 0, 0, (y * 7) % 2 > 1 ? Math.PI / 2 : 0, 0);
    // turned brass body
    sb.lathe(M.gold, 0, 2.7, 0, [[0, 0], [0.06, 0.05], [0.05, 0.2], [0.16, 0.35], [0.22, 0.55], [0.14, 0.7], [0.08, 0.8], [0.12, 0.9], [0.06, 1.15], [0.08, 1.25], [0, 1.3]], 12);
    // arms sweep out and up to drip cups and candles
    for (let k = 0; k < 8; k++) {
      const an = (k / 8) * Math.PI * 2, cx = Math.cos(an) * r, cz = Math.sin(an) * r;
      // a swan-neck arm: out of the body's waist, dipping, then curling up into the cup
      const arm = new THREE.TubeGeometry(new THREE.CubicBezierCurve3(
        new THREE.Vector3(0.1, 3.1, 0), new THREE.Vector3(r * 0.45, 2.85, 0),
        new THREE.Vector3(r * 0.95, 2.95, 0), new THREE.Vector3(r, 3.28, 0),
      ), 8, 0.03, 5);
      sb.place(arm, M.gold, 0, 0, 0, 0, -an, 0);
      sb.lathe(M.gold, cx, 3.28, cz, [[0, 0], [0.04, 0], [0.11, 0.06], [0.12, 0.08], [0.05, 0.06], [0, 0.06]], 8);
      sb.cyl(M.white, cx, 3.34, cz, 0.04, 0.045, 0.22, 8);
      sb.sph(flame, cx, 3.6, cz, 0.06, 6);
      // crystal drops hang beneath each arm
      const drop = new THREE.OctahedronGeometry(0.06);
      drop.scale(0.8, 1.6, 0.8);
      sb.place(drop, M.crystal, cx * 0.6, 3.05, cz * 0.6);
    }
    // lower crystal ring and a finial
    sb.torus(M.gold, 0, 3.15, 0, r * 0.45, 0.018, 24);
    for (let k = 0; k < 12; k++) {
      const an = (k / 12) * Math.PI * 2 + 0.26;
      const drop = new THREE.OctahedronGeometry(0.045);
      drop.scale(0.8, 1.7, 0.8);
      sb.place(drop, M.crystal, Math.cos(an) * r * 0.45, 3.04, Math.sin(an) * r * 0.45);
    }
    const tip = new THREE.OctahedronGeometry(0.1);
    tip.scale(0.8, 2, 0.8);
    sb.place(tip, M.crystal, 0, 2.55, 0);
    sb.reset();
  };
  LEVEL.lights.forEach((l, li) => { for (const [x, z, r] of l.chands) chand(x, z, r, li); });
  const beforeChand = introGroup.children.length;
  sb.build(introGroup);
  // the chandeliers' own lights sit among their arms: as casters they'd throw giant spokes across the floor
  introGroup.children.slice(beforeChand).forEach((o) => { o.userData.noShadow = true; });
  scene.add(introGroup);

  // ---- roomba & dock
  const roomba = makeRoomba();
  scene.add(roomba.group);
  const dock = makeDock();
  scene.add(dock.group);
  addBox(DOCK.x, DOCK.z + 1.05, 1.5, 0.45);

  // ---- lights
  const ambient = new THREE.AmbientLight(0xb8b0d8, 0.75);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xa0b0ff, 0x4a3020, 0.8);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xb0c0ff, 0.9);
  moon.position.set(-30, 60, -20);
  scene.add(moon);
  const pl = (x: number, y: number, z: number, int: number, dist: number, bulbs: THREE.MeshStandardMaterial[], flaky = 1, color = 0xffb870) => {
    const l = new THREE.PointLight(color, int, dist, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
    lights.push({ light: l, base: int, bulbs, flaky });
  };
  LEVEL.lights.forEach((l, li) => pl(l.x, l.y, l.z, l.int, l.dist, [chandBulbs[li]], l.flaky ?? 1));

  // ---- secret rooms: a single bare bulb on a cord (visible during play), the oldest bulbs in the house
  const pendants = new THREE.Group();
  const psb = new SB();
  ROOMS.forEach((room, ri) => {
    if (!room.secret) return;
    const [c0, r0, w, h] = room.rect;
    const x = (c0 + w / 2) * TILE, z = (r0 + h / 2) * TILE;
    const bulb = bulbMat();
    psb.cyl(M.black, x, 3.25, z, 0.015, 0.015, WALL_H - 3.25, 5);
    psb.cyl(M.black, x, 3.12, z, 0.06, 0.07, 0.16, 8);
    psb.sph(bulb, x, 3.0, z, 0.13, 10);
    pl(x, 2.9, z, 14, 13, [bulb], 3.2, 0xffc890);
    void ri;
  });
  psb.build(pendants);
  scene.add(pendants);

  // ---- secret doors: a wall block that looks like the rest, with a slightly crooked portrait as the tell
  const secrets: SecretDoor[] = [];
  for (const [c, r, key, side] of SECRET_DOORS) {
    const group = new THREE.Group();
    const ssb = new SB();
    const cx = (c + 0.5) * TILE, cz = (r + 0.5) * TILE;
    // a shell like the walls (no stacked boxes, so nothing coincides when it's cut), inset a hair
    // so its sides never sit exactly on the neighbouring wall faces
    const half = TILE / 2 - 0.015;
    for (const [mat, y0, y1] of [[wallM.wainscot, 0, 1.3], [wallM.wallpaper, 1.3, WALL_H - 0.15], [wallM.cap, WALL_H - 0.15, WALL_H]] as const) {
      for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        ssb.place(new THREE.PlaneGeometry(half * 2, y1 - y0), mat, cx + Math.sin(ry) * half, (y0 + y1) / 2, cz + Math.cos(ry) * half, 0, ry, 0);
      }
    }
    ssb.place(new THREE.PlaneGeometry(half * 2, half * 2), wallM.cap, cx, WALL_H, cz, -Math.PI / 2);
    // crooked little portrait on the visible face
    const fx = cx + side * TILE / 2;
    ssb.frame(fx, cz, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const tilt = 0.13 * side;
    ssb.box(wallM.gold, 0, 2.6 - 0.65 - 0.1, 0.03, 0.95, 1.3, 0.06, 0, 0, tilt);
    ssb.place(new THREE.PlaneGeometry(0.75, 1.1), wallPortraits[(c + r) % wallPortraits.length], 0, 2.6, 0.065, 0, 0, tilt);
    ssb.reset();
    ssb.build(group);
    scene.add(group);
    const box: Box = { minX: c * TILE, maxX: (c + 1) * TILE, minZ: r * TILE, maxZ: (r + 1) * TILE };
    boxes.push(box);
    const room = ROOMS.findIndex((rm) => rm.key === key);
    const [rc, rr, rw, rh] = ROOMS[room].rect;
    // not cut away (it must never reveal the room) and drawn like the wall tops around it
    // a solid block filling the room, so even where the cutaway slices the surrounding walls there's nothing to see
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(rw * TILE + 0.02, WALL_H, rh * TILE + 0.02),
      new THREE.MeshLambertMaterial({ color: 0x17111a, transparent: true, opacity: 1 }),
    );
    roof.position.set((rc + rw / 2) * TILE, WALL_H / 2, (rr + rh / 2) * TILE);
    scene.add(roof);
    secrets.push({ room, c, r, idx: r * COLS + c, group, box, fx, fz: cz, nx: side, roof });
  }

  const animate = (t: number, hours: number) => { for (const fn of animators) fn(t, hours); };
  const setMessState = (it: MessItem, tidy: boolean) => {
    for (const pt of it.parts) applyPose(pt.obj, tidy ? pt.to : pt.from);
    const [rm, add] = tidy ? [it.messyBoxes, it.tidyBoxes] : [it.tidyBoxes, it.messyBoxes];
    for (const b of rm) { const i = boxes.indexOf(b); if (i >= 0) boxes.splice(i, 1); }
    for (const b of add) if (!boxes.includes(b)) boxes.push(b);
    it.tidy = tidy;
  };

  return { scene, grid, boxes, roomba, dock, cut, introGroup, floorMat, lights, secrets, ambient, hemi, clocks, soundSources, mess, setMessState, animate, animRoot };
}

/**
 * Enable real-time shadow casting/receiving on a built world. Call after buildWorld() and once the
 * renderer has shadow maps enabled (Engine constructor with shadows: true).
 *   - Floor (large flat plane at y≈0) receives shadows.
 *   - Furniture + walls cast and receive.
 *   - The roomba doesn't cast (its blob shadow grounds it): every shadow map is cached, see ShadowCache.
 *   - Point lights and the directional moon light cast shadows.
 */
export function enableShadows(world: World, renderer: THREE.WebGLRenderer) {
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was removed in three r18x; it fell back to this with a console warning
  renderer.shadowMap.type = THREE.PCFShadowMap;
  world.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    // Outlines, sprites/points and see-through glow effects (flames, rings, the roomba's glow and
    // blob shadow) don't block light. Drawn into a shadow map they'd cast solid shapes and cost a
    // draw per shadow pass.
    if (!(mesh as THREE.Mesh).isMesh || !castsLight(mesh.material) || mesh.userData.noShadow) { mesh.castShadow = false; return; }
    // the floor is a large flat plane at y≈0 — receives but doesn't cast
    const isFloor = mesh.position.y <= 0.01 && mesh.geometry instanceof THREE.PlaneGeometry;
    if (isFloor) { mesh.receiveShadow = true; mesh.castShadow = false; return; }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  // point lights: each casts a soft shadow from above
  for (const l of world.lights) {
    const pl = l.light;
    pl.castShadow = true;
    pl.shadow.mapSize.set(512, 512);
    pl.shadow.bias = -0.002;
    pl.shadow.camera.near = 0.5;
    pl.shadow.camera.far = pl.distance || 30;
  }
  // directional moon light: one big shadow map covering the whole floor plan
  const sun = world.scene.children.find((c) => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight | undefined;
  if (sun) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -WORLD_W / 2;
    sun.shadow.camera.right = WORLD_W / 2;
    sun.shadow.camera.top = WORLD_H / 2;
    sun.shadow.camera.bottom = -WORLD_H / 2;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0008;
    sun.target.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    world.scene.add(sun.target);
  }
}

/**
 * Image-based lighting for the PBR materials. Not a bright studio: a dim, warm-and-cool room that
 * matches the manor at night (chandelier glow overhead, moonlit window panes on two sides), so
 * polished wood, brass and marble pick up believable highlights without lifting the darkness.
 */
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
export function applyEnvironment(world: World, renderer: THREE.WebGLRenderer) {
  let tex = envCache.get(renderer);
  if (!tex) {
    const env = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(24, 10, 24), new THREE.MeshBasicMaterial({ color: 0x120c14, side: THREE.BackSide }));
    box.position.y = 3;
    env.add(box);
    // a dark floor so downward reflections stay low
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0x07050a }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.9;
    env.add(floor);
    const glow = (color: number, k: number, w: number, h: number, x: number, y: number, z: number, rx: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      env.add(m);
    };
    // chandeliers overhead
    glow(0xffb36b, 6, 3, 3, -4, 7.9, -3, Math.PI / 2, 0);
    glow(0xffc888, 4, 2, 2, 5, 7.9, 4, Math.PI / 2, 0);
    // moonlit windows
    glow(0x6f88d8, 2.2, 3, 4.5, 0, 3.5, -11.9, 0, 0);
    glow(0x5a74c4, 1.6, 2.5, 4, 11.9, 3.2, 2, 0, -Math.PI / 2);
    // a soft warm bounce near the floor (fireplace)
    glow(0xff7a3a, 1.2, 4, 1.4, -11.9, 0.2, -2, 0, Math.PI / 2);
    const pm = new THREE.PMREMGenerator(renderer);
    tex = pm.fromScene(env, 0.035).texture;
    pm.dispose();
    env.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    envCache.set(renderer, tex);
  }
  world.scene.environment = tex;
  world.scene.environmentIntensity = 0.85;
}

/** Whether a material is solid enough to cast a shadow (not an additive or depthless effect). */
function castsLight(mat: THREE.Material | THREE.Material[]) {
  const m = Array.isArray(mat) ? mat[0] : mat;
  return !(m.transparent && (!m.depthWrite || m.blending === THREE.AdditiveBlending));
}

/**
 * Keeps every shadow map cached. Each chandelier renders a cube shadow map (six passes over the
 * scene) and the moon one more over the whole house, yet almost everything they see is walls and
 * furniture that never move. So the maps are only redrawn when something in them changes: a mess
 * item or secret wall moving, or the intro ceiling showing or hiding. Things that move all the time
 * (the roomba, animated furniture) are left out of the maps so they're never baked in at a stale
 * spot; the roomba's own blob shadow grounds it instead.
 */
export class ShadowCache {
  private sig = NaN;
  private casters: THREE.LightShadow[] = [];

  constructor(private world: World) {
    // the moving parts never cast; their shadow would be stuck wherever they were at the last redraw
    for (const root of [world.roomba.group, world.animRoot]) root.traverse((o) => { o.castShadow = false; });
    world.scene.traverse((o) => {
      const l = o as THREE.Light & { shadow?: THREE.LightShadow };
      if (l.isLight && l.castShadow && l.shadow) { l.shadow.autoUpdate = false; this.casters.push(l.shadow); }
    });
  }

  /** Force the cached maps to be redrawn on the next frame. */
  invalidate() { this.sig = NaN; }

  /** Call once per frame, just before rendering. */
  update() {
    const sig = this.signature();
    if (sig === this.sig) return;
    this.sig = sig;
    for (const s of this.casters) s.needsUpdate = true;
  }

  /** A cheap fingerprint of everything that can move or appear in the cached shadow maps. */
  private signature() {
    let h = this.world.introGroup.visible ? 1 : 0;
    const add = (o: THREE.Object3D, k: number) => {
      const p = o.position, q = o.quaternion;
      h += k * (p.x * 1.3 + p.y * 2.7 + p.z * 3.1 + q.x * 5.3 + q.y * 7.1 + q.z * 11.3 + q.w * 13.7 + o.scale.y * 17.9 + (o.visible ? 19.1 : 0));
    };
    let k = 1;
    for (const it of this.world.mess) for (const pt of it.parts) add(pt.obj, k += 0.37);
    for (const sd of this.world.secrets) { add(sd.group, k += 0.37); add(sd.roof, k += 0.37); }
    return h;
  }
}
