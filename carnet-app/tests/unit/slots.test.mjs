import test from 'node:test';
import assert from 'node:assert/strict';
import { freeSlot, partSummary, lengthFor } from '../../src/lib/slots.js';

const day = '2026-11-28';
const items = [
  { id: 'a', title: 'Musée Picasso', day, start_time: '11:30', end_time: '13:00', status: 'planned' },
  { id: 'b', title: 'Brunch', day, start_time: '09:00', end_time: '10:15', status: 'planned' },
  { id: 'c', title: 'Crazy Horse', day, start_time: '23:45', end_time: '01:00', status: 'booked' },
  { id: 'd', title: 'Other day', day: '2026-11-29', start_time: '09:00', status: 'planned' },
];

test('first free time in a part of the day, after what is planned', () => {
  // Brunch until 10:15, then 15 min to get there → 10:30; a 45-min coffee fits before 11:30.
  assert.deepEqual(freeSlot(items, day, 'morning', lengthFor('coffee')), { time: '10:30', fits: true });
  // A 90-min stop doesn't fit before 11:30, so it goes after the museum (13:00 + 15).
  assert.deepEqual(freeSlot(items, day, 'morning', 90), { time: '13:15', fits: false });
  assert.deepEqual(freeSlot(items, '2026-11-30', 'evening', 90), { time: '19:00', fits: true });
  // Moving an item: its own slot doesn't block it.
  assert.equal(freeSlot(items, day, 'morning', 60, 'b').time, '09:00');
});

test('what is already there, in a line', () => {
  assert.equal(partSummary(items, day, 'morning'), 'Brunch at 09:00, Musée Picasso at 11:30');
  assert.equal(partSummary(items, '2026-11-30', 'afternoon'), 'nothing planned yet');
  assert.match(partSummary(items, day, 'evening'), /Crazy Horse at 23:45/);
});
