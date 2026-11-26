import test from 'node:test';
import assert from 'node:assert/strict';
import { kindFor, fresh, catOf } from '../../src/lib/nearby.js';

test('what to suggest for free time, by time of day', () => {
  const at = (h, m = 0) => kindFor(h * 60 + m);
  assert.deepEqual([at(9), at(12, 30), at(15), at(18), at(20), at(23), at(1), at(5)], ['coffee', 'eat', 'coffee', 'drink', 'eat', 'drink', 'drink', null]);
});

test('suggestions leave out what is in the guide (by name or spot) and what was waved away', () => {
  const list = [
    { osm: 'n/1', name: 'Le Baratin', lat: 48.87, lng: 2.38, amenity: 'restaurant' },
    { osm: 'n/2', name: 'Bokbar', lat: 48.8716, lng: 2.3815, amenity: 'cafe' },
    { osm: 'n/3', name: 'Aux Folies', lat: 48.8720, lng: 2.3790, amenity: 'bar' },
    { osm: 'n/4', name: 'Chez Alain', lat: 48.88, lng: 2.39, amenity: 'restaurant' },
  ];
  const guide = [{ name: 'BOKBAR', lat: 48.8717, lng: 2.3816 }, { name: 'Folies bar', lat: 48.87201, lng: 2.37901 }];
  assert.deepEqual(fresh(list, guide, new Set(['n/4'])).map((s) => s.name), ['Le Baratin']);
  assert.deepEqual(list.map(catOf), ['eat', 'coffee', 'drink', 'eat']);
});

test('from your list: near the sight, the kind that suits the time first, not what is already planned', async () => {
  const { fromYourList } = await import('../../src/lib/nearby.js');
  const museum = { lat: 48.8598, lng: 2.3625 };
  const places = [
    { id: 'a', name: 'Café Charlot', category: 'drink', lat: 48.8632, lng: 2.3622 },
    { id: 'b', name: 'Breizh Café', category: 'eat', lat: 48.8603, lng: 2.3620 },
    { id: 'c', name: 'Ten Belles', category: 'coffee', lat: 48.8722, lng: 2.3640 },
    { id: 'd', name: 'Far away', category: 'eat', lat: 48.8300, lng: 2.3000 },
    { id: 'e', name: 'Planned', category: 'eat', lat: 48.8600, lng: 2.3626 },
    { id: 'f', name: 'A museum', category: 'culture', lat: 48.8600, lng: 2.3626 },
  ];
  const items = [{ place_id: 'e' }];
  assert.deepEqual(fromYourList(places, items, museum, { kind: 'eat' }).map((p) => p.name), ['Breizh Café', 'Café Charlot']);
  assert.deepEqual(fromYourList(places, items, museum, { kind: 'drink' }).map((p) => p.name)[0], 'Café Charlot');
});
