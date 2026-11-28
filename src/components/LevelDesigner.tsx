import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Engine } from '../../engine/src';
import {
  COLS, ROWS, TILE, WORLD_W, WORLD_H, setCustomLevel,
  FloorStyle, Facing, FurnDef,
} from '../game/constants';
import { LevelDef, levelFromMap, SecretDoor } from '../game/levels';
import { LEVELS } from '../game/levels';
import { buildGrid, buildWorld, enableShadows, World } from '../game/world';
import { DirtMap } from '../game/dirt';
import { Icon, IconName } from './ui';

// ------------------------------------------------------------------ catalogues
const P2 = Math.PI / 2;
const PI = Math.PI;

interface PaletteItem { t: string; icon: string; label: string }
const FURNITURE_PALETTE: PaletteItem[] = [
  { t: 'table', icon: '🍽️', label: 'Table' },
  { t: 'roundtable', icon: '⭕', label: 'Round Table' },
  { t: 'chair', icon: '🪑', label: 'Chair' },
  { t: 'sofa', icon: '🛋️', label: 'Sofa' },
  { t: 'armchair', icon: '🪑', label: 'Armchair' },
  { t: 'shelf', icon: '📚', label: 'Shelf' },
  { t: 'counter', icon: '🧱', label: 'Counter' },
  { t: 'stove', icon: '🍳', label: 'Stove' },
  { t: 'island', icon: '🏝️', label: 'Island' },
  { t: 'fridge', icon: '🧊', label: 'Fridge' },
  { t: 'piano', icon: '🎹', label: 'Piano' },
  { t: 'pillar', icon: '🏛️', label: 'Pillar' },
  { t: 'plant', icon: '🪴', label: 'Plant' },
  { t: 'statue', icon: '🗿', label: 'Statue' },
  { t: 'clock', icon: '🕰️', label: 'Clock' },
  { t: 'fireplace', icon: '🔥', label: 'Fireplace' },
  { t: 'desk', icon: '🖥️', label: 'Desk' },
  { t: 'globe', icon: '🌍', label: 'Globe' },
  { t: 'fountain', icon: '⛲', label: 'Fountain' },
  { t: 'books', icon: '📖', label: 'Books' },
  { t: 'vase', icon: '🏺', label: 'Vase' },
  { t: 'pots', icon: '🍲', label: 'Pots' },
  { t: 'frame', icon: '🖼️', label: 'Frame' },
  { t: 'crate', icon: '📦', label: 'Crate' },
  { t: 'barrel', icon: '🛢️', label: 'Barrel' },
  { t: 'machine', icon: '⚙️', label: 'Machine' },
  { t: 'bed', icon: '🛏️', label: 'Bed' },
];

/** Default footprint [w,d] (local, before facing rotation) for picker + 2D marker sizing. */
const FURN_SIZE: Record<string, [number, number]> = {
  table: [2.4, 1.4], roundtable: [1.7, 1.7], chair: [0.95, 0.95],
  sofa: [3, 1.3], armchair: [1.8, 1.7], shelf: [2, 0.8], counter: [2, 1], stove: [1.5, 1.3],
  island: [2.4, 1.5], fridge: [1.3, 1.3], piano: [2.4, 1.2], pillar: [1, 1], plant: [1, 1],
  statue: [1.2, 1.2], clock: [1.2, 0.8], fireplace: [3, 1.2], desk: [2.4, 1.3], globe: [1, 1],
  fountain: [2, 2], books: [1.6, 1], vase: [0.8, 0.8], pots: [1.2, 1.2], frame: [2.4, 0.4],
  crate: [1.4, 1.4], barrel: [1.2, 1.2], machine: [2, 2], bed: [3, 2.2],
};
/**
 * Wireframe spec per furniture type: local w/h/d (matching the rendered mesh), center y-offset, and
 * whether the shape is round (use a cylinder wireframe instead of a box).
 * Derived from the actual geometry built in world.ts so the wireframe hugs the real silhouette.
 */
const FURN_WIRE: Record<string, { w: number; h: number; d: number; y: number; round?: boolean }> = {
  table: { w: 2.4, h: 1.6, d: 1.4, y: 0.8 },
  roundtable: { w: 1.7, h: 1.74, d: 1.7, y: 0.87, round: true },
  chair: { w: 0.95, h: 1.1, d: 0.95, y: 0.55 },
  sofa: { w: 3, h: 1.1, d: 1.3, y: 0.55 },
  armchair: { w: 1.8, h: 1.2, d: 1.7, y: 0.6 },
  shelf: { w: 2, h: 2.2, d: 0.8, y: 1.1 },
  counter: { w: 2, h: 1.65, d: 1, y: 0.825 },
  stove: { w: 1.5, h: 1.65, d: 1.3, y: 0.825 },
  island: { w: 2.4, h: 1.65, d: 1.5, y: 0.825 },
  fridge: { w: 1.3, h: 3.8, d: 1.3, y: 1.9 },
  piano: { w: 3.4, h: 1.7, d: 2.6, y: 0.85 },
  pillar: { w: 1.4, h: 4.5, d: 1.4, y: 2.25 },
  plant: { w: 1, h: 2.3, d: 1, y: 1.15 },
  statue: { w: 1.35, h: 2.65, d: 1.35, y: 1.3 },
  clock: { w: 1.2, h: 4.15, d: 0.8, y: 2.07 },
  fireplace: { w: 3, h: 3.2, d: 1.2, y: 1.6 },
  desk: { w: 2.4, h: 1.65, d: 1.3, y: 0.825 },
  globe: { w: 1, h: 2.4, d: 1, y: 1.2 },
  fountain: { w: 2, h: 1.8, d: 2, y: 0.9, round: true },
  books: { w: 1.6, h: 0.5, d: 1.0, y: 0.25 },
  vase: { w: 0.9, h: 0.9, d: 0.9, y: 0.45 },
  pots: { w: 1.4, h: 0.6, d: 1.2, y: 0.3 },
  frame: { w: 1.7, h: 0.15, d: 1.3, y: 0.075 }, // fallen picture, flat on floor
  crate: { w: 1.4, h: 1.8, d: 1.4, y: 0.9 },
  barrel: { w: 1.2, h: 1.5, d: 1.2, y: 0.75, round: true },
  machine: { w: 2, h: 2.6, d: 2, y: 1.3 },
  bed: { w: 3, h: 1.2, d: 2.2, y: 0.6 },
};
const FURN_H: Record<string, number> = {
  table: 1.2, roundtable: 1.2, chair: 1.1, sofa: 1.1, armchair: 1.2, shelf: 2.2,
  counter: 1.5, stove: 1.6, island: 1.5, fridge: 2.2, piano: 1.3, pillar: 3.5, plant: 1.6,
  statue: 2.2, clock: 2.8, fireplace: 2.6, desk: 1.4, globe: 1.4, fountain: 1.8, books: 0.5,
  vase: 0.9, pots: 0.7, frame: 2.4, crate: 1.4, barrel: 1.5, machine: 2.6, bed: 1.2,
};

const FLOOR_STYLES: { key: FloorStyle; label: string; color: string }[] = [
  { key: 'marble', label: 'Marble', color: '#d8cfbd' },
  { key: 'checker', label: 'Checker', color: '#cfc8be' },
  { key: 'parquet', label: 'Parquet', color: '#b08a50' },
  { key: 'darkwood', label: 'Dark Wood', color: '#4a2e1c' },
  { key: 'lightwood', label: 'Light Wood', color: '#a8784a' },
  { key: 'terracotta', label: 'Terracotta', color: '#a5583a' },
  { key: 'carpetV', label: 'Carpet (V)', color: '#6b4a8a' },
  { key: 'carpetH', label: 'Carpet (H)', color: '#8a6b4a' },
  { key: 'greencarpet', label: 'Green Carpet', color: '#2c4434' },
];
const FLOOR_COLOR: Record<string, string> = Object.fromEntries(FLOOR_STYLES.map((f) => [f.key, f.color]));

const RUG_COLORS = ['red', 'blue', 'green', 'gold'] as const;
const WALL_PAPERS = [
  { paper: 0x23304f, wainscot: 0x1c1712, label: 'Manor Blue' },
  { paper: 0x2e3436, wainscot: 0x1c1f22, label: 'Industrial Slate' },
  { paper: 0x3d3a2e, wainscot: 0x2a2418, label: 'Warehouse Tan' },
  { paper: 0x1e3a5f, wainscot: 0x0f1e33, label: 'Cruise Navy' },
  { paper: 0x3a2330, wainscot: 0x1f1218, label: 'Burgundy' },
  { paper: 0x223322, wainscot: 0x121a12, label: 'Forest' },
];

const ROT_ORDER = [0, P2, PI, -P2];
/** Nearest cardinal wall direction (0, π/2, π, -π/2) for a given yaw. */
const nearestCardinal = (ry: number) => {
  const norm = ((ry % (2 * PI)) + 2 * PI) % (2 * PI); // 0..2π
  const idx = Math.round(norm / P2) % 4;
  return ROT_ORDER[idx];
};

/** Per-object special options, keyed by furniture type. Each entry maps a `v` value to a label. */
const OBJECT_OPTIONS: Record<string, { label: string; v: number }[]> = {
  piano: [{ label: 'Lid Open', v: 1 }],
  fridge: [{ label: 'Doors Open', v: 1 }],
  stove: [{ label: 'Burners On', v: 1 }],
  vase: [{ label: 'Broken', v: 1 }],
  sofa: [{ label: 'Wicker', v: 1 }],
  armchair: [{ label: 'Green', v: 1 }],
  counter: [{ label: 'Wood Top', v: 1 }],
  island: [{ label: 'Wood Top', v: 1 }],
};
/**
 * Furniture types small/light enough to be knocked over (rendered lying on its side / floor).
 * Large or fixed objects (tables, pianos, shelves, appliances, beds, etc.) are excluded.
 */
const TIPPABLE = new Set([
  'chair', 'armchair', 'plant', 'vase', 'pots', 'books', 'globe', 'barrel', 'crate', 'clock', 'statue',
]);
const RAD_TO_DEG = 180 / PI;
const DEG_TO_RAD = PI / 180;
const ROT_STEP = 15 * DEG_TO_RAD; // 15° per R-key press

// ------------------------------------------------------------------ editor types
type ObjKind = 'furniture' | 'rug' | 'light' | 'painting' | 'window' | 'dock' | 'secret';
interface Sel { kind: ObjKind; id: string }

interface ERoom { key: string; name: string; floor: FloorStyle; dust: number; trails: number; patches: number; secret?: boolean }
interface EFurn extends FurnDef { id: string }
interface ERug { id: string; x0: number; z0: number; x1: number; z1: number; color: string }
interface ELight { id: string; x: number; z: number; y: number; int: number; dist: number; chands: [number, number, number][]; flaky?: number }
interface EPainting { id: string; x: number; z: number; ry: number; w: number; h: number; idx: number }
interface EWindow { id: string; x: number; z: number; ry: number }
interface ESecret { id: string; c: number; r: number; roomKey: string; side: -1 | 1 }

interface EditorLevel {
  key: string; name: string; blurb: string;
  map: string[];
  rooms: ERoom[];
  secrets: ESecret[];
  furniture: EFurn[];
  rugs: ERug[];
  dock: { x: number; z: number };
  lights: ELight[];
  paintings: EPainting[];
  windows: EWindow[];
  paper: number; wainscot: number;
}

// ------------------------------------------------------------------ helpers
let _uid = 1;
const uid = () => `o${_uid++}`;

const facingRot = (f?: Facing) => (f === 'n' ? PI : f === 'e' ? P2 : f === 'w' ? -P2 : 0);
/** Full rotation for an editor furniture piece: free ry when set, otherwise cardinal facing. */
const editorRot = (f: { ry?: number; f?: Facing }) => f.ry ?? facingRot(f.f);

/** Local (un-rotated) footprint [w,d] for a furniture type. */
function localFootprint(t: string, w?: number, d?: number): [number, number] {
  const base = FURN_SIZE[t] ?? [1.5, 1.5];
  return [w ?? base[0], d ?? base[1]];
}

