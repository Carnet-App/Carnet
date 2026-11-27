// Plans typed in by hand ("Eiffel Tower", "Opera Garnier Tickets") have no spot on the map, so the
// day can't say what's near them or how far the walk is. Look each one up once, by its title, and
// pin it only when the match is sure. The free map lookup goes first; Google only when it finds no
// sure match (and within the server's daily caps).
import { findVenue, distM } from './util.js';
import { nameMatch, isPlace } from './match.js';

const SURE = 0.85;
const FAR = 25000;
// Words about the booking rather than the place.
const NOISE = /\b(tickets?|billets?|entry|entrance|visit|tour|booking|booked|reservation|resa|show|concert|gig|trip|day|night|evening|morning|afternoon|lunch|dinner|breakfast|brunch|drinks?|coffee|at|@|w\/|with|and)\b/gi;
export const placeWords = (title = '') => title.replace(/\(.*?\)/g, ' ').replace(NOISE, ' ').replace(/[·•|–—-]+/g, ' ').replace(/\s+/g, ' ').trim();

// Google's first answer is trusted with a looser name match, since landmarks go by several names
// ("Opera Garnier" is "Palais Garnier" there); anything else needs a near-identical name.
export function pickSpot(name, results, { city, centre } = {}) {
  let best = null;
  const firstGoogle = (results || []).find((r) => r.source === 'google');
  for (const r of results || []) {
    if (r.lat == null || !isPlace(r)) continue;
    if (centre && distM(centre, r) > FAR) continue;
    const sim = nameMatch(name, r.name, { city });
    const ok = sim >= SURE || (r === firstGoogle && sim >= 0.5);
    if (ok && (!best || sim > best.sim)) best = { ...r, sim };
  }
  return best;
}

const KEY = 'carnet.locate';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const keep = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

let running = false;
export async function locatePlans(items, { places = [], city, centre, save, lookup, max = 25 } = {}) {
  if (running) return 0;
  const tried = load();
  const pinnedPlace = new Set(places.filter((p) => p.lat != null).map((p) => p.id));
  const todo = items.filter((i) => i.title && i.lat == null && !(i.place_id && pinnedPlace.has(i.place_id)) && i.visibility !== 'busy' && tried[i.id] !== i.title).slice(0, max);
  if (!todo.length) return 0;
  running = true;
  let n = 0;
  const find = lookup || ((q, name) => findVenue(q, centre, null, { google: true, name, city }));
  try {
    for (const it of todo) {
      const name = placeWords(it.title);
      tried[it.id] = it.title;
      if (name.length < 3) continue;
      const res = await find(`${name} ${city || ''}`.trim(), name).catch(() => []);
      const hit = pickSpot(name, res, { city, centre });
      if (hit) { save(it.id, { lat: hit.lat, lng: hit.lng, ...(it.address ? {} : { address: hit.address || null }) }); n++; }
      keep(tried);
    }
  } finally { running = false; keep(tried); }
  return n;
}
