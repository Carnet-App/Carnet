import test from 'node:test';
import assert from 'node:assert/strict';
import { balances, simplify, evenShares, itemShares, pairwise, ledgers } from '../../src/lib/money.js';
import { allocate, evenMinor, sharesValid, splitItems, toMinor } from '../../src/lib/minor.js';

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

test('F5: different currencies are never added together', () => {
  const ex = [
    { payer_email: 'a@x', amount: 10, currency: 'EUR', shares: { 'b@x': 10 } },
    { payer_email: 'b@x', amount: 10, currency: 'GBP', shares: { 'a@x': 10 } },
  ];
  const ls = ledgers(ex, [{ from_email: 'b@x', to_email: 'a@x', amount: 10 }], 'EUR');
  const by = Object.fromEntries(ls.map((l) => [l.currency, l.net]));
  // €10 owed one way and £10 the other: two debts, not zero. The payment with no currency is the trip's (EUR).
  assert.deepEqual(by.EUR, { 'a@x': 0, 'b@x': 0 });
  assert.deepEqual(by.GBP, { 'b@x': 10, 'a@x': -10 });
  assert.equal(ls[0].currency, 'EUR', "the trip's currency comes first");
});

test('F7: custom shares that do not add up are refused', () => {
  assert.equal(sharesValid(1000, { 'a@x': 333, 'b@x': 333, 'c@x': 333 }), false, 'a 1p gap is refused');
  assert.equal(sharesValid(1000, { 'a@x': 334, 'b@x': 333, 'c@x': 333 }), true);
  assert.equal(sharesValid(1000, { 'a@x': 1001, 'b@x': -1 }), false, 'no negative shares');
});

test('largest remainder: parts are whole, add up exactly and are stable', () => {
  for (let i = 0; i < 2000; i++) {
    const total = 1 + rnd(1000000);
    const w = Object.fromEntries(Array.from({ length: 1 + rnd(8) }, (_, k) => [`p${k}`, 1 + rnd(1000)]));
    const a = allocate(total, w);
    assert.equal(Object.values(a).reduce((x, y) => x + y, 0), total);
    assert.ok(Object.values(a).every(Number.isInteger));
    assert.deepEqual(allocate(total, w), a);
    // No part is off from its exact share by a whole unit or more.
    const sum = Object.values(w).reduce((x, y) => x + y, 0);
    for (const k in w) assert.ok(Math.abs(a[k] - (total * w[k]) / sum) < 1);
  }
});

test('minor units respect each currency', () => {
  assert.equal(toMinor('12,50', 'EUR'), 1250);
  assert.equal(toMinor(1.005, 'GBP'), 101);
  assert.equal(toMinor(1500, 'JPY'), 1500);
  assert.equal(toMinor(0.1 + 0.2, 'EUR'), 30);
  assert.deepEqual(evenMinor(1000, ['a', 'b', 'c']), { a: 334, b: 333, c: 333 });
});

test('itemised split with a printed service line and a tip adds up', () => {
  for (let i = 0; i < 1000; i++) {
    const people = ['a@x', 'b@x', 'c@x'];
    const lines = Array.from({ length: 1 + rnd(8) }, () => ({ minor: 1 + rnd(5000), who: people.filter(() => Math.random() < 0.7) })).filter((l) => l.who.length);
    if (!lines.length) continue;
    const r = splitItems(lines, [{ kind: 'service', minor: rnd(2000) }], [0, 5, 10, 12.5][rnd(4)]);
    assert.equal(Object.values(r.shares).reduce((x, y) => x + y, 0), r.total);
  }
});
