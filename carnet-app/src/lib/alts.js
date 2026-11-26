// Backups for a slot: a meal, a drink or a coffee can keep a ranked list of other places to go
// instead ("2nd choice", "3rd"). They sit on the main plan and take no time on the schedule.
export const FOOD_DRINK = new Set(['eat', 'drink', 'coffee']);
export const MAX_ALTS = 5;
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];
export const rankLabel = (i) => ORD[i + 2] || `${i + 2}th`; // index 0 in the list is the 2nd choice

const entry = (p, by) => ({ place_id: p.place_id ?? p.id ?? null, title: p.title || p.name, category: p.category, lat: p.lat ?? null, lng: p.lng ?? null, address: p.address || null, by: by || null });
const same = (a, b) => (a.place_id && a.place_id === b.place_id) || (a.title || '').toLowerCase() === (b.title || '').toLowerCase();

export function altsOf(item) { return Array.isArray(item?.alternatives) ? item.alternatives : []; }

// Add a place as the next backup. No duplicates, not the main pick itself, at most MAX_ALTS.
export function withAlt(item, place, by) {
  const e = entry(place, by);
  const list = altsOf(item);
  if (same(e, { place_id: item.place_id, title: item.title }) || list.some((a) => same(a, e)) || list.length >= MAX_ALTS) return null;
  return { alternatives: [...list, e] };
}

// Swap a backup in: it becomes the plan, and the old pick goes to the top of the backups.
export function swapIn(item, i) {
  const list = altsOf(item);
  const a = list[i];
  if (!a) return null;
  const old = entry({ place_id: item.place_id, title: item.title, category: item.category, lat: item.lat, lng: item.lng, address: item.address });
  return { place_id: a.place_id, title: a.title, category: a.category || item.category, lat: a.lat, lng: a.lng, address: a.address, alternatives: [old, ...list.filter((_, j) => j !== i)] };
}

export function withoutAlt(item, i) {
  const list = altsOf(item).filter((_, j) => j !== i);
  return { alternatives: list.length ? list : null };
}

// Which plan (and rank) a place is a backup for: place_id → { item, rank }.
export function backupIndex(items) {
  const m = new Map();
  for (const it of items || []) altsOf(it).forEach((a, i) => a.place_id && !m.has(a.place_id) && m.set(a.place_id, { item: it, rank: rankLabel(i) }));
  return m;
}
