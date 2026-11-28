import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Sfx } from '../game/audio';

/* ------------------------------------------------------------------ UI sound */

let uiSfx: Sfx | null = null;
/** App hands the game's synth over once it exists, so menus can tick and chime. */
export function bindUiSfx(s: Sfx | null) { uiSfx = s; }
export const uiSound = {
  move() { uiSfx?.uiMove(); },
  /** Always called from a click or key press, so it's also a safe place to unlock audio. */
  select() { uiSfx?.unlock(); uiSfx?.uiSelect(); },
  back() { uiSfx?.unlock(); uiSfx?.uiBack(); },
};

/* ------------------------------------------------------------------ icons */

const paths = {
  close: 'M6 6l12 12M18 6L6 18',
  soundOn: 'M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12',
  soundOff: 'M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6',
  back: 'M15 5l-7 7 7 7',
  check: 'M5 12.5l4.5 4.5L19 7',
  lock: 'M7 11V8a5 5 0 0110 0v3M5.5 11h13v9h-13z',
  // editor
  cursor: 'M5 3l14 7.5-6 1.5-2.5 6L5 3z',
  room: 'M4 4h16v16H4zM4 12h16M12 4v16',
  wall: 'M3 5h18v14H3zM3 9.7h18M3 14.3h18M9 5v4.7M15 9.7v4.6M9 14.3V19',
  door: 'M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M3 21h18M14.5 12.5h.01',
  key: 'M14 10a4 4 0 10-3.5 3.97M10.5 13.97L4 20.5M6.5 18l2 2M8.5 16l1.5 1.5',
  eraser: 'M16 3.5l4.5 4.5L10 18.5H5.5L3.5 16.5a1.5 1.5 0 010-2.1L16 3.5zM9 9.5l5.5 5.5M10 18.5h10',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  play: 'M7 4.5v15l12.5-7.5L7 4.5z',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 6.5A1.5 1.5 0 014.5 5H10l2 2h7.5A1.5 1.5 0 0121 8.5v10a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5v-12z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  rotate: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, className = 'w-4 h-4' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name]} />
    </svg>
  );
}

/* ------------------------------------------------------------------ small pieces */

/** A keyboard key drawn as a keycap, for the prompt bar. */
export function KeyCap({ children }: { children: ReactNode }) {
  return <kbd className="cs-key">{children}</kbd>;
}

/** "[Enter] Confirm  [Esc] Back" — the bottom-of-screen button prompts. */
export function PromptBar({ items, className = '' }: { items: [ReactNode, string][]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cs-dim)] ${className}`}>
      {items.map(([k, label], i) => (
        <span key={i} className="flex items-center gap-2">{k}<span>{label}</span></span>
      ))}
    </div>
  );
}

/** Eyebrow + ornamental rule used above titles and section headings. */
export function Rule({ className = '' }: { className?: string }) {
  return (
    <div className={`cs-rule ${className}`} aria-hidden>
      <span /><i /><span />
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h3 className="font-display text-[12px] font-semibold tracking-[0.32em] text-[var(--cs-gold)] whitespace-nowrap">{children}</h3>
      <div className="flex-1 h-px bg-gradient-to-r from-[var(--cs-line)] to-transparent" />
      {aside}
    </div>
  );
}

/** The ornate panel every overlay sits in: hairline gold border, inset line and corner brackets. */
export function Frame({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`cs-frame ${className}`} style={style}>
      <span className="cs-corner tl" /><span className="cs-corner tr" /><span className="cs-corner bl" /><span className="cs-corner br" />
      {children}
    </div>
  );
}

/** Header for a Frame: eyebrow, big title, optional close button. */
export function FrameHeader({ eyebrow, title, onClose, right }: { eyebrow?: string; title: string; onClose?: () => void; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        {eyebrow && <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.34em] text-[var(--cs-dim)] mb-1.5 truncate">{eyebrow}</div>}
        <h2 className="font-display font-black text-2xl sm:text-[2rem] leading-none tracking-[0.14em] gold-text">{title}</h2>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {right}
        {onClose && (
          <button onClick={() => { uiSound.back(); onClose(); }} className="cs-icon-btn" aria-label="Close">
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}

/** A labelled figure: small caps label over a big number. Used in stat strips. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--cs-dim)] mb-1 truncate">{label}</div>
      <div className="font-display font-bold text-lg sm:text-xl text-[var(--cs-ink-hi)] tabular-nums leading-tight truncate">{value}</div>
      {sub && <div className="text-[11px] text-[var(--cs-dim)] truncate">{sub}</div>}
    </div>
  );
}

export function StatStrip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`cs-stats ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ buttons */

