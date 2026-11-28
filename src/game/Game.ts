import * as THREE from 'three';
import {
  CLEAR_THRESHOLD, COLS, DOCK, LEVEL, MACHINES, upgradeCost, NIGHT_LENGTH, ROOMBA_R, ROOMS, ROWS, TILE, UPGRADES, UpKey, WALL_H, setLevel,
} from './constants';
import { DirtMap, UNIT, makeRng } from './dirt';
import { LEVELS, LevelDef } from './levels';
import { setMachineLook, buildGrid, buildWorld, enableShadows, ShadowCache, ghostTexture, MessItem, MessPart, PART_ANIM, World } from './world';
import { Sfx } from './audio';
import { CollisionWorld, Engine, FollowCamera, Input, Mover, Particles, Popups, Squash, lerpAngle, poseBody } from '../../engine/src';
import { AUTO_ID, RunSnapshot, SAVE_VERSION, SaveMeta, decodeBytes, deleteSave, encodeBytes, writeSave } from './saves';

export type Phase = 'menu' | 'intro' | 'playing' | 'paused' | 'shop' | 'gameover' | 'tidy';

interface TidyScene {
  room: number;
  items: MessItem[];
  idx: number;
  t: number;
  stage: 'travel' | 'anim' | 'hold' | 'return';
  camPos: THREE.Vector3;
  look: THREE.Vector3;
  lifted: Set<MessPart>;
  landed: Set<MessPart>;
}
export type ToastKind = 'info' | 'good' | 'warn' | 'bad' | 'big';

export interface HudState {
  battery: number;
  batteryMax: number;
  bin: number;
  binCap: number;
  coins: number;
  score: number;
  mult: number;
  comboT: number;
  time: number;
  roomName: string;
  roomPct: number;
  roomCleared: boolean;
  roomsCleared: number;
  roomsTotal: number;
  docked: boolean;
  overall: number;
  upgrades: Record<UpKey, number>;
  /** Index into MACHINES. */
  machine: number;
  /** Machines owned (MACHINES[0..owned-1]); any of them can be switched to on the dock. */
  owned: number;
  /** Every upgrade on the newest machine maxed, so the next machine can be bought. */
  allMaxed: boolean;
  /** Upgrade levels of the newest machine (drives the unlock progress). */
  bestUpgrades: Record<UpKey, number>;
  turbo: boolean;
  homeHint: boolean;
  secretsFound: number;
  secretsTotal: number;
  levelName: string;
  /** 1-based building number. */
  levelNum: number;
  /** Name of the next building once this one is done, else null. */
  nextLevel: string | null;
}

export interface GameOverInfo {
  reason: 'battery' | 'dawn';
  score: number;
  rooms: number;
  clears: number;
  overall: number;
  time: number;
  coinsEarned: number;
  bonus: number;
  /** Coins in hand when the run ended. */
  coins: number;
  /** Nights fully survived (dawns reached) this run. */
  nights: number;
  /** Building reached (1-based) and its name / room count. */
  levelNum: number;
  levelName: string;
  roomsTotal: number;
  /** Coins it costs to recharge and keep playing after the battery dies, or 0 if you can't afford it. */
  reviveCost: number;
}

const AMBIENT_NIGHT = new THREE.Color(0xb8b0d8);
const AMBIENT_DAWN = new THREE.Color(0xffc88a);

/** Minimum coins to revive after a dead battery; with 500+ coins it costs half of them instead. */
export const REVIVE_MIN = 250;
export function reviveCost(coins: number) {
  if (coins < REVIVE_MIN) return 0;
  return coins >= 500 ? Math.floor(coins / 2) : REVIVE_MIN;
}

export interface GameCallbacks {
  onPhase: (p: Phase) => void;
  onHud: (h: HudState) => void;
  /** `detail` is a second line: used by 'big' banners for the reward or the name. */
  onToast: (text: string, kind: ToastKind, detail?: string) => void;
  onCaption: (text: string | null, big?: boolean) => void;
  onGameOver: (info: GameOverInfo) => void;
  onMute: (m: boolean) => void;
  /** Fired whenever a save is written or the autosave is cleared, so menus can refresh. */
  onSaves?: () => void;
}

interface Coin { x: number; z: number; active: boolean; phase: number }
export type DevCheat =
  | 'secrets' | 'nextLevel'
  | 'coins100' | 'coins1000' | 'battery' | 'infBattery' | 'emptyBin' | 'maxUpgrades'
  | 'cleanRoom' | 'cleanAll' | 'ghost' | 'hour' | 'dawn' | 'freezeTime' | 'dock';

interface Ghost { room: number; steps: { x: number; z: number; a: number; left: boolean; s: number }[]; idx: number; timer: number; x: number; z: number; fade: number; caught?: boolean; spin?: number; spinT?: number }

const AUTOSAVE_EVERY = 15;

const emptyUpgrades = (): Record<UpKey, number> => ({ battery: 0, bin: 0, speed: 0, brush: 0, suction: 0, charger: 0 });

export class Game {
  /** Renderer, frame loop, resizing and adaptive resolution live in the shared engine. */
  engine: Engine;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  world!: World;
  dirt!: DirtMap;
  grid!: Int8Array;
  /** Building index (0 = Blackwood Manor); counts on past the last building as it loops round. */
  level = -1;
  /** Every regular room of this building has been spotless at once, so the next building is open. */
  levelDone = false;
  dust: Particles;
  glow: Particles;
  sfx = new Sfx();
  phase: Phase = 'menu';
  cb: GameCallbacks;
  container: HTMLElement;
  popupLayer: HTMLElement;
  minimap: HTMLCanvasElement | null = null;
  isTouch: boolean;

  // input (keyboard + touch stick)
  controls: Input;

  // run state
  time = 0;
  score = 0;
  coins = 0;
  coinsEarned = 0;
  coinFrac = 0;
  battery = 100;
  bin = 0;
  binBase = 100;
  /** Every machine bought so far (index = MACHINES index), each with its own upgrade levels. */
  garage: Record<UpKey, number>[] = [emptyUpgrades()];
  /** Which cleaning machine you're driving (index into MACHINES and garage). */
  machine = 0;
  /** Upgrade levels of the machine being driven. */
  get up() { return this.garage[this.machine]; }
  set up(v: Record<UpKey, number>) { this.garage[this.machine] = v; }
  mult = 1;
  comboTime = 0;
  comboTimer = 0;
  cleared: boolean[] = ROOMS.map(() => false);
  clearedOnce: boolean[] = ROOMS.map(() => false);
  clears = 0;
  docked = false;
  dockLock = false;
  /** Set once the drive input has been let go after docking, so the push that docked you can't undock you. */
  undockArmed = false;
  dockHinted = false;
  fullHinted = false;
  dying = 0;
  ending: 'battery' | 'dawn' | null = null;
  endTimer = 0;
  warned30 = false;
  warned12 = false;
  critBeep = 0;
  binWarned = false;
  ghost: Ghost | null = null;
  nextGhost = 40;
  hourAnnounced = 0;
  /** Seconds left on the warm sunrise glow after a dawn. */
  dawnGlow = 0;
  /** Night index the whole-manor bonus was last paid in (-1: never). */
  manorBonusNight = -1;
  curRoom = -1;
  /** Rooms the roomba has driven into this run; the rest stay blurred on the minimap. */
  explored: boolean[] = ROOMS.map(() => false);
  /** Per world.secrets entry: found (wall gone or going). */
  secretFound: boolean[] = [];
  /** Per secret: seconds of pushing against it / sinking animation progress 0..1. */
  secretPush: number[] = [];
  secretAnim: number[] = [];
  secretHintT = 0;
  private bulbs: { level: number; target: number; hold: number; burst: number; burstT: number; burstV: number; dip: number }[] = [];
  turbo = false;
  homeHint = false;
  // developer cheats (only reachable through the ?devmode=true menu)
  devInfBattery = false;
  devFreezeTime = false;
  /** True while playtesting a custom level from the designer: suppresses saving so the real autosave is untouched. */
  isPlaytest = false;

  // roomba physics: the engine's mover (eased velocity, lean, bouncy substepped collision)
  mover = new Mover({ radius: ROOMBA_R });
  /** Squash-and-stretch spring and hop. */
  squash = new Squash();
  collision!: CollisionWorld;
  bumpCd = 0;
  blinkT = 2;
  get px() { return this.mover.x; }
  set px(v: number) { this.mover.x = v; }
  get pz() { return this.mover.z; }
  set pz(v: number) { this.mover.z = v; }
  get vx() { return this.mover.vx; }
  set vx(v: number) { this.mover.vx = v; }
  get vz() { return this.mover.vz; }
  set vz(v: number) { this.mover.vz = v; }
  get yaw() { return this.mover.yaw; }
  set yaw(v: number) { this.mover.yaw = v; }

  // camera: the engine's leading follow camera with trauma shake and turbo FOV kick
  cam: FollowCamera;
  introT = 0;
  introStage = 0;
  menuT = 0;
  flashT = 0;

  // misc
  coinsList: Coin[] = [];
  coinMesh: THREE.InstancedMesh;
  /** Redraws the chandeliers' shadow maps only when something they show has moved. */
  private shadowCache!: ShadowCache;
  ghostSprite: THREE.Sprite;
  arrow: THREE.Group;
  popups: Popups;
  distField!: Int16Array;
  roomTiles: number[][] = ROOMS.map(() => []);
  rng = makeRng(Date.now() & 0xffff);
  hudT = 0;
  mapT = 0;
  /** Seconds since the last autosave while playing. */
  autosaveT = 0;
  private tmpV = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();

  constructor(container: HTMLElement, popupLayer: HTMLElement, cb: GameCallbacks) {
    this.container = container;
    this.popupLayer = popupLayer;
    this.cb = cb;
    this.engine = new Engine(container, {
      update: this.frame,
      adaptive: () => this.phase === 'playing',
      onBlur: this.onBlur,
      fov: 50, near: 0.1, far: 220,
      shadows: true,
    });
    this.isTouch = this.engine.isTouch;
    this.renderer = this.engine.renderer;
    this.camera = this.engine.camera;
    this.cam = new FollowCamera(this.camera, {}, this.engine.syncProjection);
    this.cam.focus.set(DOCK.x, 0, DOCK.z);
    this.controls = new Input({
      capture: () => this.phase === 'playing' || this.phase === 'intro',
      onKey: this.onKey,
    });
    this.popups = new Popups(container, { layer: popupLayer, className: 'cs-popup' });
    // particles move between level scenes, so buildLevel adds them to each new scene
    this.dust = this.engine.addParticles(700, false, false);
    this.glow = this.engine.addParticles(500, true, false);

    // coins
    const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 18);
    coinGeo.rotateX(Math.PI / 2);
    this.coinMesh = new THREE.InstancedMesh(coinGeo, new THREE.MeshPhongMaterial({ color: 0xffc43a, emissive: 0x6a4000, shininess: 120, specular: 0xffffff }), 48);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.frustumCulled = false;
    for (let i = 0; i < 48; i++) this.coinsList.push({ x: 0, z: 0, active: false, phase: Math.random() * 6 });

