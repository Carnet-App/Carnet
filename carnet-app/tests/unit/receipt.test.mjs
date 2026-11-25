import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, splitInputs } from '../../src/lib/receipt.js';
import { itemShares } from '../../src/lib/money.js';

test('a clean Tesco-style receipt: items and total', () => {
  const r = parseReceipt(`TESCO\n2 Tesco Mini Danish Pastries £4.50\n£2.25 each\n1 Tesco Maple And Pecan Plait 2 £2.10\n1 Tesco All Butter Croissant 2 £2.10\n1 Tesco Cinnamon Swirls 2 Pack £2.10\nTOTAL: £10.80\nCard £10.80`);
  assert.deepEqual(r.lines.map((l) => l.price), [4.5, 2.1, 2.1, 2.1]);
  assert.equal(r.total, 10.8);
  assert.equal(r.matchesTotal, true);
});

test('a lost decimal point after the currency sign ("£6 50")', () => {
  assert.equal(parseReceipt('1 x Elderflower Fizz £6 50').lines[0].price, 6.5);
});

test('"TOTAL:" with the amount on the next line', () => {
  assert.equal(parseReceipt('1 Latte 3.60\nTOTAL:\n£3.60').total, 3.6);
});

test('F2: a receipt with no printed total is not reported as reconciled', () => {
  const r = parseReceipt('1 Latte 3.60\n1 Croissant 2.10');
  assert.notEqual(r.matchesTotal, true);
});

test('F1: a printed service charge survives into the split', () => {
  const r = parseReceipt('1 Steak 24.00\n1 Wine 8.00\nService 4.00\nTOTAL 36.00');
  assert.equal(r.validation, 'reconciled');
  const { lines, adjustments, tipPct } = splitInputs(r);
  const { total } = itemShares(lines.map((l) => ({ price: l.price, who: ['a@x', 'b@x'] })), tipPct, null, 'GBP', adjustments);
  assert.equal(Math.round(total * 100), 3600);
});

test('a printed service percentage with no service line becomes the tip', () => {
  const r = parseReceipt('1 Steak 24.00\n1 Wine 8.00\nService 12.5%\nTOTAL 36.00');
  assert.equal(splitInputs(r).tipPct, 12.5);
  assert.equal(r.validation, 'reconciled');
});

test('a printed total that does not match is a difference, not reconciled', () => {
  const r = parseReceipt('1 Steak 24.00\n1 Wine 8.00\nTOTAL 40.00');
  assert.equal(r.validation, 'difference');
});

test('quantities are kept as separate fields, not folded into the name', { todo: 'Phase 4 — quantity, unit price and line total as distinct fields' }, () => {
  const l = parseReceipt('3 Tesco All Butter Croissant £6.45\n£2.15 each').lines[0];
  assert.equal(l.quantity, 3);
  assert.equal(l.unitPrice, 2.15);
});
