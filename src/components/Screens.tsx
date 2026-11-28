import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { REVIVE_MIN, type GameOverInfo, type HudState } from '../game/Game';
import { MACHINES, UPGRADES, UpKey, upgradeCost } from '../game/constants';
import { DEV_MODE } from '../game/devmode';
import { ScoreEntry, addScore, lastName, loadScores, qualifies, saveName } from '../game/highscores';
import type { SaveMeta } from '../game/saves';
import { formatClock, formatShift, nightNumber } from './HUD';
import {
  Button, Frame, FrameHeader, Icon, KeyCap, MenuEntry, MenuList, PromptBar, Rule, SectionTitle, Stat, StatStrip, uiSound, useEscape,
} from './ui';

/* ================================================================== hall of fame */

const RANK_COLORS = ['#f3d687', '#d9dde4', '#d39a62'];

export function ScoreTable({ scores, highlight, compact }: { scores: ScoreEntry[]; highlight?: number; compact?: boolean }) {
  if (!scores.length) {
    return (
      <div className="text-center py-8">
        <div className="font-display text-sm tracking-[0.24em] text-[var(--cs-ink)]">NO RECORDS YET</div>
        <div className="text-xs text-[var(--cs-dim)] mt-1.5">Be the first name on the wall.</div>
      </div>
    );
  }
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-[10px] uppercase tracking-[0.22em] text-[var(--cs-dim)]">
          <th className="text-left font-semibold pb-2 pl-2 w-10">#</th>
          <th className="text-left font-semibold pb-2">Name</th>
          {!compact && <th className="text-center font-semibold pb-2 hidden sm:table-cell">Nights</th>}
          <th className="text-center font-semibold pb-2">Rooms</th>
          <th className="text-right font-semibold pb-2 pr-2">Score</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((s, i) => {
          const hl = i === highlight;
          return (
            <tr key={i} className={`border-t border-[var(--cs-line-soft)] ${hl ? 'bg-[rgba(217,180,90,0.16)]' : ''}`}>
              <td className="py-2 pl-2 font-display font-bold tabular-nums" style={{ color: RANK_COLORS[i] ?? 'var(--cs-dim)' }}>{String(i + 1).padStart(2, '0')}</td>
              <td className={`py-2 font-semibold tracking-wider truncate max-w-[130px] ${hl ? 'text-[var(--cs-gold-hi)]' : 'text-[var(--cs-ink-hi)]'}`}>{s.name}</td>
              {!compact && (
                <td className="py-2 text-center text-xs text-[var(--cs-ink)] tabular-nums hidden sm:table-cell">
                  {s.nights !== undefined ? s.nights : s.reason === 'dawn' ? 1 : 0}
                </td>
              )}
              <td className="py-2 text-center text-xs text-[var(--cs-ink)] tabular-nums">{s.rooms}</td>
              <td className="py-2 pr-2 text-right font-display font-bold tabular-nums gold-text">{s.score.toLocaleString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ================================================================== title screen */

const GUIDE: [string, ReactNode][] = [
  ['Sweep', <>Drive over dirt and muddy footprints to vacuum them up. Keep the suction going to build a <b className="text-[var(--cs-cyan)]">combo</b>.</>],
  ['Shine', <>Bring a room to <b className="text-[var(--cs-ink-hi)]">100%</b> for bonus coins and points.</>],
  ['Power', <>Driving drains the battery and a full bin stops cleaning. Return to the <b className="text-[var(--cs-green)]">dock</b> to charge and empty.</>],
  ['Upgrade', <>Spend coins at the dock. Max every upgrade to trade up to a better machine: mop bot, shop vac, floor scrubber and beyond.</>],
  ['Expand', <>Get every room spotless to unlock the next building: a hunting lodge, a grand hotel, an ironworks, a cruise ship, and on it goes.</>],
  ['Beware', <>Something in the manor keeps tracking mud back in.</>],
  ['Dawn', <>Each <b className="text-[var(--cs-ink-hi)]">5:00 AM</b> pays a big bonus, then the curse winds the clock back to midnight. Sweep for as long as your battery lasts.</>],
];

const KEYS: [string[], string][] = [
  [['W', 'A', 'S', 'D'], 'Drive (or arrow keys)'],
  [['Shift'], 'Turbo (or Space)'],
  [['E'], 'Upgrade shop, while docked'],
  [['Esc'], 'Pause (or P)'],
  [['M'], 'Mute'],
  [['R'], 'Restart'],
];

function Guide() {
  return (
    <dl className="grid grid-cols-[84px_1fr] gap-x-4 gap-y-3.5 text-[13px] leading-relaxed">
      {GUIDE.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-display text-[11px] font-semibold tracking-[0.24em] text-[var(--cs-gold)] uppercase pt-[3px]">{k}</dt>
          <dd className="text-[var(--cs-ink)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Controls({ isTouch }: { isTouch: boolean }) {
  if (isTouch) {
    return (
      <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 text-[13px]">
        {[['Drag', 'Steer from anywhere on screen'], ['Hold Turbo', 'Speed boost, drains battery faster'], ['Pause button', 'Top right corner'], ['Dock', 'Tap the shop button when docked']].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-display text-[11px] font-semibold tracking-[0.2em] text-[var(--cs-gold)] uppercase pt-[2px]">{k}</dt>
            <dd className="text-[var(--cs-ink)]">{v}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="flex flex-col">
      {KEYS.map(([keys, label]) => (
        <div key={label} className="flex items-center justify-between py-2.5 border-t border-[var(--cs-line-soft)] first:border-t-0">
          <span className="text-[13px] text-[var(--cs-ink)]">{label}</span>
          <span className="flex gap-1">{keys.map((k) => <KeyCap key={k}>{k}</KeyCap>)}</span>
        </div>
      ))}
    </div>
  );
}

type InfoTab = 'guide' | 'controls' | 'scores';
const TABS: [InfoTab, string][] = [['guide', 'HOW TO PLAY'], ['controls', 'CONTROLS'], ['scores', 'HALL OF FAME']];

/** How-to / controls / hall of fame, as one tabbed panel. ←/→ (or Q/E) change tab. */
function InfoPanel({ tab, setTab, onClose, isTouch, scores }: { tab: InfoTab; setTab: (t: InfoTab) => void; onClose: () => void; isTouch: boolean; scores: ScoreEntry[] }) {
  useEscape(onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const i = TABS.findIndex(([t]) => t === tab);
      let n = -1;
      if (e.code === 'ArrowLeft' || e.code === 'KeyQ' || e.code === 'KeyA') n = (i + TABS.length - 1) % TABS.length;
      if (e.code === 'ArrowRight' || e.code === 'KeyE' || e.code === 'KeyD') n = (i + 1) % TABS.length;
      if (n >= 0) { e.preventDefault(); uiSound.move(); setTab(TABS[n][0]); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [tab, setTab]);

  return (
    <Frame className="w-full max-w-[560px] p-6 sm:p-8 cs-slide-r flex flex-col max-h-full">
      <FrameHeader eyebrow="Blackwood Manor · Staff handbook" title={TABS.find(([t]) => t === tab)![1]} onClose={onClose} />
      <div className="flex gap-4 sm:gap-6 border-b border-[var(--cs-line-soft)] mb-5 overflow-x-auto">
        {TABS.map(([t, label]) => (
          <button key={t} className="cs-tab" data-on={t === tab || undefined} onClick={() => { if (t !== tab) { uiSound.move(); setTab(t); } }}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 overflow-y-auto scrollbar-thin pr-1 -mr-1" key={tab}>
        <div className="cs-panel-in">
          {tab === 'guide' && <Guide />}
          {tab === 'controls' && <Controls isTouch={isTouch} />}
          {tab === 'scores' && <ScoreTable scores={scores} />}
        </div>
      </div>
      {!isTouch && (
        <PromptBar className="mt-6 pt-4 border-t border-[var(--cs-line-soft)]" items={[[<><KeyCap>Q</KeyCap><KeyCap>E</KeyCap></>, 'Switch tab'], [<KeyCap>Esc</KeyCap>, 'Back']]} />
      )}
    </Frame>
  );
}

export interface StartScreenProps {
  onPlay: (intro: boolean) => void;
  isTouch: boolean;
  seenIntro: boolean;
  autosave: SaveMeta | null;
  saveCount: number;
  muted: boolean;
  onMute: () => void;
  onContinue: () => void;
  onLoadMenu: () => void;
  onDesigner: () => void;
  onSettings: () => void;
}

export function StartScreen({ onPlay, isTouch, autosave, saveCount, muted, onMute, onContinue, onLoadMenu, onDesigner, onSettings }: StartScreenProps) {
  const scores = useMemo(() => loadScores(), []);
  const [panel, setPanel] = useState<InfoTab | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);

  const replaces = autosave ? <span className="block mt-1 text-[var(--cs-dim)]">Starting over replaces your autosave. Make a manual save from the pause menu to keep it.</span> : null;
  const items: MenuEntry[] = [];
  if (autosave) {
    items.push({
      id: 'continue', label: 'Continue', onSelect: onContinue,
      desc: <><span className="text-[var(--cs-ink-hi)]">{autosave.levelName ?? 'Blackwood Manor'}</span> · {formatShift(autosave.time)} · {autosave.score.toLocaleString()} pts</>,
    });
  }
  items.push(
    {
      id: 'new', label: 'New Shift', onSelect: () => onPlay(true),
      desc: <>The owners left at midnight, swearing they'd be home by dawn. They never came back, and the night keeps starting over. Somewhere in the dark, a little robot wakes up.{replaces}</>,
    },
    { id: 'quick', label: 'Quick Start', onSelect: () => onPlay(false), desc: <>Skip the opening cinematic and get straight to work.{replaces}</> },
  );
  if (saveCount > 0) items.push({ id: 'load', label: 'Load Game', value: saveCount, onSelect: onLoadMenu, desc: `Pick up any of your ${saveCount} saved shift${saveCount === 1 ? '' : 's'}.` });
  items.push(
    { id: 'guide', label: 'How to Play', onSelect: () => setPanel('guide'), desc: 'Cleaning, combos, the dock, upgrades, and the curse on the manor.' },
    {
      id: 'scores', label: 'Hall of Fame', onSelect: () => setPanel('scores'),
      desc: scores.length ? <>Record: <span className="text-[var(--cs-ink-hi)]">{scores[0].score.toLocaleString()}</span> by {scores[0].name}</> : 'No records yet.',
    },
    { id: 'settings', label: 'Settings', onSelect: onSettings, desc: 'Graphics quality, resolution, shadows, effects and volume.' },
    { id: 'designer', label: 'Level Designer', onSelect: onDesigner, desc: 'Draw your own building, furnish it, then playtest it.' },
  );

  return (
    <div className="absolute inset-0 fade-in overflow-hidden">
      {/* backdrop: the manor flyover shows through on the right */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(5,3,8,0.94) 0%, rgba(5,3,8,0.82) 32%, rgba(5,3,8,0.25) 62%, rgba(5,3,8,0.4) 100%)' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(5,3,8,0.55) 0%, transparent 22%, transparent 70%, rgba(5,3,8,0.9) 100%)' }} />
      <div className="cs-mist" />
      <div className="absolute inset-0 vignette pointer-events-none" />

      <div className="relative h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <main className="flex-1 min-h-0 flex items-stretch gap-8 px-5 sm:px-[clamp(28px,6vw,96px)]">
          {/* left column: title lockup + menu */}
          <div className={`w-full lg:w-[480px] shrink-0 overflow-y-auto scrollbar-thin flex flex-col justify-center py-8 ${panel ? 'max-lg:hidden' : ''}`}>
            <div className="mb-8 sm:mb-10">
              <div className="flex items-center gap-3 mb-3 cs-rise" style={{ animationDelay: '200ms' }}>
                <span className="text-[10px] sm:text-[11px] tracking-[0.42em] text-[var(--cs-ink)] font-display whitespace-nowrap">MIDNIGHT AT BLACKWOOD MANOR</span>
              </div>
              <h1 className="font-display font-black leading-[0.84] text-[clamp(64px,10vw,124px)] cs-title-in">
                <span className="cs-title block">CLEAN</span>
                <span className="cs-title block">SWEEP</span>
              </h1>
              <Rule className="cs-rule-left mt-5 max-w-[340px] cs-rise" />
              <p className="mt-4 max-w-[380px] text-[13px] leading-relaxed text-[var(--cs-dim)] cs-rise" style={{ animationDelay: '350ms' }}>
                The night keeps starting over. Something keeps tracking mud through the halls.
              </p>
            </div>
            <MenuList items={items} enabled={!panel} />
          </div>

          {/* right side: the info panel */}
          {panel && (
            <div className="flex-1 min-w-0 flex items-center justify-center lg:justify-end py-6">
              <InfoPanel tab={panel} setTab={setPanel} onClose={closePanel} isTouch={isTouch} scores={scores} />
            </div>
          )}
        </main>

        <footer className="relative flex items-center justify-between gap-4 px-5 sm:px-[clamp(28px,6vw,96px)] py-4 border-t border-[var(--cs-line-soft)] bg-gradient-to-t from-black/50 to-transparent">
          {!isTouch ? (
            <PromptBar items={panel ? [[<KeyCap>Esc</KeyCap>, 'Back']] : [[<><KeyCap>↑</KeyCap><KeyCap>↓</KeyCap></>, 'Select'], [<KeyCap>Enter</KeyCap>, 'Confirm'], [<KeyCap>M</KeyCap>, 'Mute']]} />
          ) : <span />}
          <button onClick={() => { uiSound.select(); onMute(); }} className="cs-icon-btn" aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Sound off' : 'Sound on'}>
            <Icon name={muted ? 'soundOff' : 'soundOn'} />
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ================================================================== pause */

export function PauseMenu({ onResume, onRestart, onMenu, onMute, onSaveMenu, onSettings, muted, hud, onDesigner, isTouch }: { onResume: () => void; onRestart: () => void; onMenu: () => void; onMute: () => void; onSaveMenu: () => void; onSettings: () => void; muted: boolean; hud: HudState | null; onDesigner?: () => void; isTouch?: boolean }) {
  const items: MenuEntry[] = [
    { id: 'resume', label: 'Resume', onSelect: onResume, desc: 'Back to work. The clock starts ticking again.' },
    { id: 'save', label: 'Save / Load', onSelect: onSaveMenu, desc: 'Write this shift to a slot, or load another one.' },
    { id: 'restart', label: 'Restart', confirm: 'Restart shift?', onSelect: onRestart, desc: 'Start this shift over from midnight. Current progress is lost.' },
    { id: 'sound', label: 'Sound', value: muted ? 'Off' : 'On', onSelect: onMute, desc: 'Toggle all game audio.' },
    { id: 'settings', label: 'Settings', onSelect: onSettings, desc: 'Graphics quality, resolution, shadows, effects and volume.' },
  ];
  if (onDesigner) items.push({ id: 'designer', label: 'Level Editor', onSelect: onDesigner, desc: 'Abandon this playtest and go back to editing.' });
  items.push({ id: 'menu', label: 'Main Menu', onSelect: onMenu, desc: 'Progress is autosaved. Continue from the title screen any time.' });

  return (
    <div className="absolute inset-0 fade-in">
      <div className="absolute inset-0 bg-black/45" style={{ backdropFilter: 'blur(5px) saturate(0.7)', WebkitBackdropFilter: 'blur(5px) saturate(0.7)' }} />
      <aside
        className="relative h-full w-full sm:w-[440px] flex flex-col px-6 sm:px-10 cs-slide-l overflow-y-auto scrollbar-thin"
        style={{
          background: 'linear-gradient(90deg, #07050a, #07050a 55%, rgba(7,5,10,0.88))',
          borderRight: '1px solid var(--cs-line-soft)',
          paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="text-[11px] tracking-[0.34em] uppercase text-[var(--cs-dim)] mb-2">{hud ? `${hud.levelName} · ${formatShift(hud.time)}` : 'Blackwood Manor'}</div>
        <h2 className="font-display font-black text-5xl tracking-[0.14em] cs-title leading-none">PAUSED</h2>
        <Rule className="cs-rule-left mt-5 mb-6" />
        {hud && (
          <StatStrip className="mb-8">
            <Stat label="Score" value={hud.score.toLocaleString()} />
            <Stat label="Rooms" value={<>{hud.roomsCleared}<span className="text-[var(--cs-dim)] text-sm">/{hud.roomsTotal}</span></>} />
            <Stat label="Coins" value={hud.coins.toLocaleString()} />
          </StatStrip>
        )}
        <MenuList items={items} size="md" />
        <div className="flex-1 min-h-6" />
        {!isTouch && (
          <PromptBar className="pt-4 border-t border-[var(--cs-line-soft)]" items={[[<><KeyCap>↑</KeyCap><KeyCap>↓</KeyCap></>, 'Select'], [<KeyCap>Enter</KeyCap>, 'Confirm'], [<KeyCap>Esc</KeyCap>, 'Resume']]} />
        )}
      </aside>
    </div>
  );
}

/* ================================================================== shop */

function Pips({ n, of }: { n: number; of: number }) {
  return (
    <div className="flex gap-[3px] mt-2">
      {Array.from({ length: of }, (_, k) => (
        <div key={k} className="h-[5px] flex-1" style={{ transform: 'skewX(-20deg)', background: k < n ? 'linear-gradient(180deg, #ffe7a3, #d9b45a)' : 'rgba(255,255,255,0.08)', boxShadow: k < n ? '0 0 6px rgba(217,180,90,0.6)' : undefined }} />
      ))}
    </div>
  );
}

function IconTile({ children, tone = 'gold', dim }: { children: ReactNode; tone?: 'gold' | 'cyan' | 'violet'; dim?: boolean }) {
  const c = tone === 'cyan' ? 'rgba(127,233,245,0.35)' : tone === 'violet' ? 'rgba(200,150,255,0.4)' : 'var(--cs-line)';
  return (
    <div className={`w-12 h-12 shrink-0 flex items-center justify-center text-2xl ${dim ? 'grayscale opacity-50' : ''}`} style={{ border: `1px solid ${c}`, background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.08), rgba(0,0,0,0.3))', clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)' }}>
      {children}
    </div>
  );
}

function Price({ value, ok }: { value: number; ok: boolean }) {
  return (
    <span className={`font-display font-bold text-sm whitespace-nowrap tabular-nums flex items-center gap-1.5 ${ok ? 'text-[var(--cs-gold-hi)]' : 'text-[var(--cs-red)]'}`}>
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'radial-gradient(circle at 35% 35%, #fff3c4, #c4932f)' }} />
      {value.toLocaleString()}
    </span>
  );
}

const card = 'text-left p-3.5 border transition-all flex gap-3.5 items-center';

/**
 * The garage: every machine you own (tap one to switch while docked) and the next one to buy,
 * which unlocks once every upgrade on your newest machine is maxed.
 */
function MachinePanel({ hud, onBuyMachine, onSwitch }: { hud: HudState; onBuyMachine: () => void; onSwitch: (i: number) => void }) {
  const cur = MACHINES[hud.machine];
  const next = MACHINES[hud.owned];
  const levels = UPGRADES.reduce((n, u) => n + hud.bestUpgrades[u.key], 0);
  const maxLevels = UPGRADES.reduce((n, u) => n + u.costs.length, 0);
  const can = !!next && hud.allMaxed && hud.coins >= next.price;
  return (
    <div className="grid sm:grid-cols-2 gap-3 mb-6">
      <div className={`${card} border-[rgba(127,233,245,0.25)] bg-[rgba(127,233,245,0.05)] flex-col !items-stretch`}>
        <div className="flex gap-3.5 items-center">
          <IconTile tone="cyan">{cur.icon}</IconTile>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--cs-cyan)]/80 font-semibold">Driving · {hud.machine + 1} of {MACHINES.length}</div>
            <div className="font-display font-bold text-[var(--cs-ink-hi)] truncate tracking-wide">{cur.name}</div>
            <div className="text-xs text-[var(--cs-dim)] leading-snug">{cur.desc}</div>
          </div>
        </div>
        {hud.owned > 1 && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--cs-dim)] font-semibold mb-2">Garage</div>
            <div className="flex flex-wrap gap-1.5">
              {MACHINES.slice(0, hud.owned).map((m, i) => (
                <button
                  key={m.name}
                  onClick={() => { uiSound.select(); onSwitch(i); }}
                  disabled={i === hud.machine}
                  title={m.mopR > 0 ? `${m.name} · leaves a wet sheen on tile floors` : m.name}
                  className={`px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
                    i === hud.machine ? 'bg-[rgba(127,233,245,0.18)] border-[rgba(127,233,245,0.6)] text-white' : 'border-white/15 text-[var(--cs-ink)] hover:border-[rgba(127,233,245,0.5)] hover:text-white'
                  }`}
                >
                  <span className="text-sm">{m.icon}</span>{m.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {next ? (
        <button
          onClick={() => { if (hud.allMaxed) uiSound.select(); onBuyMachine(); }}
          disabled={!hud.allMaxed}
          className={`${card} ${can ? 'border-[rgba(200,150,255,0.5)] bg-[rgba(200,150,255,0.1)] hover:bg-[rgba(200,150,255,0.18)]' : 'border-white/10 bg-white/[0.02]'}`}
        >
          <IconTile tone="violet" dim={!hud.allMaxed}>{hud.allMaxed ? next.icon : <Icon name="lock" className="w-5 h-5 text-[var(--cs-ink)]" />}</IconTile>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#d8b8ff]/80 font-semibold">Next machine</div>
            <div className="font-display font-bold text-[var(--cs-ink-hi)] truncate tracking-wide">{next.name}</div>
            <div className="text-xs text-[var(--cs-dim)] leading-snug">
              {hud.allMaxed ? next.desc : `Max every upgrade on your ${MACHINES[hud.owned - 1].name} to unlock.`}
            </div>
            {!hud.allMaxed && <Pips n={levels} of={maxLevels} />}
          </div>
          <Price value={next.price} ok={can} />
        </button>
      ) : (
        <div className={`${card} justify-center border-[rgba(143,220,170,0.3)] bg-[rgba(143,220,170,0.06)] font-display text-sm tracking-[0.14em] text-[var(--cs-green)]`}>
          EVERY MACHINE OWNED
        </div>
      )}
    </div>
  );
}

export function Shop({ hud, onBuy, onBuyMachine, onSwitchMachine, onClose, isTouch }: { hud: HudState; onBuy: (k: UpKey) => void; onBuyMachine: () => void; onSwitchMachine: (i: number) => void; onClose: () => void; isTouch: boolean }) {
  return (
    <div className="absolute inset-0 bg-black/60 overflow-y-auto scrollbar-thin fade-in" style={{ backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}>
      <div className="min-h-full flex items-center justify-center p-3 sm:p-6">
        <Frame className="w-full max-w-3xl p-5 sm:p-8 cs-panel-in">
          <FrameHeader
            eyebrow="Docked · time is frozen"
            title="UPGRADE DOCK"
            right={
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--cs-dim)]">Coins</span>
                <span className="font-display font-black text-2xl gold-text tabular-nums leading-none">{hud.coins.toLocaleString()}</span>
              </div>
            }
          />
          <SectionTitle>MACHINE</SectionTitle>
          <MachinePanel hud={hud} onBuyMachine={onBuyMachine} onSwitch={onSwitchMachine} />
          <SectionTitle>UPGRADES</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {UPGRADES.map((u, i) => {
              const lvl = hud.upgrades[u.key];
              const maxed = lvl >= u.costs.length;
              const cost = maxed ? 0 : upgradeCost(u, lvl, hud.machine);
              const can = !maxed && hud.coins >= cost;
              return (
                <button
                  key={u.key}
                  onClick={() => { if (can) uiSound.select(); onBuy(u.key); }}
                  onMouseEnter={() => !maxed && uiSound.move()}
                  disabled={maxed}
                  className={`${card} ${
                    maxed ? 'border-[rgba(143,220,170,0.25)] bg-[rgba(143,220,170,0.04)]'
                      : can ? 'border-[var(--cs-line)] bg-[rgba(217,180,90,0.05)] hover:bg-[rgba(217,180,90,0.12)] hover:border-[var(--cs-gold)]'
                        : 'border-white/[0.08] bg-white/[0.015]'
                  }`}
                >
                  <IconTile dim={!can && !maxed}>{u.icon}</IconTile>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-[var(--cs-ink-hi)] truncate tracking-wide">{u.name}</span>
                      {!isTouch && <KeyCap>{i + 1}</KeyCap>}
                    </div>
                    <div className="text-xs text-[var(--cs-dim)] leading-snug">{u.desc}</div>
                    <Pips n={lvl} of={u.costs.length} />
                  </div>
                  {maxed
                    ? <span className="font-display font-bold text-xs tracking-[0.2em] text-[var(--cs-green)] flex items-center gap-1"><Icon name="check" className="w-3.5 h-3.5" />MAX</span>
                    : <Price value={cost} ok={can} />}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col sm:flex-row gap-4 mt-7 pt-5 border-t border-[var(--cs-line-soft)] items-center">
            <div className="flex-1 flex gap-6 text-[11px] uppercase tracking-[0.2em] text-[var(--cs-dim)]">
              <span>Battery <b className="text-[var(--cs-ink-hi)] font-display tabular-nums">{Math.round((hud.battery / hud.batteryMax) * 100)}%</b></span>
              <span>Bin <b className="text-[var(--cs-ink-hi)] font-display tabular-nums">{Math.round((hud.bin / hud.binCap) * 100)}%</b></span>
            </div>
            <Button variant="primary" onClick={onClose} className="w-full sm:w-auto" hint={!isTouch ? 'E' : undefined}>Back to cleaning</Button>
          </div>
        </Frame>
      </div>
    </div>
  );
}

/* ================================================================== results */

export function GameOver({ info, onRestart, onMenu, onRevive, isTouch, onDesigner }: { info: GameOverInfo; onRestart: () => void; onMenu: () => void; onRevive: () => void; isTouch: boolean; onDesigner?: () => void }) {
  const [shown, setShown] = useState(0);
  const canEnter = useMemo(() => qualifies(info.score), [info]);
  const [name, setName] = useState(lastName());
  const [saved, setSaved] = useState<number | null>(null);
  // while a recharge is on offer the run isn't really over, so the score can only be recorded after declining it
  const [declined, setDeclined] = useState(false);
  const canRevive = info.reason === 'battery' && info.reviveCost > 0 && !declined;
  const [scores, setScores] = useState(loadScores());

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (n: number) => {
      const k = Math.min(1, (n - start) / 1400);
      setShown(Math.round(info.score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [info]);

  const save = () => {
    const n = (name.trim() || 'ROOMBA').slice(0, 12).toUpperCase();
    saveName(n);
    const rank = addScore({ name: n, score: info.score, rooms: info.rooms, reason: info.reason, nights: info.nights, date: Date.now() });
    setSaved(rank);
    setScores(loadScores());
    uiSound.select();
  };

  const dawn = info.reason === 'dawn';
  return (
    <div className="absolute inset-0 bg-black/70 overflow-y-auto scrollbar-thin fade-in" style={{ backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}>
      <div className="min-h-full flex items-center justify-center p-3 sm:p-6">
        <Frame className="w-full max-w-xl p-5 sm:p-8 flex flex-col gap-6 cs-panel-in">
          <div className="text-center">
            <div className="text-[11px] tracking-[0.34em] uppercase text-[var(--cs-dim)] mb-3">Night {nightNumber(info.time)} · {formatClock(info.time)} · Results</div>
            <h2
              className={`font-display font-black text-3xl sm:text-[2.6rem] leading-none tracking-[0.12em] ${dawn ? 'cs-title' : ''}`}
              style={dawn ? undefined : { color: '#f0a493', textShadow: '0 0 30px rgba(239,100,80,0.35)' }}
            >
              {dawn ? 'SHIFT COMPLETE' : 'BATTERY DEPLETED'}
            </h2>
            <Rule className="max-w-[240px] mx-auto mt-4" />
            <div className="text-[13px] text-[var(--cs-ink)] mt-3">
              {dawn
                ? 'You made it to dawn.'
                : info.nights > 0
                  ? `Your little robot swept through ${info.nights} night${info.nights === 1 ? '' : 's'} before running out of juice.`
                  : 'Your little robot ran out of juice before the first dawn.'}
            </div>
          </div>

          <div className="text-center">
            <div className="text-[10px] tracking-[0.36em] text-[var(--cs-dim)] mb-1">FINAL SCORE</div>
            <div className="font-display font-black text-6xl sm:text-7xl cs-title tabular-nums leading-none">{shown.toLocaleString()}</div>
            {info.bonus > 0 && <div className="text-[var(--cs-green)] text-xs font-semibold tracking-[0.14em] uppercase mt-2">Includes dawn bonus +{info.bonus.toLocaleString()}</div>}
          </div>

          <StatStrip>
            <Stat label="Building" value={`#${info.levelNum}`} sub={info.levelName} />
            <Stat label="Nights" value={info.nights} />
            <Stat label="Clean" value={`${Math.round(info.overall * 100)}%`} />
            <Stat label="Coins" value={info.coinsEarned.toLocaleString()} />
          </StatStrip>

          {canEnter && saved === null && canRevive && (
            <button
              type="button"
              onClick={() => { uiSound.select(); setDeclined(true); }}
              className="text-xs font-semibold tracking-wide text-[var(--cs-gold-hi)] border border-[var(--cs-line)] bg-[rgba(217,180,90,0.08)] px-4 py-2.5 hover:bg-[rgba(217,180,90,0.16)] transition-colors"
            >
              New high score. End the run here and record it instead of recharging.
            </button>
          )}

          {canEnter && saved === null && !canRevive && (
            <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <SectionTitle>NEW HIGH SCORE</SectionTitle>
              <div className="flex gap-2">
                <input
                  autoFocus={!isTouch}
                  value={name}
                  maxLength={12}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  placeholder="ENTER YOUR NAME"
                  className="cs-input tracking-[0.2em] font-display"
                />
                <Button type="submit" variant="primary" className="shrink-0">Record</Button>
              </div>
            </form>
          )}

          {DEV_MODE && (
            <div className="text-center text-xs font-semibold text-fuchsia-200/80 bg-fuchsia-400/10 border border-fuchsia-300/30 px-3 py-2">
              Dev mode: high scores are disabled
            </div>
          )}

          <div>
            <SectionTitle>HALL OF FAME</SectionTitle>
            <div className="max-h-56 overflow-y-auto scrollbar-thin">
              <ScoreTable scores={scores} highlight={saved ?? undefined} />
            </div>
          </div>

          {info.reason === 'battery' && (
            canRevive ? (
              <Button variant="primary" onClick={onRevive} className="!min-h-[64px] w-full">
                <span className="flex flex-col items-center gap-1">
                  <span>Recharge &amp; keep playing</span>
                  <span className="font-[family-name:var(--font-ui)] text-[11px] font-semibold tracking-[0.04em] normal-case opacity-75">
                    Costs {info.reviveCost.toLocaleString()} of your {info.coins.toLocaleString()} coins · score and progress kept
                  </span>
                </span>
              </Button>
            ) : info.reviveCost === 0 && (
              <div className="text-center text-xs text-[var(--cs-dim)] border border-white/10 px-3 py-2.5">
                Recharging costs at least {REVIVE_MIN} coins. You have {info.coins.toLocaleString()}.
              </div>
            )
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button variant={canRevive ? 'secondary' : 'primary'} onClick={onRestart} className="flex-1" hint={!isTouch ? 'R' : undefined}>Play again</Button>
            <Button onClick={onMenu} className="sm:w-44">Main menu</Button>
          </div>
          {onDesigner && <Button onClick={onDesigner} className="w-full">Back to level editor</Button>}
        </Frame>
      </div>
    </div>
  );
}
