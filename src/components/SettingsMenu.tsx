import { ReactNode, useEffect, useRef, useState } from 'react';
import { Preset, Settings, ShadowQuality, defaultSettings, matchPreset, withPreset } from '../game/settings';
import { Button, Frame, FrameHeader, KeyCap, PromptBar, uiSound } from './ui';

type Choice<T> = { kind: 'choice'; options: [T, string][]; value: T; set: (v: T) => void };
type Slider = { kind: 'slider'; min: number; max: number; step: number; value: number; format: (v: number) => string; set: (v: number) => void };
type Row = { id: string; label: string; desc: ReactNode; cost?: 'low' | 'medium' | 'high' } & (Choice<unknown> | Slider);

type Tab = 'graphics' | 'audio';
const TABS: [Tab, string][] = [['graphics', 'GRAPHICS'], ['audio', 'AUDIO']];
const onOff: [boolean, string][] = [[false, 'Off'], [true, 'On']];

function CostTag({ cost }: { cost?: Row['cost'] }) {
  if (!cost) return null;
  const c = cost === 'high' ? 'var(--cs-red)' : cost === 'medium' ? 'var(--cs-gold)' : 'var(--cs-green)';
  return <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: c }}>Performance cost: {cost}</span>;
}

/** ‹ VALUE › selector with a pip per option. */
function ChoiceControl({ row, focused }: { row: Row & Choice<unknown>; focused: boolean }) {
  const i = row.options.findIndex(([v]) => v === row.value);
  const step = (d: number) => {
    const n = (i + d + row.options.length) % row.options.length;
    uiSound.move();
    row.set(row.options[n][0]);
  };
  return (
    <div className="flex items-center gap-2 w-[240px]">
      <button className="cs-set-arrow" onClick={() => step(-1)} aria-label="Previous">‹</button>
      <div className="flex-1 flex flex-col items-center">
        <span className={`font-display text-[14px] font-semibold tracking-[0.16em] uppercase ${focused ? 'text-[var(--cs-gold-hi)]' : 'text-[var(--cs-ink-hi)]'}`}>
          {i >= 0 ? row.options[i][1] : 'Custom'}
        </span>
        <span className="flex gap-1 mt-1.5">
          {row.options.map(([v], k) => (
            <span key={k} className="h-[3px] w-4" style={{ background: v === row.value ? 'var(--cs-gold)' : 'rgba(255,255,255,0.15)' }} />
          ))}
        </span>
      </div>
      <button className="cs-set-arrow" onClick={() => step(1)} aria-label="Next">›</button>
    </div>
  );
}

function SliderControl({ row, focused }: { row: Row & Slider; focused: boolean }) {
  const pct = ((row.value - row.min) / (row.max - row.min)) * 100;
  return (
    <div className="flex items-center gap-3 w-[240px]">
      <input
        type="range"
        min={row.min} max={row.max} step={row.step} value={row.value}
        onChange={(e) => row.set(Number(e.target.value))}
        className="cs-set-range flex-1"
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
      />
      <span className={`w-12 text-right font-display text-[13px] font-semibold tabular-nums ${focused ? 'text-[var(--cs-gold-hi)]' : 'text-[var(--cs-ink-hi)]'}`}>{row.format(row.value)}</span>
    </div>
  );
}

