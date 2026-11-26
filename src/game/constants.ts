export const TILE = 2;
export const COLS = 44;
export const ROWS = 34;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;
export const DPU = 8; // dirt texels per world unit
export const DW = WORLD_W * DPU;
export const DH = WORLD_H * DPU;
export const WALL_H = 4.5;
export const ROOMBA_R = 0.55;
export const DOCK = { x: 44, z: 62.7 };
export const NIGHT_LENGTH = 300; // seconds: 12AM -> 5AM
export const CLEAR_THRESHOLD = 0.94;

export type FloorStyle =
  | 'marble'
  | 'carpetV'
  | 'carpetH'
  | 'darkwood'
  | 'checker'
  | 'parquet'
  | 'lightwood'
  | 'terracotta'
  | 'greencarpet';

export interface RoomDef {
  key: string;
  name: string;
  rect: [number, number, number, number]; // col,row,w,h in tiles
  floor: FloorStyle;
  dust: number; // base dust density
  trails: number;
  patches: number;
}

export const ROOMS: RoomDef[] = [
  { key: 'G', name: 'Grand Hall', rect: [16, 18, 12, 14], floor: 'marble', dust: 1.0, trails: 16, patches: 14 },
  { key: 'H', name: 'North Gallery', rect: [20, 1, 4, 16], floor: 'carpetV', dust: 0.55, trails: 4, patches: 3 },
  { key: 'L', name: 'Library', rect: [1, 1, 18, 10], floor: 'darkwood', dust: 0.45, trails: 5, patches: 4 },
  { key: 'K', name: 'Kitchen', rect: [25, 1, 18, 10], floor: 'checker', dust: 0.5, trails: 6, patches: 6 },
  { key: 'D', name: 'Dining Room', rect: [1, 12, 14, 9], floor: 'parquet', dust: 0.45, trails: 5, patches: 4 },
  { key: 'B', name: 'Ballroom', rect: [29, 12, 14, 9], floor: 'lightwood', dust: 0.4, trails: 8, patches: 2 },
  { key: 'W', name: 'West Corridor', rect: [1, 22, 14, 4], floor: 'carpetH', dust: 0.55, trails: 4, patches: 2 },
  { key: 'E', name: 'East Corridor', rect: [29, 22, 14, 4], floor: 'carpetH', dust: 0.55, trails: 4, patches: 2 },
  { key: 'C', name: 'Conservatory', rect: [1, 27, 14, 6], floor: 'terracotta', dust: 0.6, trails: 4, patches: 6 },
  { key: 'S', name: 'Study', rect: [29, 27, 14, 6], floor: 'greencarpet', dust: 0.45, trails: 4, patches: 3 },
];

// col,row,w,h,roomKey
export const DOORS: [number, number, number, number, string][] = [
  [20, 17, 4, 1, 'G'],
  [19, 4, 1, 3, 'H'],
  [24, 4, 1, 3, 'H'],
  [15, 22, 1, 4, 'W'],
  [28, 22, 1, 4, 'E'],
  [6, 11, 3, 1, 'D'],
  [6, 21, 3, 1, 'W'],
  [6, 26, 3, 1, 'W'],
  [35, 11, 3, 1, 'B'],
  [35, 21, 3, 1, 'E'],
  [35, 26, 3, 1, 'E'],
];

export type Facing = 'n' | 's' | 'e' | 'w';
export interface FurnDef {
  t: string;
  x: number;
  z: number;
  w?: number; // local length
  d?: number; // local depth
  f?: Facing; // direction the front faces
  h?: number;
  v?: number; // variant
}

