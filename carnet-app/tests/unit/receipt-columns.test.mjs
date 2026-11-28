import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt } from '../../src/lib/receipt.js';

// Invented receipts in the same layouts as real ones; no real receipt text is kept in the repo.
const shifted = [
  'CAFE DU COIN', '2 Rue Exemple', '75011 Paris', 'Table 12', 'NOTE PROVISOIRE',
  '14.00', '11.50',
  '1.00 Spritz Maison  9.00',
  '1.00 Negroni  6.50',
  '1.00 Croque Monsieur  1.00 Café Crème',
  '41.00', 'Total  41.00', 'A payer',
].join('\n');

test('prices printed as their own column are paired with the names in order, when they add up', () => {
  const r = parseReceipt(shifted);
  assert.equal(r.matchesTotal, true);
  assert.deepEqual(r.lines.map((l) => [l.name, l.price]), [['Spritz Maison', 14], ['Negroni', 11.5], ['Croque Monsieur', 9], ['Café Crème', 6.5]]);
  assert.ok(!r.lines.some((l) => /provisoire/i.test(l.name)));
});

test('"1.00 Name 12.00" is one of a name, not €12 as 12 × €1', () => {
  const r = parseReceipt(['1.00 Spritz Maison 9.00', '2.00 Negroni 13.00', 'Total 22.00'].join('\n'));
  assert.deepEqual(r.lines.map((l) => [l.name, l.price, l.quantity]), [['Spritz Maison', 9, 1], ['Negroni', 13, 2]]);
  assert.equal(r.matchesTotal, true);
});

test('nothing is paired when no run of prices adds up to the total', () => {
  const r = parseReceipt(shifted.replace('Total  41.00', 'Total  44.00'));
  assert.equal(r.matchesTotal, false);
  assert.ok(!r.lines.some((l) => l.columns));
});
