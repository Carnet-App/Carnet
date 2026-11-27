import { toMin, walkMin, distM, NIGHT_ENDS } from './util.js';

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
// hop(from, to, item): the way to get there, { minutes, mode, … } (walking if not given).
export function buildDay({ items, day, home, now, places, minGap = 45, hop }) {
  const list = items
    .filter((i) => i.day === day && i.start_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const loose = items.filter((i) => i.day === day && !i.start_time);
  const rows = [];
  const isToday = now && now.day === day;
  let cursor = Math.max(9 * 60, isToday ? now.min : 0);
  let prevLoc = home;
  let prevName = home?.name ? home.name : 'where you’re staying';
  let prevItem = null;
  // Last night's plans that run on into this morning come first, and the morning's free time starts
  // after them. Ones over by 05:00 belong to last night (see tripNow) and aren't repeated here.
  const yday = prevDay(day);
  for (const it of items.filter((i) => i.day === yday && i.start_time).map((i) => ({ i, s: span(i) })).filter(({ s }) => s.end > DAY + NIGHT_ENDS)
    .sort((a, b) => a.s.start - b.s.start)) {
    rows.push({ kind: 'item', item: it.i, start: it.s.start - DAY, end: it.s.end - DAY, fromYesterday: true });
    cursor = Math.max(cursor, it.s.end - DAY);
  }
  // A plan made from a place in the guide can sit where that place is pinned.
  const placeById = new Map((places || []).map((p) => [p.id, p]));
  for (const it of list) {
    const { start, end } = span(it);
    const pl = it.place_id ? placeById.get(it.place_id) : null;
    const loc = it.lat != null ? { lat: it.lat, lng: it.lng } : pl?.lat != null ? { lat: pl.lat, lng: pl.lng } : null;
    const way = hop && prevLoc && loc ? hop(prevLoc, loc, it) : null;
    const travel = way?.minutes ?? walkMin(prevLoc, loc);
    const freeEnd = start - (travel || 0);
    if (freeEnd - cursor >= minGap) rows.push({ ...gapRow(cursor, freeEnd, prevLoc || loc, places, items), before: prevLoc && { ...prevLoc, name: prevName }, after: loc && { ...loc, name: it.title }, prev: prevItem });
    if (rows.length && travel) rows.push({ kind: 'travel', minutes: travel, to: it, way, from: prevLoc, toLoc: loc });
    rows.push({ kind: 'item', item: it, start, end });
    cursor = Math.max(cursor, end);
    // Where you'll be next is this plan's spot. A plan with no spot on the map leaves that
    // unknown, rather than suggesting places near something earlier in the day.
    prevLoc = loc; prevName = it.title; prevItem = it;
  }
  // Free time to the end of the evening, unless the night is already taken up past midnight.
  if (DAY - cursor >= 120) rows.push({ ...gapRow(cursor, DAY, prevLoc, places, items, true), before: prevLoc && { ...prevLoc, name: prevName }, after: null, prev: prevItem });
  return { rows, loose };
}

function gapRow(from, to, near, places, items, open = false) {
  // Places already on a day — as the pick or as a backup — aren't suggested again. Ideas with no
  // day yet are exactly what free time should suggest.
  const used = new Set(items.flatMap((i) => [i.day ? i.place_id : null, ...(Array.isArray(i.alternatives) ? i.alternatives.map((a) => a.place_id) : [])]).filter(Boolean));
  const ideas = (places || [])
    .filter((p) => !used.has(p.id) && p.lat != null)
    .map((p) => ({ p, d: distM(near, p) }))
    .filter((x) => x.d == null || x.d < 2500)
    .sort((a, b) => (a.d ?? 9e9) - (b.d ?? 9e9))
    .slice(0, 3)
    .map((x) => ({ ...x.p, walk: walkMin(near, x.p) }));
  return { kind: 'gap', from, to, minutes: to - from, ideas, near, open };
}