type BtnVariant = 'primary' | 'secondary' | 'danger';
export function Button({
  children, onClick, variant = 'secondary', className = '', disabled, type = 'button', hint,
}: { children: ReactNode; onClick?: () => void; variant?: BtnVariant; className?: string; disabled?: boolean; type?: 'button' | 'submit'; hint?: ReactNode }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={() => !disabled && uiSound.move()}
      onClick={() => { if (disabled) return; uiSound.select(); onClick?.(); }}
      className={`cs-btn cs-btn-${variant} ${className}`}
    >
      <span className="relative flex items-center justify-center gap-2">{children}{hint && <span className="cs-btn-hint">{hint}</span>}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ menu list */

export interface MenuEntry {
  id: string;
  label: string;
  /** Shown under the list while this entry is highlighted. */
  desc?: ReactNode;
  /** Small text on the right of the row (a value, a shortcut). */
  value?: ReactNode;
  disabled?: boolean;
  /** Ask once before running: the row's label swaps to this and needs a second confirm. */
  confirm?: string;
  onSelect: () => void;
}

/**
 * A vertical, keyboard-driven menu in the style of a console title screen: one highlighted row,
 * ↑/↓ (or W/S) to move, Enter/Space to pick, mouse hover follows along.
 */
export function MenuList({ items, enabled = true, initial = 0, size = 'lg', showDesc = true }: { items: MenuEntry[]; enabled?: boolean; initial?: number; size?: 'lg' | 'md'; showDesc?: boolean }) {
  const [sel, setSel] = useState(() => Math.min(initial, items.length - 1));
  const [armed, setArmed] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // keep the cursor in range if entries appear or vanish
  useEffect(() => { setSel((s) => Math.min(s, items.length - 1)); }, [items.length]);
  // an armed confirm times out, and clears when the cursor moves away
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const move = useCallback((dir: 1 | -1) => {
    setSel((s) => {
      const list = itemsRef.current;
      let n = s;
      for (let i = 0; i < list.length; i++) {
        n = (n + dir + list.length) % list.length;
        if (!list[n].disabled) break;
      }
      if (n !== s) { uiSound.move(); setArmed(null); }
      return n;
    });
  }, []);

  const activate = useCallback((i: number) => {
    const it = itemsRef.current[i];
    if (!it || it.disabled) return;
    if (it.confirm && armed !== it.id) { uiSound.move(); setArmed(it.id); return; }
    setArmed(null);
    uiSound.select();
    it.onSelect();
  }, [armed]);

  useEffect(() => {
    if (!enabled) return;
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); move(-1); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); move(1); }
      else if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) { e.preventDefault(); activate(sel); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [enabled, move, activate, sel]);

  const current = items[sel];
  return (
    <div>
      <ul className={`cs-menu cs-menu-${size}`} role="menu">
        {items.map((it, i) => {
          const on = i === sel;
          const isArmed = armed === it.id;
          return (
            <li key={it.id} role="none" className="cs-menu-row" style={{ animationDelay: `${120 + i * 55}ms` }}>
              <button
                role="menuitem"
                disabled={it.disabled}
                aria-current={on}
                data-on={on || undefined}
                data-armed={isArmed || undefined}
                onMouseEnter={() => { if (!it.disabled && sel !== i) { setSel(i); setArmed(null); uiSound.move(); } }}
                onFocus={() => setSel(i)}
                onClick={() => activate(i)}
                className="cs-menu-item"
              >
                <span className="cs-menu-mark" aria-hidden />
                <span className="cs-menu-label">{isArmed ? it.confirm : it.label}</span>
                {it.value !== undefined && <span className="cs-menu-value">{it.value}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {showDesc && (
        <div className="cs-menu-desc" key={current?.id}>
          {current && (armed === current.id ? 'Press again to confirm.' : current.desc)}
        </div>
      )}
    </div>
  );
}

/** Escape (or Backspace) closes whatever overlay registered this. */
export function useEscape(onEscape: (() => void) | undefined, enabled = true) {
  useEffect(() => {
    if (!onEscape || !enabled) return;
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); uiSound.back(); onEscape(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onEscape, enabled]);
}
