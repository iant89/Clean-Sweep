import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  COLS, DOCK, DOORS, FURNITURE, Facing, FurnDef, ROOMS, ROWS, RUGS, TILE, WALL_H, WORLD_H, WORLD_W,
} from './constants';
import { makeRng } from './dirt';

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
export interface CutUniforms { uRoomba: { value: THREE.Vector3 }; uCut: { value: number } }

export function buildGrid() {
  const g = new Int8Array(COLS * ROWS).fill(-1);
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
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (!gl_FrontFacing) gl_FragColor = vec4(0.07, 0.05, 0.06, 1.0);`,
      );
    }
  };
  mat.customProgramCacheKey = () => (darkBack ? 'cutD' : 'cut');
}

// Furniture: fragments sitting between the camera and the roomba (i.e. tall pieces hiding it) are
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
  float perp = length(rel - dir * t);
  return (1.0 - smoothstep(1.1, 2.3, perp)) * (1.0 - smoothstep(len - 1.4, len - 0.6, t));
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
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.78), occRim * 0.4);`,
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
  torus(mat: THREE.Material, cx: number, cy: number, cz: number, r: number, t: number) {
    this.place(new THREE.TorusGeometry(r, t, 6, 20), mat, cx, cy, cz, Math.PI / 2);
  }
  frame(x: number, z: number, ry: number, y = 0) {
    this.m.makeRotationY(ry);
    this.m.setPosition(x, y, z);
  }
  reset() { this.m.identity(); }
  build(parent: THREE.Object3D) {
    for (const [mat, geos] of this.map) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.map.clear();
  }
}

const facingRot = (f: Facing | undefined) => (f === 'n' ? Math.PI : f === 'e' ? Math.PI / 2 : f === 'w' ? -Math.PI / 2 : 0);
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

function floorTexture(grid: Int8Array) {
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
    const [c0, r0, w, h] = room.rect;
    g.save();
    g.beginPath();
    g.rect(c0 * TILE * S, r0 * TILE * S, w * TILE * S, h * TILE * S);
    for (const [dc, dr, dw, dh, key] of DOORS) {
      if (key === room.key) g.rect(dc * TILE * S, dr * TILE * S, dw * TILE * S, dh * TILE * S);
    }
    g.clip();
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
}

