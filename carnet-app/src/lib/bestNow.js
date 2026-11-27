// "Best now": the Places list ordered by what suits this moment, here. Food and drink go to the
// group for the next time of day they suit (lunch now, dinner and drinks later); a meal you've had
// or planned today drops down; sights sit under "Any time". Within a group: open now first, then
// what the crew wants, then the nearest. Places you've been drop to the bottom; ones you (or most
// of the crew) passed on are hidden until asked for.
import { openAt } from './facts.js';
import { mealsOn } from './nearby.js';

// When each kind of place suits, in minutes from midnight (past midnight runs on past 1440).
const WINDOWS = {
  coffee: [[7 * 60, 17 * 60, 'coffee']],
  eat: [[8 * 60, 11.5 * 60, 'brunch'], [11.5 * 60, 15.5 * 60, 'lunch'], [18.5 * 60, 22.5 * 60, 'dinner']],
  drink: [[17 * 60, 26 * 60, 'drinks']],
  dance: [[23 * 60, 30 * 60, 'dancing']],
};
const WORD = { coffee: 'Coffee', brunch: 'Brunch', lunch: 'Lunch', dinner: 'Dinner', drinks: 'Drinks', dancing: 'Dancing' };
const SOON = 45; // minutes: a window starting this soon counts as now

// The next window a place suits from `min` on, today: { meal, from, to, now }.
export function nextWindow(category, min, skip = new Set()) {
  const ws = (WINDOWS[category] || []).filter((w) => !skip.has(w[2]));
  if (WINDOWS[category] && !ws.length) return { meal: WINDOWS[category][0][2], sorted: true };
  if (!WINDOWS[category]) return null;
  // Past midnight, late windows that started yesterday are still on.
  for (const [a, b, meal] of ws) if (b > 1440 && min + 1440 < b && min + 1440 >= a) return { meal, from: a, to: b, now: true };
  for (const [a, b, meal] of ws) {
    if (min < b && min >= a - SOON) return { meal, from: a, to: b, now: true };
    if (min < a) return { meal, from: a, to: b, now: false };
  }
  return null;
}

// Meals already sorted today (had or planned), so their places stop rising.
export function doneToday(dayItems, min) {
  const m = mealsOn(dayItems);
  const had = new Set();
  if (m.breakfast) { had.add('coffee'); had.add('brunch'); }
  if (m.lunch) { had.add('lunch'); had.add('brunch'); }
  if (m.dinner) had.add('dinner');
  // Brunch is over once it's lunch time and lunch is done; coffee after lunch is still fair.
  if (m.lunch && min >= 14 * 60) had.delete('coffee');
  return had;
}

const voteOf = (list = [], me, mineOf) => {
  const mine = mineOf ? mineOf(list) : list.find((r) => r.email?.toLowerCase() === me);
  const up = list.filter((r) => r.vote > 0).length, down = list.filter((r) => r.vote < 0).length;
  return { mine, up, down, been: !!mine?.visited };
};

