// Who owes whom. Pure functions, easy to test.
const r2 = (n) => Math.round(n * 100) / 100;

// net[email] > 0 → is owed money; < 0 → owes.
export function balances(expenses, settlements = []) {
  const net = {};
  const add = (e, v) => (net[e.toLowerCase()] = (net[e.toLowerCase()] || 0) + v);
  for (const x of expenses) {
    add(x.payer_email, +x.amount);
    for (const [e, v] of Object.entries(x.shares || {})) add(e, -v);
  }
  for (const s of settlements) {
    add(s.from_email, +s.amount);
    add(s.to_email, -s.amount);
  }
  for (const k in net) net[k] = r2(net[k]);
  return net;
}

// Fewest transfers: people who are down pay people who are up, largest first.
export function simplify(net) {
  const cr = Object.entries(net).filter(([, v]) => v > 0.004).map(([e, v]) => ({ e, v })).sort((a, b) => b.v - a.v);
  const db = Object.entries(net).filter(([, v]) => v < -0.004).map(([e, v]) => ({ e, v: -v })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < db.length && j < cr.length) {
    const m = Math.min(db[i].v, cr[j].v);
    if (m > 0.004) out.push({ from: db[i].e, to: cr[j].e, amount: r2(m) });
    db[i].v -= m; cr[j].v -= m;
    if (db[i].v < 0.005) i++;
    if (cr[j].v < 0.005) j++;
  }
  return out;
}

// Cost by cost, netted pair by pair (what "Simplify off" shows).
export function pairwise(expenses, settlements = []) {
  const owe = {};
  const add = (a, b, v) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return;
    const k = a < b ? a + '|' + b : b + '|' + a;
    owe[k] = (owe[k] || 0) + (a < b ? v : -v); // positive: first owes second
  };
  for (const x of expenses) for (const [e, v] of Object.entries(x.shares || {})) add(e, x.payer_email, +v);
  for (const s of settlements) add(s.from_email, s.to_email, -s.amount);
  return Object.entries(owe)
    .filter(([, v]) => Math.abs(v) > 0.004)
    .map(([k, v]) => {
      const [a, b] = k.split('|');
      return v > 0 ? { from: a, to: b, amount: r2(v) } : { from: b, to: a, amount: r2(-v) };
    });
}

// Split an amount evenly in cents, so shares always add up exactly.
export function evenShares(amount, emails) {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / emails.length);
  let rem = cents - base * emails.length;
  return Object.fromEntries(emails.map((e) => [e, (base + (rem-- > 0 ? 1 : 0)) / 100]));
}

// Per-item split with an optional tip shared in proportion; rounding fixed on the payer.
export function itemShares(lines, tipPct = 0, payer) {
  const s = {};
  for (const l of lines) {
    if (!l.who?.length) continue;
    const part = evenShares(l.price, l.who);
    for (const [e, v] of Object.entries(part)) s[e] = (s[e] || 0) + v;
  }
  const sub = Object.values(s).reduce((a, b) => a + b, 0);
  const total = r2(sub * (1 + tipPct / 100));
  for (const e in s) s[e] = r2(s[e] * (1 + tipPct / 100));
  const diff = r2(total - Object.values(s).reduce((a, b) => a + b, 0));
  const fix = payer && s[payer] != null ? payer : Object.keys(s)[0];
  if (fix && diff) s[fix] = r2(s[fix] + diff);
  return { shares: s, total };
}
