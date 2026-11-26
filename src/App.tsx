import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, GameOverInfo, HudState, Phase, ToastKind } from './game/Game';
import HUD from './components/HUD';
import TouchControls from './components/TouchControls';
import { GameOver, PauseMenu, Shop, StartScreen } from './components/Screens';
import { SaveMenu } from './components/SaveMenu';
import { getAutosave, listSaves, loadSave } from './game/saves';

interface Toast { id: number; text: string; kind: ToastKind }

const toastStyle: Record<ToastKind, string> = {
  info: 'border-cyan-300/40 text-cyan-50',
  good: 'border-emerald-300/50 text-emerald-50',
  warn: 'border-orange-300/60 text-orange-100',
  bad: 'border-fuchsia-300/60 text-fuchsia-100',
  big: 'border-amber-300/80 text-amber-100',
};

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('menu');
  const [hud, setHud] = useState<HudState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [caption, setCaption] = useState<{ text: string; big: boolean; id: number } | null>(null);
  const [over, setOver] = useState<GameOverInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(0);
  const [seenIntro, setSeenIntro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMenu, setSaveMenu] = useState<'save' | 'load' | null>(null);
  const [savesVersion, setSavesVersion] = useState(0);
  const toastId = useRef(0);
  const isTouch = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

  const pushToast = useCallback((text: string, kind: ToastKind) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    if (kind === 'big') setFlash((f) => f + 1);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'big' ? 3200 : 2600);
  }, []);

  useEffect(() => {
    if (!mountRef.current || !popupRef.current) return;
    let g: Game | null = null;
    // let the loading screen paint before heavy world generation
    const id = window.setTimeout(() => {
      try {
        g = new Game(mountRef.current!, popupRef.current!, {
          onPhase: (p) => setPhase(p),
          onHud: (h) => setHud(h),
          onToast: pushToast,
          onCaption: (text, big) => setCaption(text ? { text, big: !!big, id: Date.now() } : null),
          onGameOver: (info) => setOver(info),
          onMute: (m) => setMuted(m),
          onSaves: () => setSavesVersion((v) => v + 1),
        });
        gameRef.current = g;
        setGame(g);
        setMuted(g.sfx.muted);
      } catch (e) {
        console.error(e);
        setError('Your browser could not start WebGL. Please try another browser or device.');
      }
      setLoading(false);
    }, 30);
    return () => {
      clearTimeout(id);
      g?.dispose();
      gameRef.current = null;
    };
  }, [pushToast]);

  const play = useCallback((intro: boolean) => {
    const g = gameRef.current;
    if (!g) return;
    setOver(null);
    setToasts([]);
    setSeenIntro(true);
    g.startRun(intro);
  }, []);

  useEffect(() => {
    if (phase !== 'gameover') return;
    setToasts([]);
  }, [phase]);

  // the save menu only lives on top of the title screen or the pause menu
  useEffect(() => {
    if (phase !== 'menu' && phase !== 'paused') setSaveMenu(null);
  }, [phase]);

  const loadById = useCallback((id: string) => {
    const g = gameRef.current;
    const f = loadSave(id);
    if (!g || !f) { pushToast('That save could not be read.', 'bad'); setSavesVersion((v) => v + 1); return; }
    setOver(null);
    setToasts([]);
    setSeenIntro(true);
    setSaveMenu(null);
    g.loadGame(f.run);
  }, [pushToast]);

  const continueRun = useCallback(() => {
    const a = getAutosave();
    if (a) loadById(a.id);
  }, [loadById]);

  // re-read storage for the title screen whenever saves change
  const autosave = phase === 'menu' ? getAutosave() : null;
  const saveCount = phase === 'menu' ? listSaves().length : 0;

  const minimapRef = useCallback((c: HTMLCanvasElement | null) => {
    gameRef.current?.setMinimap(c);
  }, []);

  const inPlay = phase === 'playing' || phase === 'paused' || phase === 'shop';

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#07050a] font-[family-name:var(--font-ui)]">
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={popupRef} className="absolute inset-0 pointer-events-none overflow-hidden" />

      {phase === 'playing' && game && <TouchControls game={game} showTurbo={isTouch} />}

      {inPlay && hud && (
        <HUD
          hud={hud}
          minimapRef={minimapRef}
          onPause={() => game?.pause()}
          onShop={() => game?.openShop()}
          onMute={() => game?.toggleMute()}
          muted={muted}
          isTouch={isTouch}
        />
      )}

      {/* flash */}
      {flash > 0 && <div key={flash} className="absolute inset-0 pointer-events-none flash" style={{ background: 'radial-gradient(circle, rgba(255,240,190,0.9), rgba(255,210,120,0.3))' }} />}

      {/* toasts */}
      {(phase === 'playing' || phase === 'intro' || phase === 'tidy') && (
        <div className="absolute left-1/2 -translate-x-1/2 top-[150px] sm:top-[140px] flex flex-col items-center gap-2 pointer-events-none w-[92vw] max-w-xl">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`${t.kind === 'big' ? 'big-in text-base sm:text-xl font-black px-5 py-2.5' : 'toast-in text-xs sm:text-sm font-semibold px-4 py-1.5'} panel rounded-full border text-center ${toastStyle[t.kind]}`}
              style={t.kind === 'big' ? { boxShadow: '0 0 30px rgba(255,210,100,0.45)' } : undefined}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* cinematic captions */}
      {(phase === 'intro' || phase === 'playing' || phase === 'tidy') && caption && (
        <div className="absolute inset-x-0 bottom-[18%] flex justify-center pointer-events-none px-4">
          <div
            key={caption.id}
            className={`${caption.big ? 'big-in font-display font-black text-3xl sm:text-6xl gold-text drop-shadow-[0_4px_18px_rgba(0,0,0,0.9)]' : 'caption-in font-display text-lg sm:text-2xl text-amber-50/90'} text-center tracking-[0.12em]`}
            style={caption.big ? undefined : { textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}
          >
            {caption.text}
          </div>
        </div>
      )}

      {phase === 'intro' && (
        <>
          <div className="absolute inset-x-0 top-0 h-[9vh] bg-black pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-[9vh] bg-black pointer-events-none" />
          <div className="absolute inset-0" onPointerDown={() => game?.skipIntro()} />
          <button
            onClick={() => game?.skipIntro()}
            className="absolute right-4 bottom-[calc(9vh+12px)] btn-ghost rounded-full px-4 py-1.5 text-sm font-semibold text-amber-100/80"
          >
            Skip ⏭
          </button>
        </>
      )}

      {phase === 'tidy' && (
        <>
          <div className="absolute inset-x-0 top-0 h-[9vh] bg-black pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-[9vh] bg-black pointer-events-none" />
          <button
            onClick={() => game?.skipTidy()}
            className="absolute right-4 bottom-[calc(9vh+12px)] btn-ghost rounded-full px-4 py-1.5 text-sm font-semibold text-amber-100/80"
          >
            Skip ⏭
          </button>
        </>
      )}

      {phase === 'menu' && !loading && !error && !saveMenu && (
        <StartScreen
          onPlay={play}
          isTouch={isTouch}
          seenIntro={seenIntro}
          autosave={autosave}
          saveCount={saveCount}
          onContinue={continueRun}
          onLoadMenu={() => setSaveMenu('load')}
        />
      )}

      {phase === 'paused' && !saveMenu && (
        <PauseMenu
          hud={hud}
          muted={muted}
          onResume={() => game?.resume()}
          onRestart={() => play(false)}
          onMenu={() => game?.toMenu()}
          onMute={() => game?.toggleMute()}
          onSaveMenu={() => setSaveMenu('save')}
        />
      )}

      {saveMenu && (phase === 'menu' || phase === 'paused') && (
        <SaveMenu
          mode={saveMenu}
          inRun={phase === 'paused'}
          version={savesVersion}
          onSave={(id, name) => game?.saveGame(id, name) ?? null}
          onLoad={loadById}
          onClose={() => setSaveMenu(null)}
        />
      )}

      {phase === 'shop' && hud && <Shop hud={hud} isTouch={isTouch} onBuy={(k) => game?.buy(k)} onClose={() => game?.closeShop()} />}

      {phase === 'gameover' && over && (
        <GameOver info={over} isTouch={isTouch} onRestart={() => play(false)} onMenu={() => { setOver(null); game?.toMenu(); }} />
      )}

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#07050a]">
          <div className="font-display font-black text-4xl gold-text tracking-widest">CLEAN SWEEP</div>
          <div className="text-amber-100/60 text-sm blink-soft">Unlocking the manor doors…</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="panel rounded-2xl p-6 max-w-sm">{error}</div>
        </div>
      )}
    </div>
  );
}
