import test from 'node:test';
import assert from 'node:assert/strict';
import { kindForDay, kindWords, mealsOn } from '../../src/lib/nearby.js';
import { buildDay } from '../../src/lib/schedule.js';
import { placeWords, pickSpot, locatePlans } from '../../src/lib/locatePlans.js';

const H = (h) => h * 60;
const m = new Map(); globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
const fri = [
  { day: 'd', start_time: '12:00', category: 'coffee', title: 'Bambin', lat: 48.871, lng: 2.39 },
  { day: 'd', start_time: '14:00', end_time: '15:30', category: 'culture', title: 'Eiffel Tower' },
  { day: 'd', start_time: '17:00', end_time: '17:45', category: 'culture', title: 'Opera Garnier Tickets' },
  { day: 'd', start_time: '19:30', end_time: '21:00', category: 'culture', title: 'Opéra Garnier', lat: 48.8719, lng: 2.3316 },
];

test('after a coffee and no lunch, the afternoon gap suggests (late) lunch, not another coffee', () => {
  assert.equal(kindForDay(H(15.5), fri, 'culture'), 'eat');
  assert.equal(kindWords('eat', H(15.5)), 'For a late lunch');
});
test('with lunch done, the afternoon is coffee; evening is dinner until one is planned, then drinks', () => {
  const withLunch = [...fri, { start_time: '13:00', category: 'eat' }];
  assert.equal(kindForDay(H(15.5), withLunch), 'coffee');
  assert.equal(kindForDay(H(15.5), withLunch, 'coffee'), null);
  assert.equal(kindForDay(H(21), fri), 'eat');
  assert.equal(kindWords('eat', H(21)), 'For dinner');
  assert.equal(kindForDay(H(21), [...fri, { start_time: '20:00', category: 'eat' }]), 'drink');
});
test('a morning with breakfast already planned doesn’t suggest another', () => {
  assert.equal(kindForDay(H(9), [{ start_time: '08:30', category: 'coffee' }]), null);
  assert.equal(kindForDay(H(9), []), 'coffee');
  assert.deepEqual(mealsOn(fri), { breakfast: true, lunch: false, dinner: false });
});

test('a gap after a plan with no spot is not anchored to an earlier place in the day', () => {
  const { rows } = buildDay({ items: fri, day: 'd', home: null, now: null, places: [] });
  const gap = rows.find((r) => r.kind === 'gap' && r.from === H(15.5));
  assert.equal(gap.before, null, 'not Bambin');
  assert.equal(gap.prev.title, 'Eiffel Tower');
});
test('a plan made from a pinned place uses that pin', () => {
  const items = [{ day: 'd', start_time: '14:00', end_time: '15:30', category: 'culture', title: 'Eiffel Tower', place_id: 'p1' }, { day: 'd', start_time: '18:00', category: 'eat', title: 'X' }];
  const { rows } = buildDay({ items, day: 'd', home: null, now: null, places: [{ id: 'p1', lat: 48.858, lng: 2.2945 }] });
  const gap = rows.find((r) => r.kind === 'gap' && r.from === H(15.5));
  assert.equal(gap.before.lat, 48.858);
});

test('plan titles lose the booking words before looking up the place', () => {
  assert.equal(placeWords('Opera Garnier Tickets'), 'Opera Garnier');
  assert.equal(placeWords('Lunch at Maiya'), 'Maiya');
  assert.equal(placeWords('Louvre (booked)'), 'Louvre');
});
test('Google’s first answer may go by another name; other answers need the same name', () => {
  const centre = { lat: 48.86, lng: 2.35 };
  const garnier = { name: 'Palais Garnier', lat: 48.872, lng: 2.3316, osm_value: 'tourist_attraction', source: 'google' };
  assert.ok(pickSpot('Opera Garnier', [garnier], { city: 'Paris', centre }));
  assert.equal(pickSpot('Opera Garnier', [{ ...garnier, source: 'osm' }], { city: 'Paris', centre }), null);
  assert.equal(pickSpot('Opera Garnier', [{ ...garnier, name: 'Garage Dupont' }], { city: 'Paris', centre }), null);
});
test('each plan is looked up once, and only plans without a spot', async () => {
  const saved = {}; const asked = [];
  const items = [{ id: 'a', title: 'Eiffel Tower' }, { id: 'b', title: 'Bambin', lat: 1, lng: 1 }];
  const lookup = async (q) => { asked.push(q); return [{ name: 'Eiffel Tower', lat: 48.858, lng: 2.2945, osm_value: 'tourist_attraction', source: 'google', address: 'Champ de Mars' }]; };
  const opts = { city: 'Paris', centre: { lat: 48.86, lng: 2.35 }, save: (id, f) => (saved[id] = f), lookup };
  assert.equal(await locatePlans(items, opts), 1);
  assert.deepEqual(asked, ['Eiffel Tower Paris']);
  assert.equal(saved.a.address, 'Champ de Mars');
  assert.equal(await locatePlans(items, opts), 0);
});
