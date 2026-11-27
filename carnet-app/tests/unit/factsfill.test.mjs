import test from 'node:test';
import assert from 'node:assert/strict';
import { factsFill, fromOsm, googleIdOf, lacks } from '../../src/lib/factsFill.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('Google’s id comes from the photo link for places matched before fix-9', () => {
  assert.equal(googleIdOf({ photo_url: '/api/gphoto?id=ChIJabc%3D' }), 'ChIJabc=');
  assert.equal(googleIdOf({ google_id: 'X' }), 'X');
});
test('the map entry with the same name gives hours and cuisine', () => {
  const o = fromOsm({ name: 'Maiya' }, [{ name: 'Boulangerie', hours: 'Mo-Su 07:00-20:00' }, { name: 'Maiya', cuisine: 'nepalese', hours: 'Tu-Sa 19:00-23:00' }]);
  assert.equal(o.cuisine, 'Nepali');
  assert.equal(o.hours.periods.length, 5);
});
test('free first: notes and map; Google only for what’s left; once per place; only my places', async () => {
  globalThis.localStorage = mem();
  const places = [
    { id: 'a', name: 'Maiya', owner: 'me', category: 'eat', lat: 1, lng: 1, notes: 'PRICES €16 to €35' },
    { id: 'b', name: 'Syndicat', owner: 'me', category: 'drink', lat: 1, lng: 1, photo_url: '/api/gphoto?id=G1' },
    { id: 'c', name: 'Theirs', owner: 'them', category: 'eat', lat: 1, lng: 1 },
  ];
  const saved = {}; const asked = { osm: 0, google: [] };
  const osm = async (p) => { asked.osm++; return p.name === 'Maiya' ? [{ name: 'Maiya', cuisine: 'nepalese', hours: 'Tu-Sa 19:00-23:00' }] : []; };
  const google = async (id) => { asked.google.push(id); return { hours: { periods: [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }] }, price_level: 2 }; };
  const r = await factsFill(places, { myId: 'me', save: (id, f) => (saved[id] = f), osm, google, pause: 0 });
  assert.equal(r.filled, 2);
  assert.equal(saved.a.price_text, '€16–35'); assert.equal(saved.a.cuisine, 'Nepali'); assert.equal(saved.a.facts_src.hours, 'osm');
  assert.deepEqual(asked.google, ['G1'], 'Maiya had everything from free sources');
  assert.equal(saved.b.facts_src.hours, 'google'); assert.equal(saved.b.google_id, 'G1');
  assert.ok(!saved.c);
  assert.equal(await factsFill(places, { myId: 'me', save: () => {}, osm, google, pause: 0 }), null, 'each place once');
});
test('Google’s cap stops Google, and those places are tried again another day', async () => {
  globalThis.localStorage = mem();
  const places = [{ id: 'b', name: 'Syndicat', owner: 'me', category: 'drink', lat: 1, lng: 1, google_id: 'G1' }];
  const r = await factsFill(places, { myId: 'me', save: () => {}, osm: async () => [], google: async () => { throw new Error('limit'); }, pause: 0 });
  assert.equal(r.stopped, 'google');
  assert.ok(lacks(places[0]).hours);
  const again = await factsFill(places, { myId: 'me', save: () => {}, osm: async () => [], google: async () => ({ hours: null, price_level: 3 }), pause: 0 });
  assert.ok(again, 'retried');
});
