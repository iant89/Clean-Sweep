import { useEffect, useState } from 'react';
import { MAX_MANUAL, SaveMeta, deleteAllSaves, deleteSave, listSaves } from '../game/saves';
import { formatShift } from './HUD';
import { Button, Frame, FrameHeader, Icon, useEscape } from './ui';

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

/** A button that needs a second click to fire, for anything destructive. */
function ConfirmButton({ label, confirm, onConfirm, variant = 'secondary', className = '' }: { label: string; confirm: string; onConfirm: () => void; variant?: 'primary' | 'secondary'; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant={armed ? 'danger' : variant}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={`cs-btn-sm ${className}`}
    >
      {armed ? confirm : label}
    </Button>
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

  // in a run, Escape belongs to the game (it resumes play); on the title screen it closes this
  useEscape(onClose, mode === 'load' && !inRun);

  const manual = saves.filter((s) => !s.auto);
  const full = manual.length >= MAX_MANUAL;

  const doSave = (id?: string) => {
    const res = onSave?.(id, id ? undefined : name);
    if (res) { setMsg({ text: `Saved \u201c${res.name}\u201d`, ok: true }); setName(''); }
    else setMsg({ text: full && !id ? 'All slots are full. Overwrite or delete one.' : 'Could not save (browser storage full or blocked).', ok: false });
    refresh();
  };

  let slot = 0;
  return (
    <div className="absolute inset-0 bg-black/70 overflow-y-auto scrollbar-thin fade-in z-10" style={{ backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}>
      <div className="min-h-full flex items-center justify-center p-3 sm:p-6">
        <Frame className="w-full max-w-2xl p-5 sm:p-8 flex flex-col gap-5 cs-panel-in">
          <FrameHeader
            eyebrow={`${manual.length} of ${MAX_MANUAL} slots used · progress autosaves as you play`}
            title={mode === 'save' ? 'SAVE / LOAD' : 'LOAD GAME'}
            onClose={onClose}
          />

          {mode === 'save' && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); doSave(); }}>
              <input
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                placeholder={full ? 'All slots full' : `Name this save (Save ${manual.length + 1})`}
                disabled={full}
                className="cs-input"
              />
              <Button type="submit" variant="primary" disabled={full} className="shrink-0">New save</Button>
            </form>
          )}
          {msg && <div className={`text-xs tracking-wide ${msg.ok ? 'text-[var(--cs-green)]' : 'text-[var(--cs-red)]'}`}>{msg.text}</div>}

          <div className="flex flex-col border-t border-[var(--cs-line-soft)]">
            {saves.length === 0 && (
              <div className="text-center py-10">
                <div className="font-display text-sm tracking-[0.24em] text-[var(--cs-ink)]">NO SAVED SHIFTS</div>
                <div className="text-xs text-[var(--cs-dim)] mt-1.5">Save from the pause menu during a run.</div>
              </div>
            )}
            {saves.map((s) => {
              const num = s.auto ? 'A' : String(++slot).padStart(2, '0');
              return (
                <div key={s.id} className="group flex flex-col sm:flex-row sm:items-center gap-3 py-3.5 border-b border-[var(--cs-line-soft)] hover:bg-[rgba(217,180,90,0.04)] transition-colors">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`w-11 h-11 shrink-0 flex items-center justify-center font-display font-bold text-sm border ${s.auto ? 'border-[rgba(127,233,245,0.4)] text-[var(--cs-cyan)]' : 'border-[var(--cs-line)] text-[var(--cs-gold)]'}`}>{num}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3">
                        <span className="font-display font-bold tracking-wide text-[var(--cs-ink-hi)] truncate">{s.auto ? 'Autosave' : s.name}</span>
                        <span className="text-[11px] text-[var(--cs-dim)] whitespace-nowrap">{ago(s.date)}</span>
                      </div>
                      <div className="text-xs text-[var(--cs-dim)] tabular-nums leading-snug mt-0.5">
                        <span className="text-[var(--cs-ink)]">{s.levelName ?? 'Blackwood Manor'}</span> · {formatShift(s.time)} · {s.score.toLocaleString()} pts · {s.coins} coins · {s.roomsCleared}/{s.roomsTotal ?? 10} rooms · {Math.round(s.overall * 100)}% clean
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap sm:justify-end pl-[60px] sm:pl-0">
                    {inRun
                      ? <ConfirmButton label="Load" confirm="Replace run?" onConfirm={() => onLoad(s.id)} />
                      : <Button variant="primary" className="cs-btn-sm" onClick={() => onLoad(s.id)}>Load</Button>}
                    {mode === 'save' && !s.auto && <ConfirmButton label="Overwrite" confirm="Sure?" onConfirm={() => doSave(s.id)} />}
                    <ConfirmButton label="Delete" confirm="Delete?" onConfirm={() => { deleteSave(s.id); refresh(); }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button onClick={onClose}><Icon name="back" className="w-3.5 h-3.5" />Back</Button>
            {saves.length > 0 && (
              <ConfirmButton label="Delete all" confirm="Delete ALL saves?" onConfirm={() => { deleteAllSaves(); refresh(); setMsg(null); }} />
            )}
          </div>
        </Frame>
      </div>
    </div>
  );
}
