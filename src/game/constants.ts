import { Door, LEVELS, LevelDef, Rug, SecretDoor } from './levels';

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
  /** Hidden room: walled off behind a fake wall until the roomba finds it. */
  secret?: boolean;
}

// ---- the building being cleaned: these are live bindings, swapped by setLevel()
export let LEVEL_INDEX = 0;
export let LEVEL: LevelDef = LEVELS[0];
export let ROOMS: RoomDef[] = LEVEL.rooms;
export let SECRET_DOORS: SecretDoor[] = LEVEL.secretDoors;
/** Doorways, including the secret ones (a secret door's tile belongs to its room). */
export let DOORS: Door[] = [];
export let FURNITURE: FurnDef[] = LEVEL.furniture;
export let RUGS: Rug[] = LEVEL.rugs;
export let DOCK = LEVEL.dock;

/** Switch to building n (wraps around after the last one). */
export function setLevel(n: number) {
  LEVEL_INDEX = n;
  LEVEL = LEVELS[n % LEVELS.length];
  ROOMS = LEVEL.rooms;
  SECRET_DOORS = LEVEL.secretDoors;
  DOORS = [...LEVEL.doors, ...SECRET_DOORS.map(([c, r, key]) => [c, r, 1, 1, key] as Door)];
  FURNITURE = LEVEL.furniture;
  RUGS = LEVEL.rugs;
  DOCK = LEVEL.dock;
}
setLevel(0);

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

/** Base stat multipliers a machine gives, on top of its upgrades. */
export type MachineStats = Record<UpKey, number>;
export interface MachineDef {
  name: string;
  icon: string;
  desc: string;
  /** Coins to buy it (once every upgrade on the previous machine is maxed). */
  price: number;
  mult: MachineStats;
  /** Upgrade prices on this machine are multiplied by this. */
  costMul: number;
  /** Half-width of the wet trail it leaves on tile floors (0: a dry machine). */
  mopR: number;
}
/**
 * The cleaning machines, in order. Buying the next one resets the upgrades so they can be bought again
 * for the new machine. Brush multipliers stay modest so the cleaning radius can never reach through a wall.
 */
export const MACHINES: MachineDef[] = [
  {
    name: 'Robo Vacuum', icon: '🤖', desc: 'Where every career starts.', price: 0, costMul: 1, mopR: 0,
    mult: { battery: 1, bin: 1, speed: 1, brush: 1, suction: 1, charger: 1 },
  },
  {
    name: 'Mop & Sweep Bot', icon: '🧽', desc: 'Sweeps, then mops behind itself. Mud doesn\'t stand a chance.', price: 600, costMul: 2, mopR: 0.62,
    mult: { battery: 1.2, bin: 1.25, speed: 1.05, brush: 1.15, suction: 1.5, charger: 1.2 },
  },
  {
    name: 'Auto Shop Vac', icon: '🌀', desc: 'A wet/dry canister vac that drives itself. Huge bin, huge suction.', price: 1500, costMul: 3.5, mopR: 0.55,
    mult: { battery: 1.4, bin: 2, speed: 1.1, brush: 1.3, suction: 2.2, charger: 1.4 },
  },
  {
    name: 'Floor Scrubber', icon: '🚜', desc: 'Industrial scrub deck and squeegee. Built for hotel lobbies.', price: 3500, costMul: 5, mopR: 0.85,
    mult: { battery: 1.8, bin: 2.6, speed: 1.15, brush: 1.45, suction: 3, charger: 1.7 },
  },
  {
    name: 'Hover Cleaner', icon: '🛸', desc: 'Floats on a cushion of air. Cleans like it\'s from the future.', price: 7000, costMul: 7, mopR: 0,
    mult: { battery: 2.2, bin: 3.2, speed: 1.3, brush: 1.6, suction: 4, charger: 2 },
  },
];

/** Coins for the next level of an upgrade on a given machine. */
export function upgradeCost(u: UpgradeDef, lvl: number, machine: number) {
  return Math.round(u.costs[lvl] * MACHINES[Math.min(machine, MACHINES.length - 1)].costMul);
}