export const FURNITURE: FurnDef[] = [
  // ---- Grand Hall (x 32..56, z 36..64)
  { t: 'roundtable', x: 44, z: 47, w: 4.2 },
  { t: 'statue', x: 37, z: 40 },
  { t: 'statue', x: 51, z: 40 },
  { t: 'clock', x: 33.2, z: 38, f: 'e' },
  { t: 'sofa', x: 34.9, z: 57, w: 4.5, d: 1.7, f: 'e' },
  { t: 'sofa', x: 53.1, z: 57, w: 4.5, d: 1.7, f: 'w' },
  { t: 'plant', x: 34, z: 62.6 },
  { t: 'plant', x: 54, z: 62.6 },
  { t: 'tipchair', x: 40.5, z: 55 },
  { t: 'books', x: 48.5, z: 52 },
  { t: 'vase', x: 38, z: 50 },
  // ---- North Gallery (x 40..48, z 2..34)
  { t: 'statue', x: 41.2, z: 3.4 },
  { t: 'statue', x: 46.8, z: 3.4 },
  { t: 'table', x: 40.8, z: 21, w: 1.1, d: 3, h: 1.7 },
  { t: 'table', x: 40.8, z: 29, w: 1.1, d: 3, h: 1.7 },
  { t: 'table', x: 47.2, z: 18, w: 1.1, d: 3, h: 1.7 },
  { t: 'table', x: 47.2, z: 26, w: 1.1, d: 3, h: 1.7 },
  { t: 'frame', x: 44.6, z: 16 },
  // ---- Library (x 2..38, z 2..22)
  { t: 'shelf', x: 6, z: 2.75, w: 5, d: 1.5, f: 's' },
  { t: 'shelf', x: 12, z: 2.75, w: 5, d: 1.5, f: 's' },
  { t: 'shelf', x: 18, z: 2.75, w: 5, d: 1.5, f: 's' },
  { t: 'shelf', x: 24, z: 2.75, w: 5, d: 1.5, f: 's' },
  { t: 'shelf', x: 30, z: 2.75, w: 5, d: 1.5, f: 's' },
  { t: 'shelf', x: 2.75, z: 9, w: 5, d: 1.5, f: 'e' },
  { t: 'shelf', x: 2.75, z: 15, w: 5, d: 1.5, f: 'e' },
  { t: 'table', x: 14, z: 13, w: 5, d: 2.6 },
  { t: 'table', x: 27, z: 13, w: 5, d: 2.6 },
  { t: 'chair', x: 12.5, z: 10.8, f: 's' },
  { t: 'chair', x: 15.5, z: 15.2, f: 'n' },
  { t: 'chair', x: 25.5, z: 15.2, f: 'n' },
  { t: 'tipchair', x: 29, z: 9.5 },
  { t: 'armchair', x: 33.5, z: 18.5, f: 'w' },
  { t: 'armchair', x: 7, z: 19.6, f: 'n' },
  { t: 'globe', x: 35.5, z: 5 },
  { t: 'books', x: 20, z: 8 },
  { t: 'books', x: 31, z: 17 },
  // ---- Kitchen (x 50..86, z 2..22)
  { t: 'counter', x: 56, z: 2.8, w: 6, d: 1.6, f: 's' },
  { t: 'stove', x: 61.5, z: 2.8, w: 3, d: 1.6, f: 's' },
  { t: 'counter', x: 67, z: 2.8, w: 8, d: 1.6, f: 's' },
  { t: 'counter', x: 77, z: 2.8, w: 8, d: 1.6, f: 's' },
  { t: 'fridge', x: 84, z: 3.2, w: 2.6, d: 2.2, f: 's' },
  { t: 'counter', x: 85.2, z: 10, w: 6, d: 1.6, f: 'w' },
  { t: 'island', x: 68, z: 12, w: 10, d: 3 },
  { t: 'table', x: 57, z: 16, w: 3.2, d: 3.2 },
  { t: 'chair', x: 57, z: 13.6, f: 's' },
  { t: 'chair', x: 57, z: 18.4, f: 'n' },
  { t: 'tipchair', x: 54.5, z: 17 },
  { t: 'pots', x: 78, z: 16 },
  { t: 'plant', x: 85, z: 20.8 },
  // ---- Dining (x 2..30, z 24..42)
  { t: 'table', x: 16, z: 33, w: 14, d: 3.6, h: 1.7 },
  { t: 'chair', x: 11, z: 30.4, f: 's' },
  { t: 'chair', x: 14, z: 30.4, f: 's' },
  { t: 'chair', x: 20, z: 30.4, f: 's' },
  { t: 'chair', x: 12, z: 35.6, f: 'n' },
  { t: 'chair', x: 18, z: 35.6, f: 'n' },
  { t: 'chair', x: 21, z: 35.6, f: 'n' },
  { t: 'tipchair', x: 17, z: 28.5 },
  { t: 'tipchair', x: 7, z: 36 },
  { t: 'counter', x: 25, z: 24.8, w: 6, d: 1.4, f: 's', v: 1 },
  { t: 'clock', x: 28.9, z: 27, f: 'w' },
  { t: 'plant', x: 3.4, z: 25.4 },
  { t: 'plant', x: 28.5, z: 40.6 },
  { t: 'vase', x: 24, z: 39 },
  // ---- Ballroom (x 58..86, z 24..42)
  { t: 'piano', x: 64, z: 30 },
  { t: 'pillar', x: 62, z: 38.5 },
  { t: 'pillar', x: 82, z: 38.5 },
  { t: 'pillar', x: 82, z: 27.5 },
  { t: 'chair', x: 85.2, z: 33, f: 'w' },
  { t: 'chair', x: 85.2, z: 35.5, f: 'w' },
  { t: 'tipchair', x: 74, z: 34 },
  { t: 'frame', x: 69, z: 38 },
  // ---- West corridor (x 2..30, z 44..52)
  { t: 'plant', x: 3.4, z: 45.4 },
  { t: 'statue', x: 3.6, z: 50.4 },
  { t: 'table', x: 24, z: 44.8, w: 3.2, d: 1.1, h: 1.7 },
  { t: 'books', x: 9, z: 48.5 },
  // ---- East corridor (x 58..86, z 44..52)
  { t: 'plant', x: 59.6, z: 45.4 },
  { t: 'plant', x: 84.6, z: 50.6 },
  { t: 'table', x: 80, z: 44.8, w: 3.2, d: 1.1, h: 0.9 },
  { t: 'vase', x: 66, z: 49 },
  // ---- Conservatory (x 2..30, z 54..66)
  { t: 'fountain', x: 16, z: 61 },
  { t: 'plant', x: 4.5, z: 57 },
  { t: 'plant', x: 8.5, z: 64 },
  { t: 'plant', x: 22, z: 57.5 },
  { t: 'plant', x: 26, z: 64 },
  { t: 'plant', x: 28.4, z: 56 },
  { t: 'armchair', x: 4, z: 61.5, f: 'e', v: 1 },
  { t: 'pots', x: 11, z: 57 },
  // ---- Study (x 58..86, z 54..66)
  { t: 'desk', x: 72, z: 60, w: 5, d: 2.4 },
  { t: 'chair', x: 72, z: 62.6, f: 'n' },
  { t: 'shelf', x: 62, z: 65.25, w: 5, d: 1.5, f: 'n' },
  { t: 'shelf', x: 79, z: 65.25, w: 5, d: 1.5, f: 'n' },
  { t: 'fireplace', x: 85.3, z: 59, w: 4, d: 1.4, f: 'w' },
  { t: 'armchair', x: 64, z: 58, f: 's' },
  { t: 'armchair', x: 81, z: 56.5, f: 'w' },
  { t: 'globe', x: 60, z: 56 },
  { t: 'books', x: 77, z: 62 },
];

