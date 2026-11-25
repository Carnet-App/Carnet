import { nameMatch } from './match.js';
import { useEffect, useState } from 'react';
import { authHeader } from './supabase';

export const CATS = {
  explore: { label: 'Explore', color: '#2F6B57', bg: '#E3F1EA' },
  eat: { label: 'Eat', color: '#A8472A', bg: '#F7E9E3' },
  drink: { label: 'Drink', color: '#8E3A5C', bg: '#F6E6EC' },
  dance: { label: 'Dance', color: '#5A4FB0', bg: '#ECEAFA' },
  coffee: { label: 'Coffee', color: '#8A5A14', bg: '#F6EAD3' },
  culture: { label: 'Culture', color: '#2E5C8A', bg: '#E4ECF5' },
  other: { label: 'Other', color: '#6F665B', bg: '#EDE9E2' },
};
export const cat = (c) => CATS[c] || CATS.other;

// Map tags from OpenStreetMap / Google to our categories: an exact tag wins outright.
const TAG_CAT = {
  nightclub: 'dance', night_club: 'dance', dance: 'dance',
  bar: 'drink', pub: 'drink', biergarten: 'drink', wine_bar: 'drink', brewery: 'drink', cocktail_bar: 'drink', wine: 'drink',
  cafe: 'coffee', coffee: 'coffee', coffee_shop: 'coffee', bakery: 'coffee', pastry: 'coffee', tea: 'coffee',
  restaurant: 'eat', fast_food: 'eat', food_court: 'eat', ice_cream: 'eat', meal_takeaway: 'eat', meal_delivery: 'eat', deli: 'eat',
  museum: 'culture', gallery: 'culture', art_gallery: 'culture', arts_centre: 'culture', theatre: 'culture', cinema: 'culture',
  movie_theater: 'culture', concert_hall: 'culture', library: 'culture',
  attraction: 'explore', tourist_attraction: 'explore', viewpoint: 'explore', park: 'explore', garden: 'explore', marketplace: 'explore',
};
// Words and phrases from the text, matched as whole words ("travel" is not "rave", "public" is not
// "pub", "Clubcard" is not "club"), each with a weight; the highest total wins.
const CAT_WORDS = {
  dance: [['nightclub', 3], ['night club', 3], ['club', 2], ['techno', 2], ['rave', 2], ['dancefloor', 2], ['dj', 1], ['house music', 2], ['party', 1]],
  drink: [['bar', 2], ['wine bar', 3], ['pub', 2], ['natural wine', 2], ['cocktail', 2], ['cocktails', 2], ['biergarten', 3], ['brewery', 2], ['taproom', 2], ['cave', 1], ['wine', 1], ['drinks', 1]],
  coffee: [['coffee', 2], ['café', 2], ['cafe', 2], ['bakery', 2], ['boulangerie', 2], ['patisserie', 2], ['pâtisserie', 2], ['espresso', 2], ['brunch', 1]],
  eat: [['restaurant', 3], ['bistro', 2], ['bistrot', 2], ['bistrosteria', 2], ['brasserie', 2], ['trattoria', 2], ['osteria', 2], ['food', 1], ['dinner', 1], ['dinners', 1], ['lunch', 1], ['pizza', 2], ['ramen', 2], ['tapas', 2], ['dishes', 1], ['chefs', 1], ['menu', 1], ['seafood', 2], ['small plates', 2], ['steak', 1]],
  culture: [['museum', 3], ['gallery', 2], ['galerie', 2], ['theatre', 2], ['théâtre', 2], ['cinema', 2], ['cinéma', 2], ['exhibition', 2], ['expo', 2], ['art', 1], ['concert', 2], ['opera', 2], ['opéra', 2]],
};
const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
const CAT_RES = Object.fromEntries(Object.entries(CAT_WORDS).map(([c, ws]) => [c, ws.map(([w, n]) => [wordRe(w), n])]));
export function categoryScores(text = '') {
  const out = {};
  for (const [c, ws] of Object.entries(CAT_RES)) for (const [re, n] of ws) if (re.test(text)) out[c] = (out[c] || 0) + n;
  return out;
}
export function guessCategory(tag = '', text = '') {
  const t = String(tag || '').toLowerCase();
  if (TAG_CAT[t]) return TAG_CAT[t];
  const scores = categoryScores(`${tag || ''} ${text || ''}`);
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'explore';
}

// ── Dates & times ─────────────────────────────────────────────────────
export const todayISO = () => new Date().toLocaleDateString('en-CA');
export function daysBetween(start, end) {
  if (!start) return [];
  const out = [];
  const d = new Date(start + 'T12:00:00');
  const e = new Date((end || start) + 'T12:00:00');
  while (d <= e && out.length < 60) {
    out.push(d.toLocaleDateString('en-CA'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
export const dayLabel = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts) : '';
export const toMin = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
export const fromMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
export const hm = (t) => (t ? t.slice(0, 5) : '');
export const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
export const money = (n, c = 'EUR') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: c }).format(+n || 0);

// ── Geography ─────────────────────────────────────────────────────────
export function distM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Streets aren't straight lines: ×1.3, at 4.8 km/h. Works with no signal.
export const walkMin = (a, b) => {
  const d = distM(a, b);
  return d == null ? null : Math.max(1, Math.round((d * 1.3) / 80));
};

export function useLocation() {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return pos;
}

// Current home base for a trip on a given day.
export function stayFor(stays, day) {
  const list = stays.filter((s) => s.lat != null);
  return (
    list.find((s) => (!s.from_date || s.from_date <= day) && (!s.to_date || s.to_date >= day)) || list[0] || null
  );
}

// ── API helpers ───────────────────────────────────────────────────────
export async function api(path, params = {}, auth = false) {
  const u = new URL(path, location.origin);
  Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
  const r = await fetch(u, { headers: auth ? await authHeader() : {} });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

// Venue lookup: OpenStreetMap first, Google only as a last resort.
// Map search. OpenStreetMap only, unless a person asked for Google (a tap, never during import).
// opts.google: also ask Google when no OSM result is a good match (every result is judged).
// opts.fillNames: give nameless results (a house, a street) their address as a name, for pickers
// where an address is a fine answer (a stay); they're marked addressOnly.
export async function findVenue(q, near, typeHint, opts = {}) {
  const p = { q, lat: near?.lat, lng: near?.lng };
  let res = [];
  try { res = (await api('/api/geo', p)).results || []; } catch {}
  const name = opts.name || q;
  const best = Math.max(0, ...res.map((r) => nameMatch(name, r.name, { city: opts.city })));
  if (opts.google && best < 0.9) {
    try {
      const g = (await api('/api/google', { ...p, q: typeHint ? `${q} ${typeHint}` : q }, true)).results || [];
      res = [...g, ...res];
    } catch {}
  }
  if (opts.fillNames) res = res.map((r) => (r.name ? r : { ...r, name: r.address || q, addressOnly: true }));
  return res;
}

export function norm(s = '') {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(le|la|les|the|bar|cafe|restaurant)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
// Kept for older callers: the conservative name matcher (no substring bonus, city words ignored).
export const similarity = (a, b) => nameMatch(a, b);

export const nameOf = (members, email) =>
  members.find((m) => m.email?.toLowerCase() === email?.toLowerCase())?.name || (email || '?').split('@')[0];
