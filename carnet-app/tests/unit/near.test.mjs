import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= { dispatchEvent: () => {} };
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
const { planSpot, planAnchor, planAnchors, beforeTime, setNear, getNear, showNear } = await import('../../src/lib/near.js');

const places = [{ id: 'p1', lat: 48.8664, lng: 2.3011 }];
const items = [
  { id: 'ch', title: 'Crazy Horse', day: '2026-11-27', start_time: '21:00', place_id: 'p1' },
  { id: 'op', title: 'Opéra', day: '2026-11-27', start_time: '19:30', lat: 48.87, lng: 2.33 },
  { id: 'old', title: 'Louvre', day: '2026-11-26', start_time: '10:00', lat: 48.86, lng: 2.33 },
  { id: 'nospot', title: 'Pack', day: '2026-11-29', start_time: '09:00' },
];

test('a plan sits at its own spot or its place’s pin', () => {
  assert.deepEqual(planSpot(items[0], places), { lat: 48.8664, lng: 2.3011 });
  assert.equal(planSpot(items[3], places), null);
  assert.equal(planAnchor(items[0], places).start, 21 * 60);
});
test('plans to look near: today on, with a spot, in time order', () => {
  assert.deepEqual(planAnchors(items, places, '2026-11-27').map((a) => a.name), ['Opéra', 'Crazy Horse']);
});
test('near a plan, "best" is two hours before it, on its day', () => {
  const d = beforeTime(planAnchor(items[0], places));
  assert.equal(d.getHours(), 19); assert.equal(d.getDate(), 27);
  assert.equal(beforeTime({ kind: 'place', lat: 1, lng: 1 }), null);
});
test('see all near this: sets the anchor and asks to go to Places', () => {
  let went = null;
  globalThis.window = { dispatchEvent: (e) => { went = e.detail; } };
  showNear(planAnchor(items[0], places));
  assert.equal(getNear().name, 'Crazy Horse');
  assert.deepEqual(went, { tab: 'places' });
  setNear(null);
});
