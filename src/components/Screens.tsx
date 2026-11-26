import { useEffect, useMemo, useState } from 'react';
import type { GameOverInfo, HudState } from '../game/Game';
import { UPGRADES, UpKey } from '../game/constants';
import { DEV_MODE } from '../game/devmode';
import { ScoreEntry, addScore, lastName, loadScores, qualifies, saveName } from '../game/highscores';
import type { SaveMeta } from '../game/saves';
import { formatClock } from './HUD';

function RoombaIcon({ size = 120 }: { size?: number }) {
  return (
    <div className="relative floaty" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #4a4f5a, #1a1c21 70%)', boxShadow: '0 12px 30px rgba(0,0,0,0.6), 0 0 40px rgba(0,229,255,0.25)' }} />
      <div className="absolute rounded-full border-[3px] border-cyan-300 spin-slow" style={{ inset: size * 0.16, boxShadow: '0 0 14px #00e5ff, inset 0 0 10px #00e5ff', borderStyle: 'dashed' }} />
      <div className="absolute flex gap-[18%] justify-center w-full" style={{ top: '38%' }}>
        <div className="rounded-full bg-cyan-100" style={{ width: size * 0.1, height: size * 0.1, boxShadow: '0 0 10px #bffcff' }} />
        <div className="rounded-full bg-cyan-100" style={{ width: size * 0.1, height: size * 0.1, boxShadow: '0 0 10px #bffcff' }} />
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 rounded-b-full border-b-[3px] border-cyan-100" style={{ top: '55%', width: size * 0.2, height: size * 0.08 }} />
    </div>
  );
}