function makeRoomba(): RoombaModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const shell = new THREE.MeshPhongMaterial({ color: 0x1d1f24, shininess: 90, specular: 0x666677 });
  const top = new THREE.MeshPhongMaterial({ color: 0x2f333b, shininess: 120, specular: 0x8888aa });
  const bump = new THREE.MeshPhongMaterial({ color: 0x8a8f99, shininess: 60 });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xbffcff });
  const m1 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.53, 0.26, 32), shell);
  m1.position.y = 0.17;
  body.add(m1);
  const m2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.04, 32), top);
  m2.position.y = 0.32;
  body.add(m2);
  const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.565, 0.565, 0.16, 24, 1, true, -Math.PI / 2, Math.PI), bump);
  bumper.position.y = 0.15;
  body.add(bumper);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.022, 6, 40), ledMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.345;
  body.add(ring);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), ledMat);
  btn.position.set(0, 0.345, -0.1);
  body.add(btn);
  const eyes: THREE.Mesh[] = [];
  for (const sx of [-0.13, 0.13]) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12), eyeMat);
    e.position.set(sx, 0.35, 0.2);
    body.add(e);
    eyes.push(e);
  }
  const brushMat = new THREE.MeshLambertMaterial({ color: 0xc8c0a0 });
  const brushes: THREE.Group[] = [];
  for (const sx of [-0.36, 0.36]) {
    const b = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.03), brushMat);
      s.position.x = 0.15;
      const holder = new THREE.Group();
      holder.rotation.y = (k * Math.PI * 2) / 3;
      holder.add(s);
      b.add(holder);
    }
    b.position.set(sx, 0.03, 0.36);
    group.add(b);
    brushes.push(b);
  }
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.7),
    new THREE.MeshBasicMaterial({ map: blobTexture('rgba(0,0,0,0.7)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  group.add(shadow);
  // Glow lies flat on the floor as a halo: a camera-facing sprite sank half into the floor and got clipped.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: blobTexture('rgba(120,240,255,0.55)', 'rgba(0,200,255,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.scale.set(2.4, 2.4, 1);
  glow.position.y = 0.02;
  glow.renderOrder = 2;
  group.add(glow);
  const light = new THREE.PointLight(0x9feaff, 0, 15, 2);
  light.position.set(0, 2.6, 0.4);
  group.add(light);
  return { group, body, ledMat, eyeMat, eyes, brushes, light, glow };
}

// ---------------------------------------------------------------- dock
export interface DockModel { group: THREE.Group; ring: THREE.Mesh; stripMat: THREE.MeshBasicMaterial; ringMat: THREE.MeshBasicMaterial }
function makeDock(): DockModel {
  const group = new THREE.Group();
  const dark = new THREE.MeshPhongMaterial({ color: 0x1b1d22, shininess: 80 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 1.5), dark);
  base.position.set(0, 0.025, 0.2);
  group.add(base);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.4), dark);
  tower.position.set(0, 0.25, 1.05);
  group.add(tower);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x35ff9a });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.02), stripMat);
  strip.position.set(0, 0.36, 0.84);
  group.add(strip);
  for (const sx of [-0.35, 0.35]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.3), new THREE.MeshPhongMaterial({ color: 0xd4af37, shininess: 100 }));
    c.position.set(sx, 0.06, 0.55);
    group.add(c);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x35ff9a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  group.position.set(DOCK.x, 0, DOCK.z);
  return { group, ring, stripMat, ringMat };
}

// ---------------------------------------------------------------- world
export interface World {
  scene: THREE.Scene;
  grid: Int8Array;
  boxes: Box[];
  roomba: RoombaModel;
  dock: DockModel;
  cut: CutUniforms;
  introGroup: THREE.Group;
  floorMat: THREE.MeshPhongMaterial;
  lights: { light: THREE.PointLight; base: number }[];
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  /** Grandfather clocks: position and pendulum phase (pendulum angle ~ sin(t*PI + phase)). */
  clocks: { x: number; z: number; phase: number }[];
  /** Drive animated furniture. t: seconds; hours: in-game clock time in hours (12 = midnight). */
  animate(t: number, hours: number): void;
}

