// Money in whole minor units (cents, pence, yen), so shares always add up exactly.
// Digits match the database's currencies table (supabase/fix-3-money-stage1.sql).
export const DIGITS = {
  EUR: 2, GBP: 2, USD: 2, CHF: 2, DKK: 2, SEK: 2, NOK: 2, CZK: 2, PLN: 2,
  HUF: 2, ISK: 0, JPY: 0, KRW: 0, AUD: 2, CAD: 2, MAD: 2, TRY: 2,
};
export const digits = (cur) => DIGITS[String(cur || 'EUR').toUpperCase()] ?? 2;

// "12,50", "12.5", 12.5 → 1250 (EUR). Rounds half away from zero, safe from float drift.
export function toMinor(amount, cur = 'EUR') {
  if (amount == null || amount === '') return 0;
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(n)) return 0;
  const f = 10 ** digits(cur);
  return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-7);
}
export const fromMinor = (minor, cur = 'EUR') => (minor || 0) / 10 ** digits(cur);

// Largest-remainder allocation: split `total` minor units across weights. The parts are whole,
// never negative for non-negative inputs, and always add up to `total` exactly. Ties go to the
// earlier key (stable), so the same inputs always give the same answer.
export function allocate(total, weights) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const out = Object.fromEntries(Object.keys(weights).map((k) => [k, 0]));
  if (!keys.length || !total) return out;
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  const sign = Math.sign(total), abs = Math.abs(total);
  let given = 0;
  const rem = keys.map((k, i) => {
    const exact = (abs * weights[k]) / sum;
    const base = Math.floor(exact + 1e-9);
    out[k] = base;
    given += base;
    return { k, r: exact - base, i };
  });
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let j = 0; j < abs - given; j++) out[rem[j % rem.length].k] += 1;
  if (sign < 0) for (const k of keys) out[k] = -out[k];
  return out;
}

export const evenMinor = (total, people) => allocate(total, Object.fromEntries(people.map((p) => [p, 1])));

// Itemised split in minor units.
// lines:       [{ minor, who: [emails] }] — each line shared evenly by the people on it.
// adjustments: [{ kind: 'service' | 'discount' | ..., minor }] — printed on the bill, shared in
//              proportion to what each person had (a discount is negative).
// tipPct:      a tip on top, also in proportion.
// Returns { shares, subtotal, adjustments, tip, total }, all minor units; shares add up to total.
export function splitItems(lines, adjustments = [], tipPct = 0) {
  const had = {};
  for (const l of lines) {
    if (!l.who?.length || !l.minor) continue;
    for (const [e, v] of Object.entries(evenMinor(l.minor, l.who))) had[e] = (had[e] || 0) + v;
  }
  const subtotal = Object.values(had).reduce((a, b) => a + b, 0);
  const shares = { ...had };
  const weights = Object.fromEntries(Object.entries(had).filter(([, v]) => v > 0));
  const add = (amount) => { for (const [e, v] of Object.entries(allocate(amount, weights))) shares[e] = (shares[e] || 0) + v; };
  let adj = 0;
  for (const a of adjustments) if (a.minor) { add(a.minor); adj += a.minor; }
  const tip = Math.round(((subtotal + adj) * (tipPct || 0)) / 100);
  if (tip) add(tip);
  return { shares, subtotal, adjustments: adj, tip, total: subtotal + adj + tip };
}

// A split is valid only when every share is a whole, non-negative amount and they add up exactly.
export function sharesValid(totalMinor, sharesMinor) {
  const v = Object.values(sharesMinor || {});
  if (!v.length || !Number.isInteger(totalMinor) || totalMinor <= 0) return false;
  if (v.some((x) => !Number.isInteger(x) || x < 0)) return false;
  return v.reduce((a, b) => a + b, 0) === totalMinor;
}

// Fields every new or edited expense carries (schema_version 2), alongside the legacy decimal
// fields older app versions still read.
export function expenseFields({ amountMinor, sharesMinor, currency, kind = 'expense', adjustments = [], validation = 'manual' }) {
  const cur = String(currency || 'EUR').toUpperCase();
  const shares = Object.fromEntries(Object.entries(sharesMinor).filter(([, v]) => v).map(([e, v]) => [e, fromMinor(v, cur)]));
  return {
    schema_version: 2,
    currency: cur,
    amount: fromMinor(amountMinor, cur),
    amount_minor: amountMinor,
    shares,
    shares_minor: Object.fromEntries(Object.entries(sharesMinor).filter(([, v]) => v)),
    kind,
    adjustments,
    validation,
  };
}
