import * as THREE from 'three';
import type { Engine, PostFxOptions } from '../../engine/src';
import type { World } from './world';

/**
 * Player settings: graphics quality and audio. Saved to localStorage; applied live to the engine and
 * the current world (the game and the level designer share the same graphics settings).
 */
export type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQuality = 'off' | 'low' | 'high' | 'ultra';

export interface Settings {
  preset: Preset;
  /** Render resolution as a fraction of the display's (0.5 .. 1). */
  renderScale: number;
  antialias: boolean;
  bloom: boolean;
  shadows: ShadowQuality;
  reflections: boolean;
  /** Vignette, film grain and edge fringing. */
  filmEffects: boolean;
  /** Tone-mapping exposure multiplier (0.7 .. 1.4). */
  brightness: number;
  /** Drop effects and resolution automatically when frames get slow. */
  autoQuality: boolean;
  /** 0 .. 1 */
  volume: number;
}

type Graphics = Omit<Settings, 'preset' | 'brightness' | 'autoQuality' | 'volume'>;
export const PRESETS: Record<Exclude<Preset, 'custom'>, Graphics> = {
  low: { renderScale: 0.75, antialias: false, bloom: false, shadows: 'off', reflections: false, filmEffects: false },
  medium: { renderScale: 1, antialias: false, bloom: true, shadows: 'low', reflections: true, filmEffects: true },
  high: { renderScale: 1, antialias: true, bloom: true, shadows: 'high', reflections: true, filmEffects: true },
  ultra: { renderScale: 1, antialias: true, bloom: true, shadows: 'ultra', reflections: true, filmEffects: true },
};
const GRAPHICS_KEYS = Object.keys(PRESETS.low) as (keyof Graphics)[];

const KEY = 'cs_settings';
const isTouch = () => typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

export function defaultSettings(): Settings {
  const preset = isTouch() ? 'medium' : 'high';
  return { preset, ...PRESETS[preset], brightness: 1, autoQuality: true, volume: 0.6 };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = { ...d, ...JSON.parse(raw) } as Settings;
    // clamp anything out of range from an older or hand-edited save
    s.renderScale = Math.min(1, Math.max(0.5, Number(s.renderScale) || 1));
    s.brightness = Math.min(1.4, Math.max(0.7, Number(s.brightness) || 1));
    s.volume = Number.isFinite(Number(s.volume)) ? Math.min(1, Math.max(0, Number(s.volume))) : d.volume;
    if (!['off', 'low', 'high', 'ultra'].includes(s.shadows)) s.shadows = d.shadows;
    return s;
  } catch { return d; }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}

/** Apply a preset's graphics values. */
export function withPreset(s: Settings, p: Exclude<Preset, 'custom'>): Settings {
  return { ...s, ...PRESETS[p], preset: p };
}

/** After an individual change: name the preset it now matches, or 'custom'. */
export function matchPreset(s: Settings): Settings {
  const hit = (Object.keys(PRESETS) as Exclude<Preset, 'custom'>[]).find((p) => GRAPHICS_KEYS.every((k) => PRESETS[p][k] === s[k]));
  return { ...s, preset: hit ?? 'custom' };
}

const BASE_EXPOSURE = 1.3;
const postKeys = new WeakMap<Engine, string>();

/** Post-processing options for these settings, or null for a plain render. */
function postOptions(s: Settings, tool: boolean): PostFxOptions | null {
  const film = s.filmEffects && !tool;
  if (!s.bloom && !s.antialias && !film) return null;
  return {
    bloom: s.bloom ? { strength: tool ? 0.45 : 0.4, radius: 0.5, threshold: 0.95 } : undefined,
    vignette: film ? 0.38 : tool ? 0.18 : 0,
    grain: film ? 0.03 : 0,
    aberration: film ? 1 : 0,
    shadowTint: [0.0, 0.006, 0.022],
    highlightTint: [0.022, 0.01, -0.006],
    samples: s.antialias ? 4 : 0,
  };
}

/**
 * Renderer-level settings: resolution, post chain, exposure, shadow map switch.
 * `tool` = the level designer (no grain or fringing there).
 */
export function applyEngineGraphics(engine: Engine, s: Settings, tool = false) {
  engine.renderer.toneMappingExposure = BASE_EXPOSURE * s.brightness;
  engine.setRenderScale(s.renderScale);
  // only rebuild the post chain when its options actually change (not on every slider step)
  const post = postOptions(s, tool);
  const key = JSON.stringify(post);
  if (postKeys.get(engine) !== key || (post && !engine.post)) {
    postKeys.set(engine, key);
    engine.setPostFx(post);
  }
  const shadowsOn = s.shadows !== 'off';
  if (engine.renderer.shadowMap.enabled !== shadowsOn) {
    engine.renderer.shadowMap.enabled = shadowsOn;
    // shadow sampling is compiled into every lit material; rebuild them
    engine.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; });
    });
  }
}

/** World-level settings: reflections and shadow map resolution. Call after building a world. */
export function applyWorldGraphics(world: World, s: Settings) {
  world.scene.environmentIntensity = s.reflections ? 0.85 : 0;
  const [point, sun] = s.shadows === 'ultra' ? [1024, 4096] : s.shadows === 'high' ? [512, 2048] : [256, 1024];
  world.scene.traverse((o) => {
    const l = o as THREE.Light & { shadow?: THREE.LightShadow };
    if (!l.isLight || !l.shadow) return;
    const size = (l as THREE.DirectionalLight).isDirectionalLight ? sun : point;
    if (l.shadow.mapSize.x !== size) {
      l.shadow.mapSize.set(size, size);
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
    l.shadow.needsUpdate = true;
  });
}
