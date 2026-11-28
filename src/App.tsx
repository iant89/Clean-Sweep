import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, GameOverInfo, HudState, Phase, ToastKind } from './game/Game';
import HUD from './components/HUD';
import HUDNext from './components/HUDNext';
import TouchControls from './components/TouchControls';
import { GameOver, PauseMenu, Shop, StartScreen } from './components/Screens';
import { SaveMenu } from './components/SaveMenu';
import DevMenu, { DEV_MODE } from './components/DevMenu';
import LevelDesigner from './components/LevelDesigner';
import type { LevelDef } from './game/levels';
import { getAutosave, listSaves, loadSave } from './game/saves';
import { KeyCap, bindUiSfx } from './components/ui';

/** Preview of the redesigned HUD: open the game with ?hud=next. */
const HUD_NEXT = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hud') === 'next';
const ActiveHUD = HUD_NEXT ? HUDNext : HUD;

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
  const [designer, setDesigner] = useState(false);
  const [playtesting, setPlaytesting] = useState(false);
  /** Seed the level designer is opened with: set when Test Play is pressed so the design survives. */
  const designerSeedRef = useRef<LevelDef | null>(null);
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
        bindUiSfx(g.sfx);
      } catch (e) {
        console.error(e);
        setError('Your browser could not start WebGL. Please try another browser or device.');
      }
      setLoading(false);
    }, 30);
    return () => {
      clearTimeout(id);
      bindUiSfx(null);
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

  // a playtest run is over once we're back at the menu (cleared via Back to Editor or Menu)
  useEffect(() => {
    if (phase === 'menu') setPlaytesting(false);
  }, [phase]);

  /** Abandon the playtest run and reopen the level editor with the in-progress design. */
  const backToEditor = useCallback(() => {
    const g = gameRef.current;
    if (g) g.toMenu();
    setOver(null);
    setToasts([]);
    setPlaytesting(false);
    setDesigner(true);
  }, []);

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
        <ActiveHUD
          hud={hud}
          minimapRef={minimapRef}
          onPause={() => game?.pause()}
          onShop={() => game?.openShop()}
          onNextLevel={() => game?.nextLevel()}
          onMute={() => game?.toggleMute()}
          muted={muted}
          isTouch={isTouch}
        />
      )}

      {DEV_MODE && inPlay && game && <DevMenu game={game} />}

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
            className="absolute right-5 bottom-[calc(9vh+14px)] flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--cs-ink)] hover:text-[var(--cs-gold-hi)] transition-colors"
          >
            {!isTouch && <KeyCap>Space</KeyCap>}Skip
          </button>
        </>
      )}

      {phase === 'tidy' && (
        <>
          <div className="absolute inset-x-0 top-0 h-[9vh] bg-black pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-[9vh] bg-black pointer-events-none" />
          <button
            onClick={() => game?.skipTidy()}
            className="absolute right-5 bottom-[calc(9vh+14px)] flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--cs-ink)] hover:text-[var(--cs-gold-hi)] transition-colors"
          >
            {!isTouch && <KeyCap>Space</KeyCap>}Skip
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
          muted={muted}
          onMute={() => game?.toggleMute()}
          onContinue={continueRun}
          onLoadMenu={() => setSaveMenu('load')}
          onDesigner={() => { designerSeedRef.current = null; setDesigner(true); }}
        />
      )}

      {phase === 'paused' && !saveMenu && (
        <PauseMenu
          hud={hud}
          muted={muted}
          isTouch={isTouch}
          onResume={() => game?.resume()}
          onRestart={() => { if (playtesting) { const g = gameRef.current; if (g) g.startRun(false, g.level); } else play(false); }}
          onMenu={() => game?.toMenu()}
          onMute={() => game?.toggleMute()}
          onSaveMenu={() => setSaveMenu('save')}
          onDesigner={playtesting ? backToEditor : undefined}
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

      {phase === 'shop' && hud && <Shop hud={hud} isTouch={isTouch} onBuy={(k) => game?.buy(k)} onBuyMachine={() => game?.buyMachine()} onSwitchMachine={(i) => game?.switchMachine(i)} onClose={() => game?.closeShop()} />}

      {phase === 'gameover' && over && (
        <GameOver info={over} isTouch={isTouch} onRestart={() => { setOver(null); if (playtesting) { const g = gameRef.current; if (g) g.startRun(false, g.level); } else play(false); }} onMenu={() => { setOver(null); game?.toMenu(); }} onRevive={() => { if (game?.revive()) setOver(null); }} onDesigner={playtesting ? backToEditor : undefined} />
      )}

      {designer && (
        <LevelDesigner
          initialDef={designerSeedRef.current}
          onExit={() => setDesigner(false)}
          onPlay={(def) => {
            designerSeedRef.current = def;
            setPlaytesting(true);
            setDesigner(false);
            game?.playCustomLevel(def);
          }}
        />
      )}

      {/* floating return-to-editor button while playtesting a custom level */}
      {playtesting && !designer && phase !== 'gameover' && (
        <button
          onClick={backToEditor}
          className="absolute left-2 z-40 panel rounded-full px-3 py-1.5 text-xs font-semibold text-cyan-100 border border-cyan-400/40 hover:bg-cyan-400/15 pointer-events-auto"
          style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          🛠️ Editor
        </button>
      )}

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#07050a]">
          <div className="text-[10px] tracking-[0.42em] text-[var(--cs-dim)] font-display">MIDNIGHT AT BLACKWOOD MANOR</div>
          <div className="font-display font-black text-5xl sm:text-6xl cs-title tracking-[0.06em] leading-none">CLEAN SWEEP</div>
          <div className="cs-loadbar" />
          <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--cs-dim)]">Unlocking the manor doors</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="cs-frame p-8 max-w-sm text-sm leading-relaxed text-[var(--cs-ink)]">
            <div className="font-display font-bold tracking-[0.2em] text-[var(--cs-red)] mb-2">UNABLE TO START</div>
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
