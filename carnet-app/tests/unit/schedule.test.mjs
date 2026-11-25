import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDay, span } from '../../src/lib/schedule.js';
import { tripNow } from '../../src/lib/util.js';

const show = { id: 'ch', day: '2026-11-27', start_time: '23:45', end_time: '01:00', title: 'Crazy Horse' };

test('a plan ending after midnight runs into the next morning', () => {
  assert.deepEqual(span(show), { start: 1425, end: 1500, overnight: true });
  const fri = buildDay({ items: [show], day: '2026-11-27', places: [] });
  const kinds = fri.rows.map((r) => r.kind + (r.open ? ':open' : ''));
  assert.deepEqual(kinds, ['gap', 'item'], 'no "free from here" after a show that ends at 01:00');
  assert.equal(fri.rows[0].minutes, 1425 - 540);
});

test('the next day shows last night\'s plan first, and its free time starts after it', () => {
  const late = { ...show, id: 'club', start_time: '23:00', end_time: '10:30' };
  const sat = buildDay({ items: [late, { id: 'b', day: '2026-11-28', start_time: '13:00', end_time: '14:00' }], day: '2026-11-28', places: [] });
  assert.equal(sat.rows[0].kind, 'item');
  assert.equal(sat.rows[0].fromYesterday, true);
  assert.equal(sat.rows[1].kind, 'gap');
  assert.equal(sat.rows[1].from, 630, 'free from 10:30, not 09:00');
});

test('an evening plan with no end time near midnight', () => {
  const s = span({ start_time: '23:30' });
  assert.equal(s.end, 1500);
  assert.equal(s.overnight, true);
});

test('trip time: until 05:00 it is still the night before', () => {
  assert.deepEqual(tripNow(new Date(2026, 10, 28, 0, 30)), { day: '2026-11-27', min: 1470 });
  assert.deepEqual(tripNow(new Date(2026, 10, 28, 9, 0)), { day: '2026-11-28', min: 540 });
  const fri = buildDay({ items: [show], day: '2026-11-27', now: tripNow(new Date(2026, 10, 28, 0, 30)), places: [] });
  assert.ok(!fri.rows.some((r) => r.kind === 'gap'), 'at 00:30 nothing on Friday is still "free"');
});
