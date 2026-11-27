import * as THREE from 'three';
import { COLS, DH, DPU, DW, ROOMS, TILE } from './constants';

export type Rng = () => number;
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const UNIT = 255 * DPU * DPU; // bytes per "dirt unit" (1 sq unit of full dirt)

export class DirtMap {
  data = new Uint8Array(DW * DH);
  room = new Int8Array(DW * DH);
  mask = new Uint8Array(DW * DH);
  sum = new Float64Array(ROOMS.length);
  total = new Float64Array(ROOMS.length);
  tex: THREE.DataTexture;
  dirty = false;
  touched = 0; // bitmask of rooms touched in last clean()
  /** Rooms that count towards the manor totals (secret rooms join once they're found). */
  counted = ROOMS.map((r) => !r.secret);

  constructor(public grid: Int8Array) {
    this.tex = new THREE.DataTexture(this.data, DW, DH, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
  }

  /** Build reachable mask + room ids. boxes are collision boxes (texels inside are unreachable). */
  buildMask(boxes: { minX: number; maxX: number; minZ: number; maxZ: number }[]) {
    const g = this.grid;
    const margin = 0.22;
    for (let j = 0; j < DH; j++) {
      const z = (j + 0.5) / DPU;
      const r = Math.floor(z / TILE);
      const lz = z - r * TILE;
      for (let i = 0; i < DW; i++) {
        const idx = j * DW + i;
        const x = (i + 0.5) / DPU;
        const c = Math.floor(x / TILE);
        const id = g[r * COLS + c];
        this.room[idx] = id;
        if (id < 0) { this.mask[idx] = 0; continue; }
        const lx = x - c * TILE;
        let ok = 1;
        if (lx < margin && g[r * COLS + c - 1] < 0) ok = 0;
        else if (lx > TILE - margin && g[r * COLS + c + 1] < 0) ok = 0;
        else if (lz < margin && g[(r - 1) * COLS + c] < 0) ok = 0;
        else if (lz > TILE - margin && g[(r + 1) * COLS + c] < 0) ok = 0;
        this.mask[idx] = ok;
      }
    }
    const m = 0.12;
    for (const b of boxes) {
      const i0 = Math.max(0, Math.floor((b.minX - m) * DPU)), i1 = Math.min(DW - 1, Math.ceil((b.maxX + m) * DPU));
      const j0 = Math.max(0, Math.floor((b.minZ - m) * DPU)), j1 = Math.min(DH - 1, Math.ceil((b.maxZ + m) * DPU));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.mask[j * DW + i] = 0;
    }
  }

  /** Open (recompute from the grid, ignoring furniture) or close (mask out) a single floor tile. */
  setTileMask(c: number, r: number, open: boolean) {
    const g = this.grid, margin = 0.22;
    for (let j = r * TILE * DPU; j < (r + 1) * TILE * DPU; j++) {
      const lz = (j + 0.5) / DPU - r * TILE;
      for (let i = c * TILE * DPU; i < (c + 1) * TILE * DPU; i++) {
        const idx = j * DW + i;
        if (!open) { this.mask[idx] = 0; continue; }
        const lx = (i + 0.5) / DPU - c * TILE;
        let ok = 1;
        if (lx < margin && g[r * COLS + c - 1] < 0) ok = 0;
        else if (lx > TILE - margin && g[r * COLS + c + 1] < 0) ok = 0;
        else if (lz < margin && g[(r - 1) * COLS + c] < 0) ok = 0;
        else if (lz > TILE - margin && g[(r + 1) * COLS + c] < 0) ok = 0;
        this.mask[idx] = ok;
      }
    }
  }

  reachable(x: number, z: number) {
    const i = Math.floor(x * DPU), j = Math.floor(z * DPU);
    if (i < 0 || j < 0 || i >= DW || j >= DH) return false;
    return this.mask[j * DW + i] === 1;
  }

  /** raise dirt to at least v (0..1 * strength) inside ellipse in local frame. returns bytes added */
  private put(idx: number, v: number) {
    if (!this.mask[idx]) return 0;
    const val = Math.min(255, Math.round(v * 255));
    const cur = this.data[idx];
    if (val <= cur) return 0;
    this.data[idx] = val;
    const add = val - cur;
    this.sum[this.room[idx]] += add;
    return add;
  }

  blob(x: number, z: number, rad: number, strength: number, seed: number) {
    let added = 0;
    const i0 = Math.max(0, Math.floor((x - rad * 1.4) * DPU)), i1 = Math.min(DW - 1, Math.ceil((x + rad * 1.4) * DPU));
    const j0 = Math.max(0, Math.floor((z - rad * 1.4) * DPU)), j1 = Math.min(DH - 1, Math.ceil((z + rad * 1.4) * DPU));
    for (let j = j0; j <= j1; j++) {
      const wz = (j + 0.5) / DPU;
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) / DPU;
        const dx = wx - x, dz = wz - z;
        const n = vnoise(wx * 1.6, wz * 1.6, seed) * 0.55 + vnoise(wx * 5, wz * 5, seed + 7) * 0.45;
        const d = Math.sqrt(dx * dx + dz * dz) / (rad * (0.7 + n * 0.6));
        if (d >= 1) continue;
        const v = strength * Math.min(1, (1 - d) * 2.2) * (0.75 + 0.25 * n);
        added += this.put(j * DW + i, v);
      }
    }
    if (added) this.dirty = true;
    return added;
  }

  /** shoe print: angle = heading (radians, 0 = +z) */
  shoe(x: number, z: number, ang: number, strength: number, left: boolean) {
    let added = 0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const R = 0.5;
    const i0 = Math.max(0, Math.floor((x - R) * DPU)), i1 = Math.min(DW - 1, Math.ceil((x + R) * DPU));
    const j0 = Math.max(0, Math.floor((z - R) * DPU)), j1 = Math.min(DH - 1, Math.ceil((z + R) * DPU));
    const toe = left ? -0.03 : 0.03;
    for (let j = j0; j <= j1; j++) {
      const wz = (j + 0.5) / DPU;
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) / DPU;
        const dx = wx - x, dz = wz - z;
        // local: u along heading, v perpendicular
        const u = dx * sa + dz * ca;
        const v = dx * ca - dz * sa;
        // sole
        const su = (u - 0.1) / 0.24, sv = (v - toe) / 0.13;
        const sd = su * su + sv * sv;
        const hu = (u + 0.25) / 0.11, hv = v / 0.105;
        const hd = hu * hu + hv * hv;
        const d = Math.min(sd, hd);
        if (d >= 1) continue;
        const grain = 0.7 + 0.3 * hash2(i, j, 99);
        added += this.put(j * DW + i, strength * Math.min(1, (1 - d) * 3) * grain);
      }
    }
    if (added) this.dirty = true;
    return added;
  }

  /** Generate a footprint trail; returns list of steps for progressive stamping */
  trailSteps(rng: Rng, roomIdx: number, len: number) {
    const [c, r, w, h] = ROOMS[roomIdx].rect;
    const x0 = c * TILE + 0.8, x1 = (c + w) * TILE - 0.8;
    const z0 = r * TILE + 0.8, z1 = (r + h) * TILE - 0.8;
    let x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0);
    let ang = rng() * Math.PI * 2;
    const steps: { x: number; z: number; a: number; left: boolean; s: number }[] = [];
    let left = false;
    for (let k = 0; k < len; k++) {
      ang += (rng() - 0.5) * 0.5;
      let nx = x + Math.sin(ang) * 0.62, nz = z + Math.cos(ang) * 0.62;
      if (nx < x0 || nx > x1) { ang = -ang; nx = x + Math.sin(ang) * 0.62; }
      if (nz < z0 || nz > z1) { ang = Math.PI - ang; nz = z + Math.cos(ang) * 0.62; }
      x = Math.min(x1, Math.max(x0, nx));
      z = Math.min(z1, Math.max(z0, nz));
      left = !left;
      const px = x + Math.cos(ang) * (left ? -0.2 : 0.2);
      const pz = z - Math.sin(ang) * (left ? -0.2 : 0.2);
      const s = 1 - (k / len) * 0.45;
      steps.push({ x: px, z: pz, a: ang, left, s });
    }
    return steps;
  }

  generate(seed: number) {
    const rng = makeRng(seed);
    this.data.fill(0);
    this.sum.fill(0);
    // base dust
    for (let j = 0; j < DH; j++) {
      const wz = (j + 0.5) / DPU;
      for (let i = 0; i < DW; i++) {
        const idx = j * DW + i;
        if (!this.mask[idx]) continue;
        const rid = this.room[idx];
        const dens = ROOMS[rid].dust;
        const wx = (i + 0.5) / DPU;
        const n = vnoise(wx * 0.35, wz * 0.35, seed) * 0.6 + vnoise(wx * 1.3, wz * 1.3, seed + 3) * 0.4;
        const thr = 1.02 - dens * 0.62;
        if (n > thr) {
          const v = Math.min(0.7, (n - thr) * 2.4 + 0.12) * (0.75 + 0.25 * hash2(i, j, seed));
          this.put(idx, v);
        }
      }
    }
    ROOMS.forEach((room, ri) => {
      const [c, r, w, h] = room.rect;
      for (let p = 0; p < room.patches; p++) {
        const x = (c + 0.5 + rng() * (w - 1)) * TILE;
        const z = (r + 0.5 + rng() * (h - 1)) * TILE;
        this.blob(x, z, 0.7 + rng() * 1.7, 0.75 + rng() * 0.25, seed + p * 13 + ri * 101);
      }
      for (let t = 0; t < room.trails; t++) {
        const steps = this.trailSteps(rng, ri, 14 + Math.floor(rng() * 22));
        for (const s of steps) this.shoe(s.x, s.z, s.a, s.s, s.left);
      }
    });
    for (let i = 0; i < ROOMS.length; i++) this.total[i] = Math.max(1, this.sum[i]);
    this.dirty = true;
  }

  /** remove dirt in radius; amount = bytes per texel at center. returns bytes removed */
  clean(x: number, z: number, rad: number, amount: number, limit: number) {
    let removed = 0;
    this.touched = 0;
    const i0 = Math.max(0, Math.floor((x - rad) * DPU)), i1 = Math.min(DW - 1, Math.ceil((x + rad) * DPU));
    const j0 = Math.max(0, Math.floor((z - rad) * DPU)), j1 = Math.min(DH - 1, Math.ceil((z + rad) * DPU));
    const r2 = rad * rad;
    const inner = rad * 0.65;
    for (let j = j0; j <= j1; j++) {
      const dz = (j + 0.5) / DPU - z;
      for (let i = i0; i <= i1; i++) {
        const idx = j * DW + i;
        const cur = this.data[idx];
        if (!cur) continue;
        const dx = (i + 0.5) / DPU - x;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const f = d < inner ? 1 : 1 - (d - inner) / (rad - inner) * 0.75;
        const take = Math.min(cur, Math.ceil(amount * f));
        this.data[idx] = cur - take;
        const rid = this.room[idx];
        this.sum[rid] -= take;
        this.touched |= 1 << rid;
        removed += take;
        if (removed >= limit) { this.dirty = true; return removed; }
      }
    }
    if (removed) this.dirty = true;
    return removed;
  }

  wipeRoom(rid: number) {
    const d = this.data, rm = this.room;
    for (let k = 0; k < d.length; k++) if (rm[k] === rid && d[k]) d[k] = 0;
    this.sum[rid] = 0;
    this.dirty = true;
  }

  cleanliness(rid: number) {
    const t = this.total[rid];
    if (t <= 1) return 1;
    return Math.max(0, 1 - this.sum[rid] / t);
  }

  overall() {
    let s = 0, t = 0;
    for (let i = 0; i < ROOMS.length; i++) if (this.counted[i]) { s += this.sum[i]; t += this.total[i]; }
    return t > 0 ? 1 - s / t : 1;
  }

  totalUnits() {
    let t = 0;
    for (let i = 0; i < ROOMS.length; i++) if (this.counted[i]) t += this.sum[i];
    return t / UNIT;
  }

  upload() {
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }
}
