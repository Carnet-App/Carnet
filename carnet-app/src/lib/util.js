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

// Map tags from OpenStreetMap / Google to our categories.
export function guessCategory(tag = '', text = '') {
  const s = (tag + ' ' + text).toLowerCase();
  if (/nightclub|club|techno|rave|dance|party/.test(s)) return 'dance';
  if (/coffee|café|cafe|bakery|boulangerie|brunch/.test(s)) return 'coffee';
  if (/\bbar\b|pub|wine|cave|cocktail|biergarten|drink/.test(s)) return 'drink';
  if (/restaurant|bistro|brasserie|food|fast_food|\beat\b|dinner|lunch|pizza|ramen|tapas/.test(s)) return 'eat';
  if (/museum|gallery|galerie|theatre|théâtre|cinema|cinéma|cinémathèque|arts_centre|exhibition|expo|\bart\b|concert|opera|opéra/.test(s)) return 'culture';
  return 'explore';
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
export async function findVenue(q, near, typeHint) {
  const p = { q, lat: near?.lat, lng: near?.lng };
  let res = [];
  try { res = (await api('/api/geo', p)).results || []; } catch {}
  const best = res.length ? similarity(q, res[0].name) : 0;
  if (best < 0.7) {
    try {
      const g = (await api('/api/google', { ...p, q: typeHint ? `${q} ${typeHint}` : q }, true)).results || [];
      res = [...g, ...res];
    } catch {}
  }
  return res;
}

export function norm(s = '') {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(le|la|les|the|bar|cafe|restaurant)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const grams = (s) => new Set([...Array(Math.max(1, s.length - 1))].map((_, i) => s.slice(i, i + 2)));
  const A = grams(a), B = grams(b);
  let n = 0;
  A.forEach((g) => B.has(g) && n++);
  return (2 * n) / (A.size + B.size);
}

export const nameOf = (members, email) =>
  members.find((m) => m.email?.toLowerCase() === email?.toLowerCase())?.name || (email || '?').split('@')[0];
