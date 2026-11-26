import test from 'node:test';
import assert from 'node:assert/strict';
import { withAlt, swapIn, withoutAlt, backupIndex, rankLabel } from '../../src/lib/alts.js';

const main = { id: 'i1', place_id: 'p1', title: 'Le Petit Grain', category: 'coffee', day: '2026-11-28', start_time: '09:30', lat: 1, lng: 2, address: 'A' };
const bok = { id: 'p2', name: 'Bokbar', category: 'coffee', lat: 3, lng: 4, address: 'B' };
const ten = { id: 'p3', name: 'Ten Belles', category: 'coffee' };

test('backups: ranked, no duplicates, not the main pick', () => {
  const a = { ...main, ...withAlt(main, bok, 'seb') };
  const b = { ...a, ...withAlt(a, ten, 'conor') };
  assert.deepEqual(b.alternatives.map((x) => x.title), ['Bokbar', 'Ten Belles']);
  assert.equal(withAlt(b, bok), null, 'already a backup');
  assert.equal(withAlt(b, { id: 'p1', name: 'Le Petit Grain' }), null, 'the main pick');
  assert.deepEqual([rankLabel(0), rankLabel(1), rankLabel(2)], ['2nd', '3rd', '4th']);
  const idx = backupIndex([b]);
  assert.equal(idx.get('p2').rank, '2nd');
  assert.equal(idx.get('p3').rank, '3rd');
});

test('swapping a backup in keeps the old pick as the first backup', () => {
  const b = { ...main, alternatives: withAlt({ ...main, ...withAlt(main, bok) }, ten).alternatives };
  const s = { ...b, ...swapIn(b, 1) };
  assert.equal(s.title, 'Ten Belles');
  assert.equal(s.place_id, 'p3');
  assert.equal(s.start_time, '09:30', 'same slot');
  assert.deepEqual(s.alternatives.map((x) => x.title), ['Le Petit Grain', 'Bokbar']);
  assert.deepEqual(withoutAlt(s, 0).alternatives.map((x) => x.title), ['Bokbar']);
  assert.equal(withoutAlt({ alternatives: [s.alternatives[0]] }, 0).alternatives, null);
});