export function SettingsMenu({ settings, onChange, muted, onMute, onClose, isTouch }: {
  settings: Settings;
  onChange: (s: Settings) => void;
  muted: boolean;
  onMute: () => void;
  onClose: () => void;
  isTouch: boolean;
}) {
  const [tab, setTab] = useState<Tab>('graphics');
  const [focus, setFocus] = useState(0);
  const s = settings;
  // a change to one graphics option re-labels the preset (or 'custom')
  const upd = (patch: Partial<Settings>) => onChange(matchPreset({ ...s, ...patch }));

  const graphics: Row[] = [
    {
      id: 'preset', label: 'Quality preset', kind: 'choice',
      options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] as [Preset, string][],
      value: s.preset, set: (v) => onChange(withPreset(s, v as Exclude<Preset, 'custom'>)),
      desc: 'Sets every graphics option below at once. Changing any single option switches this to Custom.',
    },
    {
      id: 'scale', label: 'Resolution', kind: 'slider', min: 0.5, max: 1, step: 0.05, value: s.renderScale,
      format: (v) => `${Math.round(v * 100)}%`, set: (v) => upd({ renderScale: v }), cost: 'high',
      desc: 'Renders the scene at a fraction of your screen resolution. The biggest single saving on slower devices.',
    },
    {
      id: 'aa', label: 'Anti-aliasing', kind: 'choice', options: [[false, 'Off'], [true, 'MSAA 4×']], value: s.antialias,
      set: (v) => upd({ antialias: v as boolean }), cost: 'medium',
      desc: 'Smooths jagged edges on furniture and walls.',
    },
    {
      id: 'shadows', label: 'Shadows', kind: 'choice',
      options: [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']] as [ShadowQuality, string][],
      value: s.shadows, set: (v) => upd({ shadows: v as ShadowQuality }), cost: 'high',
      desc: 'Shadows cast by the chandeliers and moonlight. Higher settings give sharper edges.',
    },
    {
      id: 'bloom', label: 'Bloom', kind: 'choice', options: onOff, value: s.bloom, set: (v) => upd({ bloom: v as boolean }), cost: 'medium',
      desc: 'The soft glow around candles, lamps and the robot\'s lights.',
    },
    {
      id: 'refl', label: 'Reflections', kind: 'choice', options: onOff, value: s.reflections, set: (v) => upd({ reflections: v as boolean }), cost: 'low',
      desc: 'Subtle reflections on polished wood, brass, marble and wet floors.',
    },
    {
      id: 'film', label: 'Film effects', kind: 'choice', options: onOff, value: s.filmEffects, set: (v) => upd({ filmEffects: v as boolean }), cost: 'low',
      desc: 'Vignette, film grain and a faint colour fringe at the screen edges.',
    },
    {
      id: 'bright', label: 'Brightness', kind: 'slider', min: 0.7, max: 1.4, step: 0.05, value: s.brightness,
      format: (v) => `${Math.round(v * 100)}%`, set: (v) => onChange({ ...s, brightness: v }),
      desc: 'Overall exposure. Raise it if the manor looks too dark on your screen.',
    },
    {
      id: 'auto', label: 'Auto quality', kind: 'choice', options: onOff, value: s.autoQuality, set: (v) => onChange({ ...s, autoQuality: v as boolean }),
      desc: 'If frames get slow during play, effects and then resolution are lowered automatically. Changing any setting resets it.',
    },
  ];
  const audio: Row[] = [
    {
      id: 'vol', label: 'Volume', kind: 'slider', min: 0, max: 1, step: 0.05, value: s.volume,
      format: (v) => `${Math.round(v * 100)}%`, set: (v) => onChange({ ...s, volume: v }),
      desc: 'Master volume for sound effects and ambience.',
    },
    {
      id: 'mute', label: 'Sound', kind: 'choice', options: [[false, 'On'], [true, 'Muted']], value: muted, set: () => onMute(),
      desc: 'Mute everything. M toggles this at any time.',
    },
  ];
  const rows = tab === 'graphics' ? graphics : audio;
  const f = Math.min(focus, rows.length - 1);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Keys are captured before the game sees them, so Esc goes back here instead of resuming play.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const list = rowsRef.current;
      const row = list[Math.min(focus, list.length - 1)];
      const nudge = (d: number) => {
        if (row.kind === 'slider') {
          const v = Math.min(row.max, Math.max(row.min, Math.round((row.value + d * row.step) / row.step) * row.step));
          if (v !== row.value) { uiSound.move(); row.set(v); }
        } else {
          const i = row.options.findIndex(([v]) => v === row.value);
          uiSound.move();
          row.set(row.options[(i + d + row.options.length) % row.options.length][0]);
        }
      };
      let handled = true;
      switch (e.code) {
        case 'ArrowUp': case 'KeyW': uiSound.move(); setFocus((i) => (Math.min(i, list.length - 1) + list.length - 1) % list.length); break;
        case 'ArrowDown': case 'KeyS': uiSound.move(); setFocus((i) => (Math.min(i, list.length - 1) + 1) % list.length); break;
        case 'ArrowLeft': case 'KeyA': nudge(-1); break;
        case 'ArrowRight': case 'KeyD': case 'Enter': case 'Space': nudge(1); break;
        case 'KeyQ': case 'KeyE': uiSound.move(); setTab((t) => (t === 'graphics' ? 'audio' : 'graphics')); setFocus(0); break;
        case 'Escape': case 'Backspace': uiSound.back(); onClose(); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [focus, onClose]);

  const current = rows[f];
  return (
    <div className="absolute inset-0 bg-black/70 overflow-y-auto scrollbar-thin fade-in z-10" style={{ backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}>
      <div className="min-h-full flex items-center justify-center p-3 sm:p-6">
        <Frame className="w-full max-w-2xl p-5 sm:px-8 sm:py-6 flex flex-col cs-panel-in">
          <FrameHeader eyebrow="Options" title="SETTINGS" onClose={onClose} />
          <div className="flex gap-6 border-b border-[var(--cs-line-soft)] mb-3">
            {TABS.map(([t, label]) => (
              <button key={t} className="cs-tab" data-on={t === tab || undefined} onClick={() => { if (t !== tab) { uiSound.move(); setTab(t); setFocus(0); } }}>{label}</button>
            ))}
          </div>

          <div className="flex flex-col" role="list">
            {rows.map((row, i) => {
              const on = i === f;
              return (
                <div
                  key={row.id}
                  role="listitem"
                  className="cs-set-row"
                  data-on={on || undefined}
                  onMouseEnter={() => { if (!on) setFocus(i); }}
                >
                  <span className="cs-menu-mark" aria-hidden />
                  <span className="flex-1 font-display text-[14px] sm:text-[15px] font-semibold tracking-[0.12em] uppercase">{row.label}</span>
                  {row.kind === 'choice' ? <ChoiceControl row={row} focused={on} /> : <SliderControl row={row} focused={on} />}
                </div>
              );
            })}
          </div>

          <div className="mt-3 min-h-[3.6em] pl-4 border-l border-[var(--cs-line-soft)] text-[13px] leading-relaxed text-[var(--cs-ink)]" key={current.id}>
            <div className="cs-menu-desc !mt-0 !pl-0 !border-0 !min-h-0">{current.desc}</div>
            <div className="mt-1"><CostTag cost={current.cost} /></div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3 mt-4 pt-4 border-t border-[var(--cs-line-soft)]">
            {!isTouch && (
              <PromptBar className="flex-1" items={[[<><KeyCap>↑</KeyCap><KeyCap>↓</KeyCap></>, 'Select'], [<><KeyCap>←</KeyCap><KeyCap>→</KeyCap></>, 'Change'], [<KeyCap>Esc</KeyCap>, 'Back']]} />
            )}
            <div className="flex gap-2 sm:ml-auto">
              {tab === 'graphics' && <Button className="cs-btn-sm flex-1 sm:flex-none" onClick={() => onChange({ ...defaultSettings(), volume: s.volume })}>Reset graphics</Button>}
              <Button variant="primary" className="cs-btn-sm flex-1 sm:flex-none" onClick={onClose}>Done</Button>
            </div>
          </div>
        </Frame>
      </div>
    </div>
  );
}
