import { useEffect, useState } from 'react';
import { MAX_MANUAL, SaveMeta, deleteAllSaves, deleteSave, listSaves } from '../game/saves';
import { formatShift } from './HUD';

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

/** A button that needs a second click to fire, for anything destructive. */
function ConfirmButton({ label, confirm, onConfirm, className }: { label: string; confirm: string; onConfirm: () => void; className: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={`${className} ${armed ? '!bg-red-500/30 !border-red-300/60 text-red-100' : ''}`}
    >
      {armed ? confirm : label}
    </button>
  );
}

export interface SaveMenuProps {
  /** 'save' adds the new-save / overwrite controls (opened from the pause menu). */
  mode: 'save' | 'load';
  /** Loading from inside a run replaces it, so ask first. */
  inRun: boolean;
  /** Bumped by the game whenever saves change, to re-read storage. */
  version: number;
  onSave?: (id?: string, name?: string) => SaveMeta | null;
  onLoad: (id: string) => void;
  onClose: () => void;
}

export function SaveMenu({ mode, inRun, version, onSave, onLoad, onClose }: SaveMenuProps) {
  const [tick, setTick] = useState(0);
  const [saves, setSaves] = useState<SaveMeta[]>(() => listSaves());
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => { setSaves(listSaves()); }, [version, tick]);
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && mode === 'load' && !inRun) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode, inRun, onClose]);

  const manual = saves.filter((s) => !s.auto);
  const full = manual.length >= MAX_MANUAL;

  const doSave = (id?: string) => {
    const res = onSave?.(id, id ? undefined : name);
    if (res) { setMsg({ text: `Saved “${res.name}”`, ok: true }); setName(''); }
    else setMsg({ text: full && !id ? 'All slots are full — overwrite or delete one.' : 'Could not save (browser storage full or blocked).', ok: false });
    refresh();
  };

  return (
    <div className="absolute inset-0 bg-black/70 overflow-y-auto scrollbar-thin fade-in z-10" style={{ backdropFilter: 'blur(3px)' }}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="panel rounded-2xl p-5 sm:p-6 w-full max-w-lg flex flex-col gap-4 big-in">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-black text-2xl sm:text-3xl gold-text tracking-widest">{mode === 'save' ? 'SAVE / LOAD' : 'LOAD GAME'}</h2>
            <button onClick={onClose} className="btn-ghost rounded-full w-9 h-9 font-bold" aria-label="Close">✕</button>
          </div>

          {mode === 'save' && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); doSave(); }}>
              <input
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                placeholder={full ? 'Slots full' : `Save ${manual.length + 1}`}
                disabled={full}
                className="flex-1 min-w-0 bg-black/50 border border-white/20 rounded-lg px-3 py-2 font-semibold text-amber-50 outline-none focus:border-amber-300 select-text disabled:opacity-50"
              />
              <button type="submit" disabled={full} className="btn-gold rounded-lg px-4 py-2 font-black whitespace-nowrap disabled:opacity-50">💾 New save</button>
            </form>
          )}
          {msg && <div className={`text-sm text-center ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</div>}

          <div className="flex flex-col gap-2">
            {saves.length === 0 && <div className="text-center text-amber-100/50 text-sm py-6">No saved shifts yet.</div>}
            {saves.map((s) => (
              <div key={s.id} className={`rounded-xl p-3 border flex flex-col sm:flex-row sm:items-center gap-2 ${s.auto ? 'bg-cyan-300/[0.07] border-cyan-300/30' : 'bg-white/[0.04] border-white/10'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-50 truncate">{s.auto ? '⟳ Autosave' : s.name}</span>
                    <span className="text-[11px] text-amber-100/40 whitespace-nowrap">{ago(s.date)}</span>
                  </div>
                  <div className="text-xs text-amber-100/60 tabular-nums">
                    🕐 {formatShift(s.time)} · ⭐ {s.score.toLocaleString()} · 🪙 {s.coins} · 🏠 {s.roomsCleared}/10 · {Math.round(s.overall * 100)}% clean
                  </div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {inRun ? (
                    <ConfirmButton label="Load" confirm="Replace run?" onConfirm={() => onLoad(s.id)} className="btn-ghost rounded-lg px-3 py-1.5 text-sm font-bold" />
                  ) : (
                    <button onClick={() => onLoad(s.id)} className="btn-gold rounded-lg px-3 py-1.5 text-sm font-black">Load</button>
                  )}
                  {mode === 'save' && !s.auto && (
                    <ConfirmButton label="Overwrite" confirm="Sure?" onConfirm={() => doSave(s.id)} className="btn-ghost rounded-lg px-3 py-1.5 text-sm font-bold" />
                  )}
                  <ConfirmButton label="🗑" confirm="Delete?" onConfirm={() => { deleteSave(s.id); refresh(); }} className="btn-ghost rounded-lg px-3 py-1.5 text-sm font-bold" />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-amber-100/50">
            <span>{manual.length}/{MAX_MANUAL} save slots · progress autosaves as you play</span>
            {saves.length > 0 && (
              <ConfirmButton label="Delete all" confirm="Delete ALL saves?" onConfirm={() => { deleteAllSaves(); refresh(); setMsg(null); }} className="btn-ghost rounded-lg px-3 py-1.5 font-bold" />
            )}
          </div>
          <button onClick={onClose} className="btn-ghost rounded-xl py-2.5 font-bold">← Back</button>
        </div>
      </div>
    </div>
  );
}
