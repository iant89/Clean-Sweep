/**
 * Buildings the roomba cleans, one after another. Every level uses the same COLS x ROWS tile grid
 * (TILE world units per tile); rooms are rectangles of floor tiles, everything else is wall.
 */
import type { FurnDef, RoomDef } from './constants';

export type Door = [number, number, number, number, string]; // col,row,w,h,roomKey
/** Fake wall tile: col,row,roomKey, and the x direction (-1/+1) of the face seen from the room you find it from. */
export type SecretDoor = [number, number, string, -1 | 1];
/** Rug drawn into the floor texture: x0,z0,x1,z1 (world units), colour scheme. */
export type Rug = [number, number, number, number, string];
/** Ceiling light: point light position/strength, plus the chandeliers (x,z,radius) it feeds (seen in menu & intro). */
export interface LightDef { x: number; z: number; y: number; int: number; dist: number; chands: [number, number, number][] }

export interface LevelDef {
  key: string;
  name: string;
  /** One line shown when you arrive. */
  blurb: string;
  rooms: RoomDef[];
  doors: Door[];
  secretDoors: SecretDoor[];
  furniture: FurnDef[];
  rugs: Rug[];
  /** Dock centre: sits against the south wall of its room. */
  dock: { x: number; z: number };
  lights: LightDef[];
  /** x,z,ry,w,h,portrait index */
  paintings: [number, number, number, number, number, number][];
  /** x,z,ry */
  windows: [number, number, number][];
  walls: { paper: number; wainscot: number };
}

const P2 = Math.PI / 2;
const PI = Math.PI;

const MANOR: LevelDef = {
  key: 'manor',
  name: 'Blackwood Manor',
  blurb: 'Where it all began. Mud everywhere.',
  rooms: [

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
    // secret rooms (tucked in the dead space either side of the North Gallery)
    { key: 'X', name: 'Forgotten Chapel', rect: [16, 12, 3, 5], floor: 'terracotta', dust: 1.0, trails: 3, patches: 5, secret: true },
    { key: 'Y', name: 'Hidden Treasury', rect: [25, 12, 3, 5], floor: 'marble', dust: 1.0, trails: 3, patches: 5, secret: true },
  ],
  secretDoors: [

    [15, 15, 'X', -1], // from the Dining Room
    [28, 15, 'Y', 1], // from the Ballroom
  ],
  doors: [

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
  ],
  furniture: [

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
    // ---- Forgotten Chapel (secret, x 32..38, z 24..34)
    { t: 'statue', x: 35, z: 25.4 },
    { t: 'plant', x: 33.2, z: 32.8 },
    { t: 'globe', x: 36.8, z: 32.6 },
    // ---- Hidden Treasury (secret, x 50..56, z 24..34)
    { t: 'statue', x: 53, z: 25.4 },
    { t: 'pillar', x: 51.2, z: 32.8 },
    { t: 'plant', x: 54.8, z: 32.8 },
  ],
  rugs: [

    [37, 42, 51, 54, 'red'],
    [9, 9, 33, 17, 'blue'],
    [66, 57, 78, 64, 'red'],
    [8, 29, 24, 37, 'green'],
  ],
  dock: { x: 44, z: 62.7 },
  lights: [
    { x: 44, y: 3.6, z: 50, int: 45, dist: 26, chands: [[44, 50, 1.2]] },
    { x: 44, y: 3.4, z: 18, int: 22, dist: 20, chands: [[44, 14, 0.7], [44, 26, 0.7]] },
    { x: 20, y: 3.6, z: 12, int: 35, dist: 22, chands: [[20, 12, 1.0]] },
    { x: 72, y: 3.6, z: 33, int: 35, dist: 22, chands: [[72, 33, 1.2]] },
  ],
  paintings: [
    [44, 2, 0, 2.6, 1.9, 0],
    [40, 19, P2, 1.2, 1.5, 1],
    [40, 25, P2, 1.2, 1.5, 2],
    [40, 31.5, P2, 1.2, 1.5, 3],
    [48, 22, -P2, 1.2, 1.5, 4],
    [48, 30, -P2, 1.2, 1.5, 5],
    [36, 36, 0, 1.6, 1.2, 2],
    [52, 36, 0, 1.6, 1.2, 5],
    [2, 33, P2, 1.6, 1.2, 1],
    [86, 48, -P2, 1.6, 1.2, 3],
  ],
  windows: [
    ...[6, 12, 20, 26].map((x) => [x, 66, PI] as [number, number, number]),
    ...[29, 36].map((z) => [86, z, -P2] as [number, number, number]),
    ...[37.5, 50.5].map((x) => [x, 64, PI] as [number, number, number]),
    ...[56, 66, 78].map((x) => [x, 2, 0] as [number, number, number]),
    [2, 47, P2],
    [2, 37, P2],
  ],
  walls: { paper: 0x4a2d3c, wainscot: 0x2e1d14 },
};