    // ghost — a proper spectral figure with hollow eyes, waving arms, and a wispy tail
    this.ghostSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ghostTexture(), transparent: true, depthWrite: false, blending: THREE.NormalBlending, opacity: 0.9,
    }));
    this.ghostSprite.scale.set(2.6, 2.6, 1);
    this.ghostSprite.visible = false;

    // home arrow
    this.arrow = new THREE.Group();
    const am = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, depthTest: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 12), am);
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 0.9;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.6), am);
    shaft.position.z = 0.4;
    this.arrow.add(cone, shaft);
    this.arrow.renderOrder = 20;
    this.arrow.visible = false;

    this.buildLevel(0);
    this.resetRun();
    this.setRoombaPower(0);
    window.addEventListener('pagehide', this.onPageHide);
    this.engine.start(); // warms up shaders, then runs frame() every animation frame
  }

  /** Tear down the current building (if any) and build building n in its place. */
  private buildLevel(n: number) {
    const old = this.world;
    if (old) {
      old.scene.remove(this.dust.points, this.glow.points, this.coinMesh, this.ghostSprite, this.arrow);
      const keep = new Set<unknown>([this.dust.points, this.glow.points, this.coinMesh, this.ghostSprite, this.arrow]);
      const mats = new Set<THREE.Material>();
      old.scene.traverse((o) => {
        if (keep.has(o)) return;
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
      });
      for (const m of mats) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
      this.dirt.tex.dispose();
      this.dirt.wetTex.dispose();
    }
    setLevel(n);
    this.level = n;
    this.grid = buildGrid();
    this.dirt = new DirtMap(this.grid);
    this.dirt.dustMul = 1 + 0.15 * n;
    this.world = buildWorld(this.dirt.tex, this.grid, this.dirt.wetTex);
    enableShadows(this.world, this.renderer);
    this.shadowCache = new ShadowCache(this.world);
    setMachineLook(this.world.roomba, this.machine);
    this.engine.scene = this.world.scene;
    const grid = this.grid;
    // walls are the grid's non-room tiles; furniture and secret doors are boxes (spliced in place as secrets open)
    this.collision = { boxes: this.world.boxes, grid: { cols: COLS, rows: ROWS, tile: TILE, solid: (c, r) => grid[r * COLS + c] < 0 } };
    this.dirt.buildMask(this.world.boxes);
    this.roomTiles = ROOMS.map(() => []);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const id = this.grid[r * COLS + c];
      if (id >= 0) this.roomTiles[id].push(r * COLS + c);
    }
    this.cleared = ROOMS.map(() => false);
    this.clearedOnce = ROOMS.map(() => false);
    this.explored = ROOMS.map(() => false);
    this.secretFound = this.world.secrets.map(() => false);
    this.secretPush = this.world.secrets.map(() => 0);
    this.secretAnim = this.world.secrets.map(() => 0);
    for (const sd of this.world.secrets) this.dirt.setTileMask(sd.c, sd.r, false);
    this.distField = this.bfs();
    this.bulbs = [];
    this.tidyQueue = [];
    this.tidy = null;
    this.world.scene.add(this.dust.points, this.glow.points, this.coinMesh, this.ghostSprite, this.arrow);
    if (old) {
      this.setPhase(this.phase); // re-apply cutaway, fog and ceiling visibility to the new scene
      this.renderer.compile(this.world.scene, this.camera);
    }
  }

  /** Fresh dirt, coins and per-room state for the current building; the roomba waits on its dock. */
  private resetBuilding() {
    for (const m of this.world.mess) this.world.setMessState(m, false);
    this.tidyQueue = [];
    this.tidyDelay = 0;
    this.tidy = null;
    this.world.secrets.forEach((_, k) => this.setSecret(k, false));
    this.distField = this.bfs();
    this.dirt.generate(Math.floor(Math.random() * 1e6));
    this.dirt.clearWet();
    this.binBase = Math.max(70, Math.min(220, this.dirt.totalUnits() * 0.12));
    this.battery = this.batteryMax;
    this.bin = 0;
    this.cleared = ROOMS.map(() => false);
    this.clearedOnce = ROOMS.map(() => false);
    this.levelDone = false;
    this.docked = true;
    this.dockLock = true;
    this.undockArmed = false;
    this.dying = 0;
    this.warned30 = this.warned12 = this.binWarned = false;
    this.ghost = null;
    this.ghostSprite.visible = false;
    this.manorBonusNight = -1;
    this.curRoom = -1;
    this.explored = ROOMS.map(() => false);
    this.px = DOCK.x; this.pz = DOCK.z; this.vx = 0; this.vz = 0; this.yaw = Math.PI;
    this.squash.reset();
    this.cam.trauma = 0;
    this.dust.clear();
    this.glow.clear();
    this.popups.clear();
    for (const c of this.coinsList) c.active = false;
    // instant-gratification coins in front of the dock
    this.placeCoin(DOCK.x, DOCK.z - 4.2); this.placeCoin(DOCK.x - 2.5, DOCK.z - 7.7); this.placeCoin(DOCK.x + 2.5, DOCK.z - 11.2);
    ROOMS.forEach((r, i) => { for (let n = r.secret ? 5 : 2; n > 0; n--) this.spawnCoin(i); });
    this.world.roomba.group.position.set(this.px, 0, this.pz);
    this.world.roomba.group.rotation.y = this.yaw;
  }

  /** Name of the building after this one. */
  get nextLevelName() { return LEVELS[(this.level + 1) % LEVELS.length].name; }

  /** Move on to the next building once this one has been made spotless. Score, coins, upgrades and the clock carry over. */
  nextLevel() {
    if (this.phase !== 'playing' || !this.levelDone || this.ending) return false;
    this.cb.onCaption(null);
    this.buildLevel(this.level + 1);
    this.resetBuilding();
    this.mult = 1;
    this.comboTime = this.comboTimer = 0;
    this.nextGhost = 30;
    this.setRoombaPower(1);
    this.snapCamera();
    this.engine.resetClock();
    this.sfx.dawn();
    this.bootFx();
    const lap = Math.floor(this.level / LEVELS.length);
    this.cb.onCaption(`🏠 BUILDING ${this.level + 1}: ${LEVEL.name.toUpperCase()}${lap ? ` (ROUND ${lap + 1})` : ''}`, true);
    setTimeout(() => { if (this.phase === 'playing') this.cb.onCaption(null); }, 2600);
    setTimeout(() => { if (this.phase === 'playing') this.cb.onToast(LEVEL.blurb, 'info'); }, 2800);
    this.pushHud();
    this.drawMinimap();
    this.autosave();
    return true;
  }

  dispose() {
    this.controls.dispose();
    this.popups.dispose();
    window.removeEventListener('pagehide', this.onPageHide);
    this.engine.dispose();
  }

  // ------------------------------------------------------------ derived stats
  get mach() { return MACHINES[Math.min(this.machine, MACHINES.length - 1)].mult; }
  get batteryMax() { return 100 * (1 + 0.25 * this.up.battery) * this.mach.battery; }
  get binCap() { return this.binBase * (1 + 0.35 * this.up.bin) * this.mach.bin; }
  get speedMax() { return 5.8 * (1 + 0.1 * this.up.speed) * this.mach.speed; }
  // capped so the brushes can never reach through a 2-unit wall into the next room
  get brushR() { return Math.min(2.4, 0.85 * (1 + 0.15 * this.up.brush) * this.mach.brush); }
  get suction() { return 4.4 * (1 + 0.3 * this.up.suction) * this.mach.suction; }
  get chargeRate() { return 24 * (1 + 0.6 * this.up.charger) * this.mach.charger; }
  get emptyRate() { return this.binCap * 0.55 * (1 + 0.6 * this.up.charger) * this.mach.charger; }

  /** Newest machine owned. */
  get bestMachine() { return this.garage.length - 1; }
  /** Every upgrade on the newest machine is maxed, so the next one can be bought. */
  get allMaxed() { return UPGRADES.every((u) => this.garage[this.bestMachine][u.key] >= u.costs.length); }

  /** Buy the next machine (needs every upgrade on the newest one maxed) and switch to it; its upgrades start from zero. */
  buyMachine() {
    const next = MACHINES[this.garage.length];
    if (!next || !this.allMaxed || (this.phase !== 'shop' && this.phase !== 'playing')) return false;
    if (this.coins < next.price) { this.sfx.deny(); return false; }
    this.coins -= next.price;
    this.garage.push(emptyUpgrades());
    this.machine = this.bestMachine;
    this.battery = this.batteryMax;
    this.bin = Math.min(this.bin, this.binCap);
    setMachineLook(this.world.roomba, this.machine);
    this.sfx.buy();
    this.sfx.dawn();
    this.squash.jump(6);
    this.addTrauma(0.3);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      this.glow.spawn(this.px, 0.4, this.pz, Math.cos(a) * 6, 2 + Math.random() * 3, Math.sin(a) * 6, 0.5, 1, 0.9, 0.4, 1, 4);
    }
    this.cb.onToast('New machine', 'big', next.name);
    this.autosaveT = Math.max(this.autosaveT, AUTOSAVE_EVERY - 1);
    this.pushHud();
    return true;
  }

  // ------------------------------------------------------------ public API
  setMinimap(c: HTMLCanvasElement | null) { this.minimap = c; }

  startRun(withIntro: boolean, level = 0) {
    this.sfx.unlock();
    this.resetRun(level);
    if (withIntro) {
      this.introT = 0;
      this.introStage = 0;
      this.setRoombaPower(0);
      this.setPhase('intro');
    } else {
      this.setRoombaPower(1);
      this.beginPlay(false);
    }
  }

  skipIntro() {
    if (this.phase !== 'intro') return;
    this.cb.onCaption(null);
    if (this.introT < 8.6) {
      this.sfx.boot();
      this.bootFx();
    }
    this.beginPlay(true);
  }

  pause() { if (this.phase === 'playing' && !this.ending) { this.setPhase('paused'); this.sfx.hum(0, 0); this.autosave(); } }
  resume() { if (this.phase === 'paused') { this.setPhase('playing'); this.engine.resetClock(); } }
  openShop() { if (this.phase === 'playing' && this.docked && !this.ending) { this.setPhase('shop'); this.sfx.click(); this.sfx.hum(0, 0); this.pushHud(); } }
  closeShop() { if (this.phase === 'shop') { this.setPhase('playing'); this.sfx.click(); this.autosave(); } }
  toMenu() { this.autosave(); this.cb.onCaption(null); this.resetRun(); this.setRoombaPower(0); this.setPhase('menu'); this.sfx.hum(0, 0); }
  toggleMute() { this.sfx.setMuted(!this.sfx.muted); this.cb.onMute(this.sfx.muted); }
  setJoystick(x: number, y: number, active: boolean) { this.controls.setJoystick(x, y, active); }

  /**
   * Drop a custom LevelDef (from the level designer) into the rotation and start a fresh run on it,
   * so a design can be playtested immediately. Replaces an existing entry with the same key.
   * Falls back to the menu if the level can't be built, so the player is never stranded.
   */
  playCustomLevel(level: LevelDef) {
    try {
      let idx = LEVELS.findIndex((l) => l.key === level.key);
      if (idx < 0) { LEVELS.push(level); idx = LEVELS.length - 1; }
      else LEVELS[idx] = level;
      this.startRun(false, idx);
      this.isPlaytest = true; // suppress autosaves so the real game's saves are untouched
    } catch (e) {
      console.error('playCustomLevel failed', e);
      this.cb.onToast('That level could not be built. Back to the editor.', 'bad');
      this.toMenu();
    }
  }
  setTurbo(b: boolean) { this.controls.setBoost(b); }

  /** Swap to another machine you already own; only on the dock. Battery keeps its charge level as a fraction. */
  switchMachine(i: number) {
    if (i === this.machine || i < 0 || i >= this.garage.length) return false;
    if (!(this.phase === 'shop' || (this.phase === 'playing' && this.docked)) || this.ending) return false;
    const frac = this.battery / this.batteryMax;
    this.machine = i;
    this.battery = frac * this.batteryMax;
    this.bin = Math.min(this.bin, this.binCap);
    setMachineLook(this.world.roomba, i);
    this.sfx.click();
    this.sfx.buy();
    this.squash.jump(4);
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2;
      this.glow.spawn(this.px, 0.4, this.pz, Math.cos(a) * 4, 1.5 + Math.random() * 2, Math.sin(a) * 4, 0.5, 1, 0.9, 0.3, 0.8, 4);
    }
    this.autosaveT = Math.max(this.autosaveT, AUTOSAVE_EVERY - 1);
    this.pushHud();
    return true;
  }

  buy(key: UpKey) {
    const def = UPGRADES.find((u) => u.key === key)!;
    const lvl = this.up[key];
    if (lvl >= def.costs.length) return false;
    const cost = upgradeCost(def, lvl, this.machine);
    if (this.coins < cost) { this.sfx.deny(); return false; }
    this.coins -= cost;
    const oldMax = this.batteryMax;
    this.up[key]++;
    if (key === 'battery') this.battery += this.batteryMax - oldMax;
    this.sfx.buy();
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      this.glow.spawn(this.px, 0.4, this.pz, Math.cos(a) * 4, 2 + Math.random() * 2, Math.sin(a) * 4, 1, 0.8, 0.3, 0.35, 0.8, 4);
    }
    this.pushHud();
    return true;
  }

  // ------------------------------------------------------------ developer cheats
  /** Run a cheat from the dev menu. Returns a short description for feedback, or null if it can't run now. */
  devCheat(cmd: DevCheat): string | null {
    // Dev cheats are a debugging tool — they work in any play state, including playtests from the
    // level designer (where canSave is false). Only bail out if there's no live run at all.
    if (this.phase === 'menu' || this.phase === 'intro' || this.ending) return null;
    switch (cmd) {
      case 'coins100': this.coins += 100; break;
      case 'coins1000': this.coins += 1000; break;
      case 'battery':
        this.battery = this.batteryMax;
        this.warned30 = this.warned12 = false;
        break;
      case 'infBattery': this.devInfBattery = !this.devInfBattery; break;
      case 'emptyBin': this.bin = 0; this.binWarned = false; this.fullHinted = false; break;
      case 'maxUpgrades': {
        const oldMax = this.batteryMax;
        for (const u of UPGRADES) this.up[u.key] = u.costs.length;
        this.battery += this.batteryMax - oldMax;
        break;
      }
      case 'cleanRoom': {
        const r = this.curRoom >= 0 ? this.curRoom : 0;
        if (this.cleared[r]) return 'Room already spotless';
        this.clearRoom(r);
        break;
      }
      case 'cleanAll':
        for (let i = 0; i < ROOMS.length; i++) if (!this.cleared[i] && this.dirt.counted[i]) this.clearRoom(i);
        break;
      case 'nextLevel':
        this.levelDone = true;
        if (!this.nextLevel()) return null;
        break;
      case 'secrets': {
        const left = this.world.secrets.map((_, k) => k).filter((k) => !this.secretFound[k]);
        if (!left.length) return 'All secrets already found';
        left.forEach((k) => this.discoverSecret(k));
        break;
      }
      case 'ghost': if (!this.ghost) this.nextGhost = 0; break;
      case 'hour': this.time += NIGHT_LENGTH / 5; break;
      case 'dawn': this.time = Math.max(this.time, (this.night + 1) * NIGHT_LENGTH - 5); break;
      case 'freezeTime': this.devFreezeTime = !this.devFreezeTime; break;
      case 'dock':
        this.px = DOCK.x; this.pz = DOCK.z; this.vx = this.vz = 0;
        if (this.phase === 'playing') this.snapCamera();
        break;
    }
    this.pushHud();
    return cmd;
  }

  // ------------------------------------------------------------ save / load
  /** True while there's a live run that can be saved. */
  get canSave() {
    return (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'shop' || this.phase === 'tidy') && !this.ending && !this.isPlaytest;
  }

  serialize(): RunSnapshot {
    const tidyQueue = [...this.tidyQueue];
    // a cutscene in progress is replayed from the start of that room on load
    if (this.tidy && !tidyQueue.includes(this.tidy.room)) tidyQueue.unshift(this.tidy.room);
    const g = this.ghost;
    return {
      v: SAVE_VERSION,
      time: this.time,
      score: this.score,
      coins: this.coins,
      coinsEarned: this.coinsEarned,
      coinFrac: this.coinFrac,
      battery: this.battery,
      bin: this.bin,
      binBase: this.binBase,
      up: { ...this.up },
      machine: this.machine,
      garage: this.garage.map((g) => ({ ...g })),
      mult: this.mult,
      comboTime: this.comboTime,
      comboTimer: this.comboTimer,
      cleared: [...this.cleared],
      clearedOnce: [...this.clearedOnce],
      clears: this.clears,
      docked: this.docked,
      warned30: this.warned30,
      warned12: this.warned12,
      binWarned: this.binWarned,
      ghost: g ? { room: g.room, steps: g.steps.map((s) => ({ ...s })), idx: g.idx, timer: g.timer, x: g.x, z: g.z, fade: g.fade, caught: g.caught } : null,
      nextGhost: this.nextGhost,
      hourAnnounced: this.hourAnnounced,
      px: this.px,
      pz: this.pz,
      yaw: this.yaw,
      coinSpots: this.coinsList.filter((c) => c.active).map((c) => [c.x, c.z] as [number, number]),
      messTidy: this.world.mess.map((m) => m.tidy),
      tidyQueue,
      dirtTotal: Array.from(this.dirt.total),
      explored: [...this.explored],
      level: this.level,
      levelDone: this.levelDone,
      manorBonusNight: this.manorBonusNight,
      secrets: [...this.secretFound],
      dirt: encodeBytes(this.dirt.data),
      dirtLen: this.dirt.data.length,
    };
  }

  private saveMeta() {
    return {
      time: this.time,
      score: Math.round(this.score),
      coins: this.coins,
      roomsCleared: this.roomsCleanNow(),
      roomsTotal: this.roomCount(),
      level: this.level,
      levelName: LEVEL.name,
      overall: this.dirt.overall(),
    };
  }

  /** Write the current run to a save slot (new manual slot when id is omitted). */
  saveGame(id?: string, name?: string): SaveMeta | null {
    if (!this.canSave) return null;
    const meta = writeSave(this.serialize(), this.saveMeta(), id, name);
    if (meta) this.cb.onSaves?.();
    return meta;
  }

  autosave() {
    if (!this.canSave || this.time <= 0) return;
    this.autosaveT = 0;
    writeSave(this.serialize(), this.saveMeta(), AUTO_ID);
    this.cb.onSaves?.();
  }

  /** Resume a saved run. */
  loadGame(run: RunSnapshot) {
    this.sfx.unlock();
    this.cb.onCaption(null);
    this.resetRun(run.level ?? 0);
    this.time = run.time;
    this.score = run.score;
    this.coins = run.coins;
    this.coinsEarned = run.coinsEarned;
    this.coinFrac = run.coinFrac;
    this.binBase = run.binBase;
    this.machine = Math.min(MACHINES.length - 1, run.machine ?? 0);
    if (run.garage?.length) {
      this.garage = run.garage.slice(0, MACHINES.length).map((g) => ({ ...emptyUpgrades(), ...g }));
      this.machine = Math.min(this.machine, this.garage.length - 1);
    } else {
      // older saves: the machines before the current one were all maxed when you traded up
      const maxed = () => Object.fromEntries(UPGRADES.map((u) => [u.key, u.costs.length])) as Record<UpKey, number>;
      this.garage = [...Array.from({ length: this.machine }, maxed), { ...emptyUpgrades(), ...run.up }];
    }
    setMachineLook(this.world.roomba, this.machine);
    this.battery = Math.min(this.batteryMax, run.battery);
    this.bin = run.bin;
    this.mult = run.mult;
    this.comboTime = run.comboTime;
    this.comboTimer = run.comboTimer;
    this.cleared = ROOMS.map((_, i) => !!run.cleared[i]);
    this.clearedOnce = ROOMS.map((_, i) => !!run.clearedOnce[i]);
    this.clears = run.clears;
    this.warned30 = run.warned30;
    this.warned12 = run.warned12;
    this.binWarned = run.binWarned;
    this.nextGhost = run.nextGhost;
    this.hourAnnounced = run.hourAnnounced;
    this.fullHinted = true;
    this.dockHinted = true;
    this.explored = ROOMS.map((_, i) => !!run.explored?.[i]);
    this.levelDone = run.levelDone ?? ROOMS.every((r, k) => r.secret || this.clearedOnce[k]);
    // older saves didn't track it: assume this night's bonus is taken if the manor is already spotless
    this.manorBonusNight = run.manorBonusNight ?? (ROOMS.every((r, k) => r.secret || this.cleared[k]) ? this.night : -1);
    this.world.secrets.forEach((_, k) => this.setSecret(k, !!run.secrets?.[k]));
    this.distField = this.bfs();

    // dirt: restore the texture and recompute each room's running sum from it
    const d = this.dirt;
    d.data.set(decodeBytes(run.dirt, d.data.length));
    d.sum.fill(0);
    for (let k = 0; k < d.data.length; k++) {
      const rid = d.room[k];
      if (rid >= 0 && d.data[k]) d.sum[rid] += d.data[k];
    }
    for (let i = 0; i < ROOMS.length; i++) d.total[i] = run.dirtTotal[i] ?? Math.max(1, d.sum[i]);
    d.dirty = true;

    this.world.mess.forEach((m, i) => this.world.setMessState(m, !!run.messTidy[i]));
    this.tidyQueue = run.tidyQueue.filter((r) => this.world.mess.some((m) => m.room === r && !m.tidy));
    this.tidyDelay = this.tidyQueue.length ? 1.2 : 0;

    for (const c of this.coinsList) c.active = false;
    for (const [x, z] of run.coinSpots) this.placeCoin(x, z);

    if (run.ghost && run.ghost.steps.length) {
      this.ghost = { ...run.ghost, steps: run.ghost.steps.map((s) => ({ ...s })) };
      this.ghostSprite.visible = true;
    }

    this.docked = run.docked;
    this.dockLock = true;
    this.undockArmed = false;
    if (run.docked) { this.px = DOCK.x; this.pz = DOCK.z; this.yaw = Math.PI; }
    else { this.px = run.px; this.pz = run.pz; this.yaw = run.yaw; }
    this.world.roomba.group.position.set(this.px, 0, this.pz);
    this.world.roomba.group.rotation.y = this.yaw;

    this.setRoombaPower(1);
    this.world.ambient.intensity = 0.75;
    this.world.hemi.intensity = 0.8;
    this.snapCamera();
    this.setPhase('playing');
    this.engine.resetClock();
    this.pushHud();
    this.drawMinimap();
    this.cb.onToast('Shift resumed. Welcome back.', 'good');
  }

  // ------------------------------------------------------------ internals
  private setPhase(p: Phase) {
    this.phase = p;
    const playCam = p === 'playing' || p === 'paused' || p === 'shop' || p === 'gameover' || p === 'tidy';
    this.world.cut.uCut.value = playCam ? 1 : 0;
    this.world.introGroup.visible = !playCam;
    const fog = this.world.scene.fog as THREE.Fog;
    if (p === 'menu') { fog.near = 120; fog.far = 280; }
    else if (p === 'intro') { fog.near = 8; fog.far = 46; }
    else if (p === 'tidy') { fog.near = 70; fog.far = 160; }
    else { fog.near = 26; fog.far = 58; }
    this.cb.onPhase(p);
  }

  private beginPlay(fromIntro: boolean) {
    this.setRoombaPower(1);
    this.world.ambient.intensity = 0.75;
    this.world.hemi.intensity = 0.8;
    this.snapCamera();
    this.setPhase('playing');
    this.engine.resetClock();
    this.cb.onCaption(null);
    setTimeout(() => {
      if (this.phase !== 'playing' && this.phase !== 'paused') return;
      this.cb.onToast(this.isTouch ? 'Drag anywhere to drive · Hold Turbo to boost' : 'WASD or arrows to drive · Shift for turbo', 'info');
    }, fromIntro ? 300 : 100);
    setTimeout(() => {
      if (this.phase === 'playing') this.cb.onToast('Clean rooms to 100% for coins. Every dawn pays a bonus.', 'good');
    }, 3200);
  }

  resetRun(level = 0) {
    if (this.level !== level) this.buildLevel(level);
    this.isPlaytest = false;
    this.time = 0;
    this.autosaveT = 0;
    this.score = 0;
    this.coins = 0;
    this.coinsEarned = 0;
    this.coinFrac = 0;
    this.garage = [emptyUpgrades()];
    this.machine = 0;
    setMachineLook(this.world.roomba, 0);
    this.mult = 1;
    this.comboTime = 0;
    this.comboTimer = 0;
    this.clears = 0;
    this.dockHinted = false;
    this.fullHinted = true;
    this.ending = null;
    this.endTimer = 0;
    this.nextGhost = 38;
    this.hourAnnounced = 0;
    this.dawnGlow = 0;
    this.resetBuilding();
  }

  private setRoombaPower(p: number) {
    const r = this.world.roomba;
    r.light.intensity = 12 * p;
    r.glow.material.opacity = p;
    r.ledMat.color.setRGB(0, 0.9 * p, p);
    r.eyeMat.color.setRGB(0.75 * p, 0.99 * p, p);
    r.eyes.forEach((e) => (e.scale.z = 0.2 + 0.8 * p));
  }

  private bootFx() {
    this.squash.jump(4);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      this.glow.spawn(this.px, 0.35, this.pz, Math.cos(a) * 5, 0.5, Math.sin(a) * 5, 0.3, 0.9, 1, 0.3, 0.7, 0);
    }
  }

  private placeCoin(x: number, z: number) {
    const c = this.coinsList.find((k) => !k.active);
    if (!c) return;
    c.x = x; c.z = z; c.active = true; c.phase = Math.random() * 6;
  }

  private spawnCoin(room: number) {
    const [c0, r0, w, h] = ROOMS[room].rect;
    for (let k = 0; k < 40; k++) {
      const x = (c0 + 0.3 + this.rng() * (w - 0.6)) * TILE;
      const z = (r0 + 0.3 + this.rng() * (h - 0.6)) * TILE;
      if (this.grid[Math.floor(z / TILE) * COLS + Math.floor(x / TILE)] === room && this.dirt.reachable(x, z) && this.dirt.reachable(x + 0.6, z) && this.dirt.reachable(x - 0.6, z) && this.dirt.reachable(x, z + 0.6) && this.dirt.reachable(x, z - 0.6)) {
        this.placeCoin(x, z);
        return;
      }
    }
  }

  private bfs() {
    const d = new Int16Array(COLS * ROWS).fill(-1);
    const sc = Math.floor(DOCK.x / TILE), sr = Math.floor(DOCK.z / TILE);
    const q = [sr * COLS + sc];
    d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const c = i % COLS, r = (i - c) / COLS;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dx, nr = r + dy;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const j = nr * COLS + nc;
        if (this.grid[j] < 0 || d[j] >= 0 || this.closedSecret(j)) continue;
        d[j] = d[i] + 1;
        q.push(j);
      }
    }
    return d;
  }

  private closedSecret(idx: number) {
    return this.world.secrets.some((sd, k) => sd.idx === idx && !this.secretFound[k]);
  }

  /** Total of the regular (non-secret) rooms plus any secret rooms found so far. */
  private roomCount() {
    return ROOMS.filter((r, i) => !r.secret || this.dirt.counted[i]).length;
  }

  private roomsCleanNow() {
    return this.cleared.filter((c, i) => c && (!ROOMS[i].secret || this.dirt.counted[i])).length;
  }

  // ------------------------------------------------------------ secret rooms
  /** Snap a secret door open or shut (no fanfare) — used on reset and when loading a save. */
  private setSecret(k: number, found: boolean) {
    const sd = this.world.secrets[k];
    this.secretFound[k] = found;
    this.secretAnim[k] = found ? 1 : 0;
    this.secretPush[k] = 0;
    sd.group.position.y = found ? -WALL_H - 0.2 : 0;
    sd.group.position.x = 0;
    sd.group.visible = !found;
    sd.roof.visible = !found;
    sd.roof.material.opacity = 1;
    const bi = this.world.boxes.indexOf(sd.box);
    if (found && bi >= 0) this.world.boxes.splice(bi, 1);
    if (!found && bi < 0) this.world.boxes.push(sd.box);
    this.dirt.setTileMask(sd.c, sd.r, found);
    this.dirt.counted[sd.room] = found;
  }

  private discoverSecret(k: number) {
    const sd = this.world.secrets[k];
    this.secretFound[k] = true;
    this.dirt.counted[sd.room] = true;
    this.distField = this.bfs();
    const bonus = Math.round(1500 * this.mult), coins = 25;
    this.score += bonus;
    this.coins += coins;
    this.coinsEarned += coins;
    this.addTrauma(0.55);
    this.sfx.noise(1.4, 140, 0.35);
    this.sfx.noise(0.5, 900, 0.12, 0.05, 'bandpass');
    [392, 523, 659, 784, 1047].forEach((f, i) => this.sfx.tone(f, 0.45, 'triangle', 0.13, 0, 0.5 + i * 0.1));
    this.cb.onToast('Secret room found', 'big', `${ROOMS[sd.room].name} · +${coins} coins · +${bonus.toLocaleString()}`);
    this.popup('🗝️ SECRET!', '#ffd84d', 1.8, 1.5);
    for (let n = 0; n < 50; n++) {
      this.dust.spawn(sd.fx + sd.nx * 0.2, Math.random() * 3, sd.fz + (Math.random() - 0.5) * 2,
        sd.nx * (1 + Math.random() * 3), Math.random() * 0.8, (Math.random() - 0.5) * 2, 0.6, 0.55, 0.48, 0.25, 1.4, -0.5);
    }
    this.autosaveT = Math.max(this.autosaveT, AUTOSAVE_EVERY - 2);
  }

  private updateSecrets(dt: number) {
    const R = ROOMBA_R;
    this.secretHintT -= dt;
    const hint = this.secretHintT <= 0;
    if (hint) this.secretHintT = 0.25;
    this.world.secrets.forEach((sd, k) => {
      if (this.secretFound[k]) {
        // sink the fake wall into the floor, juddering as it goes
        if (this.secretAnim[k] < 1) {
          this.secretAnim[k] = Math.min(1, this.secretAnim[k] + dt / 1.6);
          const u = this.secretAnim[k];
          sd.group.position.y = -(WALL_H + 0.2) * u * u;
          sd.group.position.x = Math.sin(u * 90) * 0.04 * (1 - u);
          if (Math.random() < 0.5) {
            this.dust.spawn(sd.fx + sd.nx * 0.15, 0.05, sd.fz + (Math.random() - 0.5) * TILE,
              sd.nx * (0.5 + Math.random()), 0.6 + Math.random(), (Math.random() - 0.5), 0.55, 0.5, 0.45, 0.22, 1.1, -0.3);
          }
          if (u > 0.55) {
            const bi = this.world.boxes.indexOf(sd.box);
            if (bi >= 0) { this.world.boxes.splice(bi, 1); this.dirt.setTileMask(sd.c, sd.r, true); }
          }
          sd.roof.material.opacity = 1 - Math.min(1, u * 1.6);
          if (u >= 1) { sd.group.visible = false; sd.roof.visible = false; }
        }
        return;
      }
      const b = sd.box;
      const cx = Math.max(b.minX, Math.min(this.px, b.maxX)), cz = Math.max(b.minZ, Math.min(this.pz, b.maxZ));
      const d = Math.hypot(this.px - cx, this.pz - cz);
      // a faint draft puffs dust out from under the fake wall when you're nearby
      if (hint && Math.abs(this.px - sd.fx) < 12 && Math.abs(this.pz - sd.fz) < 10 && Math.random() < 0.6) {
        this.dust.spawn(sd.fx + sd.nx * 0.1, 0.04, sd.fz + (Math.random() - 0.5) * 1.6,
          sd.nx * (0.25 + Math.random() * 0.35), 0.05 + Math.random() * 0.15, (Math.random() - 0.5) * 0.2, 0.62, 0.58, 0.52, 0.12, 1.6, -0.05);
      }
      // keep pushing into it and something gives
      const inp = this.controls.read();
      const pushing = d < R + 0.3 && inp.m > 0.3 && (cx - this.px) * inp.x + (cz - this.pz) * inp.z > 0.6 * Math.max(d, 1e-3) * inp.m;
      if (pushing) {
        this.secretPush[k] += dt;
        sd.group.position.x = (Math.random() - 0.5) * 0.04 * Math.min(1, this.secretPush[k] * 2);
        if (Math.random() < dt * 8) this.sfx.noise(0.12, 220, 0.06);
        if (this.secretPush[k] > 0.7) { sd.group.position.x = 0; this.discoverSecret(k); }
      } else {
        this.secretPush[k] = Math.max(0, this.secretPush[k] - dt * 0.5);
        sd.group.position.x = 0;
      }
    });
  }

  /** Non-repeat key presses (driving keys are tracked by the engine's Input). */
  private onKey = (code: string, e: KeyboardEvent) => {
    if (this.phase === 'intro') { this.skipIntro(); return; }
    if (this.phase === 'tidy') {
      // only deliberate keys skip, so holding a drive key through the cutscene doesn't
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); this.skipTidy(); }
      return;
    }
    switch (code) {
      case 'Escape':
      case 'KeyP':
        if (this.phase === 'playing') this.pause();
        else if (this.phase === 'paused') this.resume();
        else if (this.phase === 'shop') this.closeShop();
        break;
      case 'KeyE':
      case 'Enter':
        if (this.phase === 'playing' && this.docked) this.openShop();
        else if (this.phase === 'shop') this.closeShop();
        break;
      case 'KeyR':
        if (this.phase === 'gameover' || this.phase === 'paused') this.startRun(false);
        break;
      case 'KeyN':
        this.nextLevel();
        break;
      case 'KeyM':
        this.toggleMute();
        break;
      default:
        if (this.phase === 'shop' && /^Digit[1-6]$/.test(code)) {
          const k = UPGRADES[parseInt(code.slice(5), 10) - 1];
          if (k) this.buy(k.key);
        }
    }
  };
  /** Window blur or tab hidden (wired through the engine). */
  private onBlur = () => { this.controls.clear(); this.pause(); if (this.phase === 'shop') this.autosave(); };
  private onPageHide = () => { this.autosave(); };

  // ------------------------------------------------------------ loop
  /** One frame, called by the engine with a clamped dt; the engine renders afterwards. */
  private frame = (dt: number, nowSec: number) => {

    switch (this.phase) {
      case 'menu': this.updateMenu(dt); break;
      case 'intro': this.updateIntro(dt); break;
      case 'playing': this.updatePlay(dt); break;
      case 'tidy': this.updateTidy(dt); break;
      default: break;
    }
    // animated furniture freezes while paused or shopping, like the rest of the game
    if (this.phase !== 'paused' && this.phase !== 'shop') {
      this.world.animate(nowSec, 12 + ((this.time % NIGHT_LENGTH) / NIGHT_LENGTH) * 5);
    }
    if (this.phase === 'playing') this.tickClocks(nowSec);
    this.updateAmbience(dt);
    if (this.phase !== 'paused' && this.phase !== 'shop') {
      const target = this.docked ? this.tmpV.set(DOCK.x, 0.4, DOCK.z + 1.0) : this.tmpV.set(this.px, 0.25, this.pz);
      this.dust.update(dt, target.x, target.y, target.z);
      this.glow.update(dt, this.px, 0.3, this.pz);
      this.updateCoins(dt);
      this.popups.update(dt, this.camera);
    }
    this.updateVisuals(dt);
    this.dirt.upload();

    this.hudT -= dt;
    if (this.hudT <= 0 && (this.phase === 'playing' || this.phase === 'intro')) { this.hudT = 1 / 12; this.pushHud(); }
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.15; this.drawMinimap(); }
    this.shadowCache.update();
  };

  private updateMenu(dt: number) {
    this.menuT += dt;
    const a = this.menuT * 0.05 + 0.6;
    this.camera.position.set(44 + Math.sin(a) * 46, 40, 34 + Math.cos(a) * 46);
    this.camera.lookAt(44, 0, 34);
    this.world.cut.uRoomba.value.set(this.px, 0, this.pz);
    // flicker lights
    this.flicker(dt);
  }

  // ---- tidy-up cutscene: out-of-place objects float back to where they belong
  private tidyQueue: number[] = [];
  private tidyDelay = 0;
  private tidy: TidyScene | null = null;

  private startTidy(room: number) {
    const items = this.world.mess.filter((m) => m.room === room && !m.tidy);
    if (!items.length) return;
    this.vx = 0; this.vz = 0;
    this.controls.setJoystick(0, 0, false);
    this.sfx.hum(0, 0);
    this.tidy = {
      room, items, idx: 0, t: 0, stage: 'travel',
      camPos: this.camera.position.clone(),
      look: new THREE.Vector3(this.cam.focus.x, 0, this.cam.focus.z - 0.6),
      lifted: new Set(), landed: new Set(),
    };
    this.setPhase('tidy');
    this.cb.onCaption(`Tidying up the ${ROOMS[room].name}…`);
    this.sfx.tidyStart();
  }

  skipTidy() {
    const td = this.tidy;
    if (!td || this.phase !== 'tidy') return;
    for (let k = td.idx; k < td.items.length; k++) {
      const it = td.items[k];
      this.world.setMessState(it, true);
      for (const pt of it.parts) this.glow.burst(pt.to.p.x, pt.to.p.y + 0.2, pt.to.p.z, 6, 2, 1, 0.9, 0.5, 0.2, 0.6, 3);
    }
    this.sfx.tidyDone();
    this.finishTidy();
  }

  private finishTidy() {
    this.tidy = null;
    this.cb.onCaption(null);
    this.snapCamera();
    this.setPhase('playing');
    this.engine.resetClock();
    if (this.tidyQueue.length) this.tidyDelay = 0.8;
  }

  /** Centre of a room and the camera distance (along TIDY_DIR) that fits all of it on screen. */
  private tidyView(room: number) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const idx of this.roomTiles[room]) {
      const c = idx % COLS, r = (idx - c) / COLS;
      x0 = Math.min(x0, c * TILE); x1 = Math.max(x1, (c + 1) * TILE);
      z0 = Math.min(z0, r * TILE); z1 = Math.max(z1, (r + 1) * TILE);
    }
    const w = x1 - x0, d = z1 - z0;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    // the floor is seen at an angle, so its depth shows up foreshortened
    const elev = Math.atan2(TIDY_DIR.y, TIDY_DIR.z);
    // extra vertical room for the cutscene's letterbox bars
    const dist = Math.max(((d * Math.sin(elev)) / 2 / tanV) * 1.3, (w / 2 / tanH) * 1.15);
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, dist: THREE.MathUtils.clamp(dist, 12, 90) };
  }

  private updateTidy(dt: number) {
    const td = this.tidy;
    if (!td) return;
    this.flicker(dt);
    td.t += dt;
    // camera glides to each item in turn, then back to the roomba
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    if (td.stage === 'return') {
      wantLook.set(this.cam.focus.x, 0, this.cam.focus.z - 0.6);
      wantPos.copy(this.cam.positionFor(this.cam.focus));
    } else {
      // pulled back to show the whole room, leaning a little towards the item being put away
      const it = td.items[td.idx];
      const v = this.tidyView(td.room);
      wantLook.set(v.cx + (it.focus.x - v.cx) * 0.25, 0.3, v.cz + (it.focus.z - v.cz) * 0.25);
      wantPos.copy(wantLook).addScaledVector(TIDY_DIR, v.dist);
    }
    const k = 1 - Math.exp(-3.2 * dt);
    td.camPos.lerp(wantPos, k);
    td.look.lerp(wantLook, k);
    this.camera.position.copy(td.camPos);
    this.camera.lookAt(td.look);
    this.world.cut.uRoomba.value.set(td.look.x, 0, td.look.z);

    switch (td.stage) {
      case 'travel':
        if (td.t >= (td.idx === 0 ? 1.0 : 0.8)) { td.stage = 'anim'; td.t = 0; }
        break;
      case 'anim': {
        const it = td.items[td.idx];
        const vol = 1 / Math.sqrt(it.parts.length);
        for (const pt of it.parts) {
          const u = Math.min(1, Math.max(0, (td.t - pt.delay) / PART_ANIM));
          this.poseTidyPart(pt, u);
          if (u > 0 && !td.lifted.has(pt)) { td.lifted.add(pt); this.sfx.tidyLift(vol); }
          if (u > 0 && u < 1 && Math.random() < 0.7) {
            const o = pt.obj.position;
            this.glow.spawn(o.x + (Math.random() - 0.5) * 0.5, o.y + Math.random() * 0.4, o.z + (Math.random() - 0.5) * 0.5, 0, 0.5, 0, 1, 0.85, 0.45, 0.16 + Math.random() * 0.1, 0.7, -0.3);
          }
          if (u >= 1 && !td.landed.has(pt)) {
            td.landed.add(pt);
            this.sfx.tidyLand(vol);
            this.glow.burst(pt.to.p.x, pt.to.p.y + 0.1, pt.to.p.z, 8, 2, 1, 0.9, 0.5, 0.2, 0.6, 3);
          }
        }
        if (td.t >= it.duration) {
          this.world.setMessState(it, true);
          td.stage = 'hold'; td.t = 0;
        }
        break;
      }
      case 'hold':
        if (td.t >= 0.45) {
          td.idx++; td.t = 0;
          if (td.idx < td.items.length) td.stage = 'travel';
          else {
            td.stage = 'return';
            this.sfx.tidyDone();
            this.cb.onCaption(`✨ ${ROOMS[td.room].name} tidied!`);
          }
        }
        break;
      case 'return':
        if (td.t >= 1.1) this.finishTidy();
        break;
    }
  }

  /** u in [0,1]: lift off, arc over to the tidy spot while turning upright, then drop into place. */
  private poseTidyPart(pt: MessPart, u: number) {
    const o = pt.obj;
    const LIFT = 0.28, MOVE = 0.82, H = 0.9, DROP = 0.45;
    if (u <= 0 || u >= 1) {
      const ps = u <= 0 ? pt.from : pt.to;
      o.position.copy(ps.p); o.quaternion.copy(ps.q); o.scale.copy(ps.s);
      return;
    }
    if (u < LIFT) {
      const k = 1 - (1 - u / LIFT) ** 3;
      o.position.copy(pt.from.p);
      o.position.y += H * k;
      o.quaternion.copy(pt.from.q);
      o.rotateZ(Math.sin(u * 45) * 0.05 * k);
      o.scale.copy(pt.from.s);
    } else if (u < MOVE) {
      const x = (u - LIFT) / (MOVE - LIFT);
      const k = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
      const a = pt.from.p.clone(); a.y += H;
      const b = pt.to.p.clone(); b.y += DROP;
      o.position.lerpVectors(a, b, k);
      o.position.y += Math.sin(k * Math.PI) * (0.5 + a.distanceTo(b) * 0.08);
      o.quaternion.slerpQuaternions(pt.from.q, pt.to.q, k);
      o.scale.lerpVectors(pt.from.s, pt.to.s, k);
    } else {
      const k = (u - MOVE) / (1 - MOVE);
      o.position.copy(pt.to.p);
      o.position.y += DROP * (1 - k * k);
      o.quaternion.copy(pt.to.q);
      o.scale.copy(pt.to.s);
    }
  }

  // ---- grandfather clock sounds, positioned relative to the roomba
  private tickSigns: boolean[] = [];

  /** Left/right placement from the direction to the clock, never hard-panned. */
  private clockPan(c: { x: number; z: number }) {
    const d = Math.max(1, Math.hypot(c.x - this.px, c.z - this.pz));
    return ((c.x - this.px) / d) * 0.6;
  }

  /** A tick each time a pendulum passes the centre of its swing, audible only nearby. */
  private tickClocks(t: number) {
    this.world.clocks.forEach((c, i) => {
      const sign = Math.sin(t * Math.PI + c.phase) >= 0;
      const prev = this.tickSigns[i];
      this.tickSigns[i] = sign;
      if (prev === undefined || prev === sign) return;
      const d = Math.hypot(c.x - this.px, c.z - this.pz);
      const near = Math.max(0, 1 - d / 13);
      if (near <= 0) return;
      this.sfx.tick(0.32 * near * near, this.clockPan(c), !sign);
    });
  }

  /** Fireplace crackle and fountain water: looping beds plus random one-shots, louder up close. */
  private updateAmbience(dt: number) {
    const on = this.phase === 'playing' || this.phase === 'tidy';
    for (const kind of ['fire', 'water'] as const) {
      const range = kind === 'fire' ? 11 : 13;
      let best = 0, pan = 0;
      if (on) {
        for (const s of this.world.soundSources) {
          if (s.kind !== kind) continue;
          const d = Math.hypot(s.x - this.px, s.z - this.pz);
          const near = Math.max(0, 1 - d / range) ** 2;
          if (near > best) { best = near; pan = ((s.x - this.px) / Math.max(1, d)) * 0.6; }
        }
      }
      this.sfx.ambience(kind, best * (kind === 'fire' ? 0.2 : 0.17), pan);
      if (best <= 0.01) continue;
      if (kind === 'fire' && Math.random() < dt * 9) this.sfx.crackle(0.35 * best * (0.4 + Math.random() * 0.6), pan);
      if (kind === 'water' && Math.random() < dt * 3.5) this.sfx.drip(0.18 * best * (0.4 + Math.random() * 0.6), pan);
    }
  }

  /** Hourly chime from every clock: heard anywhere in the manor, louder the closer you are. */
  private chimeClocks(hour: number) {
    this.world.clocks.forEach((c, i) => {
      const d = Math.hypot(c.x - this.px, c.z - this.pz);
      const vol = 0.32 * (0.18 + 0.82 / (1 + (d / 7) ** 2));
      this.sfx.chime(hour, vol, this.clockPan(c), i * 0.12);
    });
  }

  /**
   * Old incandescent bulbs: each one wanders slowly between brightness levels, now and then
   * stutters through a burst of quick flickers, and occasionally browns out and struggles back.
   * When a ghost is haunting a room, the lights in that room flicker violently.
   */
  private flicker(dt: number) {
    const t = performance.now() / 1000;
    const ghost = this.ghost;
    this.world.lights.forEach((l, i) => {
      const s = this.bulbs[i] ??= { level: 0.9, target: 0.9, hold: Math.random(), burst: 0, burstT: 0, burstV: 1, dip: 0 };
      s.hold -= dt;
      if (s.hold <= 0) {
        s.target = 0.7 + Math.random() * 0.34;
        s.hold = 0.35 + Math.random() * 2.2;
      }
      s.level += (s.target - s.level) * Math.min(1, dt * 2.2);
      let k = s.level;
      if (s.burst <= 0 && Math.random() < dt * 0.1 * l.flaky) { s.burst = 0.12 + Math.random() * 0.6; s.burstT = 0; }
      if (s.burst > 0) {
        s.burst -= dt;
        s.burstT -= dt;
        if (s.burstT <= 0) {
          s.burstT = 0.03 + Math.random() * 0.08;
          s.burstV = Math.random() < 0.4 ? 0.05 + Math.random() * 0.25 : 0.6 + Math.random() * 0.45;
        }
        k *= s.burstV;
      }
      if (s.dip <= 0 && Math.random() < dt * 0.03 * l.flaky) s.dip = 1;
      if (s.dip > 0) {
        s.dip = Math.max(0, s.dip - dt * 1.3);
        k *= 1 - 0.6 * Math.sin(s.dip * Math.PI);
      }
      k *= 0.97 + 0.03 * Math.sin(t * 37 + i * 5);
      // Ghost haunting: lights in the ghost's room (or near it) flicker violently — strobing between
      // near-dark and full brightness with a fast chaotic pattern.
      if (ghost && !ghost.caught) {
        const lroom = this.grid[Math.floor(l.light.position.z / TILE) * COLS + Math.floor(l.light.position.x / TILE)];
        const near = lroom === ghost.room || Math.hypot(l.light.position.x - ghost.x, l.light.position.z - ghost.z) < 14;
        if (near) {
          // chaotic strobe: mostly dim with sharp flashes
          const strobe = Math.random() < 0.18 ? 1.1 : 0.05 + Math.random() * 0.25;
          k = k * 0.4 + strobe * 0.6;
        }
      }
      l.light.intensity = l.base * k;
      for (const m of l.bulbs) m.emissiveIntensity = 0.15 + 0.95 * k;
    });
  }

  private introCurve = (() => {
    const P = [
      [44, 2.4, 8.5], [44, 2.9, 27], [44, 6.2, 41], [48, 7.6, 47], [44, 3.0, 58.6],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const T = [
      [44, 2.3, 1], [44, 2.2, 6], [39, 0, 51], [51, 0, 56], [44, 0.2, 62.5],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    return { p: new THREE.CatmullRomCurve3(P, false, 'centripetal'), t: new THREE.CatmullRomCurve3(T, false, 'centripetal') };
  })();

  private updateIntro(dt: number) {
    this.introT += dt;
    const t = this.introT;
    this.flicker(dt);
    const capAt = (time: number, stage: number, text: string | null, big = false) => {
      if (t >= time && this.introStage < stage) { this.introStage = stage; this.cb.onCaption(text, big); }
    };
    capAt(0.2, 1, 'Blackwood Manor — 11:59 PM');
    capAt(3.0, 2, 'The owners left at midnight, swearing they\'d be back by dawn...');
    capAt(5.3, 3, '...and someone tracked mud EVERYWHERE.');
    capAt(7.6, 4, null);
    capAt(8.0, 5, '*whirrr... beep?*');
    if (t >= 8.6 && this.introStage < 6) {
      this.introStage = 6;
      this.cb.onCaption('SURPRISE! YOU ARE THE ROOMBA.', true);
      this.sfx.boot();
      this.bootFx();
      this.cam.trauma = 0.25;
    }
    const camEnd = 8.3;
    const u = Math.min(1, t / camEnd);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const ee = 0.15 * u + 0.85 * e;
    const pos = this.introCurve.p.getPoint(ee);
    const tgt = this.introCurve.t.getPoint(ee);
    // brighten ambience slightly as we enter
    const amb = 0.45 + 0.3 * Math.min(1, Math.max(0, (t - 8.6) / 1.2));
    this.world.ambient.intensity = amb;
    this.world.hemi.intensity = amb + 0.05;
    if (t > 8.6) {
      const p = Math.min(1, (t - 8.6) / 0.6);
      this.setRoombaPower(p);
    }
    if (t > 9.3) {
      const k = Math.min(1, (t - 9.3) / 1.5);
      const s = k * k * (3 - 2 * k);
      const gp = this.cam.positionFor(this.tmpV.set(this.px, 0, this.pz));
      pos.lerp(gp, s);
      tgt.lerp(new THREE.Vector3(this.px, 0, this.pz - 0.6), s);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(tgt);
    this.cam.shake(dt);
    if (t > 10.9) this.beginPlay(true);
  }

  private snapCamera() { this.cam.snap(this.px, this.pz); }

  private addTrauma(v: number) { this.cam.addTrauma(v); }

  // ------------------------------------------------------------ gameplay
  private updatePlay(dt: number) {
    this.flicker(dt);
    // ending sequences
    if (this.ending) {
      this.endTimer -= dt;
      this.vx *= 1 - 3 * dt; this.vz *= 1 - 3 * dt;
      if (this.ending === 'battery') {
        this.yaw += dt * 6 * Math.max(0, this.endTimer);
        const p = Math.max(0, this.endTimer / 1.8);
        this.setRoombaPower(p * (0.6 + 0.4 * Math.sin(performance.now() / 40)));
      } else if (Math.random() < 0.4) {
        this.glow.spawn(this.px + (Math.random() - 0.5) * 8, 0.2, this.pz + (Math.random() - 0.5) * 8, 0, 3 + Math.random() * 3, 0, 1, 0.85, 0.4, 0.35, 1.2, -1);
      }
      this.px += this.vx * dt; this.pz += this.vz * dt;
      this.followCamera(dt);
      this.sfx.hum(0, 0);
      if (this.endTimer <= 0) this.finish();
      return;
    }

    if (!this.devFreezeTime) this.time += dt;
    this.dirt.dry(dt);
    this.autosaveT += dt;
    if (this.autosaveT >= AUTOSAVE_EVERY) this.autosave();
    // hours are counted across nights: every 5th one is a dawn, after which the curse rewinds the clock
    const hourIdx = Math.floor(this.time / (NIGHT_LENGTH / 5));
    if (hourIdx > this.hourAnnounced) {
      this.hourAnnounced = hourIdx;
      const hour = hourIdx % 5;
      if (hour === 0) this.dawnBreaks();
      else {
        const left = 5 - hour;
        this.cb.onToast(`${hour}:00 AM · ${left} hour${left === 1 ? '' : 's'} until dawn`, 'info');
        this.chimeClocks(hour);
      }
    }
    if (this.dawnGlow > 0) {
      this.dawnGlow = Math.max(0, this.dawnGlow - dt);
      const k = Math.sin(Math.min(1, this.dawnGlow / 5) * Math.PI);
      this.world.ambient.intensity = 0.75 + 1.1 * k;
      this.world.ambient.color.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAWN, k);
    }
    if (this.tidyQueue.length) {
      this.tidyDelay -= dt;
      if (this.tidyDelay <= 0) { this.startTidy(this.tidyQueue.shift()!); return; }
    }

    const inp = this.controls.read();
    this.turbo = inp.boost && inp.m > 0.1 && !this.docked;
    let removedUnits = 0;

    if (this.docked) {
      // input held from driving in is ignored until it's released; then any fresh press undocks
      if (!inp.held) this.undockArmed = true;
      if (inp.m > 0.3 && this.undockArmed) {
        this.docked = false;
        this.dockLock = true;
        this.sfx.undock();
      } else {
        // magnetic pull onto the pad, spinning round to face away from the dock (north)
        this.px += (DOCK.x - this.px) * Math.min(1, dt * 6);
        this.pz += (DOCK.z - this.pz) * Math.min(1, dt * 6);
        this.vx = this.vz = 0;
        this.yaw = lerpAngle(this.yaw, Math.PI, Math.min(1, dt * 7));
        const bmax = this.batteryMax;
        const charging = this.battery < bmax - 0.01;
        const emptying = this.bin > 0.01;
        this.battery = Math.min(bmax, this.battery + this.chargeRate * dt);
        if (emptying) {
          const e = Math.min(this.bin, this.emptyRate * dt);
          this.bin -= e;
          if (Math.random() < 0.7) {
            for (let k = 0; k < 2; k++) {
              this.dust.spawn(this.px + (Math.random() - 0.5) * 0.6, 0.35, this.pz + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, 2.5, 1.5, 0.35, 0.25, 0.15, 0.22, 0.6, 0, 18);
            }
          }
        }
        if (charging && Math.random() < 0.3) {
          this.glow.spawn(DOCK.x + (Math.random() - 0.5) * 1.2, 0.8, DOCK.z + 0.85, 0, 1.5 + Math.random(), 0, 0.3, 1, 0.6, 0.18, 0.6, 0);
        }
        if (!charging && !emptying && !this.fullHinted) {
          this.fullHinted = true;
          this.cb.onToast(this.isTouch ? 'Fully charged · Tap Shop for upgrades' : 'Fully charged · Press E for upgrades', 'good');
        }
        if (this.battery > bmax * 0.5) { this.warned30 = false; this.warned12 = false; }
        if (this.bin < this.binCap * 0.5) this.binWarned = false;
      }
      this.sfx.hum(0.25, 0.1);
    }

    if (!this.docked) {
      // ease toward the stick, lean, move in substeps, bounce off walls and furniture, turn to face travel
      this.mover.o.maxSpeed = this.speedMax;
      const hit = this.mover.update(dt, inp.x, inp.z, inp.m, this.collision, this.turbo ? 1.5 : 1);
      this.bumpCd -= dt;
      if (hit.impact > 2.6 && this.bumpCd <= 0) this.bump(hit.impact, hit.nx, hit.nz);
      const sp = this.mover.speed;

      // battery
      const frac = Math.min(1, sp / this.speedMax);
      const drain = 0.5 + frac * (this.turbo ? 2.6 : 1.0);
      if (!this.devInfBattery) this.battery -= drain * dt;
      if (this.battery <= 0) { this.battery = 0; this.startEnding('battery'); return; }

      // wet machines leave a freshly-mopped sheen on tile floors, just behind them
      const mopR = MACHINES[this.machine].mopR;
      if (mopR > 0 && sp > 0.3) this.dirt.mop(this.px - Math.sin(this.yaw) * 0.4, this.pz - Math.cos(this.yaw) * 0.4, mopR);

      // cleaning
      const room = this.bin < this.binCap ? (this.binCap - this.bin) * UNIT : 0;
      if (room > 0) {
        const removed = this.dirt.clean(this.px, this.pz, this.brushR, this.suction * dt * 255, room);
        if (removed > 0) {
          removedUnits = removed / UNIT;
          this.bin = Math.min(this.binCap, this.bin + removedUnits);
          this.checkRooms(this.dirt.touched);
        }
      } else if (!this.binWarned) {
        this.binWarned = true;
        this.sfx.full();
        this.addTrauma(0.2);
        this.cb.onToast('Dust bin full. Return to the dock to empty it.', 'warn');
        this.popup('BIN FULL!', '#ffb347', 1.2);
      }
      this.sfx.hum(0.55 + frac * 0.45, frac * (this.turbo ? 1.4 : 1) + Math.min(1, removedUnits * 40));

      // dock check
      const dd = Math.hypot(this.px - DOCK.x, this.pz - DOCK.z);
      if (this.dockLock && dd > 2.0) this.dockLock = false;
      // touching the dock's ring captures the roomba whenever it is heading towards the dock
      // (within 90 degrees); facing halfway away or more, it can pass by
      const facingDock = dd < 0.05 || (Math.sin(this.yaw) * (DOCK.x - this.px) + Math.cos(this.yaw) * (DOCK.z - this.pz)) / dd > 0;
      if (!this.dockLock && dd < DOCK_CAPTURE_R && facingDock) {
        this.docked = true;
        this.undockArmed = false;
        this.sfx.magnet();
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          this.glow.spawn(DOCK.x + Math.cos(a) * 1.15, 0.1, DOCK.z + Math.sin(a) * 1.15, -Math.cos(a) * 1.6, 0.8, -Math.sin(a) * 1.6, 0.3, 1, 0.6, 0.2, 0.5, 0);
        }
        this.fullHinted = false;
        this.sfx.dock();
        this.addTrauma(0.1);
        this.popup('DOCKED ⚡', '#5dffb0', 1.1);
        if (!this.dockHinted) {
          this.dockHinted = true;
          this.cb.onToast(this.isTouch ? 'Charging and emptying · Tap Shop for upgrades' : 'Charging and emptying · Press E for upgrades', 'good');
        }
      }

      // warnings
      const br = this.battery / this.batteryMax;
      if (br < 0.3 && !this.warned30) {
        this.warned30 = true;
        this.sfx.low();
        this.cb.onToast('Battery low. Follow the arrow home.', 'warn');
      }
      if (br < 0.12) {
        if (!this.warned12) { this.warned12 = true; this.cb.onToast('Critical battery', 'bad'); }
        this.critBeep -= dt;
        if (this.critBeep <= 0) { this.critBeep = 1.6; this.sfx.low(); }
      }
    }

    // combo
    if (removedUnits / dt > 0.25) {
      this.comboTimer = 1.1;
      this.comboTime += dt;
      const nm = Math.min(5, 1 + Math.floor(this.comboTime / 2.6));
      if (nm > this.mult) {
        this.mult = nm;
        this.sfx.combo(nm);
        this.popup(`COMBO x${nm}!`, ['#fff', '#7df9ff', '#9dff7d', '#ffd84d', '#ff7df0'][nm - 1], 1.0, 1.4);
        this.glow.burst(this.px, 0.4, this.pz, 14, 5, 1, 0.9, 0.5, 0.3, 0.6, 6);
      }
      // dust particles sucked in
      const n = Math.min(4, removedUnits * 400);
      for (let i = 0; i < n; i++) {
        if (Math.random() > n / 4 + 0.25) continue;
        const a = Math.random() * Math.PI * 2;
        const rr = this.brushR * (0.9 + Math.random() * 0.5);
        const shade = 0.7 + Math.random() * 0.5;
        this.dust.spawn(this.px + Math.cos(a) * rr, 0.06, this.pz + Math.sin(a) * rr, Math.cos(a) * 1.2, 1.5 + Math.random() * 1.5, Math.sin(a) * 1.2,
          0.38 * shade, 0.27 * shade, 0.15 * shade, 0.12 + Math.random() * 0.14, 0.45, 0, 26);
      }
    } else {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.mult > 1) { this.mult = 1; }
      if (this.comboTimer <= 0) this.comboTime = 0;
    }
    if (removedUnits > 0) {
      this.score += removedUnits * 14 * this.mult;
      this.coinFrac += removedUnits * 0.3;
      if (this.coinFrac >= 1) { const c = Math.floor(this.coinFrac); this.coinFrac -= c; this.coins += c; this.coinsEarned += c; }
    }

    // room tracking
    const tc = Math.floor(this.px / TILE), tr = Math.floor(this.pz / TILE);
    const rid = this.grid[tr * COLS + tc];
    if (rid >= 0 && rid !== this.curRoom) this.curRoom = rid;
    if (rid >= 0) this.explored[rid] = true;

    this.updateSecrets(dt);
    this.updateGhost(dt);
    this.updateArrow(dt);
    this.followCamera(dt);
  }

  private bump(impact: number, nx: number, nz: number) {
    this.bumpCd = 0.22;
    const k = Math.min(1, impact / 9);
    this.addTrauma(0.12 + k * 0.35);
    this.sfx.bump(k);
    this.squash.squash(-(2 + k * 5));
    const cx = this.px - nx * ROOMBA_R, cz = this.pz - nz * ROOMBA_R;
    for (let i = 0; i < 6 + k * 14; i++) {
      const a = Math.atan2(nz, nx) + (Math.random() - 0.5) * 2.2;
      const s = 2 + Math.random() * 5 * k + 1;
      this.glow.spawn(cx, 0.25, cz, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 1, 0.85, 0.4, 0.14 + Math.random() * 0.1, 0.35, 10);
    }
    this.dust.burst(cx, 0.15, cz, 5, 2, 0.5, 0.45, 0.4, 0.25, 0.6, 2);
    if (impact > 6 && Math.random() < 0.5) this.popup(['BONK!', 'OOF!', 'CLUNK!', 'BEEP!'][Math.floor(Math.random() * 4)], '#ffe27a', 0.8, 0.9);
  }

  private checkRooms(mask: number) {
    for (let i = 0; i < ROOMS.length; i++) {
      if (!(mask & (1 << i)) || this.cleared[i]) continue;
      if (this.dirt.cleanliness(i) >= CLEAR_THRESHOLD) this.clearRoom(i);
    }
  }

  private clearRoom(i: number) {
    const reclear = this.clearedOnce[i];
    this.cleared[i] = true;
    this.clearedOnce[i] = true;
    this.clears++;
    this.dirt.wipeRoom(i);
    this.dirt.total[i] = Math.max(1, this.dirt.total[i]);
    const [c0, r0, w, h] = ROOMS[i].rect;
    const area = w * h * 4;
    const coins = Math.round((15 + area / 10) * (reclear ? 0.5 : 1));
    const pts = Math.round((300 + area) * (reclear ? 0.5 : 1) * this.mult);
    this.coins += coins;
    this.coinsEarned += coins;
    this.score += pts;
    this.sfx.clear();
    this.addTrauma(0.35);
    this.cb.onToast('Room spotless', 'big', `${ROOMS[i].name} · +${coins} coins · +${pts.toLocaleString()}`);
    this.popup(`+${coins} 🪙`, '#ffd84d', 1.6, 1.5);
    for (let k = 0; k < 110; k++) {
      const x = (c0 + Math.random() * w) * TILE, z = (r0 + Math.random() * h) * TILE;
      const gold = Math.random() < 0.6;
      this.glow.spawn(x, 0.1 + Math.random() * 0.3, z, 0, 1.5 + Math.random() * 3, 0, gold ? 1 : 0.7, gold ? 0.85 : 1, gold ? 0.35 : 1, 0.25 + Math.random() * 0.25, 0.8 + Math.random() * 0.8, -0.5);
    }
    this.glow.burst(this.px, 0.5, this.pz, 30, 7, 1, 0.9, 0.4, 0.35, 0.9, 5);
    // anything still out of place in this room gets tidied in a short cutscene, once the celebration has played
    if (this.world.mess.some((m) => m.room === i && !m.tidy) && !this.tidyQueue.includes(i)) {
      this.tidyQueue.push(i);
      this.tidyDelay = Math.max(this.tidyDelay, 1.4);
    }
    this.autosaveT = Math.max(this.autosaveT, AUTOSAVE_EVERY - 1.5);
    if (!ROOMS[i].secret && ROOMS.every((r, k) => r.secret || this.cleared[k]) && !this.levelDone) {
      this.levelDone = true;
      setTimeout(() => this.cb.onToast(`${this.nextLevelName} is calling. Move on whenever you're ready.`, 'good'), 3200);
    }
    // whole-manor bonus: once per night, so re-cleaning after a ghost visit doesn't pay it again
    if (!ROOMS[i].secret && this.manorBonusNight !== this.night && ROOMS.every((r, k) => r.secret || this.cleared[k])) {
      this.manorBonusNight = this.night;
      this.score += 5000;
      this.coins += 100;
      this.coinsEarned += 100;
      setTimeout(() => this.cb.onToast('Building complete', 'big', `${LEVEL.name} · +5,000`), 1200);
    }
  }

  private startEnding(reason: 'battery' | 'dawn') {
    this.ending = reason;
    if (!this.isPlaytest) {
      deleteSave(AUTO_ID);
      this.cb.onSaves?.();
    }
    this.endTimer = reason === 'battery' ? 1.8 : 2.2;
    this.arrow.visible = false;
    this.turbo = false;
    this.homeHint = false;
    if (reason === 'battery') {
      this.sfx.over();
      this.addTrauma(0.5);
      this.cb.onCaption('BATTERY DEPLETED', true);
      this.popup('zzz…', '#9ab', 1.6);
    } else {
      this.sfx.dawn();
      this.cb.onCaption('☀️ DAWN BREAKS — SHIFT COMPLETE!', true);
    }
  }

  private finish() {
    const bonus = 0;
    const overall = this.dirt.overall();
    this.cb.onCaption(null);
    this.pushHud();
    this.setPhase('gameover');
    this.cb.onGameOver({
      reason: this.ending ?? 'battery',
      score: Math.round(this.score),
      rooms: this.clearedOnce.filter(Boolean).length,
      clears: this.clears,
      overall,
      time: this.time,
      coinsEarned: this.coinsEarned,
      bonus,
      coins: this.coins,
      nights: this.night,
      levelNum: this.level + 1,
      levelName: LEVEL.name,
      roomsTotal: this.roomCount(),
      reviveCost: this.ending === 'battery' ? reviveCost(this.coins) : 0,
    });
  }

  /** Nights survived so far (0 during the first night). */
  get night() { return Math.floor(this.time / NIGHT_LENGTH); }

  /**
   * Dawn: pay the dawn bonus, then the manor's curse rewinds the clock to midnight and
   * drags fresh mud through some of the rooms you'd cleaned. Each night is a little meaner.
   */
  private dawnBreaks() {
    const n = this.night; // nights now survived
    const overall = this.dirt.overall();
    const bonus = Math.round((2000 + (this.battery / this.batteryMax) * 1000 + overall * 3000) * (1 + (n - 1) * 0.25));
    const coins = 40 + 20 * (n - 1);
    this.score += bonus;
    this.coins += coins;
    this.coinsEarned += coins;
    this.sfx.dawn();
    this.chimeClocks(5);
    this.addTrauma(0.3);
    this.dawnGlow = 5;
    this.cb.onCaption(`☀️ DAWN — NIGHT ${n} SURVIVED! +${bonus.toLocaleString()}`, true);
    this.popup(`+${coins} 🪙`, '#ffd84d', 1.6, 1.5);
    for (let k = 0; k < 60; k++) {
      this.glow.spawn(this.px + (Math.random() - 0.5) * 10, 0.2, this.pz + (Math.random() - 0.5) * 10, 0, 2 + Math.random() * 3, 0, 1, 0.85, 0.4, 0.35, 1.4, -1);
    }
    setTimeout(() => {
      if (this.phase !== 'playing' && this.phase !== 'tidy') return;
      if (this.phase === 'playing') this.cb.onCaption(null); // a tidy cutscene owns the caption while it runs
      // the curse: the owners never come; midnight strikes again and the mud creeps back
      const pool = ROOMS.map((_, i) => i).filter((i) => this.cleared[i] && this.dirt.counted[i] && i !== this.curRoom);
      const count = Math.min(pool.length, 1 + n);
      for (let k = 0; k < count; k++) {
        const room = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        this.cleared[room] = false;
        this.dirt.total[room] = 0;
        const steps = this.dirt.trailSteps(this.rng, room, 26 + Math.floor(Math.random() * 14));
        for (const st of steps) this.dirt.total[room] += this.dirt.shoe(st.x, st.z, st.a, st.s, st.left);
        this.dirt.total[room] = Math.max(1, this.dirt.total[room]);
      }
      this.sfx.ghost();
      this.cb.onToast(`Night ${n + 1} begins${count ? `. Mud is back in ${count} room${count === 1 ? '' : 's'}` : ''}`, 'bad');
    }, 3200);
    this.autosaveT = Math.max(this.autosaveT, AUTOSAVE_EVERY - 2);
  }

  /** Pay to recharge after the battery died and carry on the same run. Returns false if not possible. */
  revive() {
    if (this.phase !== 'gameover' || this.ending !== 'battery') return false;
    const cost = reviveCost(this.coins);
    if (!cost) return false;
    this.coins -= cost;
    this.ending = null;
    this.endTimer = 0;
    this.battery = this.batteryMax;
    this.warned30 = this.warned12 = false;
    this.vx = this.vz = 0;
    this.cam.trauma = 0;
    this.setRoombaPower(1);
    this.sfx.unlock();
    this.sfx.boot();
    this.bootFx();
    this.cb.onCaption(null);
    this.setPhase('playing');
    this.engine.resetClock();
    this.autosaveT = AUTOSAVE_EVERY - 1;
    this.pushHud();
    this.cb.onToast(`Recharged for ${cost} coins. Back to work.`, 'good');
    return true;
  }

  // ------------------------------------------------------------ ghost
  private updateGhost(dt: number) {
    this.nextGhost -= dt;
    if (!this.ghost && this.nextGhost <= 0) {
      this.nextGhost = Math.max(Math.max(8, 16 - this.night * 2), 34 - this.time * 0.06) + Math.random() * 8;
      const candidates = ROOMS.map((_, i) => i).filter((i) => i !== this.curRoom && (!ROOMS[i].secret || this.dirt.counted[i]));
      const clearedC = candidates.filter((i) => this.cleared[i]);
      const pool = clearedC.length && Math.random() < 0.75 ? clearedC : candidates;
      const room = pool[Math.floor(Math.random() * pool.length)];
      if (this.cleared[room]) {
        this.cleared[room] = false;
        this.dirt.total[room] = 0;
      }
      const steps = this.dirt.trailSteps(this.rng, room, 22 + Math.floor(Math.random() * 14));
      this.ghost = { room, steps, idx: 0, timer: 0, x: steps[0].x, z: steps[0].z, fade: 0 };
      this.ghostSprite.visible = true;
      this.ghostSprite.scale.set(2.6, 2.6, 1);
      this.ghostSprite.material.rotation = 0;
      this.sfx.ghost();
      this.cb.onToast(`Ghostly footprints in the ${ROOMS[room].name}`, 'bad');
    }
    const g = this.ghost;
    if (!g) return;
    if (g.caught) {
      // sucked up as a spinning cyclone: orbit the vacuum in a tightening spiral while spinning fast
      g.spinT = (g.spinT ?? 0) + dt;
      g.spin = (g.spin ?? 0) + dt * (14 + g.spinT * 8); // spin accelerates as it's sucked in
      g.fade -= dt * 2.2;
      const pull = Math.min(1, dt * (6 + g.spinT * 4));
      g.x += (this.px - g.x) * pull;
      g.z += (this.pz - g.z) * pull;
      if (g.fade <= 0) { this.ghost = null; this.ghostSprite.visible = false; return; }
      const t = performance.now() / 1000;
      const f = g.fade;
      // orbit radius shrinks with fade; spin angle offset gives the cyclone spiral
      const orbitR = 0.9 * f;
      const oa = g.spin * 0.6;
      const cx = g.x + Math.cos(oa) * orbitR, cz = g.z + Math.sin(oa) * orbitR;
      // stretch horizontally + squash vertically as it's drawn into the funnel
      const sw = 2.6 * (0.4 + f * 0.8);
      const sh = 2.6 * f * f;
      this.ghostSprite.scale.set(sw, sh, 1);
      this.ghostSprite.material.rotation = g.spin;
      this.ghostSprite.position.set(cx, 1.3 + Math.sin(t * 18) * 0.12 * f, cz);
      this.ghostSprite.material.opacity = Math.min(1, f * 1.2);
      // spiraling particle trails feeding into the vacuum
      for (let p = 0; p < 2; p++) {
        const pa = g.spin + p * Math.PI;
        const pr = (0.3 + Math.random() * 0.5) * f;
        this.glow.spawn(cx + Math.cos(pa) * pr, 0.8 + Math.random() * 0.6, cz + Math.sin(pa) * pr,
          (this.px - cx) * 3 + Math.cos(pa + 1.5) * 2, 0.3 + Math.random() * 0.8, (this.pz - cz) * 3 + Math.sin(pa + 1.5) * 2,
          0.4, 0.7, 0.9, 0.25, 0.5 + Math.random() * 0.4, -0.5);
      }
      return;
    }
    // Check if the roomba's suction catches the ghost (only while it's still walking / leaving prints)
    if (g.idx < g.steps.length) {
      const dx = g.x - this.px, dz = g.z - this.pz;
      const catchR = this.brushR + 0.7;
      if (dx * dx + dz * dz < catchR * catchR) {
        this.catchGhost(g);
        return;
      }
    }
    if (g.idx < g.steps.length) {
      g.fade = Math.min(1, g.fade + dt * 2);
      g.timer -= dt;
      if (g.timer <= 0) {
        g.timer = 0.26;
        const s = g.steps[g.idx++];
        const added = this.dirt.shoe(s.x, s.z, s.a, 0.95, s.left);
        this.dirt.total[g.room] += added;
        if (g.idx === g.steps.length) {
          this.spawnCoin(g.room);
        }
      }
      const tgt = g.steps[Math.min(g.idx, g.steps.length - 1)];
      g.x += (tgt.x - g.x) * Math.min(1, dt * 6);
      g.z += (tgt.z - g.z) * Math.min(1, dt * 6);
      if (Math.random() < 0.5) this.glow.spawn(g.x + (Math.random() - 0.5) * 0.6, 1.0 + Math.random() * 0.5, g.z + (Math.random() - 0.5) * 0.6, 0, 0.6, 0, 0.6, 0.5, 1, 0.2, 0.9, -0.3);
    } else {
      g.fade -= dt * 1.2;
      if (g.fade <= 0) { this.ghost = null; this.ghostSprite.visible = false; return; }
    }
    const t = performance.now() / 1000;
    this.ghostSprite.scale.set(2.6, 2.6, 1);
    this.ghostSprite.material.rotation = 0;
    this.ghostSprite.position.set(g.x, 1.3 + Math.sin(t * 3) * 0.2, g.z);
    this.ghostSprite.material.opacity = g.fade * (0.75 + 0.25 * Math.sin(t * 9));
  }

  /** The roomba's suction caught the ghost: reward the player and start the suck-up animation. */
  private catchGhost(g: Ghost) {
    g.caught = true;
    // reward: coins + score, scaled by how many footprints the ghost still had left (caught early = bigger reward)
    const remaining = g.steps.length - g.idx;
    const coins = 30 + remaining * 2;
    const pts = Math.round((200 + remaining * 15) * this.mult);
    this.coins += coins;
    this.coinsEarned += coins;
    this.score += pts;
    this.addTrauma(0.3);
    this.sfx.ghostCatch();
    this.cb.onToast('Ghost caught', 'big', `+${coins} coins · +${pts.toLocaleString()}`);
    this.popup(`+${coins} 🪙`, '#a0e0ff', 1.6, 1.5);
    // burst of particles from the ghost's position
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
      this.glow.spawn(g.x, 1.0 + Math.random() * 0.6, g.z, Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp, 0.5, 0.8, 0.9, 0.3, 0.8 + Math.random() * 0.6, -0.4);
    }
    // the footprints already laid remain (the roomba still has to clean them), but no more will be added
    this.pushHud();
  }

  private updateArrow(dt: number) {
    const need = !this.docked && (this.battery / this.batteryMax < 0.32 || this.bin >= this.binCap - 0.01);
    this.homeHint = need;
    this.arrow.visible = need;
    if (!need) return;
    let c = Math.floor(this.px / TILE), r = Math.floor(this.pz / TILE);
    let tx = DOCK.x, tz = DOCK.z;
    const d0 = this.distField[r * COLS + c];
    if (d0 > 2) {
      for (let s = 0; s < 3; s++) {
        const cur = this.distField[r * COLS + c];
        let best = -1, bc = c, br = r;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (r + dy) * COLS + c + dx;
          const dv = this.distField[j];
          if (dv >= 0 && dv < cur && (best < 0 || dv < best)) { best = dv; bc = c + dx; br = r + dy; }
        }
        if (best < 0) break;
        c = bc; r = br;
      }
      tx = (c + 0.5) * TILE; tz = (r + 0.5) * TILE;
    }
    const ang = Math.atan2(tx - this.px, tz - this.pz);
    this.arrow.rotation.y = lerpAngle(this.arrow.rotation.y, ang, Math.min(1, dt * 10));
    const t = performance.now() / 1000;
    this.arrow.position.set(this.px, 1.25 + Math.sin(t * 6) * 0.12, this.pz);
    const s = 1 + Math.sin(t * 8) * 0.08;
    this.arrow.scale.set(s, s, s);
  }

  private followCamera(dt: number) {
    this.cam.track(dt, this.px, this.pz, this.vx, this.vz, this.turbo);
    if (this.ending === 'battery') {
      // dying: sink in toward the roomba
      const z = 1 - Math.max(0, this.endTimer / 1.8);
      this.camera.position.lerp(this.tmpV.set(this.px, 5, this.pz + 4), z * 0.6);
      this.cam.lookAtFocus();
    }
    this.cam.shake(dt);
    if (this.turbo && Math.random() < 0.6) {
      const a = this.yaw + Math.PI + (Math.random() - 0.5) * 0.8;
      this.glow.spawn(this.px + Math.sin(a) * 0.5, 0.15, this.pz + Math.cos(a) * 0.5, Math.sin(a) * 2, 0.3, Math.cos(a) * 2, 0.4, 0.8, 1, 0.16, 0.3, 0);
    }
  }

  // ------------------------------------------------------------ visuals
  private updateVisuals(dt: number) {
    const r = this.world.roomba;
    const playing = this.phase === 'playing';
    if (playing || this.phase === 'intro') this.squash.update(dt);
    poseBody(r.group, r.body, this.mover, this.squash);
    const t = performance.now() / 1000;
    if (r.machine >= 4) r.body.position.y = 0.2 + Math.sin(t * 3) * 0.04; // the hover cleaner floats
    if (r.beacon) {
      if (r.machine === 3) r.beacon.color.setRGB(1, 0.6, 0.1).multiplyScalar(Math.sin(t * 9) > 0 ? 1 : 0.25);
      else r.beacon.color.setRGB(0.45, 0.94, 1).multiplyScalar(0.7 + 0.3 * Math.sin(t * 6));
    }
    const spinning = playing && !this.docked && !this.ending;
    r.brushes[0].rotation.y += dt * (spinning ? 28 : 3);
    r.brushes[1].rotation.y -= dt * (spinning ? 28 : 3);

    if (playing && !this.ending) {
      const br = this.battery / this.batteryMax;
      let cr = 0, cg = 0.9, cb = 1;
      if (this.docked) { const p = 0.6 + 0.4 * Math.sin(t * 5); cr = 0.2 * p; cg = 1 * p; cb = 0.55 * p; }
      else if (br < 0.12) { const on = Math.sin(t * 14) > 0 ? 1 : 0.15; cr = on; cg = 0.1 * on; cb = 0.1 * on; }
      else if (br < 0.3) { cr = 1; cg = 0.55; cb = 0.1; }
      else if (this.mult > 1) { const p = 0.75 + 0.25 * Math.sin(t * (6 + this.mult * 2)); cr = 0.2 * this.mult * p * 0.4; cg = 0.95 * p; cb = p; }
      r.ledMat.color.setRGB(cr, cg, cb);
      const full = this.bin >= this.binCap - 0.01;
      if (full) r.eyeMat.color.setRGB(1, 0.6, 0.2); else r.eyeMat.color.setRGB(0.75, 0.99, 1);
      this.blinkT -= dt;
      const blink = this.blinkT < 0.12;
      if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
      r.eyes.forEach((e) => (e.scale.z = blink ? 0.15 : 1));
      r.glow.material.color.setRGB(cr, cg, cb);
      const gs = 2.2 + Math.sin(t * 4) * 0.15 + (this.mult - 1) * 0.15;
      r.glow.scale.set(gs, gs, 1);
    }
    // dock visuals
    const d = this.world.dock;
    const pulse = 0.5 + 0.5 * Math.sin(t * (this.docked ? 6 : 2.5));
    d.ringMat.opacity = this.homeHint ? 0.5 + 0.5 * pulse : 0.25 + 0.3 * pulse;
    const rs = 1 + (this.homeHint ? pulse * 0.25 : pulse * 0.08);
    d.ring.scale.set(rs, rs, rs);
    d.stripMat.color.setRGB(0.2 * (0.5 + pulse * 0.5), 1 * (0.5 + pulse * 0.5), 0.6 * (0.5 + pulse * 0.5));
    this.world.cut.uRoomba.value.set(this.px, 0, this.pz);
  }

  private updateCoins(dt: number) {
    const t = performance.now() / 1000;
    const pickR = ROOMBA_R + 0.35;
    for (let i = 0; i < this.coinsList.length; i++) {
      const c = this.coinsList[i];
      if (c.active) {
        if (this.phase === 'playing' && !this.ending) {
          const dx = this.px - c.x, dz = this.pz - c.z;
          const d = Math.hypot(dx, dz);
          if (d < 2.4 && d > 0.01) {
            const pull = (2.4 - d) * 9 * dt;
            c.x += (dx / d) * Math.min(d, pull);
            c.z += (dz / d) * Math.min(d, pull);
          }
          if (d < pickR) {
            c.active = false;
            this.coins += 5;
            this.coinsEarned += 5;
            this.score += 50 * this.mult;
            this.sfx.coin();
            this.popup('+5 🪙', '#ffd84d', 0.9);
            this.glow.burst(c.x, 0.5, c.z, 16, 4, 1, 0.8, 0.25, 0.22, 0.6, 8);
          }
        }
      }
      if (c.active) {
        this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 1, 0), t * 3 + c.phase);
        this.tmpS.set(1, 1, 1);
        this.tmpM.compose(new THREE.Vector3(c.x, 0.55 + Math.sin(t * 4 + c.phase) * 0.12, c.z), this.tmpQ, this.tmpS);
      } else {
        this.tmpM.makeScale(0, 0, 0);
      }
      this.coinMesh.setMatrixAt(i, this.tmpM);
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  /** Floating text above the roomba. */
  popup(text: string, color: string, life = 1, scale = 1) {
    this.popups.spawn(text, this.px, 1.2, this.pz, color, life, scale);
  }

  // ------------------------------------------------------------ HUD + minimap
  pushHud() {
    const rid = this.curRoom >= 0 ? this.curRoom : 0;
    const cl = this.dirt.cleanliness(rid);
    const pct = this.cleared[rid] ? 100 : Math.min(99, Math.floor((cl / CLEAR_THRESHOLD) * 100));
    this.cb.onHud({
      battery: this.battery,
      batteryMax: this.batteryMax,
      bin: this.bin,
      binCap: this.binCap,
      coins: this.coins,
      score: Math.round(this.score),
      mult: this.mult,
      comboT: this.mult >= 5 ? 1 : (this.comboTime % 2.6) / 2.6,
      time: this.time,
      roomName: ROOMS[rid].name,
      roomPct: pct,
      roomCleared: this.cleared[rid],
      roomsCleared: this.roomsCleanNow(),
      roomsTotal: this.roomCount(),
      levelName: LEVEL.name,
      levelNum: this.level + 1,
      nextLevel: this.levelDone && !this.ending ? this.nextLevelName : null,
      secretsFound: this.secretFound.filter(Boolean).length,
      secretsTotal: this.secretFound.length,
      docked: this.docked,
      overall: this.dirt.overall(),
      upgrades: { ...this.up },
      machine: this.machine,
      owned: this.garage.length,
      allMaxed: this.allMaxed,
      bestUpgrades: { ...this.garage[this.bestMachine] },
      turbo: this.turbo,
      homeHint: this.homeHint,
    });
  }

  private fog: { big: HTMLCanvasElement; small: HTMLCanvasElement; tiny: HTMLCanvasElement } | null = null;
  private fogCanvas(w: number, h: number) {
    if (!this.fog || this.fog.big.width !== w) {
      const mk = (cw: number, ch: number) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
      this.fog = { big: mk(w, h), small: mk(Math.ceil(w / 3), Math.ceil(h / 3)), tiny: mk(Math.ceil(w / 8), Math.ceil(h / 8)) };
    }
    return this.fog;
  }

  private drawMinimap() {
    const cv = this.minimap;
    if (!cv) return;
    const S = 4;
    if (cv.width !== COLS * S) { cv.width = COLS * S; cv.height = ROWS * S; }
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    // rooms not yet driven into are drawn blurry (rendered small, then scaled back up smoothly);
    // secret rooms don't show at all until their fake wall is found
    const fog = this.fogCanvas(cv.width, cv.height);
    const fg = fog.big.getContext('2d');
    if (fg) fg.clearRect(0, 0, fog.big.width, fog.big.height);
    let anyFog = false;
    for (let i = 0; i < ROOMS.length; i++) {
      if (ROOMS[i].secret && !this.dirt.counted[i]) continue;
      const known = this.explored[i];
      const tg = known ? g : fg;
      if (!tg) continue;
      if (known) {
        const pct = this.cleared[i] ? 1 : Math.min(1, this.dirt.cleanliness(i) / CLEAR_THRESHOLD);
        const hue = Math.round(pct * 120);
        tg.fillStyle = this.cleared[i] ? 'rgba(80,255,170,0.85)' : `hsla(${hue}, 75%, ${30 + pct * 15}%, 0.85)`;
      } else {
        anyFog = true;
        tg.fillStyle = 'rgba(150,140,185,0.75)';
      }
      for (const idx of this.roomTiles[i]) {
        if (!known && this.closedSecret(idx)) continue;
        const c = idx % COLS, r = (idx - c) / COLS;
        tg.fillRect(c * S, r * S, S, S);
      }
    }
    if (anyFog) {
      const sm = fog.small.getContext('2d'), sm2 = fog.tiny.getContext('2d');
      if (sm && sm2) {
        sm.clearRect(0, 0, fog.small.width, fog.small.height);
        sm.imageSmoothingEnabled = true;
        sm.drawImage(fog.big, 0, 0, fog.small.width, fog.small.height);
        sm2.clearRect(0, 0, fog.tiny.width, fog.tiny.height);
        sm2.imageSmoothingEnabled = true;
        sm2.drawImage(fog.small, 0, 0, fog.tiny.width, fog.tiny.height);
        g.save();
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.globalAlpha = 0.85;
        g.drawImage(fog.tiny, 0, 0, cv.width, cv.height);
        g.restore();
      }
    }
    const sc = S / TILE;
    // coins (only where you've been)
    g.fillStyle = '#ffd84d';
    for (const c of this.coinsList) {
      if (!c.active) continue;
      const rid = this.grid[Math.floor(c.z / TILE) * COLS + Math.floor(c.x / TILE)];
      if (rid >= 0 && !this.explored[rid]) continue;
      g.fillRect(c.x * sc - 1, c.z * sc - 1, 2, 2);
    }
    // dock
    g.fillStyle = '#35ff9a';
    g.fillRect(DOCK.x * sc - 3, DOCK.z * sc - 2, 6, 4);
    // ghost
    const t = performance.now() / 1000;
    if (this.ghost) {
      g.fillStyle = `rgba(200,150,255,${0.6 + 0.4 * Math.sin(t * 8)})`;
      g.beginPath(); g.arc(this.ghost.x * sc, this.ghost.z * sc, 4, 0, Math.PI * 2); g.fill();
    }
    // roomba
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(this.px * sc, this.pz * sc, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#00e5ff';
    g.beginPath(); g.arc(this.px * sc, this.pz * sc, 2.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#00e5ff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(this.px * sc, this.pz * sc);
    g.lineTo(this.px * sc + Math.sin(this.yaw) * 7, this.pz * sc + Math.cos(this.yaw) * 7);
    g.stroke();
  }
}

/** Direction from the look-at point to the camera during tidy cutscenes: steep, so walls hide little of the room. */
const TIDY_DIR = new THREE.Vector3(0, 1, 0.5).normalize();

/** Distance from the dock centre at which the ring grabs the roomba (ring's outer edge is 1.22). */
const DOCK_CAPTURE_R = 1.3;
