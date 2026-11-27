// Suggestions for free time: bars, restaurants and cafés near what you've just been doing,
// from OpenStreetMap (via /api/nearby). Ones already in your guide, or that you've waved away,
// are left out. Results are kept for a day per spot, so the day view doesn't refetch on every look.
import { api, norm, distM, walkMin } from './util.js';

// What to suggest for free time starting at a given minute of the day (null: nothing).
export function kindFor(minute) {
  const h = minute / 60;
  if (h >= 7 && h < 11) return 'coffee';
  if (h >= 11.5 && h < 14.5) return 'eat';
  if (h >= 14.5 && h < 17.5) return 'coffee';
  if (h >= 17.5 && h < 19) return 'drink';
  if (h >= 19 && h < 21.5) return 'eat';
  if (h >= 21.5 || h < 3) return 'drink';
  return null;
}
export const KIND_WORDS = { eat: 'Somewhere to eat', drink: 'For a drink', coffee: 'For a coffee' };

// What a day's food and drink plans already cover: breakfast (a coffee, or eating before 11),
// lunch (eating 11:00–16:30) and dinner (eating from 17:30).
export function mealsOn(items = []) {
  const out = { breakfast: false, lunch: false, dinner: false };
  for (const i of items) {
    if (!i.start_time) continue;
    const [h, m] = i.start_time.split(':').map(Number);
    const t = h * 60 + (m || 0);
    if (i.category === 'coffee' && t < 16 * 60) out.breakfast = true;
    if (i.category === 'eat') {
      if (t < 11 * 60) out.breakfast = true;
      else if (t <= 16.5 * 60) out.lunch = true;
      else if (t >= 17.5 * 60) out.dinner = true;
    }
  }
  return out;
}

// What to suggest for free time starting at `minute`, given the rest of the day: lunch if there's
// been a coffee but no lunch yet, not a second brunch; dinner if none is planned; otherwise a drink.
export function kindForDay(minute, dayItems = [], prev = null) {
  const h = (minute % 1440) / 60;
  const done = mealsOn(dayItems);
  if (h >= 3 && h < 7) return null;
  if (h >= 7 && h < 11) return done.breakfast && !done.lunch && h >= 10.5 ? 'eat' : done.breakfast ? null : 'coffee';
  if (h >= 11 && h < 16) return !done.lunch ? 'eat' : prev === 'coffee' ? null : 'coffee';
  if (h >= 16 && h < 18) {
    if (!done.lunch && h < 16.5) return 'eat';
    if (h >= 17 || prev === 'coffee') return 'drink';
    return 'coffee';
  }
  if (h >= 18 && h < 22) return !done.dinner ? 'eat' : 'drink';
  return 'drink';
}

// The heading for a suggestion: "For lunch", "For a late lunch", "For dinner"…
export function kindWords(kind, minute) {
  const h = (minute % 1440) / 60;
  if (kind === 'eat') return h < 11 ? 'For breakfast' : h < 14.5 ? 'For lunch' : h < 17.5 ? 'For a late lunch' : 'For dinner';
  return KIND_WORDS[kind] || 'Somewhere';
}

const DAY = 864e5;
const memo = new Map();
const keyOf = (near, kind) => `${kind}:${near.lat.toFixed(3)},${near.lng.toFixed(3)}`;
const read = (k) => { try { const v = JSON.parse(localStorage.getItem('carnet.nearby.' + k)); return v && Date.now() - v.at < DAY ? v.places : null; } catch { return null; } };
const write = (k, places) => { try { localStorage.setItem('carnet.nearby.' + k, JSON.stringify({ at: Date.now(), places })); } catch {} };

export async function fetchNearby(near, kind) {
  const k = keyOf(near, kind);
  if (memo.has(k)) return memo.get(k);
  const kept = read(k);
  if (kept) { memo.set(k, kept); return kept; }
  const p = api('/api/nearby', { lat: near.lat.toFixed(5), lng: near.lng.toFixed(5), kind, r: 700 })
    .then((r) => { const places = r.places || []; if (places.length) write(k, places); return places; })
    .catch(() => { memo.delete(k); return []; });
  memo.set(k, p);
  return p;
}

// "Not for me": hidden from suggestions on this phone.
const DISMISSED = 'carnet.nearby.dismissed';
export const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(DISMISSED) || '[]')); } catch { return new Set(); } };
export const dismiss = (osm) => { const s = dismissed(); s.add(osm); try { localStorage.setItem(DISMISSED, JSON.stringify([...s].slice(-500))); } catch {} };

// Leave out what's already in the guide (same name, or within 40 m) and what's been waved away.
export function fresh(list, guide, gone = dismissed()) {
  const names = new Set((guide || []).map((p) => norm(p.name)).filter(Boolean));
  return (list || []).filter((s) => !gone.has(s.osm) && !names.has(norm(s.name)) && !(guide || []).some((p) => p.lat != null && distM(p, s) < 40));
}

export const catOf = (s) => (s.amenity === 'cafe' ? 'coffee' : s.amenity === 'restaurant' ? 'eat' : 'drink');

// From your own list: saved places near a spot (an activity on the plan), for what suits the time.
// Not ones already on the plan (as the pick or a backup). Eat/drink/coffee first, the kind that
// fits the time highest, then nearest. Each comes with its walk in minutes.
const FOOD = new Set(['eat', 'drink', 'coffee']);
// Places on a day (or a day's backups) are left out; ideas with no day yet are fair game.
export function fromYourList(places, items, at, { kind = null, max = 3, maxWalk = 15, foodOnly = true } = {}) {
  if (!at || at.lat == null) return [];
  const used = new Set((items || []).flatMap((i) => [i.day ? i.place_id : null, ...(Array.isArray(i.alternatives) ? i.alternatives.map((a) => a.place_id) : [])]).filter(Boolean));
  return (places || [])
    .filter((p) => p.lat != null && !used.has(p.id) && (!foodOnly || FOOD.has(p.category)))
    .map((p) => ({ ...p, walk: walkMin(at, p) }))
    .filter((p) => p.walk <= maxWalk)
    .map((p) => ({ p, s: (kind && p.category === kind ? 30 : 0) + (FOOD.has(p.category) ? 5 : 0) - p.walk }))
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.p);
}
