import { useEffect, useRef, useState } from 'react';
import type { HudState } from '../game/Game';
import { NIGHT_LENGTH } from '../game/constants';
import { formatClock, nightNumber } from './HUD';
import { Icon, KeyCap } from './ui';

/**
 * PREVIEW: a proposed redesign of the in-game HUD, in the same visual language as the menus.
 * Not wired in by default: open the game with `?hud=next` to play with it.
 * Same props as HUD, so swapping it in for real is a one-line change in App.
 */

/** Radial gauge: a ring that drains clockwise, with a value in the middle. */
function Ring({ value, size, stroke, color, track = 'rgba(255,255,255,0.09)', children, pulse }: { value: number; size: number; stroke: number; color: string; track?: string; children?: React.ReactNode; pulse?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`relative shrink-0 ${pulse ? 'blink-soft' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.15s linear, stroke 0.3s', filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function CoinGlyph({ size = 16 }: { size?: number }) {
  return (
    <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: 'radial-gradient(circle at 35% 30%, #fff6d0, #e4b94e 45%, #9a6d1c)', boxShadow: '0 0 8px rgba(228,185,78,0.55), inset 0 -1px 0 rgba(0,0,0,0.3)' }} />
  );
}

const COMBO_COLORS = ['#fff', '#fff', '#7fe9f5', '#9dff7d', '#ffd84d', '#ff7df0'];

export default function HUDNext({
  hud, minimapRef, onPause, onShop, onNextLevel, onMute, muted, isTouch,
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
  const bf = hud.bin / hud.binCap;
  const binFull = hud.bin >= hud.binCap - 0.01;
  const battColor = br < 0.12 ? '#ff5a4a' : br < 0.3 ? '#ffa340' : '#5ef0a8';
  const binColor = binFull ? '#ffa340' : '#d9b45a';

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
  const charging = hud.battery < hud.batteryMax - 0.5 || hud.bin > 0.5;
  const big = !isTouch;

  return (
    <div className="hud2 absolute inset-0 pointer-events-none select-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="absolute inset-0 vignette" />
      {br < 0.3 && <div className="absolute inset-0 vignette-red low-pulse" />}

      {/* ------------------------------------------------ top-left: machine status */}
      <div className="absolute left-3 top-3 sm:left-6 sm:top-5 flex flex-col gap-3">
        <div className="hud2-scrim flex items-center gap-3 pr-4">
          <Ring value={br} size={big ? 64 : 50} stroke={big ? 5 : 4} color={battColor} pulse={br < 0.3}>
            <span className="font-display font-bold text-[var(--cs-ink-hi)] tabular-nums leading-none" style={{ fontSize: big ? 17 : 13 }}>{Math.round(br * 100)}</span>
            <span className="text-[7px] sm:text-[8px] tracking-[0.2em] text-[var(--cs-dim)] mt-0.5">BATT</span>
          </Ring>
          <div className="flex flex-col gap-1.5 min-w-[92px] sm:min-w-[130px]">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`hud2-label ${binFull ? '!text-[#ffbf7a] blink-soft' : ''}`}>{binFull ? 'Bin full' : 'Dust bin'}</span>
              <span className="text-[11px] font-semibold tabular-nums text-[var(--cs-ink-hi)]">{Math.round(bf * 100)}%</span>
            </div>
            <div className="hud2-bar"><div style={{ width: `${bf * 100}%`, background: binColor, boxShadow: `0 0 8px ${binColor}` }} /></div>
            {hud.turbo && <span className="hud2-label !text-[var(--cs-cyan)]">Turbo</span>}
          </div>
        </div>

        {/* room */}
        <div className={`hud2-scrim min-w-[150px] sm:min-w-[214px] ${hud.roomCleared ? 'hud2-scrim-done' : ''}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-display text-[11px] sm:text-[13px] font-semibold tracking-[0.14em] text-[var(--cs-ink-hi)] truncate uppercase">{hud.roomName}</span>
            <span className={`font-display font-bold text-sm tabular-nums ${hud.roomCleared ? 'text-[var(--cs-green)]' : 'text-[var(--cs-gold-hi)]'}`}>
              {hud.roomCleared ? <span className="flex items-center gap-1"><Icon name="check" className="w-3.5 h-3.5" />100%</span> : `${hud.roomPct}%`}
            </span>
          </div>
          <div className="hud2-bar mt-1.5 hud2-ticks">
            <div style={{ width: `${hud.roomPct}%`, background: hud.roomCleared ? 'var(--cs-green)' : 'linear-gradient(90deg, #b88a2d, #fff0c2)' }} />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ top-center: clock + score */}
      <div className="hud2-center absolute left-1/2 -translate-x-1/2 top-1 sm:top-2 flex flex-col items-center px-10 sm:px-16 pt-2 sm:pt-3 pb-3 sm:pb-4">
        <div className="flex items-center gap-2.5 text-[9px] sm:text-[10px] tracking-[0.34em] text-[var(--cs-dim)]">
          <span className="text-[var(--cs-ink)]">NIGHT {nightNumber(hud.time)}</span>
          <span className="w-1 h-1 rotate-45 bg-[var(--cs-gold)]" />
          <span className="font-display text-[var(--cs-ink-hi)] tracking-[0.18em] text-[11px] sm:text-[13px]">{formatClock(hud.time)}</span>
        </div>
        {/* midnight → dawn track */}
        <div className="relative w-[120px] sm:w-[200px] h-[3px] mt-2 bg-white/10 rounded-full">
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${night * 100}%`, background: 'linear-gradient(90deg,#5458b8,#c66a3a,#ffd27a)' }} />
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#fff3c4]" style={{ left: `${night * 100}%`, boxShadow: '0 0 8px #ffd27a' }} />
          <span className="absolute -left-4 top-1/2 -translate-y-1/2 text-[9px] text-[var(--cs-dim)]">☾</span>
          <span className="absolute -right-4 top-1/2 -translate-y-1/2 text-[9px] text-[var(--cs-dim)]">☼</span>
        </div>
        <div className="font-display font-black cs-title tabular-nums leading-none mt-2" style={{ fontSize: big ? 40 : 26 }}>{hud.score.toLocaleString()}</div>
        {hud.mult > 1 && (
          <div key={multPop} className="pop mt-2 flex items-center gap-2">
            <span className="font-display font-black text-sm sm:text-base tracking-[0.12em]" style={{ color: COMBO_COLORS[hud.mult], textShadow: `0 0 14px ${COMBO_COLORS[hud.mult]}` }}>
              ×{hud.mult}
            </span>
            <span className="hud2-label !text-[var(--cs-ink)]">Combo</span>
            <div className="w-12 h-[3px] bg-white/10 rounded-full overflow-hidden">
              <div className="h-full" style={{ width: `${hud.comboT * 100}%`, background: COMBO_COLORS[hud.mult] }} />
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ top-right: wallet, system, map */}
      <div className="absolute right-3 top-3 sm:right-6 sm:top-5 flex flex-col items-end gap-3">
        <div className="flex items-center gap-2">
          <div key={coinPop} className="pop hud2-scrim !py-1.5 !px-3 flex items-center gap-2">
            <CoinGlyph />
            <span className="font-display font-bold tabular-nums text-[var(--cs-gold-hi)] text-base sm:text-lg leading-none">{hud.coins.toLocaleString()}</span>
          </div>
          <button onClick={onMute} className="pointer-events-auto cs-icon-btn !bg-black/40" aria-label="Toggle sound"><Icon name={muted ? 'soundOff' : 'soundOn'} /></button>
          <button onClick={onPause} className="pointer-events-auto cs-icon-btn !bg-black/40" aria-label="Pause">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          </button>
        </div>
        <div className="hud2-map">
          <span className="cs-corner tl" /><span className="cs-corner tr" /><span className="cs-corner bl" /><span className="cs-corner br" />
          <canvas ref={minimapRef} className="block w-[124px] sm:w-[190px] h-auto" style={{ imageRendering: 'pixelated', aspectRatio: '44 / 34' }} />
        </div>
        <div className="text-right -mt-1">
          <div className="font-display text-[10px] sm:text-[11px] tracking-[0.16em] text-[var(--cs-ink-hi)] truncate max-w-[190px]">{hud.levelNum}. {hud.levelName.toUpperCase()}</div>
          <div className="flex justify-end gap-3 mt-1 text-[9px] sm:text-[10px] tracking-[0.18em] text-[var(--cs-dim)] tabular-nums">
            <span>ROOMS <b className="text-[var(--cs-ink-hi)] font-semibold">{hud.roomsCleared}/{hud.roomsTotal}</b></span>
            <span>CLEAN <b className="text-[var(--cs-ink-hi)] font-semibold">{Math.round(hud.overall * 100)}%</b></span>
            {hud.secretsFound > 0 && <span>SECRETS <b className="text-[#c8a6ff] font-semibold">{hud.secretsFound}/{hud.secretsTotal}</b></span>}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ bottom-center: context prompts */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-2.5">
        {hud.nextLevel && (
          <button onClick={onNextLevel} className="pointer-events-auto cs-btn cs-btn-primary !min-h-[54px]">
            <span className="relative flex flex-col items-center leading-tight">
              <span className="flex items-center gap-2">Next building {!isTouch && <span className="cs-btn-hint">N</span>}</span>
              <span className="font-[family-name:var(--font-ui)] text-[11px] font-semibold tracking-[0.04em] normal-case opacity-75">{hud.nextLevel}</span>
            </span>
          </button>
        )}
        {hud.homeHint && !hud.docked && (
          <div className="hud2-prompt text-[#ffc993] blink-soft">Battery low. Follow the arrow back to the dock</div>
        )}
        {hud.docked && (
          <div className="flex flex-col items-center gap-2.5 fade-in">
            <div className="hud2-prompt">
              <span className={`w-1.5 h-1.5 rounded-full ${charging ? 'bg-[var(--cs-gold)] blink-soft' : 'bg-[var(--cs-green)]'}`} />
              {charging ? 'Charging and emptying' : 'Ready to roll'}
            </div>
            <button onClick={onShop} className="pointer-events-auto cs-btn cs-btn-primary">
              <span className="relative flex items-center gap-2.5">{!isTouch && <KeyCap>E</KeyCap>}Upgrade dock</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
