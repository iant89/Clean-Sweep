import { useEffect, useState } from 'react';
import type { DevCheat, Game } from '../game/Game';

export { DEV_MODE } from '../game/devmode';

const ACTIONS: { cmd: DevCheat; label: string; toggle?: 'infBattery' | 'freezeTime' }[] = [
  { cmd: 'coins100', label: '+100 🪙' },
  { cmd: 'coins1000', label: '+1000 🪙' },
  { cmd: 'battery', label: '🔋 Full battery' },
  { cmd: 'infBattery', label: '♾️ Infinite battery', toggle: 'infBattery' },
  { cmd: 'emptyBin', label: '🗑️ Empty bin' },
  { cmd: 'maxUpgrades', label: '⬆️ Max upgrades' },
  { cmd: 'cleanRoom', label: '✨ Clean this room' },
  { cmd: 'cleanAll', label: '🏆 Clean all rooms' },
  { cmd: 'secrets', label: '🗝️ Reveal secret rooms' },
  { cmd: 'ghost', label: '👻 Spawn ghost' },
  { cmd: 'hour', label: '🕐 +1 hour' },
  { cmd: 'dawn', label: '☀️ Skip to dawn' },
  { cmd: 'freezeTime', label: '⏸️ Freeze clock', toggle: 'freezeTime' },
  { cmd: 'dock', label: '🏠 Teleport to dock' },
];

export default function DevMenu({ game }: { game: Game }) {
  const [open, setOpen] = useState(false);
  const [, rerender] = useState(0);

  // backquote (`) toggles the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote' && !e.repeat) { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = (cmd: DevCheat) => {
    game.devCheat(cmd);
    rerender((n) => n + 1);
  };

  return (
    <div className="absolute right-2 sm:right-4 top-[36%] z-40 flex flex-col-reverse items-end gap-2 pointer-events-auto select-none">
      {open && (
        <div className="panel rounded-xl p-2 w-[220px] max-h-[52vh] overflow-y-auto flex flex-col gap-1 border border-fuchsia-300/40">
          <div className="text-[10px] uppercase tracking-widest font-black text-fuchsia-200/80 px-1 pb-1">Dev cheats</div>
          {ACTIONS.map((a) => {
            const on = a.toggle ? (a.toggle === 'infBattery' ? game.devInfBattery : game.devFreezeTime) : false;
            return (
              <button
                key={a.cmd}
                // keep keyboard focus off the button so Space/Enter keep driving the game
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(a.cmd)}
                className={`text-left text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${on ? 'bg-fuchsia-400/25 border-fuchsia-300/60 text-fuchsia-50' : 'btn-ghost border-white/10 text-amber-50'}`}
              >
                {a.label}{a.toggle && <span className="float-right opacity-70">{on ? 'ON' : 'OFF'}</span>}
              </button>
            );
          })}
        </div>
      )}
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="panel rounded-full px-3 py-1.5 text-xs font-black text-fuchsia-100 border border-fuchsia-300/50"
        title="Toggle dev menu (`)"
      >
        🛠 DEV
      </button>
    </div>
  );
}