export function ScoreTable({ scores, highlight }: { scores: ScoreEntry[]; highlight?: number }) {
  if (!scores.length) {
    return <div className="text-center text-amber-100/50 text-sm py-4">No scores yet — be the first to sweep the manor!</div>;
  }
  return (
    <table className="w-full text-sm">
      <tbody>
        {scores.map((s, i) => (
          <tr key={i} className={`${i === highlight ? 'bg-amber-300/20 text-amber-100' : i % 2 ? 'bg-white/[0.03]' : ''}`}>
            <td className="py-1 pl-2 w-8 font-black text-amber-300/80">{i === 0 ? '👑' : `${i + 1}.`}</td>
            <td className="py-1 font-semibold truncate max-w-[120px]">{s.name}</td>
            <td className="py-1 text-xs text-amber-100/50 text-center">{s.reason === 'dawn' ? '☀️' : '🪫'} {s.rooms}🏠</td>
            <td className="py-1 pr-2 text-right font-black tabular-nums gold-text">{s.score.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface StartScreenProps {
  onPlay: (intro: boolean) => void;
  isTouch: boolean;
  seenIntro: boolean;
  autosave: SaveMeta | null;
  saveCount: number;
  onContinue: () => void;
  onLoadMenu: () => void;
}

export function StartScreen({ onPlay, isTouch, seenIntro, autosave, saveCount, onContinue, onLoadMenu }: StartScreenProps) {
  const scores = useMemo(() => loadScores(), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (autosave) onContinue();
        else onPlay(!seenIntro);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onPlay, seenIntro, autosave, onContinue]);

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-thin fade-in" style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(20,10,30,0.35), rgba(5,3,8,0.88) 75%)' }}>
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-8 gap-6">
        <div className="flex flex-col items-center text-center gap-3">
          <RoombaIcon size={isTouch ? 90 : 116} />
          <div className="font-display text-amber-100/60 tracking-[0.4em] text-xs sm:text-sm">MIDNIGHT AT BLACKWOOD MANOR</div>
          <h1 className="font-display font-black text-5xl sm:text-7xl leading-none gold-text drop-shadow-[0_4px_20px_rgba(212,175,55,0.35)]">CLEAN SWEEP</h1>
          <p className="max-w-md text-amber-50/70 text-sm sm:text-base">
            The mansion is a muddy disaster and the owners return at dawn. Somewhere in the dark, a little robot is about to wake up…
          </p>
        </div>

        {autosave && (
          <button onClick={onContinue} className="btn-gold rounded-2xl px-10 py-3 font-black tracking-widest flex flex-col items-center">
            <span className="text-xl">▶ CONTINUE SHIFT</span>
            <span className="text-xs font-bold opacity-70 tracking-normal tabular-nums">
              {formatClock(autosave.time)} · {autosave.score.toLocaleString()} pts · {autosave.roomsCleared}/10 rooms
            </span>
          </button>
        )}
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <button onClick={() => onPlay(true)} className={`${autosave ? 'btn-ghost text-amber-100 px-6 py-3 text-base' : 'btn-gold px-10 py-4 text-xl'} rounded-2xl font-black tracking-widest`}>
            {autosave ? '✦ NEW SHIFT' : '▶ START SHIFT'}
          </button>
          <button onClick={() => onPlay(false)} className="btn-ghost rounded-2xl px-6 py-3 font-bold tracking-wider text-amber-100">
            ⏩ {autosave ? 'New, skip intro' : 'Skip intro'}
          </button>
          {saveCount > 0 && (
            <button onClick={onLoadMenu} className="btn-ghost rounded-2xl px-6 py-3 font-bold tracking-wider text-amber-100">
              📂 Load game
            </button>
          )}
        </div>
        {autosave && <div className="-mt-3 text-xs text-amber-100/40">A new shift will replace the autosave — make a manual save from the pause menu to keep it.</div>}

        <div className="grid sm:grid-cols-2 gap-4 w-full max-w-3xl">
          <div className="panel rounded-2xl p-4">
            <h2 className="font-display text-amber-200 tracking-widest text-sm mb-3">HOW TO PLAY</h2>
            <ul className="text-sm space-y-2 text-amber-50/80">
              <li>🧹 Drive over dirt & muddy footprints to vacuum them up. Keep sucking to build a <b className="text-cyan-300">COMBO</b>.</li>
              <li>✨ Get a room to <b>100%</b> for bonus <b className="text-amber-300">coins</b> & points.</li>
              <li>🔋 Battery drains as you drive. 🗑️ A full bin stops cleaning. Return to the <b className="text-emerald-300">dock</b> to charge & empty.</li>
              <li>🛒 Spend coins on upgrades while docked.</li>
              <li>👻 Beware: something keeps tracking mud back in…</li>
              <li>☀️ Survive until <b>5:00 AM</b> for a big dawn bonus!</li>
            </ul>
            <div className="mt-3 pt-3 border-t border-white/10 text-xs text-amber-100/60">
              {isTouch ? 'Drag anywhere to steer · Hold ⚡ for turbo · ❚❚ to pause' : 'WASD / Arrows: drive · Shift/Space: turbo · E: shop at dock · P/Esc: pause · M: mute · R: restart'}
            </div>
          </div>
          <div className="panel rounded-2xl p-4">
            <h2 className="font-display text-amber-200 tracking-widest text-sm mb-2">🏆 HALL OF FAME</h2>
            <ScoreTable scores={scores} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({ onResume, onRestart, onMenu, onMute, onSaveMenu, muted, hud }: { onResume: () => void; onRestart: () => void; onMenu: () => void; onMute: () => void; onSaveMenu: () => void; muted: boolean; hud: HudState | null }) {
  return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 fade-in" style={{ backdropFilter: 'blur(3px)' }}>
      <div className="panel rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3 big-in">
        <h2 className="font-display font-black text-4xl text-center gold-text tracking-widest">PAUSED</h2>
        {hud && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
            <div className="bg-white/5 rounded-lg p-2"><div className="text-amber-100/50">Score</div><div className="font-black text-amber-200">{hud.score.toLocaleString()}</div></div>
            <div className="bg-white/5 rounded-lg p-2"><div className="text-amber-100/50">Time</div><div className="font-black text-amber-200">{formatClock(hud.time)}</div></div>
            <div className="bg-white/5 rounded-lg p-2"><div className="text-amber-100/50">Rooms</div><div className="font-black text-amber-200">{hud.roomsCleared}/{hud.roomsTotal}</div></div>
          </div>
        )}
        <button onClick={onResume} className="btn-gold rounded-xl py-3 font-black tracking-widest text-lg">▶ RESUME</button>
        <button onClick={onSaveMenu} className="btn-ghost rounded-xl py-2.5 font-bold">💾 Save / Load</button>
        <button onClick={onRestart} className="btn-ghost rounded-xl py-2.5 font-bold">↻ Restart <span className="opacity-50 text-xs">(R)</span></button>
        <button onClick={onMute} className="btn-ghost rounded-xl py-2.5 font-bold">{muted ? '🔇 Sound off' : '🔊 Sound on'} <span className="opacity-50 text-xs">(M)</span></button>
        <button onClick={onMenu} className="btn-ghost rounded-xl py-2.5 font-bold">⌂ Main menu</button>
        <div className="text-center text-[11px] text-amber-100/40">Progress autosaved — Continue from the main menu anytime.</div>
      </div>
    </div>
  );
}

export function Shop({ hud, onBuy, onClose, isTouch }: { hud: HudState; onBuy: (k: UpKey) => void; onClose: () => void; isTouch: boolean }) {
  return (
    <div className="absolute inset-0 bg-black/65 flex items-center justify-center p-3 fade-in overflow-y-auto" style={{ backdropFilter: 'blur(3px)' }}>
      <div className="panel rounded-2xl p-4 sm:p-6 w-full max-w-2xl big-in my-auto">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div>
            <h2 className="font-display font-black text-2xl sm:text-3xl gold-text tracking-widest">UPGRADE DOCK</h2>
            <div className="text-xs text-amber-100/60">Time is frozen while you shop</div>
          </div>
          <div className="panel rounded-full px-4 py-1.5 flex items-center gap-2">
            <span className="text-xl">🪙</span>
            <span className="font-black text-xl text-amber-200 tabular-nums">{hud.coins}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {UPGRADES.map((u, i) => {
            const lvl = hud.upgrades[u.key];
            const maxed = lvl >= u.costs.length;
            const cost = maxed ? 0 : u.costs[lvl];
            const can = !maxed && hud.coins >= cost;
            return (
              <button
                key={u.key}
                onClick={() => onBuy(u.key)}
                disabled={maxed}
                className={`text-left rounded-xl p-3 border transition-all flex gap-3 items-center ${
                  maxed ? 'bg-emerald-400/10 border-emerald-300/30' : can ? 'bg-amber-300/10 border-amber-300/40 hover:bg-amber-300/20 active:scale-[0.98]' : 'bg-white/[0.03] border-white/10 opacity-70'
                }`}
              >
                <div className="text-3xl w-10 text-center">{u.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-50 truncate">{u.name}</span>
                    {!isTouch && <span className="text-[10px] text-amber-100/40 border border-white/15 rounded px-1">{i + 1}</span>}
                  </div>
                  <div className="text-xs text-amber-100/60">{u.desc}</div>
                  <div className="flex gap-1 mt-1.5">
                    {u.costs.map((_, k) => (
                      <div key={k} className={`h-1.5 flex-1 rounded-full ${k < lvl ? 'bg-amber-300 shadow-[0_0_6px_#fcd34d]' : 'bg-white/10'}`} />
                    ))}
                  </div>
                </div>
                <div className={`font-black text-sm whitespace-nowrap ${maxed ? 'text-emerald-300' : can ? 'text-amber-200' : 'text-red-300/80'}`}>
                  {maxed ? 'MAX' : `🪙${cost}`}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4 items-center">
          <div className="flex-1 text-xs text-amber-100/60 text-center sm:text-left">
            🔋 {Math.round((hud.battery / hud.batteryMax) * 100)}% · 🗑️ {Math.round((hud.bin / hud.binCap) * 100)}%
          </div>
          <button onClick={onClose} className="btn-gold rounded-xl px-8 py-3 font-black tracking-widest w-full sm:w-auto">
            BACK TO CLEANING {!isTouch && <span className="opacity-60 text-sm">(E)</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GameOver({ info, onRestart, onMenu, isTouch }: { info: GameOverInfo; onRestart: () => void; onMenu: () => void; isTouch: boolean }) {
  const [shown, setShown] = useState(0);
  const canEnter = useMemo(() => qualifies(info.score), [info]);
  const [name, setName] = useState(lastName());
  const [saved, setSaved] = useState<number | null>(null);
  const [scores, setScores] = useState(loadScores());

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (n: number) => {
      const k = Math.min(1, (n - start) / 1200);
      setShown(Math.round(info.score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [info]);

  const save = () => {
    const n = (name.trim() || 'ROOMBA').slice(0, 12).toUpperCase();
    saveName(n);
    const rank = addScore({ name: n, score: info.score, rooms: info.rooms, reason: info.reason, date: Date.now() });
    setSaved(rank);
    setScores(loadScores());
  };

  const dawn = info.reason === 'dawn';
  return (
    <div className="absolute inset-0 bg-black/70 overflow-y-auto scrollbar-thin fade-in" style={{ backdropFilter: 'blur(3px)' }}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="panel rounded-2xl p-5 sm:p-7 w-full max-w-lg flex flex-col gap-4 big-in">
          <div className="text-center">
            <div className="text-5xl mb-1">{dawn ? '☀️' : '🪫'}</div>
            <h2 className={`font-display font-black text-3xl sm:text-4xl tracking-wider ${dawn ? 'gold-text' : 'text-red-300'}`}>
              {dawn ? 'SHIFT COMPLETE' : 'BATTERY DEPLETED'}
            </h2>
            <div className="text-sm text-amber-100/60 mt-1">
              {dawn ? 'You made it to dawn. The owners will be… mostly pleased.' : 'Your little robot ran out of juice in the dark.'}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs tracking-[0.3em] text-amber-100/50">FINAL SCORE</div>
            <div className="font-black text-5xl sm:text-6xl gold-text tabular-nums">{shown.toLocaleString()}</div>
            {info.bonus > 0 && <div className="text-emerald-300 text-sm font-bold">incl. dawn bonus +{info.bonus.toLocaleString()}</div>}
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="bg-white/5 rounded-lg p-2"><div className="text-amber-100/50">Survived</div><div className="font-black text-amber-200">{formatClock(info.time)}</div></div>
            <div className="bg-white/5 rounded-lg p-2"><div className="text-amber-100/50">Rooms</div><div className="font-black text-amber-200">{info.rooms}/10</div></div>
            <div className="bg-white/5 rounded-lg p-2"><div className="text-amber-100/50">Manor</div><div className="font-black text-amber-200">{Math.round(info.overall * 100)}%</div></div>
            <div className="bg-white/5 rounded-lg p-2"><div className="text-amber-100/50">Coins</div><div className="font-black text-amber-200">{info.coinsEarned}</div></div>
          </div>

          {canEnter && saved === null && (
            <form
              className="flex gap-2 items-center bg-amber-300/10 border border-amber-300/30 rounded-xl p-2"
              onSubmit={(e) => { e.preventDefault(); save(); }}
            >
              <span className="text-sm font-bold text-amber-200 pl-1 whitespace-nowrap">🏆 New high score!</span>
              <input
                autoFocus={!isTouch}
                value={name}
                maxLength={12}
                onChange={(e) => setName(e.target.value.toUpperCase())}
                placeholder="YOUR NAME"
                className="flex-1 min-w-0 bg-black/50 border border-white/20 rounded-lg px-3 py-2 font-bold tracking-widest text-amber-50 outline-none focus:border-amber-300 select-text"
              />
              <button type="submit" className="btn-gold rounded-lg px-4 py-2 font-black">SAVE</button>
            </form>
          )}

          {DEV_MODE && (
            <div className="text-center text-xs font-semibold text-fuchsia-200/80 bg-fuchsia-400/10 border border-fuchsia-300/30 rounded-xl px-3 py-2">
              🛠 Dev mode — high scores are disabled
            </div>
          )}

          <div className="bg-black/30 rounded-xl p-2 max-h-56 overflow-y-auto scrollbar-thin">
            <ScoreTable scores={scores} highlight={saved ?? undefined} />
          </div>

          <div className="flex gap-2">
            <button onClick={onRestart} className="btn-gold flex-1 rounded-xl py-3 font-black tracking-widest text-lg">
              ↻ PLAY AGAIN {!isTouch && <span className="opacity-60 text-sm">(R)</span>}
            </button>
            <button onClick={onMenu} className="btn-ghost rounded-xl px-5 font-bold">⌂ Menu</button>
          </div>
        </div>
      </div>
    </div>
  );
}
