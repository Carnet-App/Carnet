// A one-off tidy-up with Google: finish places that have no pin (or that nobody was sure of),
// and give a picture to places that have none. Each phone only touches the places its
// person added (the database only lets owners change a place), so nobody does the work twice.
// A place is tried once per phone; changing its name lets it be tried again.
import { api, distM, guessCategory } from './util.js';
import { nameMatch, isPlace } from './match.js';

export const PER_DAY = 60; // Google searches one phone may spend on this in a day (the server caps everyone too)
const SURE = 0.85; // name match needed to accept Google's answer without asking
const PHOTO_NEAR = 250; // metres: for a photo, Google's place must be where our pin is
const FAR = 25000; // metres from the trip's middle: further than this is another city's namesake

const unfinished = (p) => !!p.needs_check || p.lat == null || !p.address;
const noPhoto = (p) => !p.photo_url && !p.photo_path;
export const wants = (p) => unfinished(p) || noPhoto(p);

// What to change on a place, given Google's results; null when none is sure enough.
export function pickGoogle(p, results, { city, centre } = {}) {
  const pinned = p.lat != null && !p.needs_check;
  let best = null;
  for (const r of results || []) {
    if (r.lat == null || !isPlace(r)) continue;
    const sim = nameMatch(p.name, r.name, { city });
    if (sim < SURE) continue;
    const here = pinned ? distM(p, r) : null;
    if (pinned && here > PHOTO_NEAR) continue;
    if (!pinned && centre && distM(centre, r) > FAR) continue;
    if (!best || sim > best.sim || (sim === best.sim && here != null && here < best.here)) best = { ...r, sim, here };
  }
  if (!best) return null;
  const out = {};
  if (!pinned) { out.lat = best.lat; out.lng = best.lng; out.needs_check = false; }
  if (!p.address && best.address) out.address = best.address;
  if (!p.category && best.osm_value) out.category = guessCategory(best.osm_value, best.name);
  if (noPhoto(p) && best.google_id) out.photo_url = `/api/gphoto?id=${encodeURIComponent(best.google_id)}`;
  return Object.keys(out).length ? out : null;
}

// ── Remembering what's been tried, and today's spend, on this phone ──
const KEY = 'carnet.gfill';
const today = () => new Date().toLocaleDateString('en-CA');
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function keep(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
const sig = (p) => `${p.name}|${p.lat == null ? '' : 'pin'}|${p.photo_url || p.photo_path ? 'pic' : ''}`;

// ── The latest result, for the Places screen ──
let report = null;
const subs = new Set();
const tell = (r) => { report = r; subs.forEach((f) => f(r)); };
export const lastReport = () => report;
export function onReport(f) { subs.add(f); return () => subs.delete(f); }

let running = false;
// places: everything in the trip's city; save(id, fields) writes a change.
export async function googleFill(places, { myId, city, centre, save, fetchResults } = {}) {
  if (running || !myId) return null;
  const state = load();
  if (state.day !== today()) { state.day = today(); state.spent = 0; }
  state.tried = state.tried || {};
  const todo = places.filter((p) => p.name && p.owner === myId && wants(p) && state.tried[p.id] !== sig(p));
  if (!todo.length) return null;
  running = true;
  const ask = fetchResults || ((q, near) => api('/api/google', { q, lat: near?.lat, lng: near?.lng }, true).then((d) => d.results || []));
  const r = { tried: 0, pinned: 0, photos: 0, left: 0, stopped: null, of: todo.length };
  tell({ ...r, running: true });
  try {
    for (const p of todo) {
      if (state.spent >= PER_DAY) { r.stopped = 'day'; break; }
      const near = p.lat != null ? { lat: p.lat, lng: p.lng } : centre;
      let res;
      try {
        res = await ask(`${p.name} ${city || ''}`.trim(), near);
      } catch (e) {
        // The server's cap (or no key): stop, and try the rest another day.
        r.stopped = /limit|429/.test(String(e?.message)) ? 'limit' : /no google key|404/.test(String(e?.message)) ? 'off' : 'error';
        break;
      }
      state.spent++; r.tried++;
      const fields = pickGoogle(p, res, { city, centre });
      if (fields) {
        save(p.id, fields);
        if (fields.lat != null) r.pinned++;
        if (fields.photo_url) r.photos++;
      }
      state.tried[p.id] = sig({ ...p, ...fields });
      keep(state);
      tell({ ...r, running: true });
    }
  } finally {
    running = false;
    keep(state);
  }
  r.left = todo.length - r.tried;
  tell({ ...r, running: false });
  return r;
}
