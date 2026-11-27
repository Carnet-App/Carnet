import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFrom, cuisineFrom, placeFacts, parseOsmHours, fromGoogleHours, openAt, hoursLine, closedDays } from '../../src/lib/facts.js';

test('prices: guide ranges, map-card ranges and € signs', () => {
  assert.deepEqual(priceFrom('PRICES €16 to €35'), { price_text: '€16–35', price_level: 2 });
  assert.deepEqual(priceFrom('€10–20'), { price_text: '€10–20', price_level: 2 });
  assert.deepEqual(priceFrom('16-35 €'), { price_text: '€16–35', price_level: 2 });
  assert.equal(priceFrom('€€€').price_level, 3);
  assert.equal(priceFrom('open 19:00-23:00'), null, 'times are not prices');
});
test('cuisine: tidy chip words from type lines and OSM tags', () => {
  assert.equal(cuisineFrom('Nepalese restaurant'), 'Nepali');
  assert.equal(cuisineFrom('Cocktail bar'), 'Cocktails');
  assert.equal(cuisineFrom('nepalese;indian'), 'Nepali, Indian');
  assert.equal(cuisineFrom('Restaurant'), null);
});
test('a Google Maps card and a guide page give cuisine and price', () => {
  assert.deepEqual(placeFacts('Maiya\n4.6 ★★★★★ (212)\nNepalese restaurant · €20–30\nOpen · Closes 23:00\nDirections'), { cuisine: 'Nepali', price_text: '€20–30', price_level: 2 });
  assert.deepEqual(placeFacts('RESTAURANT\nMAIYA\nDATES\nPublished on 3 Oct\nPRICES\n€16 to €35'), { price_text: '€16–35', price_level: 2 });
});
test('OSM opening hours in their usual forms', () => {
  const h = parseOsmHours('Mo-Fr 12:00-14:30,19:00-23:00; Sa 19:00-02:00; Su off');
  assert.equal(h.periods.filter((p) => p[0] === 0).length, 2);
  assert.deepEqual(h.periods.find((p) => p[0] === 5), [5, 1140, 1560]);
  assert.equal(closedDays(h), 'Sun');
  assert.equal(parseOsmHours('24/7').periods.length, 7);
  assert.equal(parseOsmHours('Mo-Fr 09:00-18:00; Jan off'), null, 'seasonal: not guessed');
  assert.ok(parseOsmHours('Tu-Su 10:00-18:00; PH off'));
});
test('open now, opening later, and late nights past midnight', () => {
  const h = parseOsmHours('Mo-Fr 12:00-14:30,19:00-23:00; Sa 19:00-02:00; Su off');
  const fri = (hh, mm = 0) => new Date(2026, 10, 27, hh, mm);
  assert.deepEqual(hoursLine(h, fri(12, 15)), { text: 'Open till 14:30', tone: 'open' });
  assert.deepEqual(hoursLine(h, fri(16)), { text: 'Opens 19:00', tone: 'later' });
  assert.deepEqual(hoursLine(h, fri(22, 30)), { text: 'Closes 23:00', tone: 'warn' });
  assert.equal(openAt(h, new Date(2026, 10, 29, 1, 0)).open, true, 'Saturday night runs into Sunday 01:00');
  assert.deepEqual(hoursLine(h, new Date(2026, 10, 29, 15)), { text: 'Closed today', tone: 'closed' });
});
test('Google periods become the same shape', () => {
  const g = fromGoogleHours({ periods: [{ open: { day: 5, hour: 19, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }], weekdayDescriptions: ['Friday: 7:00 PM – 2:00 AM'] });
  assert.deepEqual(g.periods, [[4, 1140, 1560]]);
});
