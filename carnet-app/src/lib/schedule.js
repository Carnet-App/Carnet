import { toMin, walkMin, distM } from './util';

// Builds a day: items in order, travel between them, and the free gaps worth filling.
export function buildDay({ items, day, home, now, places, minGap = 45 }) {
  const list = items
    .filter((i) => i.day === day && i.start_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const loose = items.filter((i) => i.day === day && !i.start_time);
  const rows = [];
  const isToday = now && now.day === day;
  let cursor = Math.max(9 * 60, isToday ? now.min : 0);
  let prevLoc = home;
  for (const it of list) {
    const start = toMin(it.start_time);
    const end = it.end_time ? toMin(it.end_time) : start + 90;
    const loc = it.lat != null ? { lat: it.lat, lng: it.lng } : null;
    const travel = walkMin(prevLoc, loc);
    const freeEnd = start - (travel || 0);
    if (freeEnd - cursor >= minGap) rows.push(gapRow(cursor, freeEnd, prevLoc, places, items));
    if (rows.length && travel) rows.push({ kind: 'travel', minutes: travel, to: it });
    rows.push({ kind: 'item', item: it, start, end });
    cursor = Math.max(cursor, end);
    if (loc) prevLoc = loc;
  }
  if (24 * 60 - cursor >= 120) rows.push(gapRow(cursor, 24 * 60, prevLoc, places, items, true));
  return { rows, loose };
}

function gapRow(from, to, near, places, items, open = false) {
  const used = new Set(items.map((i) => i.place_id).filter(Boolean));
  const ideas = (places || [])
    .filter((p) => !used.has(p.id) && p.lat != null)
    .map((p) => ({ p, d: distM(near, p) }))
    .filter((x) => x.d == null || x.d < 2500)
    .sort((a, b) => (a.d ?? 9e9) - (b.d ?? 9e9))
    .slice(0, 3)
    .map((x) => ({ ...x.p, walk: walkMin(near, x.p) }));
  return { kind: 'gap', from, to, minutes: to - from, ideas, near, open };
}
