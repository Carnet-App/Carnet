// Filling in what places are like (cuisine, price, opening hours) for places already saved, once
// each, on the phone of the person who added them (only they can change a place). Free sources
// first: the place's own notes ("PRICES €16 to €35"), then the map's tags at its pin. Google only
// for what's still missing, for places Google has already matched, within the server's cap.
import { api } from './util.js';
import { nameMatch } from './match.js';
import { priceFrom, cuisineFrom, parseOsmHours, fromGoogleHours } from './facts.js';

const FOODISH = new Set(['eat', 'drink', 'coffee']);
export const GOOGLE_PER_DAY = 20; // per phone; the server caps everyone too

// Google's id for a place: kept since fix-9, or inside the photo link from before that.
export function googleIdOf(p) {
  if (p.google_id) return p.google_id;
  const m = (p.photo_url || '').match(/\/api\/gphoto\?id=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// What a place still lacks.
export function lacks(p) {
  const food = FOODISH.has(p.category);
  return { hours: !p.hours?.periods?.length, cuisine: food && !p.cuisine, price: food && !p.price_level };
}
const anyOf = (l) => l.hours || l.cuisine || l.price;

// From the map's named things at the pin, the one with this place's name.
export function fromOsm(p, list) {
  const best = (list || []).map((o) => ({ o, s: nameMatch(p.name, o.name) })).filter((x) => x.s >= 0.85).sort((a, b) => b.s - a.s)[0]?.o;
  if (!best) return null;
  const out = {};
  const h = parseOsmHours(best.hours);
  if (h) out.hours = h;
  const c = cuisineFrom(best.cuisine);
  if (c) out.cuisine = c;
  if (best.website) out.link = best.website;
  return Object.keys(out).length ? out : null;
}

const KEY = 'carnet.facts';
const today = () => new Date().toLocaleDateString('en-CA');
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const keep = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

let running = false;
export async function factsFill(places, { myId, save, osm, google, pause = 300, max = 40 } = {}) {
  if (running || !myId) return null;
  const st = load();
  if (st.day !== today()) { st.day = today(); st.g = 0; }
  st.tried = st.tried || {};
  const todo = places.filter((p) => p.name && p.owner === myId && anyOf(lacks(p)) && st.tried[p.id] !== p.name).slice(0, max);
  if (!todo.length) return null;
  running = true;
  const askOsm = osm || ((p) => api('/api/osmfacts', { lat: p.lat.toFixed(5), lng: p.lng.toFixed(5) }).then((d) => d.places || []));
  const askGoogle = google || ((id) => api('/api/gfacts', { id }, true));
  const done = { filled: 0, google: 0, stopped: null };
  try {
    for (const p of todo) {
      const need = lacks(p);
      const fields = {};
      const src = { ...(p.facts_src || {}) };
      // 1. The place's own notes.
      if (need.price) { const pr = priceFrom(p.notes || ''); if (pr) { Object.assign(fields, pr); src.price = 'notes'; } }
      // 2. The map, at its pin.
      if (p.lat != null && (need.hours || need.cuisine)) {
        const o = fromOsm(p, await askOsm(p).catch(() => []));
        if (o?.hours && need.hours) { fields.hours = o.hours; src.hours = 'osm'; }
        if (o?.cuisine && need.cuisine) { fields.cuisine = o.cuisine; src.cuisine = 'osm'; }
        if (o?.link && !p.link) fields.link = o.link;
        if (pause) await new Promise((r) => setTimeout(r, pause));
      }
      // 3. Google, for hours or price still missing, if it has matched the place already.
      const gid = googleIdOf(p);
      const still = { hours: need.hours && !fields.hours, price: need.price && !fields.price_level };
      if (gid && (still.hours || still.price) && done.stopped !== 'google') {
        if (st.g >= GOOGLE_PER_DAY) done.stopped = 'google';
        else {
          try {
            const g = await askGoogle(gid);
            st.g++; done.google++;
            const h = fromGoogleHours(g.hours);
            if (h && still.hours) { fields.hours = h; src.hours = 'google'; }
            if (g.price_level && still.price) { fields.price_level = g.price_level; src.price = 'google'; }
          } catch (e) {
            if (/limit|429|no google key|404/.test(String(e?.message))) done.stopped = 'google';
          }
        }
      }
      if (gid && !p.google_id) fields.google_id = gid;
      if (Object.keys(fields).length) {
        save(p.id, { ...fields, facts_src: { ...src, at: new Date().toISOString() } });
        done.filled++;
      }
      // Tried: unless Google was only skipped for today's cap, and Google is what it still needs.
      if (!(done.stopped === 'google' && gid && (still.hours || still.price))) st.tried[p.id] = p.name;
      keep(st);
    }
  } finally { running = false; keep(st); }
  return done;
}
