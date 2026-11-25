// Scoring helpers. Normalisation is stated per metric:
//  - names: accents and punctuation KEPT for character error rate (venue names), case folded
//  - matching a proposed place to a labelled one: accents and punctuation removed, case folded
export function editDistance(a, b) {
  a = Array.from(a); b = Array.from(b);
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
export const fold = (s) => s.normalize('NFC').toLowerCase();
export const loose = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Best character error rate of an expected string against any same-length-ish window of the OCR text.
export function bestCER(expected, text) {
  const e = fold(expected);
  const lines = fold(text).split('\n');
  let best = 1;
  for (const l of lines) {
    if (!l) continue;
    for (let len = Math.max(1, e.length - 3); len <= e.length + 3; len++)
      for (let i = 0; i + len <= Math.max(l.length, len); i++) {
        const w = l.slice(i, i + len);
        best = Math.min(best, editDistance(e, w) / e.length);
        if (best === 0) return 0;
      }
  }
  return Math.min(1, best);
}

// A proposed place matches a labelled one when their loose forms are within 20% edit distance.
export function matchPlace(proposed, label) {
  const p = loose(proposed).replace(/ /g, '');
  for (const n of [label.name, ...(label.aliases || [])]) {
    const l = loose(n).replace(/ /g, '');
    if (!l) continue;
    if (p === l) return 'exact';
    if (editDistance(p, l) / l.length <= 0.2) return 'close';
  }
  return null;
}

// Wilson 95% interval for a proportion.
export function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// Multiset recall of amounts in pence.
export function amountRecall(expected, found) {
  const pool = found.map((x) => Math.round(x * 100));
  let hit = 0;
  for (const e of expected) { const i = pool.indexOf(Math.round(e * 100)); if (i >= 0) { hit++; pool.splice(i, 1); } }
  return { hit, n: expected.length, extra: pool.length };
}
