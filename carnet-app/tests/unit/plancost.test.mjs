import test from 'node:test';
import assert from 'node:assert/strict';
import { findPrice, costRow, costOf } from '../../src/lib/planCost.js';

test('the price on a ticket', () => {
  assert.deepEqual(findPrice('Tour Eiffel\n4 x Adulte 29,40 €\nTotal 117,60 €\nMerci'), { amount: 117.6, currency: 'EUR' });
  assert.deepEqual(findPrice('Montant TTC : 58.00 EUR'), { amount: 58, currency: 'EUR' });
  assert.deepEqual(findPrice('Seat 12\nPrice £45\nBooking fee £2.50'), { amount: 45, currency: 'GBP' });
  assert.deepEqual(findPrice('Entry 18 €\nGuide 12 €'), { amount: 18, currency: 'EUR' }, 'no total line: the largest');
  assert.equal(findPrice('Gate opens 19:30, row 4'), null);
});

test('a plan’s cost is one shared expense, linked to the plan', () => {
  const row = costRow({ itemId: 'i1', tripId: 't', title: 'Eiffel Tower', day: '2026-11-28', amount: '117.60', currency: 'EUR', payer: 'a', who: ['a', 'b', 'c', 'd'], newId: () => 'x1' });
  assert.equal(row.id, 'x1');
  assert.equal(row.receipt.item_id, 'i1');
  assert.equal(row.amount_minor, 11760);
  assert.deepEqual(Object.values(row.shares_minor), [2940, 2940, 2940, 2940]);
  assert.equal(costOf([row], 'i1'), row);
  const edit = costRow({ existing: row, itemId: 'i1', tripId: 't', title: 'Eiffel Tower', amount: '120', currency: 'EUR', payer: 'b', who: ['a', 'b'], newId: () => 'no' });
  assert.equal(edit.id, 'x1');
  assert.equal(edit.spent_on, '2026-11-28');
  assert.deepEqual(edit.shares_minor, { a: 6000, b: 6000 });
});