/** Axis-aligned footprint in world space for hit-testing and 2D AABB drawing. */
function footprintOf(t: string, ry?: number, w?: number, d?: number): [number, number] {
  const [lw, ld] = localFootprint(t, w, d);
  const a = ry ?? 0;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return [lw * c + ld * s, lw * s + ld * c];
}

const blankMap = (): string[] => Array.from({ length: ROWS }, () => '#'.repeat(COLS));

function blankLevel(): EditorLevel {
  const room: ERoom = { key: 'A', name: 'Room A', floor: 'checker', dust: 0.6, trails: 4, patches: 4 };
  return {
    key: 'custom', name: 'My Building', blurb: 'A brand new building, fresh for the roomba.',
    map: blankMap(),
    rooms: [room],
    secrets: [],
    furniture: [],
    rugs: [],
    dock: { x: Math.round(WORLD_W / 2), z: Math.round(WORLD_H) - 3 },
    lights: [{ id: uid(), x: Math.round(WORLD_W / 2), z: Math.round(WORLD_H / 2), y: 4, int: 40, dist: 26, chands: [], flaky: 1 }],
    paintings: [],
    windows: [],
    paper: WALL_PAPERS[0].paper,
    wainscot: WALL_PAPERS[0].wainscot,
  };
}

/** Build a map string array from any shipped LevelDef (synthesising one for rect-based levels). */
function mapFromLevel(level: LevelDef): string[] {
  if (level.map) return level.map.slice();
  const g: string[][] = Array.from({ length: ROWS }, () => Array.from('#'.repeat(COLS)));
  for (const r of level.rooms) {
    const [c0, r0, w, h] = r.rect;
    for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) if (g[y]?.[x]) g[y][x] = r.key;
  }
  for (const [c, r, , , key] of level.doors) if (g[r]?.[c]) g[r][c] = key.toLowerCase();
  return g.map((row) => row.join(''));
}

function levelToEditor(level: LevelDef): EditorLevel {
  const rooms: ERoom[] = level.rooms.map((r) => ({
    key: r.key, name: r.name, floor: r.floor, dust: r.dust, trails: r.trails, patches: r.patches, secret: r.secret,
  }));
  const secrets: ESecret[] = level.secretDoors.map(([c, r, roomKey, side]) => ({ id: uid(), c, r, roomKey, side }));
  // Legacy `tipchair` → regular `chair` with the fallen (out-of-place) flag set.
  const furniture: EFurn[] = level.furniture.map((f) => {
    if (f.t === 'tipchair') return { ...f, t: 'chair', id: uid(), ry: f.ry ?? facingRot(f.f), fallen: true };
    return { ...f, id: uid(), ry: f.ry ?? facingRot(f.f) };
  });
  const rugs: ERug[] = level.rugs.map(([x0, z0, x1, z1, color]) => ({ id: uid(), x0, z0, x1, z1, color }));
  const lights: ELight[] = level.lights.map((l) => ({ id: uid(), x: l.x, z: l.z, y: l.y, int: l.int, dist: l.dist, chands: l.chands.map((c) => [...c] as [number, number, number]), flaky: l.flaky ?? 1 }));
  const paintings: EPainting[] = level.paintings.map(([x, z, ry, w, h, idx]) => ({ id: uid(), x, z, ry, w, h, idx }));
  const windows: EWindow[] = level.windows.map(([x, z, ry]) => ({ id: uid(), x, z, ry }));
  const wp = WALL_PAPERS.find((w) => w.paper === level.walls.paper) ?? WALL_PAPERS[0];
  return {
    key: level.key + '_edit', name: level.name + ' (copy)', blurb: level.blurb,
    map: mapFromLevel(level), rooms, secrets, furniture, rugs,
    dock: { x: level.dock.x, z: level.dock.z }, lights, paintings, windows,
    paper: wp.paper, wainscot: wp.wainscot,
  };
}

function editorToLevelDef(e: EditorLevel): LevelDef {
  const roomKeys = new Set(e.rooms.map((r) => r.key));
  return levelFromMap({
    key: e.key || 'custom', name: e.name || 'Untitled', blurb: e.blurb || '',
    map: e.map,
    rooms: e.rooms.map((r) => ({ key: r.key, name: r.name, floor: r.floor, dust: r.dust, trails: r.trails, patches: r.patches, secret: r.secret })),
    secretDoors: e.secrets.filter((s) => roomKeys.has(s.roomKey)).map((s): SecretDoor => [s.c, s.r, s.roomKey, s.side]),
    furniture: e.furniture.map(({ id, f, ry, ...rest }) => ({ ...rest, ry: ry ?? facingRot(f) })),
    rugs: e.rugs.map((r) => [r.x0, r.z0, r.x1, r.z1, r.color]),
    dock: { x: e.dock.x, z: e.dock.z },
    lights: e.lights.map(({ id, ...l }) => ({ x: l.x, z: l.z, y: l.y, int: l.int, dist: l.dist, chands: l.chands, flaky: l.flaky })),
    paintings: e.paintings.map((p) => [p.x, p.z, p.ry, p.w, p.h, p.idx]),
    windows: e.windows.map((w) => [w.x, w.z, w.ry]),
    walls: { paper: e.paper, wainscot: e.wainscot },
  });
}

/** Generate paste-able TS source for the level. */
function exportTS(e: EditorLevel): string {
  const def = editorToLevelDef(e);
  const mapArr = def.map ?? [];
  const m = '    ' + mapArr.map((r) => `'${r}',`).join('\n    ');
  const rooms = '    ' + def.rooms.map((r) =>
    `{ key: '${r.key}', name: '${r.name.replace(/'/g, "\\'")}', floor: '${r.floor}', dust: ${r.dust}, trails: ${r.trails}, patches: ${r.patches}${r.secret ? ', secret: true' : ''} },`).join('\n    ');
  const sd = def.secretDoors.map((s) => `[${s[0]}, ${s[1]}, '${s[2]}', ${s[3]}],`).join(' ');
  const furn = def.furniture.map((f) => {
    const p: string[] = [`t: '${f.t}'`, `x: ${f.x}`, `z: ${f.z}`];
    if (f.w != null) p.push(`w: ${f.w}`);
    if (f.d != null) p.push(`d: ${f.d}`);
    if (f.ry != null) p.push(`ry: ${f.ry}`);
    if (f.h != null) p.push(`h: ${f.h}`);
    if (f.v != null) p.push(`v: ${f.v}`);
    if (f.fallen) p.push(`fallen: true`);
    return `    { ${p.join(', ')} },`;
  }).join('\n');
  const rugs = def.rugs.map((r) => `    [${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}, '${r[4]}'],`).join('\n');
  const lights = def.lights.map((l) => {
    const ch = l.chands.length ? ` [${l.chands.map((c) => `[${c[0]}, ${c[1]}, ${c[2]}]`).join(', ')}]` : ' []';
    return `    { x: ${l.x}, y: ${l.y}, z: ${l.z}, int: ${l.int}, dist: ${l.dist}, chands:${ch}, flaky: ${l.flaky ?? 1} },`;
  }).join('\n');
  const paints = def.paintings.map((p) => `    [${p[0]}, ${p[1]}, ${p[2]}, ${p[3]}, ${p[4]}, ${p[5]}],`).join('\n');
  const wins = def.windows.map((w) => `    [${w[0]}, ${w[1]}, ${w[2]}],`).join('\n');
  return `const ${def.key.toUpperCase()}: LevelDef = fromMap({
  key: '${def.key}',
  name: '${def.name.replace(/'/g, "\\'")}',
  blurb: '${def.blurb.replace(/'/g, "\\'")}',
  map: [
${m}
  ],
  rooms: [
${rooms}
  ],
  secretDoors: [${sd ? ' ' + sd : ''}],
  furniture: [
${furn}
  ],
  rugs: [
${rugs}
  ],
  dock: { x: ${def.dock.x}, z: ${def.dock.z} },
  lights: [
${lights}
  ],
  paintings: [
${paints}
  ],
  windows: [
${wins}
  ],
  walls: { paper: ${def.walls.paper}, wainscot: ${def.walls.wainscot} },
});
`;
}

// ------------------------------------------------------------------ 2D canvas
const CELL = 16;
const GW = COLS * CELL, GH = ROWS * CELL;

interface Interaction {
  mode: 'none' | 'paint' | 'drag';
  // paint working copy
  map?: string[];
  // object drag
  sel?: Sel;
  x?: number; z?: number;
}