// ------------------------------------------------------------------ Hollow Pines Lodge
// world x = col*2, z = row*2
const LODGE: LevelDef = {
  key: 'lodge',
  name: 'Hollow Pines Lodge',
  blurb: 'A hunting lodge in the woods. Muddy boots, every one of them.',
  rooms: [
    { key: 'R', name: 'Great Room', rect: [14, 16, 15, 16], floor: 'darkwood', dust: 1.0, trails: 16, patches: 14 },
    { key: 'T', name: 'Trophy Hall', rect: [8, 1, 28, 5], floor: 'carpetH', dust: 0.6, trails: 6, patches: 4 },
    { key: 'N', name: 'Dining Hall', rect: [14, 7, 15, 8], floor: 'parquet', dust: 0.55, trails: 6, patches: 4 },
    { key: 'U', name: 'Bunk Room', rect: [1, 7, 12, 8], floor: 'carpetV', dust: 0.6, trails: 5, patches: 4 },
    { key: 'K', name: 'Camp Kitchen', rect: [30, 7, 13, 8], floor: 'checker', dust: 0.6, trails: 6, patches: 6 },
    { key: 'M', name: 'Mudroom', rect: [1, 16, 12, 8], floor: 'terracotta', dust: 0.9, trails: 9, patches: 8 },
    { key: 'A', name: 'Game Room', rect: [30, 16, 13, 8], floor: 'greencarpet', dust: 0.5, trails: 5, patches: 3 },
    { key: 'S', name: 'Sauna', rect: [1, 25, 12, 7], floor: 'lightwood', dust: 0.55, trails: 4, patches: 5 },
    { key: 'G', name: 'Gear Store', rect: [30, 25, 13, 7], floor: 'carpetH', dust: 0.65, trails: 6, patches: 4 },
    { key: 'X', name: 'Moonshine Still', rect: [1, 1, 6, 5], floor: 'terracotta', dust: 1.0, trails: 3, patches: 5, secret: true },
    { key: 'Y', name: 'Poacher\'s Den', rect: [37, 1, 6, 5], floor: 'darkwood', dust: 1.0, trails: 3, patches: 5, secret: true },
  ],
  secretDoors: [
    [7, 3, 'X', 1], // from the Trophy Hall
    [36, 3, 'Y', -1], // from the Trophy Hall
  ],
  doors: [
    [20, 6, 4, 1, 'N'],
    [9, 6, 3, 1, 'U'],
    [31, 6, 3, 1, 'K'],
    [13, 10, 1, 3, 'U'],
    [29, 10, 1, 3, 'K'],
    [20, 15, 4, 1, 'R'],
    [5, 15, 3, 1, 'M'],
    [35, 15, 3, 1, 'A'],
    [13, 19, 1, 3, 'M'],
    [29, 19, 1, 3, 'A'],
    [5, 24, 3, 1, 'S'],
    [29, 27, 1, 3, 'G'],
    [35, 24, 3, 1, 'G'],
  ],
  furniture: [
    // ---- Great Room (x 28..58, z 32..64)
    { t: 'fireplace', x: 28.7, z: 52, w: 4, d: 1.4, f: 'e' },
    { t: 'sofa', x: 35, z: 52, w: 4.5, d: 1.7, f: 'w' },
    { t: 'roundtable', x: 44, z: 44, w: 3.6 },
    { t: 'armchair', x: 52, z: 36, f: 's' },
    { t: 'clock', x: 57.2, z: 48, f: 'w' },
    { t: 'plant', x: 30, z: 62.6 },
    { t: 'plant', x: 56, z: 62.6 },
    { t: 'tipchair', x: 38, z: 40 },
    { t: 'books', x: 50, z: 56 },
    { t: 'vase', x: 53, z: 46 },
    // ---- Trophy Hall (x 16..72, z 2..12)
    { t: 'statue', x: 24, z: 3.4 },
    { t: 'statue', x: 64, z: 3.4 },
    { t: 'shelf', x: 36, z: 2.75, w: 5, d: 1.5, f: 's' },
    { t: 'shelf', x: 52, z: 2.75, w: 5, d: 1.5, f: 's' },
    { t: 'armchair', x: 30, z: 9.5, f: 'n' },
    { t: 'tipchair', x: 56, z: 8 },
    { t: 'books', x: 50, z: 9 },
    { t: 'plant', x: 34, z: 10.6 },
    // ---- Dining Hall (x 28..58, z 14..30)
    { t: 'table', x: 43, z: 22, w: 10, d: 3.4, h: 1.7 },
    { t: 'chair', x: 39, z: 19.4, f: 's' },
    { t: 'chair', x: 43, z: 19.4, f: 's' },
    { t: 'chair', x: 47, z: 19.4, f: 's' },
    { t: 'chair', x: 39, z: 24.6, f: 'n' },
    { t: 'chair', x: 47, z: 24.6, f: 'n' },
    { t: 'tipchair', x: 35, z: 27 },
    { t: 'counter', x: 33, z: 14.8, w: 6, d: 1.4, f: 's', v: 1 },
    { t: 'clock', x: 57.2, z: 16, f: 'w' },
    { t: 'plant', x: 29.5, z: 28.5 },
    { t: 'vase', x: 55, z: 28 },
    // ---- Bunk Room (x 2..26, z 14..30)
    { t: 'sofa', x: 3.9, z: 18, w: 4.5, d: 1.7, f: 'e' },
    { t: 'sofa', x: 3.9, z: 25, w: 4.5, d: 1.7, f: 'e' },
    { t: 'shelf', x: 6, z: 14.75, w: 5, d: 1.5, f: 's' },
    { t: 'armchair', x: 24, z: 28, f: 'w' },
    { t: 'books', x: 12, z: 22 },
    { t: 'tipchair', x: 16, z: 18 },
    // ---- Camp Kitchen (x 60..86, z 14..30)
    { t: 'counter', x: 78, z: 14.8, w: 8, d: 1.6, f: 's' },
    { t: 'stove', x: 71.5, z: 14.8, w: 3, d: 1.6, f: 's' },
    { t: 'fridge', x: 84, z: 15.2, w: 2.6, d: 2.2, f: 's' },
    { t: 'island', x: 73, z: 22, w: 8, d: 3 },
    { t: 'table', x: 64, z: 27.4, w: 3, d: 3 },
    { t: 'pots', x: 80, z: 27 },
    { t: 'tipchair', x: 66, z: 18 },
    // ---- Mudroom (x 2..26, z 32..48)
    { t: 'counter', x: 2.8, z: 40, w: 6, d: 1.4, f: 'e', v: 1 },
    { t: 'plant', x: 24.5, z: 33.5 },
    { t: 'pots', x: 8, z: 45 },
    { t: 'books', x: 18, z: 38 },
    { t: 'tipchair', x: 15, z: 43 },
    // ---- Game Room (x 60..86, z 32..48)
    { t: 'table', x: 76, z: 39, w: 6, d: 3.4, h: 1.7 },
    { t: 'chair', x: 84.6, z: 36, f: 'w' },
    { t: 'chair', x: 84.6, z: 41, f: 'w' },
    { t: 'globe', x: 63, z: 34 },
    { t: 'armchair', x: 64, z: 44.5, f: 'e' },
    { t: 'frame', x: 82, z: 46 },
    { t: 'plant', x: 85, z: 33.5 },
    // ---- Sauna (x 2..26, z 50..64)
    { t: 'fountain', x: 14, z: 58 },
    { t: 'plant', x: 3.5, z: 51.5 },
    { t: 'plant', x: 24.5, z: 62.5 },
    { t: 'pots', x: 22, z: 52.5 },
    { t: 'armchair', x: 4, z: 60, f: 'e', v: 1 },
    // ---- Gear Store (x 60..86, z 50..64)
    { t: 'shelf', x: 66, z: 63.25, w: 5, d: 1.5, f: 'n' },
    { t: 'shelf', x: 80, z: 63.25, w: 5, d: 1.5, f: 'n' },
    { t: 'desk', x: 74, z: 56, w: 5, d: 2.4 },
    { t: 'chair', x: 74, z: 58.6, f: 'n' },
    { t: 'tipchair', x: 64, z: 53 },
    { t: 'books', x: 82, z: 54 },
    { t: 'statue', x: 84.5, z: 51.5 },
    // ---- Moonshine Still (secret, x 2..14, z 2..12)
    { t: 'statue', x: 8, z: 3.4 },
    { t: 'plant', x: 3.5, z: 10.5 },
    { t: 'pots', x: 11, z: 10 },
    // ---- Poacher's Den (secret, x 74..86, z 2..12)
    { t: 'statue', x: 80, z: 3.4 },
    { t: 'pillar', x: 84.8, z: 10.8 },
    { t: 'globe', x: 77, z: 10.4 },
  ],
  rugs: [
    [36, 40, 52, 50, 'red'],
    [8, 18, 22, 27, 'green'],
    [34, 18, 52, 26, 'blue'],
  ],
  dock: { x: 43, z: 62.7 },
  lights: [
    { x: 43, y: 3.6, z: 46, int: 45, dist: 26, chands: [[43, 46, 1.2]] },
    { x: 44, y: 3.4, z: 7, int: 24, dist: 24, chands: [[34, 7, 0.7], [54, 7, 0.7]] },
    { x: 43, y: 3.6, z: 22, int: 30, dist: 20, chands: [[43, 22, 1.0]] },
    { x: 73, y: 3.6, z: 30, int: 34, dist: 24, chands: [[73, 22, 0.9], [73, 40, 0.9]] },
  ],
  paintings: [
    [30, 2, 0, 2.2, 1.6, 0],
    [58, 2, 0, 2.2, 1.6, 3],
    [28, 22, P2, 1.2, 1.5, 1],
    [43, 32, 0, 1.6, 1.2, 4],
    [62, 50, 0, 1.4, 1.1, 5],
  ],
  windows: [
    [6, 64, PI], [20, 64, PI], [35, 64, PI], [51, 64, PI], [73, 64, PI],
    [2, 22, P2], [2, 35, P2], [2, 56, P2],
    [86, 24, -P2], [86, 56, -P2],
  ],
  walls: { paper: 0x34432c, wainscot: 0x4a2e1a },
};

