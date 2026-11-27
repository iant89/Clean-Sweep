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
  /**
   * Optional floor plan drawn as text (ROWS lines of COLS characters): '#' is wall, an upper-case
   * letter is that room's floor and the lower-case letter is a doorway into it. Lets rooms take any
   * shape. Secret doorways stay '#' here and are listed in secretDoors.
   */
  map?: string[];
}

/** Fill in rooms' rects (the biggest rectangle inside each room) and the doorways from a text floor plan. */
function fromMap(def: Omit<LevelDef, 'doors' | 'rooms'> & { map: string[]; rooms: Omit<RoomDef, 'rect'>[] }): LevelDef {
  const at = (c: number, r: number) => def.map[r]?.[c] ?? '#';
  const rooms: RoomDef[] = def.rooms.map((room) => {
    let best: RoomDef['rect'] = [0, 0, 0, 0], area = 0;
    const rows = def.map.length, cols = def.map[0].length;
    for (let r0 = 0; r0 < rows; r0++) for (let c0 = 0; c0 < cols; c0++) {
      if (at(c0, r0) !== room.key) continue;
      let maxW = cols;
      for (let r1 = r0; r1 < rows && at(c0, r1) === room.key; r1++) {
        let w = 0;
        while (w < maxW && at(c0 + w, r1) === room.key) w++;
        maxW = w;
        const a = maxW * (r1 - r0 + 1);
        if (a > area) { area = a; best = [c0, r0, maxW, r1 - r0 + 1]; }
      }
    }
    if (!area) throw new Error(`room ${room.key} missing from the ${def.name} floor plan`);
    return { ...room, rect: best };
  });
  const doors: Door[] = [];
  def.map.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== '#' && ch === ch.toLowerCase()) doors.push([c, r, 1, 1, ch.toUpperCase()]);
  }));
  return { ...def, rooms, doors };
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
// A rambling lodge: a tall trophy gallery down the west side, an L-shaped great room,
// a deck that wraps round the south-east, and the dock out in the mudroom.
// world x = col*2, z = row*2
const LODGE: LevelDef = fromMap({
  key: 'lodge',
  name: 'Hollow Pines Lodge',
  blurb: 'A hunting lodge in the woods. Muddy boots, every one of them.',
  map: [
    '############################################',
    '#TTTTT#BBBBBBBBBB#KKKKKKKKKKK#XXXXX#SSSSSSS#',
    '#TTTTT#BBBBBBBBBB#KKKKKKKKKKK#XXXXX#SSSSSSS#',
    '#TTTTTtBBBBBBBBBBbKKKKKKKKKKK#XXXXX#SSSSSSS#',
    '#TTTTTtBBBBBBBBBBbKKKKKKKKKKK#XXXXX#SSSSSSS#',
    '#TTTTTtBBBBBBBBBBbKKKKKKKKKKK#XXXXX#SSSSSSS#',
    '#TTTTT#BBBBBBBBBB#KKKKKKKKKKK#######SSSSSSS#',
    '#TTTTT#BBBBBBBBBB#KKKKKKKKKKK#########sss###',
    '#TTTTT####bbb#########kkkk####NNNNNNNNNNNNN#',
    '#TTTTT#RRRRRRRRRRRRRRRRRRRRRR#NNNNNNNNNNNNN#',
    '#TTTTT#RRRRRRRRRRRRRRRRRRRRRR#NNNNNNNNNNNNN#',
    '#TTTTTtRRRRRRRRRRRRRRRRRRRRRRnNNNNNNNNNNNNN#',
    '#TTTTTtRRRRRRRRRRRRRRRRRRRRRRnNNNNNNNNNNNNN#',
    '#TTTTTtRRRRRRRRRRRRRRRRRRRRRRnNNNNNNNNNNNNN#',
    '#TTTTT#RRRRRRRRRRRRRRRRRRRRRR#NNNNNNNNNNNNN#',
    '#TTTTT#RRRRRRRRRRRRRRRRRRRRRR#NNNNNNNNNNNNN#',
    '#TTTTT#####ggg#####RRRRRRRRRR#NNNNNNNNNNNNN#',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#########ppp###',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#YYYYY#PPPPPPP#',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#YYYYY#PPPPPPP#',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#YYYYY#PPPPPPP#',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#YYYYY#PPPPPPP#',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#YYYYY#PPPPPPP#',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#######PPPPPPP#',
    '#TTTTT#GGGGGGGGGGG#RRRRRRRRRR#######PPPPPPP#',
    '##mmm#####gggg########pppp##########PPPPPPP#',
    '#MMMMMMMMMMMMMMMMM#PPPPPPPPPPPPPPPPPPPPPPPP#',
    '#MMMMMMMMMMMMMMMMM#PPPPPPPPPPPPPPPPPPPPPPPP#',
    '#MMMMMMMMMMMMMMMMMmPPPPPPPPPPPPPPPPPPPPPPPP#',
    '#MMMMMMMMMMMMMMMMMmPPPPPPPPPPPPPPPPPPPPPPPP#',
    '#MMMMMMMMMMMMMMMMMmPPPPPPPPPPPPPPPPPPPPPPPP#',
    '#MMMMMMMMMMMMMMMMM#PPPPPPPPPPPPPPPPPPPPPPPP#',
    '#MMMMMMMMMMMMMMMMM#PPPPPPPPPPPPPPPPPPPPPPPP#',
    '############################################',
  ],
  rooms: [
    { key: 'M', name: 'Mudroom', floor: 'terracotta', dust: 1.0, trails: 12, patches: 10 },
    { key: 'T', name: 'Trophy Gallery', floor: 'carpetV', dust: 0.6, trails: 6, patches: 4 },
    { key: 'B', name: 'Bunk Room', floor: 'carpetH', dust: 0.6, trails: 5, patches: 4 },
    { key: 'K', name: 'Camp Kitchen', floor: 'checker', dust: 0.6, trails: 6, patches: 6 },
    { key: 'S', name: 'Sauna', floor: 'marble', dust: 0.55, trails: 3, patches: 4 },
    { key: 'R', name: 'Great Room', floor: 'darkwood', dust: 0.8, trails: 12, patches: 10 },
    { key: 'N', name: 'Dining Hall', floor: 'parquet', dust: 0.55, trails: 6, patches: 4 },
    { key: 'G', name: 'Game Room', floor: 'greencarpet', dust: 0.5, trails: 5, patches: 3 },
    { key: 'P', name: 'Wraparound Deck', floor: 'lightwood', dust: 0.85, trails: 10, patches: 8 },
    { key: 'X', name: 'Moonshine Still', floor: 'darkwood', dust: 1.0, trails: 3, patches: 5, secret: true },
    { key: 'Y', name: 'Poacher\'s Den', floor: 'terracotta', dust: 1.0, trails: 3, patches: 5, secret: true },
  ],
  secretDoors: [
    [29, 3, 'X', -1], // east wall of the Camp Kitchen
    [35, 20, 'Y', 1], // west wall of the deck
  ],
  furniture: [
    // ---- Mudroom (x 2..36, z 52..66), dock at x 14
    { t: 'counter', x: 2.8, z: 59, w: 6, d: 1.4, f: 'e', v: 1 },
    { t: 'shelf', x: 32, z: 52.75, w: 5, d: 1.5, f: 's' },
    { t: 'plant', x: 34.5, z: 64.5 },
    { t: 'pots', x: 28, z: 63 },
    { t: 'books', x: 26, z: 58 },
    { t: 'tipchair', x: 21, z: 56 },
    // ---- Trophy Gallery (x 2..12, z 2..50)
    { t: 'statue', x: 3.4, z: 16 },
    { t: 'statue', x: 3.4, z: 34 },
    { t: 'shelf', x: 2.75, z: 43, w: 5, d: 1.5, f: 'e' },
    { t: 'clock', x: 11.2, z: 33, f: 'w' },
    { t: 'armchair', x: 9, z: 18, f: 'w' },
    { t: 'books', x: 7, z: 30 },
    { t: 'tipchair', x: 8, z: 39 },
    { t: 'plant', x: 10.5, z: 3.5 },
    // ---- Bunk Room (x 14..34, z 2..16)
    { t: 'sofa', x: 19, z: 3.2, w: 4.5, d: 1.7, f: 's' },
    { t: 'sofa', x: 29, z: 3.2, w: 4.5, d: 1.7, f: 's' },
    { t: 'armchair', x: 31, z: 13, f: 'w' },
    { t: 'books', x: 24, z: 9 },
    { t: 'tipchair', x: 17, z: 12 },
    // ---- Camp Kitchen (x 36..58, z 2..16)
    { t: 'counter', x: 41, z: 2.8, w: 6, d: 1.6, f: 's' },
    { t: 'stove', x: 45.5, z: 2.8, w: 3, d: 1.6, f: 's' },
    { t: 'counter', x: 50.5, z: 2.8, w: 5, d: 1.6, f: 's' },
    { t: 'fridge', x: 56, z: 3.2, w: 2.6, d: 2.2, f: 's' },
    { t: 'island', x: 46, z: 10.5, w: 7, d: 2.6 },
    { t: 'pots', x: 39, z: 13 },
    { t: 'tipchair', x: 55, z: 13 },
    // ---- Sauna (x 72..86, z 2..14)
    { t: 'fountain', x: 79, z: 6 },
    { t: 'plant', x: 73.5, z: 3.5 },
    { t: 'plant', x: 84.5, z: 3.5 },
    { t: 'pots', x: 84.5, z: 12 },
    { t: 'armchair', x: 74, z: 12, f: 'e', v: 1 },
    // ---- Great Room (bar x 14..58, z 18..32; south leg x 38..58, z 32..50)
    { t: 'fireplace', x: 34, z: 18.7, w: 4, d: 1.4, f: 's' },
    { t: 'sofa', x: 34, z: 25, w: 4.5, d: 1.7, f: 'n' },
    { t: 'armchair', x: 16, z: 20, f: 'e' },
    { t: 'roundtable', x: 50, z: 40, w: 3.6 },
    { t: 'clock', x: 57.2, z: 36, f: 'w' },
    { t: 'plant', x: 39.5, z: 48.5 },
    { t: 'plant', x: 56.5, z: 48.5 },
    { t: 'tipchair', x: 26, z: 28 },
    { t: 'books', x: 44, z: 36 },
    { t: 'vase', x: 41, z: 30 },
    // ---- Dining Hall (x 60..86, z 16..34)
    { t: 'table', x: 73, z: 25, w: 10, d: 3.4, h: 1.7 },
    { t: 'chair', x: 69, z: 22.4, f: 's' },
    { t: 'chair', x: 73, z: 22.4, f: 's' },
    { t: 'chair', x: 77, z: 22.4, f: 's' },
    { t: 'chair', x: 69, z: 27.6, f: 'n' },
    { t: 'chair', x: 77, z: 27.6, f: 'n' },
    { t: 'counter', x: 65, z: 16.8, w: 6, d: 1.4, f: 's', v: 1 },
    { t: 'clock', x: 85.2, z: 19.5, f: 'w' },
    { t: 'plant', x: 61.5, z: 32.5 },
    { t: 'vase', x: 84, z: 32 },
    { t: 'tipchair', x: 66, z: 31 },
    // ---- Game Room (x 14..36, z 34..50)
    { t: 'table', x: 28, z: 42, w: 6, d: 3.4, h: 1.7 },
    { t: 'armchair', x: 16, z: 37, f: 'e' },
    { t: 'globe', x: 34, z: 36.5 },
    { t: 'frame', x: 33, z: 47 },
    { t: 'plant', x: 15.5, z: 48.5 },
    // ---- Wraparound Deck (east arm x 72..86, z 36..66; south arm x 38..72, z 52..66)
    { t: 'plant', x: 85, z: 37.5 },
    { t: 'plant', x: 85, z: 64.5 },
    { t: 'plant', x: 39.5, z: 64.5 },
    { t: 'armchair', x: 84.6, z: 48, f: 'w' },
    { t: 'armchair', x: 84.6, z: 54, f: 'w' },
    { t: 'roundtable', x: 79, z: 60, w: 2.6 },
    { t: 'pots', x: 60, z: 64.5 },
    { t: 'books', x: 56, z: 58 },
    { t: 'tipchair', x: 66, z: 56 },
    { t: 'vase', x: 47, z: 63.5 },
    // ---- Moonshine Still (secret, x 60..70, z 2..12)
    { t: 'statue', x: 65, z: 3.4 },
    { t: 'pots', x: 68, z: 10 },
    { t: 'plant', x: 61.5, z: 10.5 },
    // ---- Poacher's Den (secret, x 60..70, z 36..46)
    { t: 'statue', x: 65, z: 37.4 },
    { t: 'pillar', x: 61.2, z: 44.8 },
    { t: 'globe', x: 67.5, z: 44.4 },
  ],
  rugs: [
    [26, 21, 42, 29, 'red'],
    [64, 20, 84, 30, 'green'],
    [18, 38, 36, 47, 'blue'],
  ],
  dock: { x: 14, z: 64.7 },
  lights: [
    { x: 30, y: 3.6, z: 25, int: 40, dist: 26, chands: [[30, 25, 1.1]] },
    { x: 48, y: 3.6, z: 41, int: 30, dist: 20, chands: [[48, 41, 0.9]] },
    { x: 73, y: 3.6, z: 25, int: 30, dist: 20, chands: [[73, 25, 1.0]] },
    { x: 7, y: 3.4, z: 26, int: 24, dist: 26, chands: [[7, 14, 0.6], [7, 38, 0.6]] },
    { x: 18, y: 3.6, z: 59, int: 34, dist: 24, chands: [[18, 59, 1.0]] },
  ],
  paintings: [
    [2, 9, P2, 1.2, 1.5, 0],
    [2, 25, P2, 1.2, 1.5, 1],
    [38, 40, P2, 1.2, 1.5, 2],
    [70, 16, 0, 1.6, 1.2, 3],
    [20, 34, 0, 1.4, 1.1, 4],
    [26, 18, 0, 1.4, 1.1, 5],
  ],
  windows: [
    [24, 2, 0], [79, 2, 0],
    [2, 21, P2], [2, 29, P2], [2, 54, P2],
    [86, 9, -P2], [86, 26, -P2], [86, 41, -P2], [86, 60, -P2],
    [6, 66, PI], [28, 66, PI], [44, 66, PI], [58, 66, PI], [72, 66, PI],
  ],
  walls: { paper: 0x34432c, wainscot: 0x4a2e1a },
});

