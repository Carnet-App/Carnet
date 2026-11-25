import test from 'node:test';
import assert from 'node:assert/strict';
import { balances, simplify, evenShares, itemShares, pairwise } from '../../src/lib/money.js';

const cents = (o) => Object.values(o).reduce((a, b) => a + Math.round(b * 100), 0);
const rnd = (n) => Math.floor(Math.random() * n);

test('even split always adds up to the amount, to the penny', () => {
  for (let i = 0; i < 2000; i++) {
    const amount = rnd(100000) / 100 + 0.01;
    const people = Array.from({ length: 1 + rnd(9) }, (_, k) => `p${k}@x`);
    assert.equal(cents(evenShares(amount, people)), Math.round(amount * 100));
  }
});

test('itemised split with a tip adds up to its own total', () => {
  for (let i = 0; i < 1000; i++) {
    const people = ['a@x', 'b@x', 'c@x'];
    const lines = Array.from({ length: 1 + rnd(8) }, () => ({ price: (1 + rnd(5000)) / 100, who: people.filter(() => Math.random() < 0.7) }))
      .filter((l) => l.who.length);
    if (!lines.length) continue;
    const { shares, total } = itemShares(lines, [0, 5, 10, 12.5][rnd(4)], 'a@x');
    assert.equal(cents(shares), Math.round(total * 100));
  }
});

test('balances net to zero and simplified transfers settle everyone', () => {
  const ex = [
    { payer_email: 'a@x', amount: 90, shares: { 'a@x': 30, 'b@x': 30, 'c@x': 30 } },
    { payer_email: 'b@x', amount: 12.5, shares: { 'a@x': 6.25, 'b@x': 6.25 } },
  ];
  const net = balances(ex);
  assert.equal(Math.round(Object.values(net).reduce((a, b) => a + b, 0) * 100), 0);
  const after = { ...net };
  for (const t of simplify(net)) { after[t.from] += t.amount; after[t.to] -= t.amount; }
  for (const v of Object.values(after)) assert.ok(Math.abs(v) < 0.01);
  assert.ok(pairwise(ex).length >= 1);
});

test('F5: different currencies are never added together', { todo: 'F5 — balances() ignores currency (fix: per-currency ledger, phase 2)' }, () => {
  const net = balances([
    { payer_email: 'a@x', amount: 10, currency: 'EUR', shares: { 'b@x': 10 } },
    { payer_email: 'b@x', amount: 10, currency: 'GBP', shares: { 'a@x': 10 } },
  ]);
  // Today this nets to zero: €10 owed one way cancels £10 the other.
  assert.notDeepEqual(net, { 'a@x': 0, 'b@x': 0 });
});

test('F7: custom shares that do not add up are refused', { todo: 'F7 — CostSheet accepts shares within 0.01 and stores them unchanged (phase 2 client, phase 5 server)' }, () => {
  // Mirrors CostSheet's acceptance rule (Money.jsx, commit 991ed65): |sum - amount| < 0.01.
  const amount = 10, shares = { 'a@x': 3.33, 'b@x': 3.33, 'c@x': 3.33 };
  const accepted = Math.abs(Object.values(shares).reduce((a, b) => a + b, 0) - amount) < 0.01;
  assert.equal(accepted && cents(shares) !== Math.round(amount * 100), false, 'a 1p gap is accepted and stored');
});
