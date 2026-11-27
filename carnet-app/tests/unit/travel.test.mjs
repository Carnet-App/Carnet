import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { origin: 'http://localhost' };
const m = new Map(); globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
const { bestHop, ensureHop, known, atOf, linesText, hasTransit } = await import('../../src/lib/travel.js');
const { buildDay } = await import('../../src/lib/schedule.js');

const bambin = { lat: 48.8716, lng: 2.3809 }, eiffel = { lat: 48.8584, lng: 2.2945 }, near = { lat: 48.8720, lng: 2.3815 };
const wait = () => new Promise((r) => setTimeout(r, 200));

test('short hops are walks; long ones take transport once it’s known and quicker', async () => {
  assert.equal(bestHop(bambin, near).mode, 'walk');
  assert.equal(bestHop(bambin, eiffel, '20261127T1400').mode, 'walk', 'not known yet: walking');
  globalThis.fetch = async () => new Response(JSON.stringify({ minutes: 35, lines: ['Metro 9'], walking: 8, depart: '13:22' }));
  ensureHop(bambin, eiffel, { at: '20261127T1400', arrive: true });
  await wait();
  const h = bestHop(bambin, eiffel, '20261127T1400');
  assert.equal(h.mode, 'transit'); assert.equal(h.minutes, 35); assert.equal(h.depart, '13:22');
  assert.equal(linesText(h.lines), 'Métro 9');
  assert.ok(known(bambin, eiffel, '20261127T1400'));
});
test('transport that barely beats walking isn’t offered', async () => {
  const a = { lat: 48.86, lng: 2.35 }, b = { lat: 48.8665, lng: 2.3600 };
  globalThis.fetch = async () => new Response(JSON.stringify({ minutes: 14, lines: ['Bus 96'] }));
  ensureHop(a, b, { at: '20261127T1500' }); await wait();
  assert.equal(bestHop(a, b, '20261127T1500').mode, 'walk');
});
test('the day counts free time with the quicker way', () => {
  const items = [
    { id: 'a', day: 'd', start_time: '12:00', end_time: '13:00', title: 'Bambin', ...bambin },
    { id: 'b', day: 'd', start_time: '15:00', end_time: '16:00', title: 'Eiffel', ...eiffel },
  ];
  const walking = buildDay({ items, day: 'd', home: null, now: null, places: [] });
  const byMetro = buildDay({ items, day: 'd', home: null, now: null, places: [], hop: () => ({ mode: 'transit', minutes: 35, walk: 105 }) });
  const gap = (rows) => rows.find((r) => r.kind === 'gap' && r.from === 13 * 60)?.minutes || 0;
  assert.ok(gap(byMetro.rows) > gap(walking.rows));
  assert.equal(byMetro.rows.find((r) => r.kind === 'travel').way.mode, 'transit');
});
test('helpers', () => {
  assert.equal(atOf('2026-11-27', '14:00'), '20261127T1400');
  assert.ok(hasTransit('Paris')); assert.ok(!hasTransit('Berlin'));
});