// ------------------------------------------------------------------ The Gilded Grand Hotel
// A ballroom across the top, numbered guest rooms off one long corridor, and a vast lobby
// in the south-east with the dock by the front doors.
const HOTEL: LevelDef = fromMap({
  key: 'hotel',
  name: 'The Gilded Grand Hotel',
  blurb: 'Five stars, zero cleaners. The guests tracked in half the city.',
  map: [
    '############################################',
    '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW#RRRRRRRRRRR#',
    '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW#RRRRRRRRRRR#',
    '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWwRRRRRRRRRRR#',
    '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWwRRRRRRRRRRR#',
    '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWwRRRRRRRRRRR#',
    '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW#RRRRRRRRRRR#',
    '#WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW#RRRRRRRRRRR#',
    '###aaa#####ddd#####eee##########RRRRRRRRRRR#',
    '#AAAAAAA#DDDDDDD#EEEEEEE#YYYYY##RRRRRRRRRRR#',
    '#AAAAAAA#DDDDDDD#EEEEEEE#YYYYY##RRRRRRRRRRR#',
    '#AAAAAAA#DDDDDDD#EEEEEEE#YYYYY##RRRRRRRRRRR#',
    '#AAAAAAA#DDDDDDD#EEEEEEE#YYYYY##RRRRRRRRRRR#',
    '#AAAAAAA#DDDDDDD#EEEEEEE#YYYYY##RRRRRRRRRRR#',
    '###aaa#####ddd#####eee##############rrr#####',
    '#CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC#',
    '#CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC#',
    '#CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC#',
    '####uuu#######lll############oooo###########',
    '#UUUUUUUUU#LLLLLLLLL#OOOOOOOOOOOOOOOOOOOOOO#',
    '#UUUUUUUUU#LLLLLLLLL#OOOOOOOOOOOOOOOOOOOOOO#',
    '#UUUUUUUUU#LLLLLLLLL#OOOOOOOOOOOOOOOOOOOOOO#',
    '#UUUUUUUUU#LLLLLLLLL#OOOOOOOOOOOOOOOOOOOOOO#',
    '#UUUUUUUUU#LLLLLLLLL#OOOOOOOOOOOOOOOOOOOOOO#',
    '#UUUUUUUUU#LLLLLLLLL#OOOOOOOOOOOOOOOOOOOOOO#',
    '#######bbb####bbb####OOOOOOOOOOOOOOOOOOOOOO#',
    '#######BBBBBBBBBBBBB#OOOOOOOOOOOOOOOOOOOOOO#',
    '#XXXXX#BBBBBBBBBBBBB#OOOOOOOOOOOOOOOOOOOOOO#',
    '#XXXXX#BBBBBBBBBBBBBbOOOOOOOOOOOOOOOOOOOOOO#',
    '#XXXXX#BBBBBBBBBBBBBbOOOOOOOOOOOOOOOOOOOOOO#',
    '#XXXXX#BBBBBBBBBBBBBbOOOOOOOOOOOOOOOOOOOOOO#',
    '#XXXXX#BBBBBBBBBBBBB#OOOOOOOOOOOOOOOOOOOOOO#',
    '#######BBBBBBBBBBBBB#OOOOOOOOOOOOOOOOOOOOOO#',
    '############################################',
  ],
  rooms: [
    { key: 'O', name: 'Grand Lobby', floor: 'marble', dust: 1.0, trails: 18, patches: 14 },
    { key: 'C', name: 'Long Corridor', floor: 'carpetH', dust: 0.9, trails: 12, patches: 5 },
    { key: 'W', name: 'Ballroom', floor: 'lightwood', dust: 0.5, trails: 8, patches: 4 },
    { key: 'R', name: 'Rooftop Restaurant', floor: 'checker', dust: 0.7, trails: 7, patches: 7 },
    { key: 'A', name: 'Room 101', floor: 'carpetV', dust: 0.6, trails: 3, patches: 3 },
    { key: 'D', name: 'Room 102', floor: 'parquet', dust: 0.6, trails: 3, patches: 3 },
    { key: 'E', name: 'Room 103', floor: 'greencarpet', dust: 0.6, trails: 3, patches: 3 },
    { key: 'U', name: 'Spa', floor: 'terracotta', dust: 0.55, trails: 4, patches: 5 },
    { key: 'L', name: 'Library Lounge', floor: 'darkwood', dust: 0.45, trails: 4, patches: 3 },
    { key: 'B', name: 'Piano Bar', floor: 'parquet', dust: 0.7, trails: 6, patches: 6 },
    { key: 'X', name: 'Lost Luggage Room', floor: 'parquet', dust: 1.0, trails: 3, patches: 5, secret: true },
    { key: 'Y', name: 'Hotel Vault', floor: 'marble', dust: 1.0, trails: 3, patches: 5, secret: true },
  ],
  secretDoors: [
    [24, 11, 'Y', -1], // east wall of Room 103
    [6, 29, 'X', 1], // west wall of the Piano Bar
  ],
  furniture: [
    // ---- Grand Lobby (x 42..86, z 38..66), dock at x 64
    { t: 'fountain', x: 64, z: 48 },
    { t: 'counter', x: 76, z: 38.8, w: 8, d: 1.6, f: 's' },
    { t: 'sofa', x: 50, z: 52, w: 4.5, d: 1.7, f: 'e' },
    { t: 'sofa', x: 78, z: 52, w: 4.5, d: 1.7, f: 'w' },
    { t: 'plant', x: 43.5, z: 39.5 },
    { t: 'plant', x: 84.5, z: 39.5 },
    { t: 'plant', x: 43.5, z: 64.5 },
    { t: 'plant', x: 84.5, z: 64.5 },
    { t: 'clock', x: 85.2, z: 50, f: 'w' },
    { t: 'books', x: 56, z: 60 },
    { t: 'tipchair', x: 72, z: 58 },
    { t: 'vase', x: 48, z: 46 },
    // ---- Long Corridor (x 2..86, z 30..36)
    { t: 'plant', x: 3.5, z: 33 },
    { t: 'plant', x: 84.5, z: 33 },
    { t: 'table', x: 17, z: 30.7, w: 3.2, d: 1.1, h: 0.9 },
    { t: 'table', x: 33, z: 30.7, w: 3.2, d: 1.1, h: 0.9 },
    { t: 'table', x: 56, z: 30.7, w: 3.2, d: 1.1, h: 0.9 },
    { t: 'frame', x: 66, z: 31 },
    { t: 'vase', x: 48, z: 34.5 },
    // ---- Ballroom (x 2..62, z 2..16)
    { t: 'piano', x: 10, z: 8 },
    { t: 'pillar', x: 22, z: 9 },
    { t: 'pillar', x: 34, z: 9 },
    { t: 'pillar', x: 48, z: 9 },
    { t: 'chair', x: 26, z: 3.2, f: 's' },
    { t: 'chair', x: 29, z: 3.2, f: 's' },
    { t: 'chair', x: 38, z: 3.2, f: 's' },
    { t: 'chair', x: 41, z: 3.2, f: 's' },
    { t: 'tipchair', x: 54, z: 12 },
    { t: 'frame', x: 55, z: 3 },
    { t: 'plant', x: 60.5, z: 3.5 },
    // ---- Rooftop Restaurant (x 64..86, z 2..28)
    { t: 'table', x: 70, z: 8, w: 3.2, d: 3.2 },
    { t: 'chair', x: 70, z: 5.6, f: 's' },
    { t: 'chair', x: 70, z: 10.4, f: 'n' },
    { t: 'table', x: 80, z: 8, w: 3.2, d: 3.2 },
    { t: 'chair', x: 80, z: 5.6, f: 's' },
    { t: 'chair', x: 80, z: 10.4, f: 'n' },
    { t: 'table', x: 70, z: 20, w: 3.2, d: 3.2 },
    { t: 'chair', x: 70, z: 17.6, f: 's' },
    { t: 'chair', x: 70, z: 22.4, f: 'n' },
    { t: 'table', x: 80, z: 20, w: 3.2, d: 3.2 },
    { t: 'chair', x: 80, z: 17.6, f: 's' },
    { t: 'chair', x: 80, z: 22.4, f: 'n' },
    { t: 'tipchair', x: 75, z: 14 },
    { t: 'plant', x: 85, z: 26.5 },
    { t: 'plant', x: 65.5, z: 26.5 },
    // ---- Room 101 (x 2..16, z 18..28)
    { t: 'sofa', x: 3.9, z: 23, w: 4.5, d: 1.7, f: 'e' },
    { t: 'armchair', x: 14, z: 20, f: 'w' },
    { t: 'books', x: 9, z: 24 },
    // ---- Room 102 (x 18..32, z 18..28)
    { t: 'sofa', x: 30.1, z: 23, w: 4.5, d: 1.7, f: 'w' },
    { t: 'armchair', x: 20, z: 26.4, f: 'e' },
    { t: 'vase', x: 20, z: 19.6 },
    // ---- Room 103 (x 34..48, z 18..28)
    { t: 'sofa', x: 35.9, z: 23, w: 4.5, d: 1.7, f: 'e' },
    { t: 'tipchair', x: 45, z: 26.4 },
    { t: 'plant', x: 46.5, z: 19.5 },
    // ---- Hotel Vault (secret, x 50..60, z 18..28)
    { t: 'statue', x: 55, z: 19.4 },
    { t: 'pillar', x: 58.8, z: 26.8 },
    { t: 'plant', x: 51.5, z: 26.5 },
    // ---- Spa (x 2..20, z 38..50)
    { t: 'fountain', x: 7, z: 44 },
    { t: 'plant', x: 3.5, z: 39.5 },
    { t: 'plant', x: 18.5, z: 39.5 },
    { t: 'pots', x: 3.5, z: 48.5 },
    { t: 'armchair', x: 16, z: 45, f: 'w', v: 1 },
    // ---- Library Lounge (x 22..40, z 38..50)
    { t: 'shelf', x: 24.6, z: 38.75, w: 4.4, d: 1.5, f: 's' },
    { t: 'shelf', x: 22.75, z: 45, w: 4, d: 1.5, f: 'e' },
    { t: 'globe', x: 38, z: 40 },
    { t: 'armchair', x: 37, z: 47, f: 'w' },
    { t: 'books', x: 31, z: 44 },
    // ---- Piano Bar (x 14..40, z 52..66)
    { t: 'counter', x: 27, z: 65.2, w: 8, d: 1.6, f: 'n' },
    { t: 'chair', x: 24, z: 62.4, f: 's' },
    { t: 'chair', x: 27, z: 62.4, f: 's' },
    { t: 'chair', x: 30, z: 62.4, f: 's' },
    { t: 'roundtable', x: 34, z: 55, w: 2.6 },
    { t: 'tipchair', x: 18, z: 60 },
    { t: 'plant', x: 38.5, z: 53.5 },
    { t: 'books', x: 25, z: 56 },
    // ---- Lost Luggage Room (secret, x 2..12, z 54..64)
    { t: 'statue', x: 7, z: 55.4 },
    { t: 'plant', x: 3.5, z: 62.5 },
    { t: 'pots', x: 10, z: 62.5 },
  ],
  rugs: [
    [54, 53, 74, 61, 'red'],
    [26, 42, 38, 48, 'green'],
    [5, 21, 13, 27, 'blue'],
  ],
  dock: { x: 64, z: 64.7 },
  lights: [
    { x: 32, y: 3.6, z: 9, int: 40, dist: 28, chands: [[20, 9, 1.0], [44, 9, 1.0]] },
    { x: 75, y: 3.6, z: 14, int: 32, dist: 22, chands: [[75, 14, 1.0]] },
    { x: 44, y: 3.4, z: 33, int: 26, dist: 30, chands: [[22, 33, 0.6], [66, 33, 0.6]] },
    { x: 64, y: 3.6, z: 50, int: 45, dist: 26, chands: [[64, 50, 1.2]] },
    { x: 27, y: 3.6, z: 58, int: 30, dist: 20, chands: [[27, 58, 0.9]] },
  ],
  paintings: [
    [14, 2, 0, 1.6, 1.2, 0],
    [48, 2, 0, 1.6, 1.2, 1],
    [17, 30, 0, 1.2, 1.0, 2],
    [33, 30, 0, 1.2, 1.0, 3],
    [56, 30, 0, 1.2, 1.0, 4],
    [50, 38, 0, 1.6, 1.2, 5],
    [83, 38, 0, 1.2, 1.0, 0],
  ],
  windows: [
    [30, 2, 0], [68, 2, 0], [80, 2, 0],
    [2, 23, P2], [2, 44, P2],
    [86, 14, -P2], [86, 46, -P2], [86, 58, -P2],
    [50, 66, PI], [78, 66, PI],
  ],
  walls: { paper: 0x23304f, wainscot: 0x1c1712 },
});

export const LEVELS: LevelDef[] = [MANOR, LODGE, HOTEL];
