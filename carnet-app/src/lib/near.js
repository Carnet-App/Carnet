// "Near…": what Places, the map and a plan's sheet measure from. You by default; or where you're
// staying, a plan ("Crazy Horse · Fri 21:00"), a place on your list, or an address. One anchor for
// the whole trip screen, so "See all near this" from a plan opens Places (and the map) on it.
import { useSyncExternalStore } from 'react';

let anchor = null;
const subs = new Set();
export function setNear(a) { anchor = a || null; subs.forEach((f) => f()); }
export const getNear = () => anchor;
export const useNear = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => anchor);

// Open Places near something (from a plan's sheet, the map…).
export function showNear(a) {
  setNear(a);
  window.dispatchEvent(new CustomEvent('carnet:go', { detail: { tab: 'places' } }));
}

// Where a plan is: its own spot, or the pin of the place it was made from.
export function planSpot(item, places = []) {
  if (item?.lat != null) return { lat: item.lat, lng: item.lng };
  const p = item?.place_id ? places.find((x) => x.id === item.place_id) : null;
  return p?.lat != null ? { lat: p.lat, lng: p.lng } : null;
}
const toMin = (s) => (s ? +s.slice(0, 2) * 60 + +s.slice(3, 5) : null);
export function planAnchor(item, places) {
  const spot = planSpot(item, places);
  return spot && { kind: 'plan', id: item.id, name: item.title, ...spot, day: item.day || null, start: toMin(item.start_time), category: item.category };
}
export const placeAnchor = (p) => p?.lat != null && { kind: 'place', id: p.id, name: p.name, lat: p.lat, lng: p.lng };

// The plans worth measuring from: today's and later ones with a spot, in order.
export function planAnchors(items, places, fromDay) {
  return (items || [])
    .filter((i) => i.day && i.day >= fromDay && i.start_time && i.visibility !== 'busy')
    .sort((a, b) => (a.day + a.start_time).localeCompare(b.day + b.start_time))
    .map((i) => planAnchor(i, places))
    .filter(Boolean);
}

// When anchored on a plan, "best now" means the time before it: a meal that ends in time to get
// there. A Date for that moment, on the plan's day.
export function beforeTime(a, mins = 120) {
  if (a?.kind !== 'plan' || !a.day || a.start == null) return null;
  const [y, m, d] = a.day.split('-').map(Number);
  return new Date(y, m - 1, d, 0, Math.max(0, a.start - mins));
}
