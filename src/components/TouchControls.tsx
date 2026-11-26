import { useRef, useState } from 'react';
import type { Game } from '../game/Game';

const R = 62;

export default function TouchControls({ game, showTurbo }: { game: Game; showTurbo: boolean }) {
  const pid = useRef<number | null>(null);
  const base = useRef({ x: 0, y: 0 });
  const [stick, setStick] = useState<{ bx: number; by: number; kx: number; ky: number } | null>(null);
  const [turbo, setTurbo] = useState(false);

  const down = (e: React.PointerEvent) => {
    if (pid.current !== null) return;
    pid.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    base.current = { x: e.clientX, y: e.clientY };
    setStick({ bx: e.clientX, by: e.clientY, kx: 0, ky: 0 });
    game.setJoystick(0, 0, true);
  };
  const move = (e: React.PointerEvent) => {
    if (e.pointerId !== pid.current) return;
    let dx = e.clientX - base.current.x;
    let dy = e.clientY - base.current.y;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      // drag the base along for a floating stick
      const over = len - R;
      base.current.x += (dx / len) * over;
      base.current.y += (dy / len) * over;
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setStick({ bx: base.current.x, by: base.current.y, kx: dx, ky: dy });
    game.setJoystick(dx / R, dy / R, true);
  };
  const up = (e: React.PointerEvent) => {
    if (e.pointerId !== pid.current) return;
    pid.current = null;
    setStick(null);
    game.setJoystick(0, 0, false);
  };

  const tOn = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setTurbo(true);
    game.setTurbo(true);
  };
  const tOff = (e: React.PointerEvent) => {
    e.stopPropagation();
    setTurbo(false);
    game.setTurbo(false);
  };

  return (
    <>
      <div
        className="absolute inset-0"
        style={{ touchAction: 'none' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {stick && (
        <div className="absolute pointer-events-none" style={{ left: stick.bx, top: stick.by }}>
          <div
            className="absolute rounded-full border-2 border-cyan-200/40 bg-cyan-200/10"
            style={{ width: R * 2, height: R * 2, left: -R, top: -R, boxShadow: '0 0 20px rgba(0,229,255,0.25)' }}
          />
          <div
            className="absolute rounded-full bg-cyan-200/80 border-2 border-white/80"
            style={{ width: 52, height: 52, left: stick.kx - 26, top: stick.ky - 26, boxShadow: '0 0 18px rgba(0,229,255,0.7)' }}
          />
        </div>
      )}
      {showTurbo && (
        <button
          className={`absolute right-5 bottom-[max(1.75rem,env(safe-area-inset-bottom))] w-20 h-20 rounded-full font-black text-3xl border-2 transition-transform ${
            turbo ? 'scale-90 bg-fuchsia-500/70 border-white' : 'bg-fuchsia-600/35 border-fuchsia-200/60'
          }`}
          style={{ touchAction: 'none', boxShadow: turbo ? '0 0 30px rgba(255,80,220,0.8)' : '0 0 14px rgba(255,80,220,0.35)' }}
          onPointerDown={tOn}
          onPointerUp={tOff}
          onPointerCancel={tOff}
          onPointerLeave={tOff}
          aria-label="Turbo"
        >
          ⚡
        </button>
      )}
    </>
  );
}