// places: with .walk (minutes, or null). ratings: Map place id → ratings. me: email.
// plannedToday: Set of place ids already on today's plan. date: now.
export function bestNow(places, { ratings = new Map(), me, mineOf, dayItems = [], plannedToday = new Set(), date = new Date(), showPassed = false } = {}) {
  const min = date.getHours() * 60 + date.getMinutes();
  const had = doneToday(dayItems, min);
  const groups = { now: [], later: [], any: [], done: [], been: [] };
  const strip = [];
  let passed = 0;
  for (const p of places) {
    const v = voteOf(ratings.get(p.id), me, mineOf);
    const down = (v.mine && v.mine.vote < 0) || (v.down > 0 && v.down > v.up && !(v.mine?.vote > 0));
    if (down && !showPassed) { passed++; continue; }
    const open = openAt(p.hours, date);
    // The next time it suits that isn't already sorted today: after brunch, lunch.
    const w0 = nextWindow(p.category, min);
    let w = w0 && had.has(w0.meal) ? nextWindow(p.category, min, had) : w0;
    // Shut for the rest of that window (Maiya opens at 19:00, so not lunch): the next one it's open for.
    const today = (date.getDay() + 6) % 7;
    const spans = p.hours?.periods?.filter((q) => q[0] === today);
    const openIn = (x) => !spans || spans.some(([, a, b]) => a < x.to && b > Math.max(min, x.from));
    for (let k = 0; w && !w.sorted && !openIn(w) && k < 3; k++) {
      const skip = new Set([...had, w.meal]);
      w = nextWindow(p.category, Math.max(min, w.to), skip);
      if (w) w = { ...w, now: w.from - SOON <= min };
    }
    if (w && !w.sorted && !openIn(w)) w = null;
    const row = { ...p, win: w?.sorted ? w0 : w, open, votes: v };
    // Score inside a group: open now, crew wants it, near.
    row.score = (open?.open ? 30 : open?.opens && open.opensIn <= 90 ? 15 : open ? -25 : 0) + v.up * 6 - v.down * 6 - (p.walk ?? 60) * 0.8;
    if (v.been || p.visited || down) { groups.been.push(row); continue; }
    if (!w) { (WINDOWS[p.category] ? groups.done : groups.any).push(row); continue; }
    if (w.sorted || had.has(w.meal)) { groups.done.push(row); continue; }
    (w.now ? groups.now : groups.later).push(row);
    // The strip: suits now, a short walk, open (or opening within the hour), not already on today.
    if (w.now && p.walk != null && p.walk <= 12 && !plannedToday.has(p.id) && (!open || open.open || (open.opens && open.opensIn <= 60))) strip.push(row);
  }
  // Drinks for later can show in the strip, behind what suits now, if they're very near.
  for (const r of groups.later) if (strip.length < 6 && r.walk != null && r.walk <= 8 && !plannedToday.has(r.id) && r.win.from - min <= 4 * 60) strip.push({ ...r, forLater: true });
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Later today goes in time order: drinks from 17:00 before dinner from 19:00.
  const startOf = (r) => Math.max(r.win.from, r.open?.opens ? +r.open.opens.slice(0, 2) * 60 + +r.open.opens.slice(3) : 0);
  groups.later.sort((a, b) => startOf(a) - startOf(b) || b.score - a.score);
  strip.sort((a, b) => (a.forLater ? 1 : 0) - (b.forLater ? 1 : 0) || b.score - a.score);

  const meals = (rows) => [...new Set(rows.map((r) => r.win?.meal).filter(Boolean))].map((m) => WORD[m]);
  const title = (rows, tail) => (rows.length ? `${joinWords(meals(rows))} · ${tail}` : '');
  return {
    strip: strip.slice(0, 6),
    passed,
    groups: [
      { key: 'now', title: title(groups.now, 'now'), rows: groups.now },
      { key: 'later', title: title(groups.later, 'later today'), rows: groups.later },
      { key: 'any', title: 'Any time · sights & more', rows: groups.any },
      { key: 'done', title: doneTitle(groups.done, had), rows: groups.done },
      { key: 'been', title: 'Been there', rows: groups.been },
    ].filter((g) => g.rows.length),
  };
}
// "Coffee · had one today", "Lunch · sorted today", or "Not needed right now" for a mix.
function doneTitle(rows, had) {
  const sorted = [...new Set(rows.map((r) => r.win?.meal).filter((m) => m && had.has(m)))];
  if (sorted.length === 1 && rows.every((r) => r.win?.meal === sorted[0])) return sorted[0] === 'coffee' ? 'Coffee · had one today' : `${WORD[sorted[0]]} · sorted today`;
  return 'Not needed right now';
}
const joinWords = (ws) => (ws.length <= 1 ? ws[0] || '' : `${ws.slice(0, -1).join(', ')} & ${ws[ws.length - 1].toLowerCase()}`);

// The tag a row or strip card shows for why it's there: "Lunch · now", "Dinner · from 18:30".
export function whyTag(row) {
  const w = row.win;
  if (!w) return null;
  const hhmm = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (row.forLater || !w.now) return `${WORD[w.meal]} · from ${hhmm(row.open?.opens ? Math.max(w.from, toM(row.open.opens)) : w.from)}`;
  return `${WORD[w.meal]} · now`;
}
const toM = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
