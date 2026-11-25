// Is this map result the place we read? Conservative on purpose: a wrong automatic match is worse
// than asking. City and type words are ignored only while comparing, never removed from names.

const CITIES = new Set(['paris', 'london', 'berlin', 'barcelona', 'madrid', 'lisbon', 'lisboa', 'rome', 'roma', 'milan', 'milano',
  'amsterdam', 'brussels', 'bruxelles', 'copenhagen', 'kobenhavn', 'vienna', 'wien', 'prague', 'praha', 'new york', 'nyc', 'ldn', 'pdx', 'france', 'uk']);
// Words that say what a place is, not which one: they count for little on their own.
const GENERIC = new Set(['le', 'la', 'les', 'l', 'the', 'de', 'du', 'des', 'd', 'et', 'and', 'a', 'au', 'aux', 'of', 'el', 'il', 'da', 'di', 'del',
  'bar', 'cafe', 'restaurant', 'resto', 'bistro', 'bistrot', 'brasserie', 'chez', 'club', 'wine', 'cave', 'house', 'kitchen', 'official', 'shop', 'store', 'st', 'saint']);

export const fold = (s = '') => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const squashName = (s = '') => fold(s).replace(/ /g, '');
const tokens = (s, extraCity) => fold(s).split(' ').filter((t) => t && !CITIES.has(t) && t !== extraCity && t.length > 1);

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const close = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

// How much of one side's words the other side has, weighted by length. Generic words ("la",
// "cave", "bar") count for less, but still count: "Septime" isn't "Septime La Cave".
function coverage(from, to) {
  const distinctive = from.some((t) => !GENERIC.has(t));
  let got = 0, all = 0;
  for (const t of from) {
    const w = t.length * (distinctive && GENERIC.has(t) ? 0.3 : 1);
    const best = Math.max(0, ...to.map((u) => close(t, u)));
    got += w * (best >= 0.75 ? best : 0);
    all += w;
  }
  // Only generic words on this side ("Le Bar"): at most a weak match.
  return all ? (got / all) * (distinctive ? 1 : 0.5) : 0;
}
// "LAPERLE" and "Café La Perle": the same core once leading articles and type words go.
const LEAD = ['cafe', 'chez', 'bar', 'les', 'le', 'la', 'the', 'l'];
function core(sq) {
  let moved = true;
  while (moved) { moved = false; for (const x of LEAD) if (sq.startsWith(x) && sq.length - x.length >= 4) { sq = sq.slice(x.length); moved = true; break; } }
  return sq;
}

// 0–1. 1 is the same name; ≥ 0.9 is close enough to confirm on its own; < 0.6 isn't offered.
export function nameMatch(a, b, { city } = {}) {
  if (!a || !b) return 0;
  const c = city ? fold(city) : null;
  const A = tokens(a, c), B = tokens(b, c);
  if (!A.length || !B.length) return 0;
  const sa = A.join(''), sb = B.join('');
  if (sa === sb) return 1;
  // Same letters with the spaces in different places, or one misread letter
  // ("Bish rot Des Tournelles" / "Bistrot des Tournelles", "laperle" / "La Perle").
  const whole = Math.min(sa.length, sb.length) >= 8 ? close(sa, sb) : 0;
  const ca = coverage(A, B), cb = coverage(B, A);
  const both = ca + cb ? (2 * ca * cb) / (ca + cb) : 0;
  const same = core(sa) === core(sb) && core(sa).length >= 4 ? 0.92 : 0;
  return Math.round(Math.max(both, whole >= 0.85 ? whole : 0, same) * 100) / 100;
}

// Map results that can't be a venue: transport stops, streets, districts, plain buildings.
const NOT_A_PLACE = /^(station|halt|stop_position|platform|tram_stop|bus_stop|subway_entrance|train_station|transit_station|subway_station|bus_station|light_rail_station|railway_station|stop_area|residential|living_street|unclassified|primary|secondary|tertiary|trunk|motorway|service|footway|pedestrian|path|cycleway|steps|road|street|route|house|yes|building|apartments|detached|shed|garage|construction|city|town|village|hamlet|country|state|county|administrative|region|province|postcode|postal_code|suburb|neighbourhood|neighborhood|quarter|district|city_block|borough|locality|sublocality|political|island|river|stream)$/;
export const isPlace = (r) => !!r?.name && !NOT_A_PLACE.test(r.osm_value || '');

// "@lecornichon.paris" → "le cornichon", "cafecharlotparis" → "cafe charlot", "chezjeannette" → "chez jeannette".
const PREFIX = ['chez', 'cafe', 'caffe', 'bar', 'les', 'le', 'la', 'the', 'club', 'maison', 'bistrot', 'bistro', 'cave'];
const SUFFIX = ['paris', 'london', 'berlin', 'barcelona', 'official', 'restaurant', 'resto', 'bar', 'club', 'cafe'];
export function handleName(h = '') {
  let parts = String(h).replace(/^@/, '').toLowerCase().split(/[._\-]+/).filter(Boolean);
  // City or "official" at the end, whether separated ("lecarmen_paris") or not ("lamenagerieparis").
  const last = parts[parts.length - 1];
  if (parts.length > 1 && SUFFIX.includes(last) && last !== 'bar' && last !== 'club' && last !== 'cafe') parts.pop();
  else if (parts.length) for (const s of ['paris', 'london', 'berlin', 'official']) if (parts[parts.length - 1].endsWith(s) && parts[parts.length - 1].length > s.length + 3) { parts[parts.length - 1] = parts[parts.length - 1].slice(0, -s.length); break; }
  const out = [];
  for (let p of parts) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const x of PREFIX) if (p.startsWith(x) && p.length > x.length + 3) { out.push(x); p = p.slice(x.length); moved = true; break; }
    }
    out.push(p);
  }
  return out.join(' ');
}

// Score every result (not just the first), drop the ones that can't be the place, and decide
// whether the best is sure enough to tick without asking.
export function rankResults(name, results, { city, alts = [], squash } = {}) {
  const names = [name, ...alts].filter(Boolean);
  const scored = results
    .filter(isPlace)
    .map((r) => ({ ...r, sim: squash && squashName(r.name) === squash ? 1 : Math.max(...names.map((n) => nameMatch(n, r.name, { city }))) }))
    .filter((r) => r.sim >= 0.6)
    .sort((a, b) => b.sim - a.sim)
    // The same place listed twice by the map.
    .filter((r, i, a) => a.findIndex((x) => squashName(x.name) === squashName(r.name) && near(x, r, 60)) === i);
  const best = scored[0];
  // Several places with that name a distance apart (branches): ask which.
  const branches = best ? scored.filter((r) => r.sim >= best.sim - 0.03 && !near(r, best, 300)) : [];
  return { scored, best, branches: branches.length, sure: !!best && best.sim >= 0.9 && !branches.length };
}
function near(a, b, m) {
  if (a.lat == null || b.lat == null) return true;
  const R = 6371000, r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * R < m;
}
