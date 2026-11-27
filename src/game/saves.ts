/**
 * Save/load storage for runs in progress. Everything lives in localStorage:
 *  - an index of save metadata (small, read to draw the menus)
 *  - one entry per save holding the full run snapshot
 * There is one rolling autosave slot plus a handful of manual slots.
 */
import type { UpKey } from './constants';

export const AUTO_ID = 'auto';
export const MAX_MANUAL = 5;
const VERSION = 1;
const INDEX_KEY = 'cleansweep_saves_v1';
const DATA_PREFIX = 'cleansweep_save_v1_';

export interface SaveMeta {
  id: string;
  name: string;
  auto: boolean;
  date: number;
  /** In-game seconds since midnight. */
  time: number;
  score: number;
  coins: number;
  roomsCleared: number;
  overall: number;
}

export interface GhostSnap {
  room: number;
  steps: { x: number; z: number; a: number; left: boolean; s: number }[];
  idx: number;
  timer: number;
  x: number;
  z: number;
  fade: number;
}

/** Full snapshot of a run, produced by Game.serialize() and consumed by Game.restore(). */
export interface RunSnapshot {
  v: number;
  time: number;
  score: number;
  coins: number;
  coinsEarned: number;
  coinFrac: number;
  battery: number;
  bin: number;
  binBase: number;
  up: Record<UpKey, number>;
  mult: number;
  comboTime: number;
  comboTimer: number;
  cleared: boolean[];
  clearedOnce: boolean[];
  clears: number;
  docked: boolean;
  warned30: boolean;
  warned12: boolean;
  binWarned: boolean;
  ghost: GhostSnap | null;
  nextGhost: number;
  hourAnnounced: number;
  px: number;
  pz: number;
  yaw: number;
  coinSpots: [number, number][];
  messTidy: boolean[];
  tidyQueue: number[];
  dirtTotal: number[];
  /** Rooms visited (older saves: none). */
  explored?: boolean[];
  /** Night index the whole-manor bonus was last paid in (older saves: missing). */
  manorBonusNight?: number;
  /** Secret doors found (older saves: none). */
  secrets?: boolean[];
  /** Dirt texture bytes, zero-run-length encoded then base64. */
  dirt: string;
  dirtLen: number;
}

export interface SaveFile { meta: SaveMeta; run: RunSnapshot }

// ------------------------------------------------------------ dirt encoding
// The dirt map is mostly zeros (and more so the cleaner the manor gets), so we store
// alternating [zero-run][literal-run][literal bytes...] with varint lengths.

function pushVarint(out: number[], n: number) {
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(n);
}

export function encodeBytes(data: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  const n = data.length;
  while (i < n) {
    let z = i;
    while (z < n && data[z] === 0) z++;
    pushVarint(out, z - i);
    // literal run ends at a stretch of >= 3 zeros (or the end)
    let l = z;
    while (l < n && !(data[l] === 0 && data[l + 1] === 0 && data[l + 2] === 0)) l++;
    pushVarint(out, l - z);
    for (let k = z; k < l; k++) out.push(data[k]);
    i = l;
  }
  let s = '';
  const CH = 0x8000;
  for (let k = 0; k < out.length; k += CH) s += String.fromCharCode.apply(null, out.slice(k, k + CH));
  return btoa(s);
}

export function decodeBytes(b64: string, len: number): Uint8Array {
  const bin = atob(b64);
  const res = new Uint8Array(len);
  let p = 0, o = 0;
  const varint = () => {
    let v = 0, shift = 0, b = 0;
    do { b = bin.charCodeAt(p++); v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return v;
  };
  while (p < bin.length && o < len) {
    o += varint();
    const lit = varint();
    for (let k = 0; k < lit && o < len; k++) res[o++] = bin.charCodeAt(p++);
  }
  return res;
}

// ------------------------------------------------------------ storage
export function listSaves(): SaveMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as SaveMeta[]) : [];
    if (!Array.isArray(arr)) return [];
    // drop index entries whose data has gone missing
    return arr.filter((m) => m && typeof m.id === 'string' && localStorage.getItem(DATA_PREFIX + m.id) !== null)
      .sort((a, b) => (a.auto === b.auto ? b.date - a.date : a.auto ? -1 : 1));
  } catch {
    return [];
  }
}

function writeIndex(list: SaveMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function getAutosave(): SaveMeta | null {
  return listSaves().find((m) => m.id === AUTO_ID) ?? null;
}

export function manualCount() {
  return listSaves().filter((m) => !m.auto).length;
}

export function loadSave(id: string): SaveFile | null {
  try {
    const raw = localStorage.getItem(DATA_PREFIX + id);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunSnapshot;
    if (!run || run.v !== VERSION) return null;
    const meta = listSaves().find((m) => m.id === id);
    if (!meta) return null;
    return { meta, run };
  } catch {
    return null;
  }
}

/**
 * Write a save. Pass id to overwrite an existing slot, AUTO_ID for the autosave, or
 * undefined to create a new manual slot. Returns the saved meta, or null on failure
 * (e.g. storage full or unavailable).
 */
export function writeSave(run: RunSnapshot, meta: Omit<SaveMeta, 'id' | 'name' | 'auto' | 'date'>, id?: string, name?: string): SaveMeta | null {
  try {
    const list = listSaves();
    const auto = id === AUTO_ID;
    const existing = id ? list.find((m) => m.id === id) : undefined;
    if (!id) {
      if (list.filter((m) => !m.auto).length >= MAX_MANUAL) return null;
      id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    }
    const full: SaveMeta = {
      ...meta,
      id,
      auto,
      name: auto ? 'Autosave' : (name?.trim() || existing?.name || `Save ${list.filter((m) => !m.auto).length + 1}`).slice(0, 24),
      date: Date.now(),
    };
    localStorage.setItem(DATA_PREFIX + id, JSON.stringify(run));
    writeIndex([...list.filter((m) => m.id !== id), full]);
    return full;
  } catch {
    return null;
  }
}

export function deleteSave(id: string) {
  try {
    localStorage.removeItem(DATA_PREFIX + id);
    writeIndex(listSaves().filter((m) => m.id !== id));
  } catch { /* ignore */ }
}

export function deleteAllSaves() {
  try {
    for (const m of listSaves()) localStorage.removeItem(DATA_PREFIX + m.id);
    localStorage.removeItem(INDEX_KEY);
  } catch { /* ignore */ }
}

export const SAVE_VERSION = VERSION;
