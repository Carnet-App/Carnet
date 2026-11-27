// What a place is like: cuisine, price and opening hours, for filters, "Best now" and the place
// sheet. Read from what was captured (a Google Maps card's type line, a guide's PRICES row, the
// notes), from OpenStreetMap's tags, or from Google, and kept on the place.

// ── Price ──────────────────────────────────────────────────────────────
// "€16 to €35", "€10–20", "16-35 €", "££", "$$$": a range in the text and a level from 1 to 4.
const SYM = '[€£$]';
export function priceFrom(text = '') {
  const t = String(text);
  const range = t.match(new RegExp(`${SYM}\\s?(\\d{1,3})\\s*(?:to|à|-|–|—)\\s*${SYM}?\\s?(\\d{1,3})(?!\\d)`, 'i'))
    || t.match(new RegExp(`(?<![\\d.,])(\\d{1,3})\\s*(?:to|à|-|–|—)\\s*(\\d{1,3})\\s?${SYM}`, 'i'));
  const sym = (t.match(new RegExp(SYM)) || ['€'])[0];
  if (range) {
    const lo = +range[1], hi = +range[2];
    if (hi >= lo && hi > 0 && hi < 1000) return { price_text: `${sym}${lo}–${hi}`, price_level: levelFor(hi) };
  }
  const signs = t.match(new RegExp(`(?:^|[\\s·•-])(${SYM}{1,4})(?=\\s|$|·)`));
  if (signs) return { price_text: null, price_level: signs[1].length };
  return null;
}
// What one person spends, top of the range: ≤ 15 cheap, ≤ 35 mid, ≤ 70 dear, above that very.
export const levelFor = (hi) => (hi <= 15 ? 1 : hi <= 35 ? 2 : hi <= 70 ? 3 : 4);
export const priceSigns = (p) => (p?.price_level ? '€'.repeat(p.price_level) : '');

