import test from 'node:test';
import assert from 'node:assert/strict';
import { venueCandidates, tieredCandidates, overlayCandidates, splitTag, placeHint, looksLikeTicket, postLayout } from '../../src/lib/capture.js';
import { guessCategory, similarity } from '../../src/lib/util.js';

const names = (cs) => cs.map((c) => c.name);
const mk = (texts) => texts.map((t, i) => ({ text: t, y: i * 60, h: 50, conf: 90 }));

// ── Behaviour to keep
test('caption "name, street address" gives the name with its address', () => {
  const c = venueCandidates('medowski.k Rojo, 8 Rue de Beauce, 75003 Paris\n4 November');
  assert.deepEqual(names(c), ['Rojo']);
  assert.equal(c[0].address, '8 Rue de Beauce, 75003 Paris');
});
test('Instagram location tag with a misread pin', () => {
  assert.ok(names(venueCandidates('victoiretaverne Ÿ Les Puces de Vanves, Porte de Vanves, Paris\n14e')).includes('Les Puces de Vanves'));
});
test('hashtags split back into names', () => {
  assert.equal(splitTag('caveaudelahuchette'), 'Caveau de la Huchette');
  assert.equal(splitTag('bistrotdestournelles'), 'Bistrot des Tournelles');
});
test('name above a quote on a photo, with its place hint; watermark and counters ignored', () => {
  const c = overlayCandidates(mk(['SERVICE95 3/9', 'Bistrot Des Tournelles', '“A TRADITIONAL FRENCH BISTRO NEAR', 'PLACE DE LA BASTILLE, WHERE YOU CAN', 'TRY THE CLASSIC DISHES.”']), { handle: 'service95' });
  assert.deepEqual(names(c), ['Bistrot Des Tournelles']);
  assert.match(c[0].note, /bistro/i);
});
test('a slide with only a web address proposes nothing', () => {
  assert.deepEqual(overlayCandidates(mk(['KEEP READING ON', 'SERVICE95.COM']), { handle: 'service95' }).filter((c) => c.name), []);
});
test('place hints from quotes', () => {
  assert.equal(placeHint('serving small plates on rue de charonne.'), 'Rue de Charonne');
});
test('post layout falls back to the caption when the like row is misread', () => {
  const lines = [{ text: 'service95 Follow', y: 465, h: 100, conf: 82 }, { text: 'Q 428K Qas V3', y: 2336, h: 70, conf: 45 }, { text: 'service95 The only Paris food guide', y: 2449, h: 37, conf: 95 }, { text: '11 March', y: 2764, h: 24, conf: 96 }];
  const p = postLayout(lines, 2868);
  assert.ok(p);
  assert.equal(p.handle, 'service95');
});

// ── Known defects (capture defect numbers from the plan)
test('defect 1: a strong caption candidate does not hide places read from the photo', () => {
  const out = tieredCandidates([{ name: 'Rojo', why: 'caption', weight: 15 }], [{ name: 'Septime', why: 'photo', weight: 8 }], '');
  assert.deepEqual(names(out).sort(), ['Rojo', 'Septime']);
});
test('defect 2: a login screen is not read as a location tag', () => {
  assert.deepEqual(names(venueCandidates('username\nForgot your password')), []);
});
test('defect 3: a Maps card does not hide another venue on the same screen', () => {
  const c = venueCandidates('Septime\n4.6 ★★★★★ (1,203)\nRestaurant · €€€\nAlso try Clamato, 80 Rue de Charonne, 75011 Paris');
  assert.ok(names(c).includes('Septime') && names(c).includes('Clamato'));
});
test('defect 4: a shared word is not a 0.85 match', { todo: 'defect 4 — substring bonus in similarity() (phase 2)' }, () => {
  assert.ok(similarity('Paris', 'Université Paris I Panthéon-Sorbonne') < 0.5);
});
test('defect 5: "lecornichon paris" is not offered a university', { todo: 'defect 5 — 0.35 acceptance threshold (phase 2)' }, () => {
  assert.ok(similarity('lecornichon paris', 'Université Paris I Panthéon-Sorbonne') < 0.35);
});
test('defect 11: "travel" is not a rave and "public" is not a pub', () => {
  assert.equal(guessCategory('', 'Paris travel guide'), 'explore');
  assert.equal(guessCategory('', 'public garden'), 'explore');
});
test('defect 14: a lowercase name keeps its first word', () => {
  assert.deepEqual(names(venueCandidates('chez janou, 2 rue roger verlomme, 75003 paris')), ['chez janou']);
});
test('defect 17: a QR code alone does not make a ticket', () => {
  assert.equal(looksLikeTicket('Menu of the day\nScan for our wine list', { data: 'https://example.com/wine' }), false);
});
