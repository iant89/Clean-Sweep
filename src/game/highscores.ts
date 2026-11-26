import { DEV_MODE } from './devmode';

export interface ScoreEntry {
  name: string;
  score: number;
  rooms: number;
  reason: 'dawn' | 'battery';
  date: number;
}
const KEY = 'cleansweep_scores_v1';
const MAX = 10;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ScoreEntry[];
    return Array.isArray(arr) ? arr.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function qualifies(score: number) {
  if (DEV_MODE || score <= 0) return false;
  const s = loadScores();
  return s.length < MAX || score > s[s.length - 1].score;
}

export function addScore(e: ScoreEntry): number {
  if (DEV_MODE) return -1; // cheated runs never reach the table
  const s = loadScores();
  s.push(e);
  s.sort((a, b) => b.score - a.score);
  const trimmed = s.slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
  return trimmed.indexOf(e);
}

export function lastName() {
  try { return localStorage.getItem('cleansweep_name') || ''; } catch { return ''; }
}
export function saveName(n: string) {
  try { localStorage.setItem('cleansweep_name', n); } catch { /* ignore */ }
}