export default function LevelDesigner({ onExit, onPlay, initialDef }: { onExit: () => void; onPlay: (def: LevelDef) => void; initialDef?: LevelDef | null }) {
  const [level, setLevelRaw] = useState<EditorLevel>(() => levelToEditor(initialDef ?? LEVELS[0]));
  const [tab, setTab] = useState<'furniture' | 'decor' | 'rooms'>('furniture');
  const [tool, setTool] = useState<'select' | 'room' | 'wall' | 'door' | 'secret' | 'eraser'>('select');
  const [roomKey, setRoomKey] = useState('A');
  const [floorStyle, setFloorStyle] = useState<FloorStyle>('checker');
  const [sel, setSel] = useState<Sel | null>(null);
  const [armed, setArmed] = useState<{ kind: ObjKind; t?: string; color?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [propsCollapsed, setPropsCollapsed] = useState(false);
  const [showTip, setShowTip] = useState(true);
  const [query, setQuery] = useState('');
  const [view2d, setView2d] = useState({ zoom: 1, ox: 0, oz: 0 });
  const view2dRef = useRef(view2d);
  view2dRef.current = view2d;

  const levelRef = useRef(level);
  levelRef.current = level;
  const selRef = useRef<Sel | null>(sel);
  selRef.current = sel;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const roomKeyRef = useRef(roomKey);
  roomKeyRef.current = roomKey;
  const floorStyleRef = useRef(floorStyle);
  floorStyleRef.current = floorStyle;
  const armedRef = useRef(armed);
  armedRef.current = armed;

  // ---- undo / redo
  const undoStack = useRef<EditorLevel[]>([]);
  const redoStack = useRef<EditorLevel[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  /** Snapshot the current level into the undo stack before applying a change. */
  const pushUndo = useCallback(() => {
    undoStack.current.push(JSON.parse(JSON.stringify(levelRef.current)) as EditorLevel);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(false);
  }, []);
  /** setLevel wrapper that records undo history (unless `noHistory` is set). */
  const setLevel = useCallback((updater: EditorLevel | ((prev: EditorLevel) => EditorLevel), noHistory = false) => {
    if (!noHistory) pushUndo();
    setLevelRaw(updater);
  }, [pushUndo]);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(JSON.parse(JSON.stringify(levelRef.current)) as EditorLevel);
    setLevelRaw(prev);
    setSel(null); selRef.current = null;
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(JSON.parse(JSON.stringify(levelRef.current)) as EditorLevel);
    setLevelRaw(next);
    setSel(null); selRef.current = null;
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  // ---- 3D refs
  const mount3d = useRef<HTMLDivElement>(null);
  const grid2d = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const worldRef = useRef<World | null>(null);
  const pickerRef = useRef<THREE.Group>(new THREE.Group());
  const ghostRef = useRef<THREE.LineSegments>(new THREE.LineSegments());
  const highlightRef = useRef<THREE.LineSegments>(new THREE.LineSegments());
  const orbitRef = useRef({ theta: 0.6, phi: 1.15, radius: 62, tx: WORLD_W / 2, ty: 0, tz: WORLD_H / 2 });
  const interactRef = useRef<Interaction>({ mode: 'none' });
  const rebuildTimer = useRef<number>(0);
  const rebuildNeeded = useRef(false);
  const dragRef = useRef<{ kind: ObjKind; id: string; offX: number; offZ: number } | null>(null);

  // ============================================================ 3D setup
  useEffect(() => {
    const mount = mount3d.current!;
    const engine = new Engine(mount, { update: frame, fov: 50, near: 0.1, far: 400, background: 0x0a0a12, shadows: true });
    engineRef.current = engine;
    engine.scene.add(pickerRef.current);
    // Suppress the browser context menu so right-drag can pan without interruption.
    // Attach in capture phase to both the mount div AND the renderer's canvas (a child of mount)
    // so the menu is blocked no matter which element receives the event.
    const onCtx = (e: Event) => e.preventDefault();
    mount.addEventListener('contextmenu', onCtx, true);
    const canvas = engine.renderer.domElement;
    canvas.addEventListener('contextmenu', onCtx, true);
    // ghost wireframe box (drag preview)
    const ghost = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x66e0ff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    ghost.renderOrder = 30;
    ghost.visible = false;
    ghostRef.current = ghost;
    engine.scene.add(ghost);
    // selection highlight wireframe (follows the selected object's shape)
    const highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xffcc40, depthTest: false, transparent: true, opacity: 0.95, linewidth: 2 }),
    );
    highlight.renderOrder = 31;
    highlight.visible = false;
    highlightRef.current = highlight;
    engine.scene.add(highlight);
    engine.start();
    rebuildWorld();
    return () => {
      mount.removeEventListener('contextmenu', onCtx, true);
      canvas.removeEventListener('contextmenu', onCtx, true);
      engine.dispose();
      disposeWorld();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function frame(_dt: number, t: number) {
    const o = orbitRef.current;
    const cam = engineRef.current!.camera;
    const cp = Math.cos(o.phi), sp = Math.sin(o.phi);
    cam.position.set(
      o.tx + o.radius * cp * Math.sin(o.theta),
      o.ty + o.radius * sp,
      o.tz + o.radius * cp * Math.cos(o.theta),
    );
    cam.lookAt(o.tx, o.ty, o.tz);
    const w = worldRef.current;
    if (w) w.animate(t, 0);
  }

  function disposeWorld() {
    const w = worldRef.current;
    if (!w) return;
    const keep = new Set<THREE.Object3D>([pickerRef.current, ghostRef.current, highlightRef.current]);
    const mats = new Set<THREE.Material>();
    w.scene.traverse((o) => {
      if (keep.has(o)) return;
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    });
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
    pickerRef.current.clear();
    engineRef.current!.scene = new THREE.Scene(); // placeholder; rebuild swaps it back
    worldRef.current = null;
  }

  /** Update the selection highlight wireframe to match the selected object's actual rendered shape. */
  function updateHighlight() {
    const hl = highlightRef.current;
    const s = selRef.current;
    if (!s) { hl.visible = false; return; }
    const e = levelRef.current;
    // Returns the geometry + center position for the wireframe of the selected object.
    // For furniture we look up per-type specs (FURN_WIRE) that match the real mesh silhouette,
    // including round shapes (cylinder wireframes) and wall-mounted/flat objects.
    let geo: THREE.BufferGeometry;
    let x = 0, y = 0, z = 0, ry = 0;
    if (s.kind === 'furniture') {
      const f = e.furniture.find((o) => o.id === s.id);
      if (!f) { hl.visible = false; return; }
      const spec = FURN_WIRE[f.t] ?? { w: f.w ?? 1.5, h: f.h ?? 1.5, d: f.d ?? 1.5, y: (f.h ?? 1.5) / 2 };
      const w = f.w ?? spec.w, d = f.d ?? spec.d, h = f.h ?? spec.h;
      ry = editorRot(f);
      if (f.fallen) {
        // out of place: height & depth swap; the box center shifts backward (along yawed -z) by spec.y
        // and lifts to d/2 so it rests on the floor — matching the world.ts frame (Rx(-π/2) + d/2 lift).
        geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(0.1, w), Math.max(0.1, d), Math.max(0.1, h)));
        x = f.x - spec.y * Math.sin(ry); y = d / 2; z = f.z - spec.y * Math.cos(ry);
      } else if (spec.round) {
        const r = Math.max(0.1, w / 2);
        geo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(r, r, Math.max(0.1, h), 16, 1, false));
        x = f.x; y = spec.y; z = f.z;
      } else {
        geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(0.1, w), Math.max(0.1, h), Math.max(0.1, d)));
        x = f.x; y = spec.y; z = f.z;
      }
    } else if (s.kind === 'rug') {
      const r = e.rugs.find((o) => o.id === s.id);
      if (!r) { hl.visible = false; return; }
      geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(0.1, Math.abs(r.x1 - r.x0)), 0.15, Math.max(0.1, Math.abs(r.z1 - r.z0))));
      x = (r.x0 + r.x1) / 2; y = 0.075; z = (r.z0 + r.z1) / 2; ry = 0;
    } else if (s.kind === 'light') {
      const l = e.lights.find((o) => o.id === s.id);
      if (!l) { hl.visible = false; return; }
      geo = new THREE.EdgesGeometry(new THREE.SphereGeometry(0.8, 12, 8));
      x = l.x; y = l.y; z = l.z; ry = 0;
    } else if (s.kind === 'painting') {
      // wall-mounted: thin frame at y=2.6
      const p = e.paintings.find((o) => o.id === s.id);
      if (!p) { hl.visible = false; return; }
      geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(0.3, p.w + 0.24), Math.max(0.3, p.h + 0.24), 0.1));
      x = p.x; y = 2.6; z = p.z; ry = p.ry;
    } else if (s.kind === 'window') {
      // wall-mounted: thin frame spanning y=1.0–3.7
      const wn = e.windows.find((o) => o.id === s.id);
      if (!wn) { hl.visible = false; return; }
      geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, 2.8, 0.15));
      x = wn.x; y = 2.35; z = wn.z; ry = wn.ry;
    } else if (s.kind === 'dock') {
      geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 1, 2));
      x = e.dock.x; y = 0.5; z = e.dock.z; ry = 0;
    } else if (s.kind === 'secret') {
      const sc = e.secrets.find((o) => o.id === s.id);
      if (!sc) { hl.visible = false; return; }
      geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, 4.5, TILE));
      x = (sc.c + 0.5) * TILE; y = 2.25; z = (sc.r + 0.5) * TILE; ry = 0;
    } else {
      hl.visible = false; return;
    }
    hl.geometry.dispose();
    hl.geometry = geo;
    hl.position.set(x, y, z);
    hl.rotation.y = ry;
    hl.visible = true;
  }

  function rebuildWorld() {
    const engine = engineRef.current;
    if (!engine) return;
    let def: LevelDef;
    try {
      def = editorToLevelDef(levelRef.current);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      return;
    }
    disposeWorld();
    try {
      setCustomLevel(def);
      const grid = buildGrid();
      const dirt = new DirtMap(grid);
      const world = buildWorld(dirt.tex, grid, dirt.wetTex);
      dirt.buildMask(world.boxes);
      world.roomba.group.visible = false;
      world.introGroup.visible = false;
      world.cut.uCut.value = 0;
      world.ambient.intensity = 1.0;
      world.hemi.intensity = 1.1;
      world.secrets.forEach((sd) => { sd.group.visible = true; sd.roof.visible = false; }); // reveal secret rooms, keep fake-wall marker
      // shadows: floor receives, furniture + walls cast, point lights + moon light cast
      enableShadows(world, engine.renderer);
      // move pickers + ghost into the new scene
      world.scene.add(pickerRef.current, ghostRef.current, highlightRef.current);
      engine.scene = world.scene;
      worldRef.current = world;
      rebuildPickers();
      updateHighlight();
      engine.renderer.compile(world.scene, engine.camera);
    } catch (e) {
      setError('Preview build failed: ' + String((e as Error).message ?? e));
    }
  }

  function scheduleRebuild() {
    rebuildNeeded.current = true;
    if (interactRef.current.mode !== 'none') return; // defer until interaction ends
    clearTimeout(rebuildTimer.current);
    rebuildTimer.current = window.setTimeout(() => { rebuildNeeded.current = false; rebuildWorld(); }, 180);
  }

  // ============================================================ pickers
  function rebuildPickers() {
    const grp = pickerRef.current;
    for (const ch of grp.children) {
      const m = ch as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material; if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    }
    grp.clear();
    const add = (mesh: THREE.Mesh, kind: ObjKind, id: string) => {
      mesh.userData = { kind, id };
      mesh.visible = false; // invisible but raycastable
      grp.add(mesh);
    };
    const e = levelRef.current;
    for (const f of e.furniture) {
      const spec = FURN_WIRE[f.t] ?? { w: f.w ?? 1.5, h: f.h ?? 1.5, d: f.d ?? 1.5, y: (f.h ?? 1.5) / 2 };
      const [w, d] = localFootprint(f.t, f.w, f.d);
      const h = f.h ?? spec.h;
      const ry = editorRot(f);
      let m: THREE.Mesh;
      if (f.fallen) {
        // fallen: height↔depth swap, center shifts backward by spec.y along the yawed -z axis
        m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), new THREE.MeshBasicMaterial());
        m.position.set(f.x - spec.y * Math.sin(ry), d / 2, f.z - spec.y * Math.cos(ry));
      } else {
        m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
        m.position.set(f.x, spec.y, f.z);
      }
      m.rotation.y = ry;
      add(m, 'furniture', f.id);
    }
    for (const r of e.rugs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(r.x1 - r.x0), 0.1, Math.abs(r.z1 - r.z0)), new THREE.MeshBasicMaterial());
      m.position.set((r.x0 + r.x1) / 2, 0.05, (r.z0 + r.z1) / 2);
      add(m, 'rug', r.id);
    }
    for (const l of e.lights) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), new THREE.MeshBasicMaterial());
      m.position.set(l.x, l.y, l.z);
      add(m, 'light', l.id);
    }
    for (const p of e.paintings) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(p.w + 0.24, 0.4), Math.max(p.h + 0.24, 0.4), 0.3), new THREE.MeshBasicMaterial());
      m.position.set(p.x, 2.6, p.z);
      m.rotation.y = p.ry;
      add(m, 'painting', p.id);
    }
    for (const w of e.windows) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.8, 0.3), new THREE.MeshBasicMaterial());
      m.position.set(w.x, 2.35, w.z);
      m.rotation.y = w.ry;
      add(m, 'window', w.id);
    }
    const dm = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial());
    dm.position.set(e.dock.x, 0.5, e.dock.z);
    add(dm, 'dock', 'dock');
    for (const s of e.secrets) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(TILE, 2, TILE), new THREE.MeshBasicMaterial());
      m.position.set((s.c + 0.5) * TILE, 1, (s.r + 0.5) * TILE);
      add(m, 'secret', s.id);
    }
  }

  // rebuild 3D when level changes (committed)
  useEffect(() => { scheduleRebuild(); draw2d(); }, [level]);
  useEffect(() => { rebuildPickers(); updateHighlight(); }, [level.furniture, level.rugs, level.lights, level.paintings, level.windows, level.dock]);
  useEffect(() => { draw2d(); updateHighlight(); }, [sel, tool, armed]);
  useEffect(() => { draw2d(); }, [view2d]);

  // ============================================================ 2D drawing
  const draw2d = useCallback(() => {
    const cv = grid2d.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, rect.width), ch = Math.max(1, rect.height);
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
    }
    // reset transform to device pixels, clear, then apply zoom + pan
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const v = view2dRef.current;
    g.save();
    g.translate(-v.ox, -v.oz);
    g.scale(v.zoom, v.zoom);
    const e = levelRef.current;
    const inter = interactRef.current;
    const cur = selRef.current;
    const map = inter.mode === 'paint' && inter.map ? inter.map : e.map;
    const roomByKey = new Map(e.rooms.map((r) => [r.key, r]));
    // tiles
    for (let r = 0; r < ROWS; r++) {
      const row = map[r] ?? '';
      for (let c = 0; c < COLS; c++) {
        const ch = row[c] ?? '#';
        const x = c * CELL, y = r * CELL;
        if (ch === '#') {
          g.fillStyle = '#15131a'; g.fillRect(x, y, CELL, CELL);
        } else {
          const up = ch.toUpperCase();
          const room = roomByKey.get(up);
          g.fillStyle = room ? FLOOR_COLOR[room.floor] : '#333';
          g.fillRect(x, y, CELL, CELL);
          if (ch !== up) { // doorway
            g.fillStyle = 'rgba(255,210,90,0.55)'; g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
          }
        }
      }
    }
    // secret door tiles
    for (const s of e.secrets) {
      g.fillStyle = 'rgba(120,90,255,0.85)';
      g.fillRect(s.c * CELL + 2, s.r * CELL + 2, CELL - 4, CELL - 4);
      g.strokeStyle = '#b9a0ff'; g.lineWidth = 1;
      g.strokeRect(s.c * CELL + 1.5, s.r * CELL + 1.5, CELL - 3, CELL - 3);
    }
    // grid lines
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { g.beginPath(); g.moveTo(c * CELL, 0); g.lineTo(c * CELL, GH); g.stroke(); }
    for (let r = 0; r <= ROWS; r++) { g.beginPath(); g.moveTo(0, r * CELL); g.lineTo(GW, r * CELL); g.stroke(); }
    // rugs
    for (const r of e.rugs) {
      const x0 = (r.x0 / TILE) * CELL, z0 = (r.z0 / TILE) * CELL, x1 = (r.x1 / TILE) * CELL, z1 = (r.z1 / TILE) * CELL;
      g.fillStyle = r.color === 'red' ? 'rgba(180,40,50,0.5)' : r.color === 'blue' ? 'rgba(50,70,150,0.5)' : r.color === 'green' ? 'rgba(60,130,80,0.5)' : 'rgba(180,140,50,0.5)';
      g.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
      if (cur?.kind === 'rug' && cur.id === r.id) { g.strokeStyle = '#66e0ff'; g.lineWidth = 2; g.strokeRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0)); }
    }
    // dock
    {
      const d = e.dock; const dx = (d.x / TILE) * CELL, dz = (d.z / TILE) * CELL;
      g.fillStyle = '#35ff9a'; g.fillRect(dx - 6, dz - 5, 12, 10);
      g.fillStyle = '#0a3a22'; g.font = '8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('⚡', dx, dz);
      if (cur?.kind === 'dock') { g.strokeStyle = '#66e0ff'; g.lineWidth = 2; g.strokeRect(dx - 7, dz - 6, 14, 12); }
    }
    // paintings / windows on walls
    for (const p of e.paintings) drawWallDecor(g, p.x, p.z, p.ry, '#e0b040', cur?.kind === 'painting' && cur.id === p.id);
    for (const w of e.windows) drawWallDecor(g, w.x, w.z, w.ry, '#6aa0ff', cur?.kind === 'window' && cur.id === w.id);
    // furniture
    for (const f of e.furniture) {
      const [lw, ld] = localFootprint(f.t, f.w, f.d);
      const cw = (lw / TILE) * CELL, cd = (ld / TILE) * CELL;
      const fx = (f.x / TILE) * CELL, fz = (f.z / TILE) * CELL;
      const a = editorRot(f);
      g.save();
      g.translate(fx, fz);
      g.rotate(-a);
      g.fillStyle = f.fallen ? 'rgba(80,40,40,0.92)' : 'rgba(40,46,60,0.9)';
      g.fillRect(-cw / 2, -cd / 2, cw, cd);
      g.strokeStyle = f.fallen ? 'rgba(255,120,120,0.7)' : 'rgba(180,200,255,0.5)'; g.lineWidth = 1;
      g.strokeRect(-cw / 2, -cd / 2, cw, cd);
      // facing arrow: local +z = "front"
      g.strokeStyle = '#ffd060'; g.lineWidth = 1.5; g.beginPath();
      g.moveTo(0, 0); g.lineTo(0, 5); g.stroke();
      // icon (counter-rotated so it's upright)
      g.rotate(a);
      g.fillStyle = '#fff'; g.font = '7px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const lab = FURNITURE_PALETTE.find((p) => p.t === f.t)?.icon ?? '?';
      g.fillText(lab, 0, 0);
      if (f.fallen) { // out-of-place marker: small "↰" above the icon
        g.fillStyle = '#ff9090'; g.font = '6px sans-serif';
        g.fillText('↰', 0, -5);
      }
      g.restore();
      // selection highlight (AABB)
      if (cur?.kind === 'furniture' && cur.id === f.id) {
        const [hw, hd] = footprintOf(f.t, a, f.w, f.d);
        const sw = (hw / TILE) * CELL, sd = (hd / TILE) * CELL;
        g.strokeStyle = '#66e0ff'; g.lineWidth = 2; g.strokeRect(fx - sw / 2 - 1, fz - sd / 2 - 1, sw + 2, sd + 2);
      }
    }
    // lights — drawn after furniture so they're always visible on top
    for (const l of e.lights) {
      const lx = (l.x / TILE) * CELL, lz = (l.z / TILE) * CELL;
      g.fillStyle = 'rgba(255,216,77,0.25)'; g.beginPath(); g.arc(lx, lz, 6, 0, PI * 2); g.fill();
      g.fillStyle = '#ffd84d'; g.beginPath(); g.arc(lx, lz, 3, 0, PI * 2); g.fill();
      g.strokeStyle = '#fff4a0'; g.lineWidth = 0.5; g.beginPath(); g.arc(lx, lz, 3, 0, PI * 2); g.stroke();
      if (cur?.kind === 'light' && cur.id === l.id) { g.strokeStyle = '#66e0ff'; g.lineWidth = 2; g.beginPath(); g.arc(lx, lz, 6, 0, PI * 2); g.stroke(); }
    }
    // drag ghost
    if (inter.mode === 'drag' && inter.sel && inter.x != null && inter.z != null) {
      const gx = (inter.x / TILE) * CELL, gz = (inter.z / TILE) * CELL;
      g.strokeStyle = '#66e0ff'; g.lineWidth = 2; g.setLineDash([3, 3]);
      g.strokeRect(gx - 6, gz - 6, 12, 12); g.setLineDash([]);
    }
    // armed cursor hint
    if (armedRef.current) {
      g.fillStyle = 'rgba(100,224,255,0.15)'; g.fillRect(0, 0, GW, GH);
    }
    g.restore(); // end zoom/pan transform
  }, []);

  // redraw the 2D canvas when its container resizes
  useEffect(() => {
    const onResize = () => draw2d();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw2d]);

  function drawWallDecor(g: CanvasRenderingContext2D, x: number, z: number, ry: number, color: string, selected: boolean) {
    const cx = (x / TILE) * CELL, cz = (z / TILE) * CELL;
    g.save();
    g.translate(cx, cz);
    g.rotate(-ry);
    g.fillStyle = color;
    g.fillRect(-3, -3, 6, 6);
    // facing arrow: local +z = "front" (the direction the decor faces into the room)
    g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
    g.moveTo(0, 3); g.lineTo(0, 7); g.stroke();
    g.restore();
    if (selected) { g.strokeStyle = '#66e0ff'; g.lineWidth = 1.5; g.strokeRect(cx - 4, cz - 4, 8, 8); }
  }

  // ============================================================ 2D interaction
  const tileFromEvent = (ev: React.PointerEvent | React.DragEvent) => {
    const cv = grid2d.current!; const rect = cv.getBoundingClientRect();
    const v = view2dRef.current;
    // canvas-space pixel → grid-space pixel (invert the translate+scale from draw2d)
    const sx = ((ev.clientX - rect.left) + v.ox) / v.zoom;
    const sy = ((ev.clientY - rect.top) + v.oz) / v.zoom;
    return { c: Math.floor(sx / CELL), r: Math.floor(sy / CELL), sx, sy };
  };
  const worldFrom2d = (sx: number, sy: number) => ({ x: (sx / CELL) * TILE, z: (sy / CELL) * TILE });

  /** Pan state for middle-click dragging the 2D view. */
  const pan2d = useRef({ active: false, lx: 0, ly: 0 });

  function onWheel2d(ev: React.WheelEvent) {
    ev.preventDefault();
    const cv = grid2d.current!; const rect = cv.getBoundingClientRect();
    const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    const v = view2dRef.current;
    const factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
    const newZoom = Math.max(0.5, Math.min(12, v.zoom * factor));
    // keep the grid point under the cursor stationary
    const newOx = (cx + v.ox) / v.zoom * newZoom - cx;
    const newOz = (cy + v.oz) / v.zoom * newZoom - cy;
    setView2d({ zoom: newZoom, ox: newOx, oz: newOz });
  }

  function pick2d(sx: number, sy: number): Sel | null {
    const e = levelRef.current;
    // furniture first (top) — transform mouse into each object's local space for OBB hit-test
    for (const f of [...e.furniture].reverse()) {
      const [lw, ld] = localFootprint(f.t, f.w, f.d);
      const fx = (f.x / TILE) * CELL, fz = (f.z / TILE) * CELL;
      const a = editorRot(f);
      const dx = sx - fx, dy = sy - fz;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const lz = dx * Math.sin(a) + dy * Math.cos(a);
      const cw = (lw / TILE) * CELL / 2 + 1, cd = (ld / TILE) * CELL / 2 + 1;
      if (Math.abs(lx) <= cw && Math.abs(lz) <= cd) return { kind: 'furniture', id: f.id };
    }
    const hit = (px: number, pz: number, rad: number) => Math.hypot(sx - px, sy - pz) <= rad;
    for (const l of e.lights) if (hit((l.x / TILE) * CELL, (l.z / TILE) * CELL, 5)) return { kind: 'light', id: l.id };
    for (const r of e.rugs) {
      const x0 = (r.x0 / TILE) * CELL, z0 = (r.z0 / TILE) * CELL, x1 = (r.x1 / TILE) * CELL, z1 = (r.z1 / TILE) * CELL;
      if (sx >= Math.min(x0, x1) && sx <= Math.max(x0, x1) && sy >= Math.min(z0, z1) && sy <= Math.max(z0, z1)) return { kind: 'rug', id: r.id };
    }
    for (const p of e.paintings) if (hit((p.x / TILE) * CELL, (p.z / TILE) * CELL, 5)) return { kind: 'painting', id: p.id };
    for (const w of e.windows) if (hit((w.x / TILE) * CELL, (w.z / TILE) * CELL, 5)) return { kind: 'window', id: w.id };
    for (const s of e.secrets) if (Math.floor(sx / CELL) === s.c && Math.floor(sy / CELL) === s.r) return { kind: 'secret', id: s.id };
    const d = e.dock; if (hit((d.x / TILE) * CELL, (d.z / TILE) * CELL, 6)) return { kind: 'dock', id: 'dock' };
    return null;
  }

  function onPointerDown2d(ev: React.PointerEvent) {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    // middle-click or shift+drag: pan the 2D view
    if (ev.button === 1 || (ev.button === 0 && ev.shiftKey && toolRef.current === 'select' && !armedRef.current)) {
      pan2d.current = { active: true, lx: ev.clientX, ly: ev.clientY };
      return;
    }
    const { c, r, sx, sy } = tileFromEvent(ev);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    // armed placement
    if (armedRef.current) {
      placeArmed((c + 0.5) * TILE, (r + 0.5) * TILE, c, r);
      return;
    }
    // object pick (always available)
    const hit = pick2d(sx, sy);
    if (hit) {
      setSel(hit); selRef.current = hit;
      const obj = getObj(hit);
      if (obj) {
        interactRef.current = { mode: 'drag', sel: hit, x: obj.x, z: obj.z };
        dragRef.current = { kind: hit.kind, id: hit.id, offX: 0, offZ: 0 };
      }
      draw2d();
      return;
    }
    setSel(null); selRef.current = null;
    // tile tools
    const t = toolRef.current;
    if (t === 'select') return;
    const buf = levelRef.current.map.slice();
    interactRef.current = { mode: 'paint', map: buf };
    paintTile(buf, c, r);
    draw2d();
  }

  function onPointerMove2d(ev: React.PointerEvent) {
    if (pan2d.current.active) {
      const dx = ev.clientX - pan2d.current.lx;
      const dy = ev.clientY - pan2d.current.ly;
      pan2d.current.lx = ev.clientX; pan2d.current.ly = ev.clientY;
      const v = view2dRef.current;
      setView2d({ ...v, ox: v.ox - dx, oz: v.oz - dy });
      return;
    }
    const inter = interactRef.current;
    if (inter.mode === 'none') return;
    const { c, r, sx, sy } = tileFromEvent(ev);
    if (inter.mode === 'paint' && inter.map) {
      paintTile(inter.map, Math.max(0, Math.min(COLS - 1, c)), Math.max(0, Math.min(ROWS - 1, r)));
      draw2d();
    } else if (inter.mode === 'drag') {
      const w = worldFrom2d(sx, sy);
      const x = Math.max(1, Math.min(WORLD_W - 1, snap(w.x)));
      const z = Math.max(1, Math.min(WORLD_H - 1, snap(w.z)));
      inter.x = x; inter.z = z;
      moveGhost(inter.sel!, x, z);
      draw2d();
    }
  }

  function onPointerUp2d(ev: React.PointerEvent) {
    void ev;
    if (pan2d.current.active) { pan2d.current.active = false; return; }
    const inter = interactRef.current;
    if (inter.mode === 'paint' && inter.map) {
      const committed = inter.map.slice();
      interactRef.current = { mode: 'none' };
      setLevel((l) => ({ ...l, map: committed }));
    } else if (inter.mode === 'drag' && inter.sel && inter.x != null && inter.z != null) {
      const s = inter.sel; const x = inter.x, z = inter.z;
      interactRef.current = { mode: 'none' };
      ghostRef.current.visible = false;
      commitObj(s, { x, z });
    } else {
      interactRef.current = { mode: 'none' };
    }
  }

  const snap = (v: number) => Math.round(v * 2) / 2; // 0.5 unit grid

  // ============================================================ tile painting
  function paintTile(buf: string[], c: number, r: number) {
    const t = toolRef.current;
    const set = (ch: string) => {
      const row = buf[r].split(''); row[c] = ch; buf[r] = row.join('');
    };
    const cur = buf[r][c];
    const e = levelRef.current;
    if (t === 'wall') { set('#'); return; }
    if (t === 'eraser') { set('#'); // also clear a secret door on this tile
      e.secrets = e.secrets.filter((s) => !(s.c === c && s.r === r));
      return;
    }
    if (t === 'room') {
      const k = roomKeyRef.current.toUpperCase();
      if (cur === k) return;
      set(k);
      return;
    }
    if (t === 'door') {
      if (cur !== '#') { // toggle existing floor into doorway of its room
        const up = cur.toUpperCase();
        if (up === cur) set(cur.toLowerCase());
        return;
      }
      // pick an adjacent room to open into
      const neigh = new Set<string>();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ch = buf[r + dr]?.[c + dc];
        if (ch && ch !== '#' && ch === ch.toUpperCase()) neigh.add(ch);
      }
      if (neigh.size === 0) return;
      const k = roomKeyRef.current.toUpperCase();
      const chosen = neigh.has(k) ? k : [...neigh][0];
      set(chosen.toLowerCase());
      return;
    }
    if (t === 'secret') {
      // mark a wall tile as a secret door for an adjacent room
      if (cur !== '#') return;
      const k = roomKeyRef.current.toUpperCase();
      let side: -1 | 1 = 1; let found = false;
      if (buf[r]?.[c - 1] === k) { side = -1; found = true; }
      else if (buf[r]?.[c + 1] === k) { side = 1; found = true; }
      else if (buf[r - 1]?.[c] === k || buf[r + 1]?.[c] === k) { found = true; side = 1; }
      if (!found) return;
      e.secrets = e.secrets.filter((s) => !(s.c === c && s.r === r));
      e.secrets.push({ id: uid(), c, r, roomKey: k, side });
      return;
    }
  }

  // ============================================================ objects
  function getObj(s: Sel): { x: number; z: number } | null {
    const e = levelRef.current;
    if (s.kind === 'furniture') { const f = e.furniture.find((x) => x.id === s.id); return f ? { x: f.x, z: f.z } : null; }
    if (s.kind === 'rug') { const r = e.rugs.find((x) => x.id === s.id); return r ? { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 } : null; }
    if (s.kind === 'light') { const l = e.lights.find((x) => x.id === s.id); return l ? { x: l.x, z: l.z } : null; }
    if (s.kind === 'painting') { const p = e.paintings.find((x) => x.id === s.id); return p ? { x: p.x, z: p.z } : null; }
    if (s.kind === 'window') { const w = e.windows.find((x) => x.id === s.id); return w ? { x: w.x, z: w.z } : null; }
    if (s.kind === 'dock') return { x: e.dock.x, z: e.dock.z };
    return null;
  }

  function commitObj(s: Sel, pos: { x: number; z: number }) {
    setLevel((l) => {
      const next = { ...l };
      if (s.kind === 'furniture') next.furniture = l.furniture.map((f) => f.id === s.id ? { ...f, x: pos.x, z: pos.z } : f);
      else if (s.kind === 'rug') next.rugs = l.rugs.map((r) => r.id === s.id ? { ...r, x0: pos.x - Math.abs(r.x1 - r.x0) / 2, z0: pos.z - Math.abs(r.z1 - r.z0) / 2, x1: pos.x + Math.abs(r.x1 - r.x0) / 2, z1: pos.z + Math.abs(r.z1 - r.z0) / 2 } : r);
      else if (s.kind === 'light') next.lights = l.lights.map((lt) => lt.id === s.id ? { ...lt, x: pos.x, z: pos.z } : lt);
      else if (s.kind === 'painting') next.paintings = l.paintings.map((p) => p.id === s.id ? { ...p, x: pos.x, z: pos.z } : p);
      else if (s.kind === 'window') next.windows = l.windows.map((w) => w.id === s.id ? { ...w, x: pos.x, z: pos.z } : w);
      else if (s.kind === 'dock') next.dock = { x: pos.x, z: pos.z };
      return next;
    });
  }

  function moveGhost(s: Sel, x: number, z: number) {
    const ghost = ghostRef.current;
    const e = levelRef.current;
    let w = 1, d = 1, h = 1, ry = 0;
    if (s.kind === 'furniture') {
      const f = e.furniture.find((o) => o.id === s.id);
      if (f) {
        const [fw, fd] = localFootprint(f.t, f.w, f.d); w = fw; d = fd; h = f.h ?? FURN_H[f.t] ?? 1.5;
        ry = editorRot(f);
        if (f.fallen) {
          const specY = (FURN_WIRE[f.t]?.y ?? h / 2);
          ghost.geometry.dispose();
          ghost.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(0.2, w), Math.max(0.2, d), Math.max(0.2, h)));
          ghost.position.set(x - specY * Math.sin(ry), d / 2, z - specY * Math.cos(ry));
          ghost.rotation.y = ry;
          ghost.visible = true;
          return;
        }
      }
    } else if (s.kind === 'rug') { const r = e.rugs.find((o) => o.id === s.id); if (r) { w = Math.abs(r.x1 - r.x0); d = Math.abs(r.z1 - r.z0); h = 0.1; } }
    else if (s.kind === 'dock') { w = 2; d = 2; h = 1; }
    else { w = 1.4; d = 1.4; h = 1.5; }
    ghost.geometry.dispose();
    ghost.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(0.2, w), Math.max(0.2, h), Math.max(0.2, d)));
    ghost.position.set(x, h / 2, z);
    ghost.rotation.y = ry;
    ghost.visible = true;
  }

  function placeArmed(x: number, z: number, c?: number, r?: number) {
    const a = armedRef.current!;
    setLevel((l) => {
      const next = { ...l };
      if (a.kind === 'furniture' && a.t) {
        next.furniture = [...l.furniture, { id: uid(), t: a.t, x: snap(x), z: snap(z), ry: 0 }];
      } else if (a.kind === 'rug') {
        const w = 8, d = 6;
        next.rugs = [...l.rugs, { id: uid(), x0: snap(x) - w / 2, z0: snap(z) - d / 2, x1: snap(x) + w / 2, z1: snap(z) + d / 2, color: a.color ?? 'red' }];
      } else if (a.kind === 'light') {
        next.lights = [...l.lights, { id: uid(), x: snap(x), z: snap(z), y: 4, int: 35, dist: 24, chands: [], flaky: 1 }];
      } else if (a.kind === 'painting') {
        next.paintings = [...l.paintings, { id: uid(), x: snap(x), z: snap(z), ry: 0, w: 1.6, h: 1.2, idx: l.paintings.length % 6 }];
      } else if (a.kind === 'window') {
        next.windows = [...l.windows, { id: uid(), x: snap(x), z: snap(z), ry: 0 }];
      } else if (a.kind === 'dock') {
        next.dock = { x: snap(x), z: snap(z) };
      } else if (a.kind === 'secret' && c != null && r != null) {
        const k = roomKeyRef.current.toUpperCase();
        if ((l.map[r]?.[c] ?? '#') === '#') next.secrets = [...l.secrets.filter((s) => !(s.c === c && s.r === r)), { id: uid(), c, r, roomKey: k, side: 1 }];
      }
      return next;
    });
    // clear armed after placing so each click places exactly one object
    setArmed(null); armedRef.current = null;
  }

  function rotateSel() {
    const s = selRef.current; if (!s) return;
    setLevel((l) => {
      const next = { ...l };
      if (s.kind === 'furniture') {
        next.furniture = l.furniture.map((f) => f.id === s.id ? { ...f, ry: (editorRot(f) + ROT_STEP) % (2 * PI) } : f);
      } else if (s.kind === 'painting') {
        next.paintings = l.paintings.map((p) => p.id === s.id ? { ...p, ry: ROT_ORDER[(ROT_ORDER.indexOf(nearestCardinal(p.ry)) + 1) % 4] } : p);
      } else if (s.kind === 'window') {
        next.windows = l.windows.map((w) => w.id === s.id ? { ...w, ry: ROT_ORDER[(ROT_ORDER.indexOf(nearestCardinal(w.ry)) + 1) % 4] } : w);
      } else if (s.kind === 'rug') {
        next.rugs = l.rugs.map((r) => {
          if (r.id !== s.id) return r;
          const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
          const w = Math.abs(r.x1 - r.x0), d = Math.abs(r.z1 - r.z0);
          return { ...r, x0: cx - d / 2, x1: cx + d / 2, z0: cz - w / 2, z1: cz + w / 2 };
        });
      }
      return next;
    });
  }

  function deleteSel() {
    const s = selRef.current; if (!s) return;
    setLevel((l) => {
      const next = { ...l };
      if (s.kind === 'furniture') next.furniture = l.furniture.filter((f) => f.id !== s.id);
      else if (s.kind === 'rug') next.rugs = l.rugs.filter((r) => r.id !== s.id);
      else if (s.kind === 'light') next.lights = l.lights.filter((x) => x.id !== s.id);
      else if (s.kind === 'painting') next.paintings = l.paintings.filter((x) => x.id !== s.id);
      else if (s.kind === 'window') next.windows = l.windows.filter((x) => x.id !== s.id);
      else if (s.kind === 'secret') next.secrets = l.secrets.filter((x) => x.id !== s.id);
      return next;
    });
    setSel(null); selRef.current = null;
  }

  function nudge(dx: number, dz: number) {
    const s = selRef.current; if (!s) return;
    const obj = getObj(s); if (!obj) return;
    commitObj(s, { x: snap(obj.x + dx), z: snap(obj.z + dz) });
  }

  // ============================================================ 3D interaction
  const ndc = (clientX: number, clientY: number) => {
    const mount = mount3d.current!; const rect = mount.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  };
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function raycastGround(clientX: number, clientY: number): THREE.Vector3 | null {
    ray.setFromCamera(ndc(clientX, clientY), engineRef.current!.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(groundPlane, hit) ? hit : null;
  }
  function raycastPickers(clientX: number, clientY: number): { kind: ObjKind; id: string } | null {
    pickerRef.current.updateWorldMatrix(true, true);
    ray.setFromCamera(ndc(clientX, clientY), engineRef.current!.camera);
    const hits = ray.intersectObjects(pickerRef.current.children, false);
    if (!hits.length) return null;
    const ud = hits[0].object.userData;
    return ud?.kind ? { kind: ud.kind, id: ud.id } : null;
  }

  const orbitState = useRef({ down: false, pan: false, lx: 0, ly: 0, moved: false, button: 0, sx: 0, sy: 0 });

  function onPointerDown3d(ev: React.PointerEvent) {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const st = orbitState.current;
    st.down = true; st.moved = false; st.button = ev.button;
    st.pan = ev.button === 2 || ev.button === 1 || ev.shiftKey;
    st.lx = ev.clientX; st.ly = ev.clientY;
    st.sx = ev.clientX; st.sy = ev.clientY;
  }

  function onPointerMove3d(ev: React.PointerEvent) {
    const st = orbitState.current;
    if (st.down) {
      const mdx = Math.abs(ev.clientX - st.sx), mdy = Math.abs(ev.clientY - st.sy);
      if (mdx > 4 || mdy > 4) st.moved = true;
    }
    if (st.down && st.moved) {
      // orbit or pan (no selection during camera movement)
      const dx = ev.clientX - st.lx, dy = ev.clientY - st.ly;
      st.lx = ev.clientX; st.ly = ev.clientY;
      const o = orbitRef.current;
      if (st.pan) {
        const cam = engineRef.current!.camera;
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
        const k = o.radius * 0.0018;
        o.tx += (-right.x * dx + up.x * dy) * k;
        o.tz += (-right.z * dx + up.z * dy) * k;
      } else {
        o.theta -= dx * 0.008;
        o.phi = Math.max(0.12, Math.min(1.45, o.phi - dy * 0.008));
      }
    }
  }

  function onPointerUp3d(ev: React.PointerEvent) {
    void ev;
    const st = orbitState.current;
    const wasClick = st.down && !st.moved && st.button === 0; // left-click without dragging
    st.down = false;
    if (!wasClick) {
      if (rebuildNeeded.current) { rebuildNeeded.current = false; clearTimeout(rebuildTimer.current); rebuildWorld(); }
      return;
    }
    // left-click: place, select, or deselect
    if (armedRef.current) {
      const p = raycastGround(ev.clientX, ev.clientY);
      if (p) placeArmed(snap(p.x), snap(p.z), Math.floor(p.x / TILE), Math.floor(p.z / TILE));
      return;
    }
    const hit = raycastPickers(ev.clientX, ev.clientY);
    if (hit) {
      setSel(hit); selRef.current = hit; updateHighlight(); draw2d();
    } else {
      setSel(null); selRef.current = null; updateHighlight(); draw2d();
    }
    if (rebuildNeeded.current) { rebuildNeeded.current = false; clearTimeout(rebuildTimer.current); rebuildWorld(); }
  }

  function onWheel3d(ev: React.WheelEvent) {
    const o = orbitRef.current;
    o.radius = Math.max(10, Math.min(160, o.radius * (1 + ev.deltaY * 0.0012)));
  }
  function onContextMenu3d(ev: React.MouseEvent) { ev.preventDefault(); }

  // HTML5 drag-and-drop onto the canvases
  function onDrop3d(ev: React.DragEvent) {
    ev.preventDefault();
    const payload = ev.dataTransfer.getData('text/plain');
    if (!payload) return;
    const a = parsePayload(payload); if (!a) return;
    const p = raycastGround(ev.clientX, ev.clientY);
    if (p) { armedRef.current = a; placeArmed(snap(p.x), snap(p.z), Math.floor(p.x / TILE), Math.floor(p.z / TILE)); }
  }
  function onDrop2d(ev: React.DragEvent) {
    ev.preventDefault();
    const payload = ev.dataTransfer.getData('text/plain');
    if (!payload) return;
    const a = parsePayload(payload); if (!a) return;
    const { c, r } = tileFromEvent(ev as unknown as React.PointerEvent);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    armedRef.current = a; placeArmed((c + 0.5) * TILE, (r + 0.5) * TILE, c, r);
  }

  function parsePayload(s: string): { kind: ObjKind; t?: string; color?: string } | null {
    try { return JSON.parse(s); } catch { return null; }
  }
  function paletteDrag(ev: React.DragEvent, a: { kind: ObjKind; t?: string; color?: string }) {
    ev.dataTransfer.setData('text/plain', JSON.stringify(a));
    ev.dataTransfer.effectAllowed = 'copy';
  }

  // ============================================================ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // undo/redo work even inside fields
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
      // don't intercept other editor shortcuts while typing in a text/number field
      const ae = document.activeElement;
      const inField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
      if (e.key === 'Escape') { setArmed(null); armedRef.current = null; setSel(null); selRef.current = null; draw2d(); updateHighlight(); return; }
      if (inField) return; // let the field handle all keys (including R, Delete, arrows)
      if (/^[1-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey) { setTool(TOOLS[Number(e.key) - 1][0]); return; }
      if (e.key === 'r' || e.key === 'R') { rotateSel(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (selRef.current) { e.preventDefault(); deleteSel(); } return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selRef.current) e.preventDefault();
        if (e.key === 'ArrowLeft') nudge(-0.5, 0);
        if (e.key === 'ArrowRight') nudge(0.5, 0);
        if (e.key === 'ArrowUp') nudge(0, -0.5);
        if (e.key === 'ArrowDown') nudge(0, 0.5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ============================================================ actions
  const newLevel = () => { setSel(null); selRef.current = null; setLevel(blankLevel()); };
  const loadLevel = (idx: number) => { setSel(null); selRef.current = null; setLevel(levelToEditor(LEVELS[idx])); setLoadOpen(false); };

  const exportJSON = () => {
    const def = editorToLevelDef(levelRef.current);
    const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${def.key || 'level'}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const copyTS = async () => {
    try { await navigator.clipboard.writeText(exportTS(levelRef.current)); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };

  // ============================================================ room management
  const addRoom = () => {
    setLevel((l) => {
      const used = new Set(l.rooms.map((r) => r.key));
      let k = 'A'; while (used.has(k)) k = String.fromCharCode(k.charCodeAt(0) + 1);
      const floor: FloorStyle = floorStyleRef.current;
      const room: ERoom = { key: k, name: `Room ${k}`, floor, dust: 0.6, trails: 4, patches: 4 };
      return { ...l, rooms: [...l.rooms, room] };
    });
  };
  const roomsList = level.rooms;

  // ============================================================ selected object props
  const selObj = useMemo(() => {
    if (!sel) return null;
    const e = level;
    if (sel.kind === 'furniture') { const f = e.furniture.find((x) => x.id === sel.id); return f ? { kind: 'furniture', ref: f } : null; }
    if (sel.kind === 'rug') { const r = e.rugs.find((x) => x.id === sel.id); return r ? { kind: 'rug', ref: r } : null; }
    if (sel.kind === 'light') { const l = e.lights.find((x) => x.id === sel.id); return l ? { kind: 'light', ref: l } : null; }
    if (sel.kind === 'painting') { const p = e.paintings.find((x) => x.id === sel.id); return p ? { kind: 'painting', ref: p } : null; }
    if (sel.kind === 'window') { const w = e.windows.find((x) => x.id === sel.id); return w ? { kind: 'window', ref: w } : null; }
    if (sel.kind === 'dock') return { kind: 'dock', ref: e.dock };
    if (sel.kind === 'secret') { const s = e.secrets.find((x) => x.id === sel.id); return s ? { kind: 'secret', ref: s } : null; }
    return null;
  }, [sel, level]);

  function setField(patch: Record<string, unknown>) {
    const s = selRef.current; if (!s) return;
    setLevel((l) => {
      const next = { ...l };
      const upd = <T,>(arr: T[], pred: (x: T) => boolean, p: Partial<T>) => arr.map((x) => pred(x) ? { ...x, ...p } : x);
      if (s.kind === 'furniture') next.furniture = upd(l.furniture, (f) => f.id === s.id, patch as Partial<EFurn>);
      else if (s.kind === 'rug') next.rugs = upd(l.rugs, (r) => r.id === s.id, patch as Partial<ERug>);
      else if (s.kind === 'light') next.lights = upd(l.lights, (x) => x.id === s.id, patch as Partial<ELight>);
      else if (s.kind === 'painting') next.paintings = upd(l.paintings, (x) => x.id === s.id, patch as Partial<EPainting>);
      else if (s.kind === 'window') next.windows = upd(l.windows, (x) => x.id === s.id, patch as Partial<EWindow>);
      else if (s.kind === 'dock') next.dock = { ...l.dock, ...(patch as Partial<{ x: number; z: number }>) };
      else if (s.kind === 'secret') next.secrets = upd(l.secrets, (x) => x.id === s.id, patch as Partial<ESecret>);
      return next;
    });
  }

  // ============================================================ render
  const roomOpts = level.rooms;
  const activeRoom = roomOpts.find((r) => r.key === roomKey);
  const q = query.trim().toLowerCase();
  const furnList = q ? FURNITURE_PALETTE.filter((p) => p.label.toLowerCase().includes(q) || p.t.toLowerCase().includes(q)) : FURNITURE_PALETTE;
  const toolDef = TOOLS.find(([k]) => k === tool)!;
  const playTest = () => { try { onPlay(editorToLevelDef(levelRef.current)); } catch (e) { setError('Cannot play: ' + String((e as Error).message ?? e)); } };

  return (
    <div className="ed-root fixed inset-0 flex flex-col select-none" onContextMenu={(e) => e.preventDefault()}>
      {/* ---------------------------------------------------------- command bar */}
      <header className="ed-bar h-12 shrink-0 flex items-center gap-2 px-2 border-b">
        <IconBtn icon="chevronLeft" label="Back to game" onClick={onExit} />
        <div className="ed-vsep" />
        <div className="flex flex-col justify-center min-w-0 px-1">
          <span className="font-display text-[9px] font-semibold tracking-[0.3em] text-[var(--cs-gold)] leading-none mb-1.5">LEVEL DESIGNER</span>
          <input className="ed-title-input" value={level.name} onChange={(e) => setLevel((l) => ({ ...l, name: e.target.value }))} placeholder="Untitled building" />
        </div>
        <input className="ed-input hidden lg:block flex-1 min-w-40 max-w-md ml-2" value={level.blurb} onChange={(e) => setLevel((l) => ({ ...l, blurb: e.target.value }))} placeholder="Arrival caption shown when the player enters…" title="Arrival caption" />
        <div className="flex-1" />

        <div className="ed-group">
          <IconBtn icon="undo" label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <IconBtn icon="redo" label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        </div>
        <div className="ed-vsep" />
        <div className="ed-group">
          <IconBtn icon="plus" label="New blank building" onClick={newLevel} />
          <div className="relative">
            <button className="ed-btn" onClick={() => setLoadOpen((v) => !v)} title="Open a built-in building">
              <Icon name="folder" /><span className="hidden md:inline">Open</span><Icon name="chevronDown" className="w-3 h-3 opacity-60" />
            </button>
            {loadOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setLoadOpen(false)} />
                <div className="ed-menu absolute right-0 mt-1.5 z-30 min-w-60 py-1.5">
                  <div className="ed-label px-3 pb-1.5">Built-in buildings</div>
                  {LEVELS.map((l, i) => (
                    <button key={l.key} className="ed-menu-item" onClick={() => loadLevel(i)}>
                      <span className="tabular-nums text-[var(--cs-dim)] w-5">{String(i + 1).padStart(2, '0')}</span>{l.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <IconBtn icon="download" label="Download as JSON" onClick={exportJSON} />
          <IconBtn icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy as TypeScript'} onClick={copyTS} active={copied} />
        </div>
        <div className="ed-vsep" />
        <button className="cs-btn cs-btn-primary cs-btn-sm !min-h-[32px]" onClick={playTest} title="Play this building">
          <span className="relative flex items-center gap-2"><Icon name="play" className="w-3.5 h-3.5" />Test play</span>
        </button>
      </header>

      {error && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs text-[#ffc9bd] bg-[rgba(239,138,122,0.1)] border-b border-[rgba(239,138,122,0.25)]">
          <Icon name="info" className="w-3.5 h-3.5" /><span className="flex-1">{error}</span>
          <button className="opacity-60 hover:opacity-100" onClick={() => setError(null)} aria-label="Dismiss"><Icon name="close" className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* ---------------------------------------------------------- tool rail */}
        <nav className="ed-rail w-12 shrink-0 flex flex-col items-center gap-1 py-2 border-r">
          {TOOLS.map(([tk, label, icon], i) => (
            <button key={tk} className="ed-tool" data-on={tool === tk || undefined} onClick={() => setTool(tk)} title={`${label} (${i + 1})`} aria-label={label}>
              <Icon name={icon} className="w-[18px] h-[18px]" />
              <span className="ed-tool-key">{i + 1}</span>
            </button>
          ))}
          <div className="flex-1" />
          <button className="ed-tool" onClick={() => setPaletteCollapsed((v) => !v)} title={paletteCollapsed ? 'Show assets' : 'Hide assets'}>
            <Icon name={paletteCollapsed ? 'chevronRight' : 'chevronLeft'} className="w-4 h-4" />
          </button>
        </nav>

        {/* ---------------------------------------------------------- assets */}
        {!paletteCollapsed && (
          <aside className="ed-panel w-64 shrink-0 flex flex-col min-h-0 border-r">
            <div className="ed-tabs">
              {([['furniture', 'Furniture'], ['decor', 'Fixtures'], ['rooms', 'Rooms']] as const).map(([tb, label]) => (
                <button key={tb} className="ed-tab" data-on={tab === tb || undefined} onClick={() => setTab(tb)}>{label}</button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
              {tab === 'furniture' && (
                <>
                  <label className="ed-search mb-3">
                    <Icon name="search" className="w-3.5 h-3.5 opacity-60" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search furniture" />
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {furnList.map((p) => (
                      <AssetTile
                        key={p.t}
                        icon={p.icon}
                        label={p.label}
                        active={armed?.kind === 'furniture' && armed.t === p.t}
                        onDrag={(e) => paletteDrag(e, { kind: 'furniture', t: p.t })}
                        onClick={() => { setArmed({ kind: 'furniture', t: p.t }); armedRef.current = { kind: 'furniture', t: p.t }; }}
                      />
                    ))}
                  </div>
                  {!furnList.length && <div className="text-xs text-[var(--cs-dim)] text-center py-6">Nothing matches “{query}”.</div>}
                  <p className="ed-hint mt-3">Click to arm, then click in a view to place. Or drag straight onto either view.</p>
                </>
              )}
              {tab === 'decor' && (
                <>
                  <PanelSection title="Fixtures">
                    <div className="grid grid-cols-3 gap-1.5">
                      <AssetTile label="Rug" icon="🟥" onDrag={(e) => paletteDrag(e, { kind: 'rug', color: 'red' })} onClick={() => { setArmed({ kind: 'rug', color: 'red' }); }} active={armed?.kind === 'rug'} />
                      <AssetTile label="Light" icon="💡" onDrag={(e) => paletteDrag(e, { kind: 'light' })} onClick={() => { setArmed({ kind: 'light' }); }} active={armed?.kind === 'light'} />
                      <AssetTile label="Painting" icon="🖼️" onDrag={(e) => paletteDrag(e, { kind: 'painting' })} onClick={() => { setArmed({ kind: 'painting' }); }} active={armed?.kind === 'painting'} />
                      <AssetTile label="Window" icon="🪟" onDrag={(e) => paletteDrag(e, { kind: 'window' })} onClick={() => { setArmed({ kind: 'window' }); }} active={armed?.kind === 'window'} />
                      <AssetTile label="Dock" icon="⚡" onDrag={(e) => paletteDrag(e, { kind: 'dock' })} onClick={() => { setArmed({ kind: 'dock' }); }} active={armed?.kind === 'dock'} />
                      <AssetTile label="Secret door" icon="🚪" onDrag={(e) => paletteDrag(e, { kind: 'secret' })} onClick={() => { setTool('secret'); setArmed({ kind: 'secret' }); }} active={armed?.kind === 'secret'} />
                    </div>
                  </PanelSection>
                  <PanelSection title="Rug colour">
                    <Swatches value={armed?.kind === 'rug' ? armed.color : undefined} onPick={(c) => setArmed({ kind: 'rug', color: c })} onDrag={(e, c) => paletteDrag(e, { kind: 'rug', color: c })} />
                  </PanelSection>
                </>
              )}
              {tab === 'rooms' && (
                <>
                  <PanelSection title="Active room">
                    <select className="ed-input w-full" value={roomKey} onChange={(e) => { setRoomKey(e.target.value); roomKeyRef.current = e.target.value; }}>
                      {roomOpts.map((r) => <option key={r.key} value={r.key}>{r.key} · {r.name}</option>)}
                    </select>
                    <p className="ed-hint mt-1.5">Paint its tiles with the Room tool, then pick a floor below.</p>
                  </PanelSection>
                  <PanelSection title="Floor">
                    <div className="grid grid-cols-3 gap-1.5">
                      {FLOOR_STYLES.map((f) => (
                        <button key={f.key} onClick={() => { setFloorStyle(f.key); floorStyleRef.current = f.key; applyFloorToRoom(f.key); }}
                          className="ed-swatch-tile" data-on={floorStyle === f.key || undefined}>
                          <span className="block w-full h-6 mb-1" style={{ background: f.color }} />
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </PanelSection>
                  <PanelSection title={`Rooms · ${roomsList.length}`} aside={<button className="ed-link" onClick={addRoom}><Icon name="plus" className="w-3 h-3" />Add</button>}>
                    <div className="flex flex-col gap-1">
                      {roomsList.map((r) => (
                        <div key={r.key} className="ed-row group" data-on={r.key === roomKey || undefined} onClick={() => { setRoomKey(r.key); roomKeyRef.current = r.key; }}>
                          <span className="ed-roomkey" style={{ background: FLOOR_COLOR[r.floor] }}>{r.key}</span>
                          <input className="ed-inline-input flex-1 min-w-0" value={r.name} onChange={(e) => setLevel((l) => ({ ...l, rooms: l.rooms.map((rr) => rr.key === r.key ? { ...rr, name: e.target.value } : rr) }))} />
                          <label className="flex items-center gap-1 text-[10px] text-[var(--cs-dim)] cursor-pointer" title="Hidden behind a secret door" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" className="ed-check" checked={!!r.secret} onChange={(e) => setLevel((l) => ({ ...l, rooms: l.rooms.map((rr) => rr.key === r.key ? { ...rr, secret: e.target.checked } : rr) }))} />Secret
                          </label>
                          <button className="ed-row-del" title="Delete room" onClick={(e) => { e.stopPropagation(); setLevel((l) => ({ ...l, rooms: l.rooms.filter((rr) => rr.key !== r.key) })); }}><Icon name="trash" className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  </PanelSection>
                  <PanelSection title="Walls">
                    <select className="ed-input w-full" value={level.paper} onChange={(e) => { const wp = WALL_PAPERS.find((w) => w.paper === Number(e.target.value))!; setLevel((l) => ({ ...l, paper: wp.paper, wainscot: wp.wainscot })); }}>
                      {WALL_PAPERS.map((w) => <option key={w.paper} value={w.paper}>{w.label}</option>)}
                    </select>
                  </PanelSection>
                </>
              )}
            </div>
          </aside>
        )}

        {/* ---------------------------------------------------------- viewport */}
        <main className="flex-1 min-w-0 relative bg-black">
          <div
            ref={mount3d}
            className="absolute inset-0"
            onPointerDown={onPointerDown3d}
            onPointerMove={onPointerMove3d}
            onPointerUp={onPointerUp3d}
            onWheel={onWheel3d}
            onContextMenu={onContextMenu3d}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop3d}
            style={{ cursor: armed ? 'crosshair' : 'default', touchAction: 'none' }}
          />
          <div className="absolute left-3 top-3 ed-chip pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cs-gold)]" />Perspective
          </div>
          {armed && (
            <div className="absolute left-1/2 -translate-x-1/2 top-3 ed-chip ed-chip-cyan">
              Placing <b className="font-semibold text-white">{FURNITURE_PALETTE.find((p) => p.t === armed.t)?.label ?? armed.kind}</b>
              <span className="opacity-60">· click to place ·</span><kbd className="cs-key">Esc</kbd>
            </div>
          )}
          {showTip && (
            <div className="absolute left-3 bottom-3 ed-overlay px-3 py-2.5 text-[11px] text-[var(--cs-ink)] flex gap-4 items-start">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                <span className="ed-label">Orbit</span><span>Drag</span>
                <span className="ed-label">Pan</span><span>Shift-drag or right-drag</span>
                <span className="ed-label">Zoom</span><span>Wheel</span>
                <span className="ed-label">Edit</span><span className="flex items-center gap-1"><kbd className="cs-key">R</kbd>rotate <kbd className="cs-key">Del</kbd>delete <kbd className="cs-key">←→</kbd>nudge</span>
              </div>
              <button className="opacity-50 hover:opacity-100" onClick={() => setShowTip(false)} aria-label="Hide controls"><Icon name="close" className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </main>

        {/* ---------------------------------------------------------- inspector */}
        {propsCollapsed ? (
          <button className="ed-rail w-8 shrink-0 border-l flex flex-col items-center pt-3 gap-2 text-[var(--cs-dim)] hover:text-[var(--cs-gold-hi)]" onClick={() => setPropsCollapsed(false)} title="Show inspector">
            <Icon name="chevronLeft" className="w-4 h-4" />
            <span className="ed-label [writing-mode:vertical-rl]">Inspector</span>
          </button>
        ) : (
        <aside className="ed-panel w-[340px] shrink-0 flex flex-col min-h-0 border-l">
          <div className="ed-panel-head">
            <span className="ed-label !text-[var(--cs-ink)]">Overhead map</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[var(--cs-dim)] tabular-nums mr-1">{Math.round(view2d.zoom * 100)}%</span>
              <IconBtn small icon="fit" label="Reset map view" onClick={() => { setView2d({ zoom: 1, ox: 0, oz: 0 }); draw2d(); }} />
              <IconBtn small icon="chevronRight" label="Hide inspector" onClick={() => setPropsCollapsed(true)} />
            </div>
          </div>
          <div className="p-3 pb-2 shrink-0">
            <canvas
              ref={grid2d}
              onPointerDown={onPointerDown2d}
              onPointerMove={onPointerMove2d}
              onPointerUp={onPointerUp2d}
              onWheel={onWheel2d}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop2d}
              onContextMenu={(e) => e.preventDefault()}
              className="ed-canvas w-full touch-none cursor-crosshair"
              style={{ height: '240px', imageRendering: 'auto' }}
            />
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-[var(--cs-dim)]">
              {([['#15131a', 'Wall'], ['#cfc8be', 'Floor'], ['rgba(255,210,90,0.7)', 'Door'], ['rgba(120,90,255,0.85)', 'Secret'], ['#35ff9a', 'Dock']] as const).map(([c, l]) => (
                <span key={l} className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-white/15" style={{ background: c }} />{l}</span>
              ))}
            </div>
          </div>

          {/* selection properties */}
          <div className="ed-panel-head border-t">
            <span className="ed-label !text-[var(--cs-ink)]">Properties</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
            {!selObj && (
              <div className="flex flex-col items-center text-center gap-2 py-8 text-[var(--cs-dim)]">
                <Icon name="cursor" className="w-6 h-6 opacity-40" />
                <div className="text-xs">Nothing selected</div>
                <div className="text-[11px] max-w-[220px] leading-relaxed opacity-80">Click an object in the viewport or on the map to edit it.</div>
              </div>
            )}
            {selObj && (() => {
              const f = selObj.kind === 'furniture' ? (selObj.ref as EFurn) : null;
              const canRot = selObj.kind === 'furniture' || selObj.kind === 'painting' || selObj.kind === 'window' || selObj.kind === 'rug';
              const opts = f ? OBJECT_OPTIONS[f.t] : undefined;
              const ryVal = selObj.kind === 'furniture' ? editorRot(f!) : selObj.kind === 'painting' ? (selObj.ref as EPainting).ry : selObj.kind === 'window' ? (selObj.ref as EWindow).ry : 0;
              const pal = f ? FURNITURE_PALETTE.find((p) => p.t === f.t) : null;
              return (
                <div className="flex flex-col">
                  {/* header */}
                  <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/[0.06]">
                    <div className="ed-obj-icon">{selObj.kind === 'rug' ? <span className="w-5 h-5 rounded-sm" style={{ background: RUG_HEX[(selObj.ref as ERug).color] ?? RUG_HEX.red }} /> : pal?.icon ?? KIND_ICON[selObj.kind]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[var(--cs-ink-hi)] truncate">{pal?.label ?? KIND_LABEL[selObj.kind]}</div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--cs-dim)]">{selObj.kind}{f ? ` · ${f.t}` : ''}</div>
                    </div>
                    {canRot && <IconBtn icon="rotate" label="Rotate 15° (R)" onClick={rotateSel} />}
                    <IconBtn icon="trash" label="Delete (Del)" onClick={deleteSel} danger />
                  </div>

                  <PanelSection title="Transform">
                    <div className="grid grid-cols-2 gap-1.5">
                      {selObj.kind === 'secret' ? (
                        <>
                          <NumField label="Col" value={(selObj.ref as ESecret).c} step={1} onChange={(v) => setField({ c: Math.max(0, Math.min(COLS - 1, Math.round(v))) })} />
                          <NumField label="Row" value={(selObj.ref as ESecret).r} step={1} onChange={(v) => setField({ r: Math.max(0, Math.min(ROWS - 1, Math.round(v))) })} />
                        </>
                      ) : (
                        <>
                          <NumField label="X" value={selX(selObj)} step={0.5} onChange={(v) => setField({ x: v })} />
                          <NumField label="Z" value={selZ(selObj)} step={0.5} onChange={(v) => setField({ z: v })} />
                        </>
                      )}
                    </div>
                    {selObj.kind !== 'secret' && (
                      <div className="ed-seg mt-1.5">
                        {([['←', -0.5, 0], ['↑', 0, -0.5], ['↓', 0, 0.5], ['→', 0.5, 0]] as const).map(([l, dx, dz]) => (
                          <button key={l} onClick={() => nudge(dx, dz)} title="Nudge half a tile">{l}</button>
                        ))}
                      </div>
                    )}
                  </PanelSection>

                  {canRot && selObj.kind !== 'rug' && (
                    <PanelSection title={selObj.kind === 'painting' || selObj.kind === 'window' ? 'Facing wall' : 'Rotation'}>
                      {selObj.kind === 'painting' || selObj.kind === 'window' ? (
                        <div className="ed-seg">
                          {[['N', 180], ['E', 270], ['S', 0], ['W', 90]].map(([label, deg]) => (
                            <button key={label as string} data-on={Math.round(nearestCardinal(ryVal) * RAD_TO_DEG) % 360 === (deg as number) % 360 || undefined}
                              onClick={() => setField({ ry: (deg as number) * DEG_TO_RAD })}>{label}</button>
                          ))}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <input type="range" min={0} max={360} step={5}
                              value={Math.round(ryVal * RAD_TO_DEG) % 360}
                              onChange={(e) => setField({ ry: Number(e.target.value) * DEG_TO_RAD })}
                              className="ed-range flex-1" />
                            <span className="ed-readout">{Math.round(ryVal * RAD_TO_DEG) % 360}°</span>
                          </div>
                          <div className="ed-seg mt-1.5">
                            {[0, 90, 180, 270].map((deg) => (
                              <button key={deg} data-on={Math.round(ryVal * RAD_TO_DEG) % 360 === deg || undefined} onClick={() => setField({ ry: deg * DEG_TO_RAD })}>{deg}°</button>
                            ))}
                          </div>
                        </>
                      )}
                    </PanelSection>
                  )}
                  {selObj.kind === 'rug' && (
                    <PanelSection title="Orientation">
                      <button className="ed-btn w-full justify-center" onClick={rotateSel}><Icon name="rotate" />Swap width and depth</button>
                    </PanelSection>
                  )}

                  {selObj.kind === 'furniture' && (
                    <PanelSection title="Size">
                      <div className="grid grid-cols-2 gap-1.5">
                        <NumField label="W" value={f!.w ?? FURN_SIZE[f!.t]?.[0] ?? 1.5} step={0.1} onChange={(v) => setField({ w: v })} />
                        <NumField label="D" value={f!.d ?? FURN_SIZE[f!.t]?.[1] ?? 1.5} step={0.1} onChange={(v) => setField({ d: v })} />
                      </div>
                    </PanelSection>
                  )}
                  {selObj.kind === 'rug' && (
                    <PanelSection title="Size">
                      <div className="grid grid-cols-2 gap-1.5">
                        <NumField label="W" value={Math.abs((selObj.ref as ERug).x1 - (selObj.ref as ERug).x0)} step={1} onChange={(v) => resizeRug(v, undefined)} />
                        <NumField label="D" value={Math.abs((selObj.ref as ERug).z1 - (selObj.ref as ERug).z0)} step={1} onChange={(v) => resizeRug(undefined, v)} />
                      </div>
                    </PanelSection>
                  )}
                  {selObj.kind === 'painting' && (
                    <PanelSection title="Canvas">
                      <div className="grid grid-cols-3 gap-1.5">
                        <NumField label="W" value={(selObj.ref as EPainting).w} step={0.1} onChange={(v) => setField({ w: v })} />
                        <NumField label="H" value={(selObj.ref as EPainting).h} step={0.1} onChange={(v) => setField({ h: v })} />
                        <NumField label="Art" value={(selObj.ref as EPainting).idx} step={1} onChange={(v) => setField({ idx: Math.max(0, Math.round(v)) })} />
                      </div>
                    </PanelSection>
                  )}

                  {selObj.kind === 'furniture' && (!!opts?.length || TIPPABLE.has(f!.t)) && (
                    <PanelSection title="Options">
                      <div className="flex flex-col gap-1">
                        {opts?.map((opt) => (
                          <Toggle key={opt.v} label={opt.label} checked={(f!.v ?? 0) === opt.v} onChange={(on) => setField({ v: on ? opt.v : 0 })} />
                        ))}
                        {TIPPABLE.has(f!.t) && (
                          <Toggle label="Knocked over (tidy-up target)" checked={!!f!.fallen} onChange={(on) => setField({ fallen: on })} />
                        )}
                      </div>
                    </PanelSection>
                  )}

                  {selObj.kind === 'rug' && (
                    <PanelSection title="Colour">
                      <Swatches value={(selObj.ref as ERug).color} onPick={(c) => setField({ color: c })} />
                    </PanelSection>
                  )}

                  {selObj.kind === 'light' && (
                    <PanelSection title="Light">
                      <div className="grid grid-cols-3 gap-1.5">
                        <NumField label="Y" value={(selObj.ref as ELight).y} step={0.5} onChange={(v) => setField({ y: v })} />
                        <NumField label="Pow" value={(selObj.ref as ELight).int} step={5} onChange={(v) => setField({ int: v })} />
                        <NumField label="Rng" value={(selObj.ref as ELight).dist} step={2} onChange={(v) => setField({ dist: v })} />
                      </div>
                      <div className="mt-1.5">
                        <Toggle label="Flickers" checked={((selObj.ref as ELight).flaky ?? 1) > 0} onChange={(on) => setField({ flaky: on ? 1 : 0 })} />
                      </div>
                      {((selObj.ref as ELight).flaky ?? 1) > 0 && (() => {
                        const fl = (selObj.ref as ELight).flaky ?? 1;
                        return (
                          <div className="flex items-center gap-2 mt-2">
                            <span className="ed-label w-16 shrink-0">Flicker</span>
                            <input type="range" min={0.1} max={2} step={0.1} value={fl}
                              onChange={(e) => setField({ flaky: parseFloat(e.target.value) })}
                              className="ed-range flex-1" />
                            <span className="ed-readout">{fl.toFixed(1)}</span>
                          </div>
                        );
                      })()}
                    </PanelSection>
                  )}
                </div>
              );
            })()}
          </div>
        </aside>
        )}
      </div>

      {/* ---------------------------------------------------------- status bar */}
      <footer className="ed-bar h-7 shrink-0 flex items-center gap-4 px-3 border-t text-[10px] uppercase tracking-[0.14em] text-[var(--cs-dim)]">
        <span className="flex items-center gap-1.5 text-[var(--cs-ink)]"><Icon name={toolDef[2]} className="w-3 h-3" />{toolDef[1]}</span>
        {(tool === 'room') && activeRoom && <span>Painting <b className="text-[var(--cs-ink-hi)] font-semibold">{activeRoom.key} · {activeRoom.name}</b></span>}
        {tool === 'room' && (
          <select className="ed-inline-input !text-[10px] uppercase tracking-[0.1em]" value={roomKey} onChange={(e) => { setRoomKey(e.target.value); roomKeyRef.current = e.target.value; }}>
            {roomOpts.map((r) => <option key={r.key} value={r.key}>Room {r.key}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <span>{level.rooms.length} rooms</span>
        <span>{level.furniture.length} objects</span>
        <span>{level.lights.length} lights</span>
        <span className="hidden md:inline">{COLS}×{ROWS} grid</span>
      </footer>
    </div>
  );

  function applyFloorToRoom(floor: FloorStyle) {
    setLevel((l) => ({ ...l, rooms: l.rooms.map((r) => r.key === roomKeyRef.current ? { ...r, floor } : r) }));
  }
  function resizeRug(w?: number, d?: number) {
    const s = selRef.current; if (!s || s.kind !== 'rug') return;
    setLevel((l) => ({ ...l, rugs: l.rugs.map((r) => {
      if (r.id !== s.id) return r;
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const nw = w ?? Math.abs(r.x1 - r.x0), nd = d ?? Math.abs(r.z1 - r.z0);
      return { ...r, x0: cx - nw / 2, x1: cx + nw / 2, z0: cz - nd / 2, z1: cz + nd / 2 };
    }) }));
  }
}

// ---- editor chrome
const TOOLS: ['select' | 'room' | 'wall' | 'door' | 'secret' | 'eraser', string, IconName][] = [
  ['select', 'Select', 'cursor'],
  ['room', 'Paint room', 'room'],
  ['wall', 'Wall', 'wall'],
  ['door', 'Door', 'door'],
  ['secret', 'Secret door', 'key'],
  ['eraser', 'Erase', 'eraser'],
];
const KIND_ICON: Record<string, string> = { rug: '🟥', light: '💡', painting: '🖼️', window: '🪟', dock: '⚡', secret: '🚪' };
const KIND_LABEL: Record<string, string> = { rug: 'Rug', light: 'Light', painting: 'Painting', window: 'Window', dock: 'Charging dock', secret: 'Secret door' };
const RUG_HEX: Record<string, string> = { red: '#a3313a', blue: '#33498f', green: '#3d7d52', gold: '#b38a32' };

function IconBtn({ icon, label, onClick, disabled, active, danger, small }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean; small?: boolean }) {
  return (
    <button className={`ed-icon-btn ${small ? 'ed-icon-btn-sm' : ''} ${danger ? 'ed-danger' : ''}`} data-on={active || undefined} onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      <Icon name={icon} className={small ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
    </button>
  );
}
function PanelSection({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="flex items-center justify-between mb-2">
        <span className="ed-label">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}
function AssetTile({ label, icon, onDrag, onClick, active }: { label: string; icon: string; onDrag: (e: React.DragEvent) => void; onClick: () => void; active: boolean }) {
  return (
    <button draggable onDragStart={onDrag} onClick={onClick} className="ed-asset" data-on={active || undefined} title={label}>
      <span className="text-xl leading-none">{icon}</span>
      <span className="truncate w-full text-center">{label}</span>
    </button>
  );
}
function Swatches({ value, onPick, onDrag }: { value?: string; onPick: (c: string) => void; onDrag?: (e: React.DragEvent, c: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {RUG_COLORS.map((c) => (
        <button key={c} draggable={!!onDrag} onDragStart={onDrag ? (e) => onDrag(e, c) : undefined} onClick={() => onPick(c)}
          className="ed-swatch" data-on={value === c || undefined} style={{ background: RUG_HEX[c] }} title={c} aria-label={`${c} rug`} />
      ))}
    </div>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="ed-toggle">
      <span className="flex-1">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span className="ed-switch" data-on={checked || undefined} />
    </label>
  );
}
function NumField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="ed-num">
      <span>{label}</span>
      <input type="number" step={step} value={Math.round(value * 100) / 100} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  );
}

function selX(o: { kind: string; ref: unknown }): number {
  if (o.kind === 'rug') { const r = o.ref as ERug; return (r.x0 + r.x1) / 2; }
  return (o.ref as { x?: number }).x ?? 0;
}
function selZ(o: { kind: string; ref: unknown }): number {
  if (o.kind === 'rug') { const r = o.ref as ERug; return (r.z0 + r.z1) / 2; }
  return (o.ref as { z?: number }).z ?? 0;
}
