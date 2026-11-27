import { useEffect, useRef, useState } from 'react';
import type { HudState } from '../game/Game';
import { NIGHT_LENGTH } from '../game/constants';

/** Clock time within the current night (the curse rewinds it to midnight every dawn). */
export function formatClock(t: number) {
  const perHour = NIGHT_LENGTH / 5;
  t %= NIGHT_LENGTH;
  const h = Math.floor(t / perHour);
  const m = Math.floor(((t % perHour) / perHour) * 60);
  return `${h === 0 ? 12 : h}:${m.toString().padStart(2, '0')} AM`;
}

/** 1-based number of the night in progress. */
export function nightNumber(t: number) {
  return Math.floor(t / NIGHT_LENGTH) + 1;
}

/** "Night 2 · 3:15 AM" */
export function formatShift(t: number) {
  return `Night ${nightNumber(t)} · ${formatClock(t)}`;
}

function Bar({ value, max, color, label, icon, warn }: { value: number; max: number; color: string; label: string; icon: string; warn?: boolean }) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="flex items-center gap-2">
      <span className={`hidden sm:inline text-lg w-6 text-center ${warn ? 'blink-soft' : ''}`}>{icon}</span>
      <div className="flex-1">
        <div className="flex justify-between text-[10px] sm:text-[11px] uppercase tracking-wider text-amber-100/70 font-semibold leading-none mb-1">
          <span>{label}</span>
          <span className={warn ? 'text-red-300' : ''}>{Math.round(pct * 100)}%</span>
        </div>
        <div className="h-2.5 sm:h-3 rounded-full bg-black/60 overflow-hidden border border-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-100 ease-linear relative"
            style={{ width: `${pct * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }}
          >
            <div className="absolute inset-0 shimmer opacity-40" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HUD({
  hud,
  minimapRef,
  onPause,
  onShop,
  onNextLevel,
  onMute,
  muted,
  isTouch,
}: {
  hud: HudState;
  minimapRef: (c: HTMLCanvasElement | null) => void;
  onPause: () => void;
  onShop: () => void;
  onNextLevel: () => void;
  onMute: () => void;
  muted: boolean;
  isTouch: boolean;
}) {
  const br = hud.battery / hud.batteryMax;
  const binFull = hud.bin >= hud.binCap - 0.01;
  const battColor = br < 0.12 ? '#ff3b3b' : br < 0.3 ? '#ff9a2e' : '#38f5a0';
  const binColor = binFull ? '#ff9a2e' : '#c99a5b';

  const [coinPop, setCoinPop] = useState(0);
  const lastCoins = useRef(hud.coins);
  useEffect(() => {
    if (hud.coins > lastCoins.current) setCoinPop((k) => k + 1);
    lastCoins.current = hud.coins;
  }, [hud.coins]);
  const [multPop, setMultPop] = useState(0);
  const lastMult = useRef(hud.mult);
  useEffect(() => {
    if (hud.mult > lastMult.current) setMultPop((k) => k + 1);
    lastMult.current = hud.mult;
  }, [hud.mult]);

  const night = (hud.time % NIGHT_LENGTH) / NIGHT_LENGTH;

  return (
    <div className="absolute inset-0 pointer-events-none select-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="absolute inset-0 vignette" />
      {br < 0.3 && <div className="absolute inset-0 vignette-red low-pulse" />}

      {/* top-left: status */}
      <div className="absolute left-2 top-2 sm:left-4 sm:top-4 panel rounded-xl p-2 sm:p-3 w-[29vw] sm:w-[42vw] max-w-[250px] min-w-[108px] flex flex-col gap-2">
        <Bar value={hud.battery} max={hud.batteryMax} color={battColor} label="Battery" icon="🔋" warn={br < 0.3} />
        <Bar value={hud.bin} max={hud.binCap} color={binColor} label={binFull ? 'Bin FULL' : 'Dust bin'} icon="🗑️" warn={binFull} />
      </div>

      {/* top-center: clock + score */}
      <div className="absolute left-1/2 -translate-x-1/2 top-2 sm:top-4 flex flex-col items-center gap-1">
        <div className="panel rounded-xl px-2 sm:px-5 py-1.5 sm:py-2 text-center min-w-[92px] sm:min-w-[120px]">
          <div className="text-[9px] sm:text-[10px] font-black tracking-[0.3em] text-indigo-200/70 leading-none mb-0.5">🌙 NIGHT {nightNumber(hud.time)}</div>
          <div className="font-display text-[11px] sm:text-sm tracking-[0.2em] text-amber-100/80">{formatClock(hud.time)}</div>
          <div className="h-1 mt-1 rounded-full bg-black/60 overflow-hidden">
            <div className="h-full" style={{ width: `${night * 100}%`, background: 'linear-gradient(90deg,#3b3a8a,#c66a3a,#ffd27a)' }} />
          </div>
          <div className="font-black text-xl sm:text-3xl tabular-nums leading-tight gold-text">{hud.score.toLocaleString()}</div>
        </div>
        {hud.mult > 1 && (
          <div key={multPop} className="pop panel rounded-full px-3 py-0.5 flex items-center gap-2">
            <span className="font-black text-sm sm:text-base" style={{ color: ['#fff', '#fff', '#7df9ff', '#9dff7d', '#ffd84d', '#ff7df0'][hud.mult] }}>
              COMBO x{hud.mult}
            </span>
            <div className="w-10 h-1.5 bg-black/60 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-300" style={{ width: `${hud.comboT * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* top-right: coins + buttons + minimap */}
      <div className="absolute right-2 top-2 sm:right-4 sm:top-4 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1 sm:gap-2">
          <div key={coinPop} className="pop panel rounded-full pl-1.5 pr-2.5 sm:pl-2 sm:pr-3 py-1 flex items-center gap-1">
            <span className="text-lg">🪙</span>
            <span className="font-black tabular-nums text-amber-200 text-base sm:text-lg">{hud.coins}</span>
          </div>
          <button onClick={onMute} className="pointer-events-auto panel rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center text-lg" aria-label="Toggle sound">
            {muted ? '🔇' : '🔊'}
          </button>
          <button onClick={onPause} className="pointer-events-auto panel rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center font-black text-amber-100" aria-label="Pause">
            ❚❚
          </button>
        </div>
        <div className="panel rounded-xl p-1.5">
          <canvas ref={minimapRef} className="block w-[120px] sm:w-[176px] h-auto" style={{ imageRendering: 'pixelated', aspectRatio: '44 / 34' }} />
          <div className="text-[9px] sm:text-[10px] text-amber-100/70 text-center mt-1 font-semibold tracking-wide">
            <div className="truncate text-amber-200/90">🏠 {hud.levelNum}. {hud.levelName}</div>
            ROOMS {hud.roomsCleared}/{hud.roomsTotal} · CLEAN {Math.round(hud.overall * 100)}%
            {hud.secretsFound > 0 && <> · 🗝️ {hud.secretsFound}/{hud.secretsTotal}</>}
          </div>
        </div>
      </div>

      {/* room indicator */}
      <div className="absolute left-2 sm:left-4 top-[84px] sm:top-[118px]">
        <div className={`panel rounded-lg px-2.5 py-1.5 w-[29vw] sm:w-[42vw] max-w-[250px] min-w-[108px] ${hud.roomCleared ? 'border-emerald-300/60' : ''}`}>
          <div className="flex justify-between items-baseline">
            <span className="font-display text-[11px] sm:text-xs tracking-widest text-amber-100 truncate">{hud.roomName}</span>
            <span className={`font-black text-sm tabular-nums ${hud.roomCleared ? 'text-emerald-300' : 'text-amber-200'}`}>
              {hud.roomCleared ? '✨100%' : `${hud.roomPct}%`}
            </span>
          </div>
          <div className="h-1.5 mt-1 rounded-full bg-black/60 overflow-hidden">
            <div
              className="h-full transition-[width] duration-150"
              style={{ width: `${hud.roomPct}%`, background: hud.roomCleared ? '#5dffb0' : `hsl(${hud.roomPct * 1.2},80%,55%)` }}
            />
          </div>
        </div>
      </div>

      {/* bottom center: dock / hints */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[max(1rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-2">
        {hud.nextLevel && (
          <button onClick={onNextLevel} className="pointer-events-auto btn-gold rounded-xl px-5 py-2 font-black tracking-wider text-sm sm:text-base flex flex-col items-center leading-tight">
            <span>🚚 NEXT BUILDING {!isTouch && <span className="opacity-60 text-xs">(N)</span>}</span>
            <span className="text-[10px] sm:text-xs font-bold opacity-75 tracking-normal">{hud.nextLevel} →</span>
          </button>
        )}
        {hud.homeHint && !hud.docked && (
          <div className="panel rounded-full px-4 py-1.5 text-sm font-bold text-orange-200 blink-soft">↩ Follow the arrow back to the dock</div>
        )}
        {hud.docked && (
          <div className="flex flex-col items-center gap-2 fade-in">
            <div className="panel rounded-full px-4 py-1 text-xs sm:text-sm font-semibold text-emerald-200">
              {hud.battery < hud.batteryMax - 0.5 || hud.bin > 0.5 ? '⚡ Charging & emptying…' : '✅ Ready to roll'}
            </div>
            <button onClick={onShop} className="pointer-events-auto btn-gold rounded-xl px-6 py-2.5 font-black tracking-wider text-base sm:text-lg">
              🛒 UPGRADE SHOP {!isTouch && <span className="opacity-60 text-sm">(E)</span>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