// ── Cuisine ────────────────────────────────────────────────────────────
// From a type line ("Nepalese restaurant", "Cocktail bar", "Natural wine bar") or an OSM cuisine
// tag ("nepalese;indian"): the part that says what kind of food or drink, tidied for a filter chip.
const GENERIC = /\b(restaurant|restaurants|resto|place|spot|eatery|food|establishment|shop)\b/gi;
const DEMONYM = { nepalese: 'Nepali', french: 'French', italian: 'Italian', japanese: 'Japanese', chinese: 'Chinese', korean: 'Korean', thai: 'Thai', vietnamese: 'Vietnamese', indian: 'Indian', lebanese: 'Lebanese', mexican: 'Mexican', spanish: 'Spanish', greek: 'Greek', turkish: 'Turkish', moroccan: 'Moroccan', american: 'American', british: 'British', peruvian: 'Peruvian', ethiopian: 'Ethiopian', georgian: 'Georgian', israeli: 'Israeli', 'middle eastern': 'Middle Eastern', mediterranean: 'Mediterranean', seafood: 'Seafood', vegan: 'Vegan', vegetarian: 'Vegetarian', pizza: 'Pizza', burger: 'Burgers', ramen: 'Ramen', sushi: 'Sushi', bistro: 'Bistro', brasserie: 'Brasserie', bakery: 'Bakery', coffee_shop: 'Coffee', 'wine bar': 'Wine bar', 'natural wine bar': 'Natural wine', 'cocktail bar': 'Cocktails', pub: 'Pub', brunch: 'Brunch', breakfast: 'Brunch', crepe: 'Crêpes', tapas: 'Tapas', dumpling: 'Dumplings', noodle: 'Noodles' };
export function cuisineFrom(s = '') {
  if (!s) return null;
  const parts = String(s).toLowerCase().split(/[;,/]|\s+&\s+/).map((x) => x.replace(/_/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const hit = DEMONYM[p] || DEMONYM[p.replace(GENERIC, '').trim()] || Object.entries(DEMONYM).find(([k]) => new RegExp(`\\b${k}\\b`).test(p))?.[1];
    const plain = p.replace(GENERIC, '').replace(/\s+/g, ' ').trim();
    const word = hit || (plain && plain.length <= 20 && !/\d/.test(plain) ? plain[0].toUpperCase() + plain.slice(1) : null);
    if (word && !out.includes(word)) out.push(word);
  }
  return out.length ? out.slice(0, 2).join(', ') : null;
}

// From a screenshot's text: a Google Maps card's type line ("Nepalese restaurant · €20–30") or a
// guide page's rows ("PRICES €16 to €35", "CRAVINGS Momos, thukpa").
export function placeFacts(text = '') {
  const L = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  const out = {};
  const typeLine = L.find((l) => /^[\p{L} &'’-]{3,40}\s*[·•]\s*(?:[€£$]|\d)/u.test(l));
  if (typeLine) {
    const [kind, money] = typeLine.split(/\s*[·•]\s*/);
    const c = cuisineFrom(kind);
    if (c) out.cuisine = c;
    const p = priceFrom(money || '');
    if (p) Object.assign(out, p);
  }
  const pi = L.findIndex((l) => /^prices?\b/i.test(l));
  if (pi >= 0 && !out.price_level) {
    const p = priceFrom(L[pi].replace(/^prices?\s*:?\s*/i, '') || L[pi + 1] || '') || priceFrom(L[pi + 1] || '');
    if (p) Object.assign(out, p);
  }
  return Object.keys(out).length ? out : null;
}

// ── Opening hours ──────────────────────────────────────────────────────
// Kept as { periods: [[day, open, close]], text }, day 0 = Monday, minutes from midnight; a close
// past midnight is more than 1440 ("19:00-02:00" → [d, 1140, 1560]).
const DAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
// OpenStreetMap's opening_hours, in the common forms: "Mo-Fr 12:00-14:30,19:00-23:00; Sa 19:00-24:00;
// Su off", "24/7", "Tu-Su 10:00-18:00". Anything fancier (holidays, weeks, months) is left out:
// better no hours than wrong ones.
export function parseOsmHours(s) {
  if (!s || typeof s !== 'string') return null;
  const src = s.trim();
  if (/^24\/7$/.test(src)) return { periods: DAYS.map((_, d) => [d, 0, 1440]), text: '24/7' };
  // Public holidays are ignored ("PH off"); anything seasonal can't be read safely.
  if (/\b(SH|week|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|easter|sunrise|sunset)\b/i.test(src)) return null;
  const periods = [];
  for (const rule0 of src.split(/\s*;\s*/)) {
    const rule = rule0.replace(/\bPH\s+off\b/i, '').replace(/,?\s*PH\b/i, '').trim();
    if (!rule) continue;
    const m = rule.match(/^((?:[A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?\s*,?\s*)+)?\s*(off|closed|(?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\+?\s*,?\s*)+)$/i);
    if (!m) return null;
    const days = new Set();
    if (m[1]) {
      for (const part of m[1].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
        const [a, b] = part.split(/\s*-\s*/);
        const i = DAYS.indexOf(a), j = b ? DAYS.indexOf(b) : i;
        if (i < 0 || j < 0) return null;
        for (let d = i; ; d = (d + 1) % 7) { days.add(d); if (d === j) break; }
      }
    } else DAYS.forEach((_, d) => days.add(d));
    // A later rule for the same days replaces an earlier one.
    for (let k = periods.length - 1; k >= 0; k--) if (days.has(periods[k][0])) periods.splice(k, 1);
    if (/^(off|closed)$/i.test(m[2])) continue;
    for (const span of m[2].split(',').map((x) => x.trim()).filter(Boolean)) {
      const [a, b] = span.replace('+', '').split(/\s*-\s*/);
      let open = toMin(a), close = toMin(b);
      if (close <= open) close += 1440;
      for (const d of days) periods.push([d, open, close]);
    }
  }
  periods.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return { periods, text: src };
}

// Google's regularOpeningHours.periods ({open:{day 0=Sun,hour,minute}, close:{…}}).
export function fromGoogleHours(g) {
  if (!g?.periods?.length) return null;
  const periods = [];
  for (const p of g.periods) {
    if (!p.open) continue;
    const d = (p.open.day + 6) % 7;
    const open = p.open.hour * 60 + (p.open.minute || 0);
    if (!p.close) { periods.push([d, 0, 1440]); continue; }
    let close = p.close.hour * 60 + (p.close.minute || 0);
    const cd = (p.close.day + 6) % 7;
    if (cd !== d || close <= open) close += 1440 * (((cd - d + 7) % 7) || 1);
    periods.push([d, open, close]);
  }
  return periods.length ? { periods: periods.sort((x, y) => x[0] - y[0] || x[1] - y[1]), text: (g.weekdayDescriptions || []).join('; ') || null } : null;
}

const hm = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// At a moment (a Date): open now (and until when), or when it next opens today. null when unknown.
export function openAt(hours, date = new Date()) {
  const ps = hours?.periods;
  if (!ps?.length) return null;
  const d = (date.getDay() + 6) % 7;
  const t = date.getHours() * 60 + date.getMinutes();
  // Today's spans, and last night's that run past midnight.
  const spans = [
    ...ps.filter((p) => p[0] === d).map((p) => [p[1], p[2]]),
    ...ps.filter((p) => p[0] === (d + 6) % 7 && p[2] > 1440).map((p) => [p[1] - 1440, p[2] - 1440]),
  ];
  const now = spans.find(([a, b]) => t >= a && t < b);
  if (now) return { open: true, until: now[1] >= 1440 ? (now[1] === 1440 ? '00:00' : hm(now[1])) : hm(now[1]), closesIn: now[1] - t };
  const later = spans.filter(([a]) => a > t).sort((x, y) => x[0] - y[0])[0];
  return { open: false, opens: later ? hm(later[0]) : null, opensIn: later ? later[0] - t : null, closedToday: !ps.some((p) => p[0] === d) };
}
// "Open till 23:00", "Opens 19:00", "Closed today": the one line a list row shows.
export function hoursLine(hours, date = new Date()) {
  const o = openAt(hours, date);
  if (!o) return null;
  if (o.open) return { text: o.closesIn <= 45 ? `Closes ${o.until}` : `Open till ${o.until}`, tone: o.closesIn <= 45 ? 'warn' : 'open' };
  if (o.opens) return { text: `Opens ${o.opens}`, tone: 'later' };
  return { text: o.closedToday ? 'Closed today' : 'Closed now', tone: 'closed' };
}
// Days it's shut all day, for the sheet: "Sun, Mon".
export function closedDays(hours) {
  if (!hours?.periods?.length) return null;
  const open = new Set(hours.periods.map((p) => p[0]));
  const shut = [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d)).map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]);
  return shut.length ? shut.join(', ') : null;
}