// Rugs drawn into floor texture: x0,z0,x1,z1 (world units), color scheme
export const RUGS: [number, number, number, number, string][] = [
  [37, 42, 51, 54, 'red'],
  [9, 9, 33, 17, 'blue'],
  [66, 57, 78, 64, 'red'],
  [8, 29, 24, 37, 'green'],
];

export type UpKey = 'battery' | 'bin' | 'speed' | 'brush' | 'suction' | 'charger';
export interface UpgradeDef {
  key: UpKey;
  name: string;
  desc: string;
  icon: string;
  costs: number[];
}
export const UPGRADES: UpgradeDef[] = [
  { key: 'battery', name: 'Lithium Cell', desc: '+25% battery capacity', icon: '🔋', costs: [20, 40, 70, 110, 160] },
  { key: 'bin', name: 'Mega Dust Bin', desc: '+35% dust capacity', icon: '🗑️', costs: [20, 40, 70, 110, 160] },
  { key: 'speed', name: 'Turbo Motor', desc: '+10% top speed', icon: '⚡', costs: [25, 45, 75, 115, 165] },
  { key: 'brush', name: 'Wide Brushes', desc: '+15% cleaning width', icon: '🧹', costs: [25, 50, 80, 120, 170] },
  { key: 'suction', name: 'Cyclone Suction', desc: '+30% suction power', icon: '🌪️', costs: [20, 40, 70, 110, 160] },
  { key: 'charger', name: 'Quick Dock', desc: '+60% charge & empty speed', icon: '🔌', costs: [15, 35, 60, 95, 140] },
];
