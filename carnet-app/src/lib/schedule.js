import { toMin, walkMin, distM } from './util.js';

const DAY = 24 * 60;
const prevDay = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA'); };
// An item's span in minutes from its own day's midnight. An end earlier than the start ("23:45 until
// 01:00") is the next morning: 1425 to 1500. With no end, 90 minutes is assumed.
export function span(it) {
  const start = toMin(it.start_time);
  let end = it.end_time ? toMin(it.end_time) : start + 90;
  if (end <= start) end += DAY;
  return { start, end, overnight: end > DAY };
}

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
  // Last night's plans that run past midnight into this morning come first, and the morning's
  // free time starts after them.
  const yday = prevDay(day);
  for (const it of items.filter((i) => i.day === yday && i.start_time).map((i) => ({ i, s: span(i) })).filter(({ s }) => s.end > DAY)
    .sort((a, b) => a.s.start - b.s.start)) {
    rows.push({ kind: 'item', item: it.i, start: it.s.start - DAY, end: it.s.end - DAY, fromYesterday: true });
    cursor = Math.max(cursor, it.s.end - DAY);
  }
  for (const it of list) {
    const { start, end } = span(it);
    const loc = it.lat != null ? { lat: it.lat, lng: it.lng } : null;
    const travel = walkMin(prevLoc, loc);
    const freeEnd = start - (travel || 0);
    if (freeEnd - cursor >= minGap) rows.push(gapRow(cursor, freeEnd, prevLoc, places, items));
    if (rows.length && travel) rows.push({ kind: 'travel', minutes: travel, to: it });
    rows.push({ kind: 'item', item: it, start, end });
    cursor = Math.max(cursor, end);
    if (loc) prevLoc = loc;
  }
  // Free time to the end of the evening, unless the night is already taken up past midnight.
  if (DAY - cursor >= 120) rows.push(gapRow(cursor, DAY, prevLoc, places, items, true));
  return { rows, loose };
}

function gapRow(from, to, near, places, items, open = false) {
  // Places already on the plan — as the pick or as a backup — aren't suggested again.
  const used = new Set(items.flatMap((i) => [i.place_id, ...(Array.isArray(i.alternatives) ? i.alternatives.map((a) => a.place_id) : [])]).filter(Boolean));
  const ideas = (places || [])
    .filter((p) => !used.has(p.id) && p.lat != null)
    .map((p) => ({ p, d: distM(near, p) }))
    .filter((x) => x.d == null || x.d < 2500)
    .sort((a, b) => (a.d ?? 9e9) - (b.d ?? 9e9))
    .slice(0, 3)
    .map((x) => ({ ...x.p, walk: walkMin(near, x.p) }));
  return { kind: 'gap', from, to, minutes: to - from, ideas, near, open };
}