// ------------------------------------------------------------------ The Gilded Grand Hotel
const HOTEL: LevelDef = {
  key: 'hotel',
  name: 'The Gilded Grand Hotel',
  blurb: 'Five stars, zero cleaners. The guests tracked in half the city.',
  rooms: [
    { key: 'L', name: 'Grand Lobby', rect: [14, 18, 16, 14], floor: 'marble', dust: 1.0, trails: 18, patches: 14 },
    { key: 'C', name: 'Upper Corridor', rect: [1, 1, 42, 3], floor: 'carpetH', dust: 0.7, trails: 10, patches: 4 },
    { key: 'A', name: 'Royal Suite', rect: [1, 5, 11, 12], floor: 'lightwood', dust: 0.5, trails: 5, patches: 4 },
    { key: 'H', name: 'Staircase Hall', rect: [19, 5, 6, 12], floor: 'carpetV', dust: 0.6, trails: 5, patches: 3 },
    { key: 'D', name: 'Presidential Suite', rect: [32, 5, 11, 12], floor: 'darkwood', dust: 0.5, trails: 5, patches: 4 },
    { key: 'R', name: 'Restaurant', rect: [1, 18, 12, 8], floor: 'checker', dust: 0.7, trails: 7, patches: 7 },
    { key: 'B', name: 'Piano Bar', rect: [31, 18, 12, 8], floor: 'parquet', dust: 0.6, trails: 6, patches: 5 },
    { key: 'S', name: 'Spa', rect: [1, 27, 12, 6], floor: 'terracotta', dust: 0.55, trails: 4, patches: 5 },
    { key: 'G', name: 'Reading Lounge', rect: [31, 27, 12, 6], floor: 'greencarpet', dust: 0.45, trails: 4, patches: 3 },
    { key: 'X', name: 'Lost Luggage Room', rect: [13, 5, 5, 5], floor: 'parquet', dust: 1.0, trails: 3, patches: 5, secret: true },
    { key: 'Y', name: 'Hotel Vault', rect: [26, 5, 5, 5], floor: 'marble', dust: 1.0, trails: 3, patches: 5, secret: true },
  ],
  secretDoors: [
    [18, 7, 'X', 1], // from the Staircase Hall
    [31, 7, 'Y', 1], // from the Presidential Suite
  ],
  doors: [
    [5, 4, 3, 1, 'A'],
    [20, 4, 4, 1, 'H'],
    [36, 4, 3, 1, 'D'],
    [5, 17, 3, 1, 'R'],
    [20, 17, 4, 1, 'H'],
    [36, 17, 3, 1, 'B'],
    [13, 20, 1, 3, 'R'],
    [30, 20, 1, 3, 'B'],
    [5, 26, 3, 1, 'S'],
    [35, 26, 3, 1, 'G'],
    [13, 28, 1, 3, 'S'],
    [30, 28, 1, 3, 'G'],
  ],
  furniture: [
    // ---- Grand Lobby (x 28..60, z 36..64)
    { t: 'fountain', x: 44, z: 46 },
    { t: 'sofa', x: 31.4, z: 50, w: 4.5, d: 1.7, f: 'e' },
    { t: 'sofa', x: 56.6, z: 50, w: 4.5, d: 1.7, f: 'w' },
    { t: 'plant', x: 30, z: 37.5 },
    { t: 'plant', x: 58, z: 37.5 },
    { t: 'plant', x: 30, z: 62.6 },
    { t: 'plant', x: 58, z: 62.6 },
    { t: 'clock', x: 59.2, z: 51, f: 'w' },
    { t: 'books', x: 52, z: 58 },
    { t: 'tipchair', x: 36, z: 57 },
    { t: 'vase', x: 50, z: 40 },
    // ---- Upper Corridor (x 2..86, z 2..8)
    { t: 'plant', x: 3.5, z: 3.5 },
    { t: 'plant', x: 84.5, z: 3.5 },
    { t: 'table', x: 30, z: 2.8, w: 3.2, d: 1.1, h: 0.9 },
    { t: 'table', x: 58, z: 2.8, w: 3.2, d: 1.1, h: 0.9 },
    { t: 'vase', x: 24, z: 6 },
    { t: 'tipchair', x: 64, z: 5 },
    { t: 'frame', x: 52, z: 3 },
    // ---- Royal Suite (x 2..24, z 10..34)
    { t: 'sofa', x: 4.2, z: 16, w: 5, d: 2.6, f: 'e' },
    { t: 'desk', x: 19, z: 25, w: 4, d: 2 },
    { t: 'chair', x: 19, z: 27.4, f: 'n' },
    { t: 'books', x: 8, z: 24 },
    { t: 'tipchair', x: 14, z: 20 },
    { t: 'plant', x: 22.5, z: 32.5 },
    // ---- Staircase Hall (x 38..50, z 10..34)
    { t: 'pillar', x: 39.5, z: 24 },
    { t: 'pillar', x: 48.5, z: 24 },
    { t: 'pillar', x: 39.5, z: 30 },
    { t: 'pillar', x: 48.5, z: 30 },
    { t: 'statue', x: 48.6, z: 11.4 },
    // ---- Presidential Suite (x 64..86, z 10..34)
    { t: 'sofa', x: 83.8, z: 18, w: 5, d: 2.6, f: 'w' },
    { t: 'armchair', x: 70, z: 28, f: 'e' },
    { t: 'globe', x: 84, z: 31 },
    { t: 'books', x: 76, z: 22 },
    { t: 'tipchair', x: 70, z: 20 },
    // ---- Lost Luggage Room (secret, x 26..36, z 10..20)
    { t: 'statue', x: 31, z: 11.4 },
    { t: 'plant', x: 27.5, z: 18.5 },
    { t: 'pots', x: 34.5, z: 11.5 },
    // ---- Hotel Vault (secret, x 52..62, z 10..20)
    { t: 'statue', x: 57, z: 11.4 },
    { t: 'pillar', x: 53, z: 18.6 },
    { t: 'plant', x: 60.6, z: 18.6 },
    // ---- Restaurant (x 2..26, z 36..52)
    { t: 'table', x: 7, z: 44, w: 3.2, d: 3.2 },
    { t: 'chair', x: 7, z: 41.6, f: 's' },
    { t: 'chair', x: 7, z: 46.4, f: 'n' },
    { t: 'table', x: 19, z: 44, w: 3.2, d: 3.2 },
    { t: 'chair', x: 19, z: 41.6, f: 's' },
    { t: 'chair', x: 19, z: 46.4, f: 'n' },
    { t: 'tipchair', x: 23, z: 50 },
    { t: 'plant', x: 3.5, z: 37.5 },
    { t: 'plant', x: 24.5, z: 37.5 },
    { t: 'vase', x: 3.5, z: 50.5 },
    // ---- Piano Bar (x 62..86, z 36..52)
    { t: 'counter', x: 85.2, z: 44, w: 8, d: 1.6, f: 'w' },
    { t: 'chair', x: 82.4, z: 41, f: 'e' },
    { t: 'chair', x: 82.4, z: 44, f: 'e' },
    { t: 'chair', x: 82.4, z: 47, f: 'e' },
    { t: 'roundtable', x: 72, z: 43, w: 2.6 },
    { t: 'tipchair', x: 68, z: 40 },
    { t: 'plant', x: 63.5, z: 37.5 },
    { t: 'books', x: 70, z: 49 },
    // ---- Spa (x 2..26, z 54..66)
    { t: 'fountain', x: 8, z: 60 },
    { t: 'plant', x: 24.5, z: 55.5 },
    { t: 'pots', x: 3.5, z: 55.5 },
    { t: 'armchair', x: 19, z: 64, f: 'n', v: 1 },
    // ---- Reading Lounge (x 62..86, z 54..66)
    { t: 'shelf', x: 80, z: 65.25, w: 5, d: 1.5, f: 'n' },
    { t: 'desk', x: 74, z: 59, w: 5, d: 2.4 },
    { t: 'chair', x: 74, z: 61.6, f: 'n' },
    { t: 'globe', x: 84, z: 56 },
    { t: 'armchair', x: 66, z: 64, f: 'n' },
    { t: 'books', x: 80, z: 58 },
  ],
  rugs: [
    [4, 38, 22, 50, 'red'],
    [68, 20, 82, 30, 'blue'],
    [36, 54, 52, 60, 'red'],
    [66, 56, 82, 63, 'green'],
  ],
  dock: { x: 44, z: 62.7 },
  lights: [
    { x: 44, y: 3.6, z: 47, int: 45, dist: 26, chands: [[44, 47, 1.2]] },
    { x: 44, y: 3.4, z: 18, int: 24, dist: 22, chands: [[44, 14, 0.7], [44, 26, 0.7]] },
    { x: 14, y: 3.6, z: 44, int: 32, dist: 22, chands: [[14, 44, 1.0]] },
    { x: 74, y: 3.6, z: 44, int: 32, dist: 22, chands: [[74, 44, 1.0]] },
  ],
  paintings: [
    [16, 2, 0, 1.6, 1.2, 0],
    [72, 2, 0, 1.6, 1.2, 3],
    [38, 19, P2, 1.2, 1.5, 1],
    [38, 27, P2, 1.2, 1.5, 2],
    [50, 19, -P2, 1.2, 1.5, 4],
    [50, 27, -P2, 1.2, 1.5, 5],
    [34, 36, 0, 1.6, 1.2, 2],
    [54, 36, 0, 1.6, 1.2, 5],
  ],
  windows: [
    [10, 2, 0], [44, 2, 0], [80, 2, 0],
    [2, 22, P2], [2, 44, P2],
    [86, 26, -P2],
    [35, 64, PI], [53, 64, PI],
    [6, 66, PI], [20, 66, PI], [68, 66, PI],
  ],
  walls: { paper: 0x23304f, wainscot: 0x1c1712 },
};

export const LEVELS: LevelDef[] = [MANOR, LODGE, HOTEL];
