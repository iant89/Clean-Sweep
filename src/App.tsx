import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, GameOverInfo, HudState, Phase, ToastKind } from './game/Game';
import HUD from './components/HUD';
import TouchControls from './components/TouchControls';
import { GameOver, PauseMenu, Shop, StartScreen } from './components/Screens';
import { SaveMenu } from './components/SaveMenu';
import DevMenu, { DEV_MODE } from './components/DevMenu';
import LevelDesigner from './components/LevelDesigner';
import type { LevelDef } from './game/levels';
import { getAutosave, listSaves, loadSave } from './game/saves';
import { Icon, KeyCap, bindUiSfx } from './components/ui';

interface Toast { id: number; text: string; kind: ToastKind; detail?: string; out?: boolean }

/** Accent colour of each notification kind: the marker, the edge lines and the glow. */
const TOAST_ACCENT: Record<ToastKind, string> = {
  info: '#7fe9f5',
  good: '#8fdcaa',
  warn: '#ffb36b',
  bad: '#e08cff',
  big: '#e6c36a',
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

  const pushToast = useCallback((text: string, kind: ToastKind, detail?: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind, detail }]);
    if (kind === 'big') setFlash((f) => f + 1);
    const life = kind === 'big' ? 3400 : 2700;
    // fade out first, then drop it
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x))), life - 350);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), life);
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
        <HUD
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
        <div className="absolute left-1/2 -translate-x-1/2 top-[210px] sm:top-[150px] flex flex-col items-center gap-2 pointer-events-none w-[94vw] max-w-2xl" aria-live="polite">
          {toasts.map((t) => t.kind === 'big' ? (
            <div key={t.id} className={`cs-banner ${t.out ? 'cs-toast-out' : ''}`} style={{ '--accent': TOAST_ACCENT.big } as React.CSSProperties}>
              <div className="cs-banner-rule" />
              <div className="font-display font-black cs-title text-2xl sm:text-[2.1rem] leading-none tracking-[0.12em] uppercase">{t.text}</div>
              {t.detail && <div className="mt-2 text-[11px] sm:text-xs font-semibold tracking-[0.2em] uppercase text-[var(--cs-ink-hi)]">{t.detail}</div>}
              <div className="cs-banner-rule" />
            </div>
          ) : (
            <div key={t.id} className={`cs-toast ${t.out ? 'cs-toast-out' : ''}`} style={{ '--accent': TOAST_ACCENT[t.kind] } as React.CSSProperties}>
              <span className="cs-toast-mark" />
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* cinematic captions */}
      {(phase === 'intro' || phase === 'playing' || phase === 'tidy') && caption && (
        <div className="absolute inset-x-0 bottom-[18%] flex justify-center pointer-events-none px-4">
          <div
            key={caption.id}
            className={`${caption.big ? 'big-in font-display font-black text-3xl sm:text-6xl cs-title drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)]' : 'caption-in font-display text-lg sm:text-2xl text-amber-50/90'} text-center tracking-[0.12em]`}
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
          className="absolute left-3 z-40 ed-chip ed-chip-cyan !h-8 hover:!bg-[rgba(127,233,245,0.14)] pointer-events-auto"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <Icon name="chevronLeft" className="w-3.5 h-3.5" />Back to editor
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
