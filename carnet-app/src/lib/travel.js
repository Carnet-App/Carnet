// Getting between plans: on foot, or by Métro/RER when that's faster. Walking is worked out on the
// phone; transport comes from the server (Paris for now) and is kept on the phone, so each hop is
// asked once. The day reads what's known straight away and fills in as answers arrive.
import { useEffect, useSyncExternalStore } from 'react';
import { api, walkMin } from './util.js';

export const TRANSIT_FROM = 16; // walks shorter than this: just walk
const BETTER_BY = 5; // transport has to save at least this many minutes to be offered first
export const hasTransit = (city) => /paris|île-de-france|ile-de-france/i.test(city || '');

const r3 = (n) => n.toFixed(3);
export const hopKey = (a, b, at) => `${r3(a.lat)},${r3(a.lng)}>${r3(b.lat)},${r3(b.lng)}@${at || 'now'}`;

// ── Cache: in memory, and on the phone for a day ──
const KEY = 'carnet.travel';
const DAY = 864e5;
let cache = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
let version = 0;
const subs = new Set();
const bump = () => { version++; subs.forEach((f) => f()); };
function remember(k, v) {
  cache[k] = { ...v, t: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 300) for (const old of keys.sort((x, y) => cache[x].t - cache[y].t).slice(0, keys.length - 300)) delete cache[old];
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  bump();
}
export const useTravelVersion = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => version);
export const known = (a, b, at) => { const v = a && b ? cache[hopKey(a, b, at)] : null; return v && Date.now() - v.t < DAY ? v : null; };

const asking = new Set();
// Ask for a hop once (in the background); known() has it when it's back.
export function ensureHop(a, b, { at, arrive } = {}) {
  if (!a || !b || !navigator.onLine) return;
  const k = hopKey(a, b, at);
  if (known(a, b, at) || asking.has(k)) return;
  asking.add(k);
  api('/api/transit', { from: `${a.lat},${a.lng}`, to: `${b.lat},${b.lng}`, at, arrive: arrive ? 1 : undefined }, true)
    .then((r) => remember(k, r))
    .catch(() => remember(k, { none: true }))
    .finally(() => asking.delete(k));
}

// The way to go: { mode: 'walk' | 'transit', minutes, walk, lines, depart }.
export function bestHop(a, b, at) {
  const walk = walkMin(a, b);
  if (walk == null) return null;
  const tr = walk >= TRANSIT_FROM ? known(a, b, at) : null;
  if (tr && !tr.none && tr.minutes && tr.minutes + BETTER_BY <= walk) return { mode: 'transit', minutes: tr.minutes, walk, lines: tr.lines || [], depart: tr.depart || null };
  return { mode: 'walk', minutes: walk, walk };
}

// "Métro 9", "RER B + Métro 4": line names as people say them.
export const linesText = (lines = []) => lines.map((l) => l.replace(/^Metro\b/i, 'Métro').replace(/^RapidTransit\b/i, 'RER').replace(/^Bus\b/i, 'Bus')).join(' + ') || 'transport';

// For a single hop shown somewhere (the place sheet): walk now, transport once it's back.
export function useHop(a, b, { enabled = true, at, arrive } = {}) {
  useTravelVersion();
  const walk = walkMin(a, b);
  const want = enabled && walk != null && walk >= TRANSIT_FROM;
  const k = a && b ? hopKey(a, b, at) : null;
  useEffect(() => { if (want) ensureHop(a, b, { at, arrive }); }, [k, want]);
  return a && b ? bestHop(a, b, at) : null;
}

// "20261127T1400" from a day and "14:00", for planning to arrive by a plan's start.
export const atOf = (day, time) => (day && time ? `${day.replace(/-/g, '')}T${time.slice(0, 2)}${time.slice(3, 5)}` : undefined);
