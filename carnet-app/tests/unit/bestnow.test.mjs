import test from 'node:test';
import assert from 'node:assert/strict';
import { bestNow, nextWindow, whyTag } from '../../src/lib/bestNow.js';
import { parseOsmHours } from '../../src/lib/facts.js';

const fri = (h, m = 0) => new Date(2026, 10, 27, h, m);
const P = (id, category, walk, extra = {}) => ({ id, name: id, category, walk, ...extra });
const coffeeDone = [{ start_time: '12:00', category: 'coffee' }];

test('kinds go to the next time they suit', () => {
  assert.equal(nextWindow('eat', 12 * 60 + 15).meal, 'lunch');
  assert.equal(nextWindow('eat', 16 * 60).meal, 'dinner');
  assert.equal(nextWindow('eat', 16 * 60).now, false);
  assert.equal(nextWindow('drink', 60).now, true, '01:00 is still drinks');
  assert.equal(nextWindow('coffee', 20 * 60), null);
});

test('at 12:15 after a coffee: lunch now, drinks later, coffee drops, sights any time', () => {
  const places = [P('Charlot', 'eat', 4), P('Bambin', 'coffee', 25), P('Syndicat', 'drink', 22), P('Picasso', 'culture', 5)];
  const r = bestNow(places, { dayItems: coffeeDone, date: fri(12, 15), me: 'seb' });
  const g = Object.fromEntries(r.groups.map((x) => [x.key, x.rows.map((p) => p.id)]));
  assert.deepEqual(g.now, ['Charlot']);
  assert.deepEqual(g.later, ['Syndicat']);
  assert.deepEqual(g.any, ['Picasso']);
  assert.deepEqual(g.done, ['Bambin']);
  assert.equal(r.groups.find((x) => x.key === 'now').title, 'Lunch · now');
  assert.equal(r.groups.find((x) => x.key === 'done').title, 'Coffee · had one today');
});

test('open now and crew votes rise; shut at lunch moves on; strip is near, open and fits now', () => {
  const lunchHours = parseOsmHours('Mo-Su 12:00-15:00');
  const shut = parseOsmHours('Mo-Su 19:00-23:00');
  const places = [P('Far', 'eat', 15, { hours: lunchHours }), P('Shut', 'eat', 3, { hours: shut }), P('Near', 'eat', 5, { hours: lunchHours }), P('Liked', 'eat', 9)];
  const ratings = new Map([['Liked', [{ email: 'luke', vote: 1 }, { email: 'matt', vote: 1 }]]]);
  const r = bestNow(places, { date: fri(12, 30), ratings, me: 'seb' });
  const now = r.groups.find((x) => x.key === 'now').rows.map((p) => p.id);
  assert.equal(now[0], 'Near');
  assert.ok(!now.includes('Shut'), 'dinner-only: moves to later');
  assert.deepEqual(r.groups.find((x) => x.key === 'later').rows.map((p) => p.id), ['Shut']);
  assert.deepEqual(r.strip.map((p) => p.id).sort(), ['Liked', 'Near']);
  assert.equal(whyTag(r.strip[0]), 'Lunch · now');
});

test('been goes to the bottom; my thumbs down (or most of the crew’s) is hidden unless asked', () => {
  const places = [P('Been', 'eat', 3), P('Nope', 'eat', 2), P('Split', 'eat', 2), P('Fine', 'eat', 6)];
  const ratings = new Map([
    ['Been', [{ email: 'seb', visited: true, vote: 1 }]],
    ['Nope', [{ email: 'seb', vote: -1 }]],
    ['Split', [{ email: 'matt', vote: -1 }, { email: 'luke', vote: 1 }]],
  ]);
  const r = bestNow(places, { date: fri(12, 30), ratings, me: 'seb' });
  assert.equal(r.passed, 1);
  assert.deepEqual(r.groups.find((x) => x.key === 'been').rows.map((p) => p.id), ['Been']);
  assert.ok(r.groups.find((x) => x.key === 'now').rows.some((p) => p.id === 'Split'), 'one veto doesn’t hide it');
  const all = bestNow(places, { date: fri(12, 30), ratings, me: 'seb', showPassed: true });
  assert.equal(all.passed, 0);
  assert.ok(all.groups.find((x) => x.key === 'been').rows.some((p) => p.id === 'Nope'));
});

test('very near drinks for later join the strip behind what suits now', () => {
  const r = bestNow([P('Lunch', 'eat', 4), P('Bar', 'drink', 6)], { date: fri(13), me: 'seb' });
  assert.deepEqual(r.strip.map((p) => p.id), ['Lunch', 'Bar']);
  assert.equal(whyTag(r.strip[1]), 'Drinks · from 17:00');
});

test('mid-morning with breakfast planned: eating places skip brunch and count as lunch, now', () => {
  const r = bestNow([P('Charlot', 'eat', 4), P('Coffee', 'coffee', 3)], { dayItems: coffeeDone, date: fri(11, 20), me: 'seb' });
  const now = r.groups.find((x) => x.key === 'now');
  assert.deepEqual(now.rows.map((p) => p.id), ['Charlot']);
  assert.equal(now.title, 'Lunch · now');
  assert.deepEqual(r.groups.find((x) => x.key === 'done').rows.map((p) => p.id), ['Coffee']);
});

test('a place shut at lunch moves to dinner; shut all day goes to the bottom', () => {
  const dinnerOnly = parseOsmHours('Mo-Su 19:00-23:00');
  const r = bestNow([P('Maiya', 'eat', 1, { hours: dinnerOnly }), P('Shut', 'eat', 2, { hours: parseOsmHours('Sa 12:00-15:00') })], { date: fri(12, 30), me: 'seb' });
  const later = r.groups.find((x) => x.key === 'later');
  assert.deepEqual(later.rows.map((p) => p.id), ['Maiya']);
  assert.equal(later.title, 'Dinner · later today');
  assert.equal(whyTag(later.rows[0]), 'Dinner · from 19:00');
  assert.ok(r.groups.find((x) => x.key === 'done').rows.some((p) => p.id === 'Shut'));
});