export function buildWorld(dirtTex: THREE.Texture, grid: Int8Array): World {
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
  const L = (color: number, opts: THREE.MeshLambertMaterialParameters = {}, dark = false) => {
    const m = new THREE.MeshLambertMaterial({ color, ...opts });
    if (cutaway) patchCutaway(m, cut, dark);
    else { patchOccluderFade(m, cut); fadeMats.add(m); }
    return m;
  };
  const M = {
    wallpaper: L(0x4a2d3c, { side: THREE.DoubleSide }, true),
    wainscot: L(0x2e1d14, { side: THREE.DoubleSide }, true),
    cap: L(0x17111a, { side: THREE.DoubleSide }, true),
    trim: L(0x8a6a3a),
    woodDark: L(0x3b2416),
    woodMed: L(0x6b4426),
    woodLight: L(0x9a6b3e),
    red: L(0x7a1d27),
    green: L(0x2f5038),
    blue: L(0x2a3d66),
    wicker: L(0xa8875a),
    gold: L(0xc69a3e, { emissive: 0x2a1a00 }),
    stone: L(0x9a958a),
    marbleW: L(0xd8d2c4),
    white: L(0xdcd8cc),
    black: L(0x17151a),
    steel: L(0x8c9096),
    plant: L(0x2f6b34),
    plant2: L(0x3f8a3c),
    pot: L(0xa0522d),
    books: [L(0x7a1d27), L(0x22406a), L(0x2f5a34), L(0xb08a50), L(0x4a2a5a)],
    flame: L(0xffd080, { emissive: 0xffb040 }),
    ember: L(0xff6020, { emissive: 0xff4010 }),
    water: L(0x3a7fa0, { emissive: 0x0a3550 }),
    window: L(0x24345e, { emissive: 0x1a2a55 }),
    lamp: L(0xffe0a0, { emissive: 0xffc060 }),
    globe: L(0x2a6a8a),
  };
  const portraits = [0, 1, 2, 3, 4, 5].map((i) => L(0xffffff, { map: portraitTexture(i + 1) }));
  return { M, portraits };
  };
  let { M, portraits } = makeMats(true);

  // ---- floor
  const floorTex = floorTexture(grid);
  const floorMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60, specular: 0x3a3a3a });
  floorMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFloor = { value: floorTex };
    shader.uniforms.uDirt = { value: dirtTex };
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
        diffuseColor.rgb = mix(diffuseColor.rgb, mud, dirtA);`,
      )
      .replace('#include <specularmap_fragment>', `#include <specularmap_fragment>
        specularStrength *= (1.0 - dirtA);`);
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(WORLD_W / 2, 0, WORLD_H / 2);
  scene.add(floor);

  const sb = new SB();

  // ---- walls (greedy rect merge)
  const isFloor = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS && grid[r * COLS + c] >= 0;
  const need = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (grid[r * COLS + c] >= 0) continue;
    let n = false;
    for (let dy = -1; dy <= 1 && !n; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(c + dx, r + dy)) { n = true; break; }
    need[r * COLS + c] = n ? 1 : 0;
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
    const cx = (c + w / 2) * TILE, cz = (r + h / 2) * TILE;
    const ww = w * TILE, dd = h * TILE;
    sb.box(M.wainscot, cx, 0, cz, ww, 1.3, dd);
    sb.box(M.wallpaper, cx, 1.3, cz, ww, WALL_H - 1.45, dd);
    sb.box(M.cap, cx, WALL_H - 0.15, cz, ww, 0.15, dd);
  }

  // ---- wall decor: paintings & windows
  const painting = (x: number, z: number, ry: number, w: number, h: number, idx: number) => {
    sb.frame(x, z, ry);
    sb.box(M.gold, 0, 2.6 - h / 2 - 0.12, 0.03, w + 0.24, h + 0.24, 0.06);
    sb.place(new THREE.PlaneGeometry(w, h), portraits[idx % portraits.length], 0, 2.6, 0.065);
    sb.reset();
  };
  painting(44, 2, 0, 2.6, 1.9, 0);
  painting(40, 19, Math.PI / 2, 1.2, 1.5, 1);
  painting(40, 25, Math.PI / 2, 1.2, 1.5, 2);
  painting(40, 31.5, Math.PI / 2, 1.2, 1.5, 3);
  painting(48, 22, -Math.PI / 2, 1.2, 1.5, 4);
  painting(48, 30, -Math.PI / 2, 1.2, 1.5, 5);
  painting(36, 36, 0, 1.6, 1.2, 2);
  painting(52, 36, 0, 1.6, 1.2, 5);
  painting(2, 33, Math.PI / 2, 1.6, 1.2, 1);
  painting(86, 48, -Math.PI / 2, 1.6, 1.2, 3);
  const windowAt = (x: number, z: number, ry: number) => {
    sb.frame(x, z, ry);
    sb.box(M.window, 0, 1.1, 0.03, 1.6, 2.6, 0.04);
    sb.box(M.woodDark, 0, 1.0, 0.06, 1.9, 0.12, 0.1);
    sb.box(M.woodDark, 0, 3.7, 0.06, 1.9, 0.12, 0.1);
    sb.box(M.woodDark, 0, 1.1, 0.07, 0.08, 2.6, 0.06);
    sb.box(M.woodDark, 0, 2.35, 0.07, 1.6, 0.08, 0.06);
    sb.reset();
  };
  [6, 12, 20, 26].forEach((x) => windowAt(x, 66, Math.PI));
  [29, 36].forEach((z) => windowAt(86, z, -Math.PI / 2));
  [37.5, 50.5].forEach((x) => windowAt(x, 64, Math.PI));
  [56, 66, 78].forEach((x) => windowAt(x, 2, 0));
  windowAt(2, 47, Math.PI / 2);
  windowAt(2, 37, Math.PI / 2);

  // ---- furniture (fades when blocking the roomba, never cut away)
  // Moving parts are real meshes (not merged into the statics) and are driven by animate().
  const animators: ((t: number, hours: number) => void)[] = [];
  const clocks: World['clocks'] = [];
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
  const globeMat = new THREE.MeshLambertMaterial({ map: globeTexture() });
  patchOccluderFade(globeMat, cut);
  const flameMats = [0xff7a1a, 0xffc040].map((color) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const rippleMat = () => new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  ({ M, portraits } = makeMats(false));
  const rng = makeRng(42);
  const legsCollide = (x: number, z: number, a: number, pts: [number, number][], s = 0.3) => {
    for (const [lx, lz] of pts) { const [wx, wz] = rotXZ(lx, lz, a); addBox(x + wx, z + wz, s, s); }
  };
  const fullBox = (f: FurnDef, w: number, d: number) => {
    const a = facingRot(f.f);
    const swap = Math.abs(Math.sin(a)) > 0.5;
    addBox(f.x, f.z, swap ? d : w, swap ? w : d);
  };
  const chairParts = (seatMat: THREE.Material) => {
    for (const lx of [-0.38, 0.38]) for (const lz of [-0.38, 0.38]) sb.box(M.woodDark, lx, 0, lz, 0.13, 0.85, 0.13);
    sb.box(M.woodMed, 0, 0.85, 0, 0.95, 0.12, 0.95);
    sb.box(seatMat, 0, 0.97, 0.03, 0.8, 0.08, 0.8);
    sb.box(M.woodMed, 0, 0.97, -0.42, 0.95, 1.2, 0.1);
  };
  const sofaParts = (w: number, d: number, mat: THREE.Material) => {
    for (const lx of [-w / 2 + 0.2, w / 2 - 0.2]) for (const lz of [-d / 2 + 0.2, d / 2 - 0.2]) sb.box(M.woodDark, lx, 0, lz, 0.15, 0.2, 0.15);
    sb.box(mat, 0, 0.2, 0, w, 0.55, d);
    sb.box(mat, 0, 0.2, -d / 2 + 0.22, w, 1.35, 0.44);
    sb.box(mat, -w / 2 + 0.2, 0.2, 0.05, 0.4, 0.95, d - 0.1);
    sb.box(mat, w / 2 - 0.2, 0.2, 0.05, 0.4, 0.95, d - 0.1);
    const n = Math.max(1, Math.round((w - 0.8) / 1.3));
    const cw = (w - 0.8) / n;
    for (let k = 0; k < n; k++) sb.box(mat, -w / 2 + 0.4 + cw * (k + 0.5), 0.75, 0.15, cw - 0.06, 0.18, d - 0.6);
  };

  for (const f of FURNITURE) {
    const a = facingRot(f.f);
    const w = f.w ?? 1, d = f.d ?? 1;
    switch (f.t) {
      case 'table': {
        const h = f.h ?? 1.6;
        sb.frame(f.x, f.z, 0);
        sb.box(M.woodMed, 0, h - 0.14, 0, w, 0.14, d);
        sb.box(M.woodDark, 0, h - 0.3, 0, w - 0.3, 0.16, d - 0.3);
        const pts: [number, number][] = [];
        const nx = w > 6 ? 3 : 2;
        for (let k = 0; k < nx; k++) for (const lz of [-d / 2 + 0.22, d / 2 - 0.22]) {
          pts.push([-w / 2 + 0.22 + (k * (w - 0.44)) / (nx - 1), lz]);
        }
        for (const [lx, lz] of pts) sb.box(M.woodDark, lx, 0, lz, 0.18, h - 0.14, 0.18);
        if (w > 6) {
          sb.box(M.white, 0, h, 0, w - 1, 0.02, 1.2);
          for (const lx of [-3, 0, 3]) { sb.cyl(M.gold, lx, h, 0, 0.08, 0.15, 0.6); sb.cyl(M.white, lx, h + 0.6, 0, 0.05, 0.05, 0.3); }
        } else if (w > 2) {
          sb.box(M.books[1], -0.6, h, 0.2, 0.7, 0.12, 0.5, 0.3);
          sb.cyl(M.lamp, 0.8, h, -0.3, 0.12, 0.12, 0.25);
        }
        sb.reset();
        legsCollide(f.x, f.z, 0, pts, 0.3);
        break;
      }
      case 'roundtable': {
        sb.frame(f.x, f.z, 0);
        sb.cyl(M.woodDark, 0, 0, 0, 0.7, 0.9, 0.2, 16);
        sb.cyl(M.woodDark, 0, 0.2, 0, 0.3, 0.4, 1.4, 12);
        sb.cyl(M.woodMed, 0, 1.6, 0, w / 2, w / 2, 0.14, 28);
        sb.cyl(M.marbleW, 0, 1.74, 0, 0.35, 0.25, 0.9, 12);
        sb.sph(M.red, 0, 2.8, 0, 0.45, 10);
        sb.sph(M.plant, 0.3, 2.6, 0.2, 0.3, 8);
        sb.reset();
        addBox(f.x, f.z, 1.7, 1.7);
        break;
      }
      case 'chair': {
        sb.frame(f.x, f.z, a);
        chairParts(M.red);
        sb.reset();
        legsCollide(f.x, f.z, a, [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]], 0.22);
        break;
      }
      case 'tipchair': {
        const ang = rng() * Math.PI * 2;
        sb.frame(f.x, f.z, ang, 0.48);
        const inner = new THREE.Matrix4().makeTranslation(0, 0, 1.0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        sb.m.multiply(inner);
        chairParts(M.red);
        sb.reset();
        // footprint ~1.0 x 2.1 centered roughly at offset
        const [ox, oz] = rotXZ(0, 0.05, ang);
        const ex = Math.abs(Math.cos(ang)) * 0.5 + Math.abs(Math.sin(ang)) * 1.0;
        const ez = Math.abs(Math.sin(ang)) * 0.5 + Math.abs(Math.cos(ang)) * 1.0;
        addBox(f.x + ox, f.z + oz, ex * 2, ez * 2);
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
        sb.box(M.woodDark, 0, 0, -d / 2 + 0.06, w, h, 0.12);
        sb.box(M.woodDark, -w / 2 + 0.07, 0, 0, 0.14, h, d);
        sb.box(M.woodDark, w / 2 - 0.07, 0, 0, 0.14, h, d);
        sb.box(M.woodDark, 0, h - 0.14, 0, w, 0.14, d);
        sb.box(M.woodDark, 0, 0, 0, w, 0.25, d);
        for (let row = 0; row < 4; row++) {
          const y = 0.25 + row * 0.98;
          sb.box(M.woodMed, 0, y + 0.86, 0, w - 0.2, 0.08, d - 0.1);
          let x = -w / 2 + 0.18;
          while (x < w / 2 - 0.3) {
            const bw = 0.25 + rng() * 0.45;
            const bh = 0.55 + rng() * 0.28;
            if (rng() > 0.12) sb.box(M.books[Math.floor(rng() * 5)], x + bw / 2, y, 0.05, bw - 0.03, bh, d - 0.35);
            x += bw;
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
        sb.box(f.t === 'stove' ? M.black : baseMat, 0, 0.15, 0, w, 1.5, d);
        sb.box(f.v === 1 ? M.woodMed : M.marbleW, 0, 1.65, 0, w + 0.1, 0.12, d + 0.1);
        if (f.t === 'stove') {
          for (const lx of [-0.6, 0.6]) for (const lz of [-0.35, 0.35]) sb.cyl(M.steel, lx, 1.77, lz, 0.25, 0.25, 0.04, 14);
        } else if (f.t === 'island') {
          sb.sph(M.pot, -2, 1.95, 0, 0.3); sb.sph(M.plant2, -1.6, 1.9, 0.3, 0.2); sb.cyl(M.steel, 2, 1.77, 0.2, 0.35, 0.3, 0.4, 12);
        } else if (f.v === 1) {
          sb.cyl(M.gold, -1.5, 1.77, 0, 0.1, 0.18, 0.7); sb.cyl(M.marbleW, 1.2, 1.77, 0, 0.25, 0.15, 0.8);
        } else {
          for (let k = -w / 2 + 0.7; k < w / 2; k += 1.2) sb.box(M.steel, k, 1.25, d / 2 + 0.03, 0.4, 0.05, 0.05);
        }
        sb.reset();
        fullBox(f, w, d);
        break;
      }
      case 'fridge': {
        sb.frame(f.x, f.z, a);
        sb.box(M.white, 0, 0, 0, w, 3.8, d);
        sb.box(M.steel, w / 2 - 0.3, 1.5, d / 2 + 0.04, 0.08, 1.4, 0.08);
        sb.box(M.black, 0, 2.6, d / 2 + 0.005, w, 0.03, 0.01);
        sb.reset();
        fullBox(f, w, d);
        break;
      }
      case 'piano': {
        sb.frame(f.x, f.z, 0);
        const pts: [number, number][] = [[-1.4, -0.9], [1.4, -0.9], [0.6, 1.0]];
        for (const [lx, lz] of pts) sb.cyl(M.black, lx, 0, lz, 0.12, 0.09, 1.1, 8);
        sb.box(M.black, 0, 1.1, 0, 3.4, 0.6, 2.6);
        sb.box(M.white, 0, 1.45, -1.45, 3.0, 0.08, 0.35);
        for (let k = 0; k < 14; k++) sb.box(M.black, -1.4 + k * 0.21, 1.53, -1.52, 0.08, 0.05, 0.2);
        sb.box(M.black, 0.2, 1.7, 0.1, 3.0, 0.05, 2.2, 0, 0, 0.45);
        sb.box(M.black, 0, 0, -2.3, 1.4, 0.75, 0.55);
        sb.reset();
        legsCollide(f.x, f.z, 0, pts, 0.35);
        addBox(f.x, f.z - 2.3, 1.4, 0.55);
        break;
      }
      case 'pillar': {
        sb.frame(f.x, f.z, 0);
        sb.box(M.marbleW, 0, 0, 0, 1.4, 0.3, 1.4);
        sb.cyl(M.marbleW, 0, 0.3, 0, 0.5, 0.58, WALL_H - 0.6, 14);
        sb.box(M.marbleW, 0, WALL_H - 0.3, 0, 1.4, 0.3, 1.4);
        sb.reset();
        addBox(f.x, f.z, 1.4, 1.4);
        break;
      }
      case 'plant': {
        sb.frame(f.x, f.z, rng() * 6);
        sb.cyl(M.pot, 0, 0, 0, 0.48, 0.36, 0.9, 12);
        sb.sph(M.plant, 0, 1.35, 0, 0.62);
        sb.sph(M.plant2, 0.3, 1.75, 0.15, 0.45);
        sb.sph(M.plant, -0.25, 1.9, -0.2, 0.4);
        sb.reset();
        addBox(f.x, f.z, 1.0, 1.0);
        break;
      }
      case 'statue': {
        sb.frame(f.x, f.z, 0);
        sb.box(M.stone, 0, 0, 0, 1.2, 1.4, 1.2);
        sb.box(M.stone, 0, 1.4, 0, 1.35, 0.12, 1.35);
        sb.box(M.marbleW, 0, 1.52, 0, 0.85, 0.45, 0.45);
        sb.cyl(M.marbleW, 0, 1.95, 0, 0.12, 0.14, 0.25);
        sb.sph(M.marbleW, 0, 2.38, 0, 0.27);
        sb.reset();
        addBox(f.x, f.z, 1.3, 1.3);
        break;
      }
      case 'clock': {
        sb.frame(f.x, f.z, a);
        sb.box(M.woodDark, 0, 0, 0, 1.2, 3.9, 0.8);
        sb.box(M.woodMed, 0, 3.9, 0, 1.35, 0.25, 0.9);
        sb.place(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20), M.gold, 0, 3.2, 0.42, Math.PI / 2);
        sb.box(M.black, 0, 0.8, 0.39, 0.6, 1.7, 0.04);
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
        sb.box(M.stone, 0, 0, 0, w, 3, d);
        sb.box(M.black, 0, 0, d / 2 - 0.25, w * 0.55, 1.6, 0.55);
        sb.box(M.ember, 0, 0, d / 2 - 0.2, w * 0.4, 0.3, 0.4);
        sb.box(M.woodMed, 0, 3, 0.1, w + 0.4, 0.2, d + 0.2);
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
          const ember = M.ember as THREE.MeshLambertMaterial;
          animators.push((t) => {
            for (const fl of flames) {
              const n1 = Math.sin(t * 9 + fl.k * 1.7) * 0.5 + Math.sin(t * 15.3 + fl.k * 4.1) * 0.3;
              fl.m.scale.set(1 + n1 * 0.15, fl.base * (1 + n1 * 0.35), 1 + n1 * 0.15);
              fl.m.rotation.z = Math.sin(t * 5 + fl.k) * 0.08;
            }
            ember.emissiveIntensity = 0.75 + 0.25 * Math.sin(t * 6.3) * Math.sin(t * 2.9);
          });
        }
        break;
      }
      case 'desk': {
        sb.frame(f.x, f.z, 0);
        sb.box(M.woodDark, -w / 2 + 0.6, 0, 0, 1.1, 1.5, d - 0.1);
        sb.box(M.woodDark, w / 2 - 0.6, 0, 0, 1.1, 1.5, d - 0.1);
        sb.box(M.woodMed, 0, 1.5, 0, w, 0.15, d);
        sb.cyl(M.gold, 1.6, 1.65, -0.5, 0.15, 0.2, 0.6);
        sb.sph(M.lamp, 1.6, 2.4, -0.5, 0.25);
        sb.box(M.white, -0.5, 1.65, 0.1, 1.0, 0.03, 0.7, 0.2);
        sb.reset();
        addBox(f.x, f.z, w, d);
        break;
      }
      case 'globe': {
        sb.frame(f.x, f.z, 0);
        sb.cyl(M.woodDark, 0, 0, 0, 0.3, 0.4, 0.15);
        sb.cyl(M.woodDark, 0, 0.15, 0, 0.06, 0.06, 1.0);
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
        sb.cyl(M.stone, 0, 0, 0, 1.7, 1.8, 0.7, 24);
        sb.cyl(M.water, 0, 0.7, 0, 1.5, 1.5, 0.03, 24);
        sb.cyl(M.stone, 0, 0.7, 0, 0.22, 0.3, 1.2, 10);
        sb.cyl(M.stone, 0, 1.9, 0, 0.7, 0.3, 0.3, 16);
        sb.cyl(M.water, 0, 2.2, 0, 0.6, 0.6, 0.02, 16);
        sb.reset();
        addBox(f.x, f.z, 3.4, 3.4);
        {
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
        sb.frame(f.x, f.z, rng() * 6);
        for (let k = 0; k < 5; k++) sb.box(M.books[k % 5], (rng() - 0.5) * 0.4, k * 0.12, (rng() - 0.5) * 0.4, 0.6, 0.11, 0.45, rng() * 3);
        sb.box(M.books[2], 0.6, 0, 0.3, 0.55, 0.1, 0.42, 0.6);
        sb.reset();
        addBox(f.x, f.z, 1.1, 1.1);
        break;
      }
      case 'vase': {
        sb.frame(f.x, f.z, rng() * 6);
        sb.cyl(M.marbleW, 0, -0.15, 0, 0.3, 0.2, 0.9, 12, 0, Math.PI / 2);
        for (let k = 0; k < 6; k++) sb.box(M.marbleW, (rng() - 0.5) * 1.6, 0, (rng() - 0.5) * 1.6, 0.18, 0.05, 0.12, rng() * 3);
        sb.sph(M.plant2, 0.7, 0.2, 0.1, 0.18);
        sb.reset();
        addBox(f.x, f.z, 0.9, 0.9);
        break;
      }
      case 'pots': {
        sb.frame(f.x, f.z, rng() * 6);
        sb.cyl(M.steel, 0, 0.1, 0, 0.35, 0.3, 0.5, 12, 0, Math.PI / 2);
        sb.cyl(M.steel, 0.6, 0, 0.4, 0.3, 0.28, 0.35, 12);
        sb.cyl(M.black, -0.5, 0, 0.5, 0.25, 0.25, 0.08, 12);
        sb.reset();
        addBox(f.x, f.z, 1.4, 1.2);
        break;
      }
      case 'frame': {
        sb.frame(f.x, f.z, rng() * 6);
        sb.box(M.gold, 0, 0, 0, 1.7, 0.1, 1.3);
        sb.place(new THREE.PlaneGeometry(1.4, 1.0), portraits[2], 0, 0.11, 0, -Math.PI / 2);
        sb.reset();
        addBox(f.x, f.z, 1.6, 1.6);
        break;
      }
    }
  }
  const statics = new THREE.Group();
  sb.build(statics);
  // outline edges for every furniture mesh (only drawn while that furniture is faded)
  const outlineMat = makeOutlineMaterial(cut);
  for (const child of [...statics.children]) {
    if (!(child instanceof THREE.Mesh) || !fadeMats.has(child.material)) continue;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry, 35), outlineMat);
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
  const chand = (x: number, z: number, r: number) => {
    sb.frame(x, z, 0);
    sb.cyl(M.gold, 0, 3.4, 0, 0.03, 0.03, WALL_H - 3.4, 6);
    sb.torus(M.gold, 0, 3.3, 0, r, 0.05);
    sb.sph(M.gold, 0, 3.3, 0, 0.15);
    for (let k = 0; k < 8; k++) {
      const an = (k / 8) * Math.PI * 2;
      sb.cyl(M.white, Math.cos(an) * r, 3.3, Math.sin(an) * r, 0.04, 0.04, 0.22, 6);
      sb.sph(M.flame, Math.cos(an) * r, 3.6, Math.sin(an) * r, 0.06, 6);
    }
    sb.reset();
  };
  chand(44, 50, 1.2); chand(44, 14, 0.7); chand(44, 26, 0.7); chand(20, 12, 1.0); chand(72, 33, 1.2);
  sb.build(introGroup);
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
  const lights: { light: THREE.PointLight; base: number }[] = [];
  const pl = (x: number, y: number, z: number, int: number, dist: number) => {
    const l = new THREE.PointLight(0xffb870, int, dist, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
    lights.push({ light: l, base: int });
  };
  pl(44, 3.6, 50, 45, 26);
  pl(44, 3.4, 18, 22, 20);
  pl(20, 3.6, 12, 35, 22);
  pl(72, 3.6, 33, 35, 22);

  const animate = (t: number, hours: number) => { for (const fn of animators) fn(t, hours); };

  return { scene, grid, boxes, roomba, dock, cut, introGroup, floorMat, lights, ambient, hemi, clocks, animate };
}
