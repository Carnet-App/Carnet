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
test('defect 4: a shared word is not a 0.85 match', () => {
  assert.ok(similarity('Paris', 'Université Paris I Panthéon-Sorbonne') < 0.5);
});
test('defect 5: "lecornichon paris" is not offered a university', () => {
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

test('an address written on the picture goes with the one name on it', async () => {
  const { overlayCandidates, pictureAddress } = await import('../../src/lib/capture.js');
  const mk = (a) => a.map((t, i) => ({ text: t, y: i * 60, h: 50, conf: 90 }));
  const c = overlayCandidates(mk(['LAPERLE', 'fashion crowd bistro €€', '78 Rue Vieille du Temple Fashion crowd crossroads']));
  assert.equal(c[0].address, '78 Rue Vieille du Temple');
  assert.equal(pictureAddress(['37 avenue Montaigne']), '37 avenue Montaigne');
});

test('everyday phrases are not names, and people tagged in captions are not places', async () => {
  const { overlayCandidates, venueCandidates } = await import('../../src/lib/capture.js');
  const mk = (a) => a.map((t, i) => ({ text: t, y: i * 60, h: 50 + i, conf: 90 }));
  assert.deepEqual(overlayCandidates(mk(['The chicest new cafe in Paris', 'right now'])), []);
  const names = venueCandidates('S95 founder @dualipa serves up her picks\nthanks to @lamenagerieparis').map((x) => x.name);
  assert.deepEqual(names, ['la menagerie']);
});

test('pins read as stray symbols, "Name: address", "it\'s called", "X in the 3rd", headings above text', async () => {
  const { venueCandidates } = await import('../../src/lib/capture.js');
  const top = (t) => venueCandidates(t, null, 1, { social: true }).filter((c) => c.weight >= 4).map((c) => [c.name, c.address || null]);
  assert.deepEqual(top('Ÿ Kraftwerk Berlin @kraftwerkberlinofficial'), [['Kraftwerk Berlin', null]]);
  assert.deepEqual(top('natalia.lately Ÿ Café Honolulu: Warschauer Str. 39/40, 10243 Berlin'), [['Café Honolulu', 'Warschauer Str. 39/40']]);
  assert.deepEqual(top("handluggageonly It's called Malabar and it's at the top of the Hotel"), [['Malabar', null]]);
  assert.deepEqual(top('a new bar in Paris, Rojo in the 3rd. love to find'), [['Rojo', null]]);
  assert.deepEqual(top('BAR OMI\nAfter Onii-San and Ojii, Laetitia and Arthur Cohen, joined by'), [['BAR OMI', null]]);
  assert.deepEqual(top("Berlin's dreamiest hideaway\nfor rainy days"), []);
});

test('a Google Maps place card: the name above the rating, icon junk cut, wrapped names joined', async () => {
  const { mapsSheet } = await import('../../src/lib/capture.js');
  const card = (head) => `15:37 1. PTI\n${head}\n4.7 Xkk#k* (737) D\n@ 4 hr 15 min\n\nCocktail bar - €10-20 - &\nOpen : Closes 01:00\n\nA Start | Reserve\n\nOverview Menu Reviews Photos Updates`;
  assert.deepEqual(mapsSheet(card('Bar Nouveau ED Qh) @')), { name: 'Bar Nouveau', category: 'Cocktail bar' });
  assert.equal(mapsSheet(card('Little Red Door oh x')).name, 'Little Red Door');
  assert.equal(mapsSheet(card('A / ISSN ON\nCopperBay OQ td x')).name, 'CopperBay');
  assert.equal(mapsSheet(card('Stolen Moon Cocktail O Mh x\nBar')).name, 'Stolen Moon Cocktail Bar');
  assert.equal(mapsSheet('Le Syndicat A b x\n45 XkX*x (1,740) D\n341 km\nCocktail bar - €10-20\nOverview Menu Reviews').name, 'Le Syndicat');
  assert.equal(mapsSheet('Some caption about a bar\n4.7 (737)\nliked by friends'), null, 'needs the map app\'s tabs');
});

test('a guide page: the name under the type label, not the fact table or the photo credit', async () => {
  const { guideCard, placeCard } = await import('../../src/lib/capture.js');
  const page = (head) => `${head}\n\nDATES PUBLISHED ON 2 APRIL 2025\n\nESSENTIALS M Good vibes\n\nCRAVINGS BISTRO\nEXTRAS OPEN FOR LUNCH TERRACE\n\nPRICES €36 to €50\n\nHOURS From 12pm to 2pm SHOW\n\nThere's no plov on the menu at Mazali...`;
  assert.deepEqual(guideCard(page('© Restaurant Mazali\nRESTAURANT\n\nMAZALI')), { name: 'Mazali', category: 'RESTAURANT' });
  assert.equal(guideCard(page('© Maki Manoukian\nRESTAURANT\nALTRO FRENCHIE\n\nUn Frenchie en Italie')).name, 'Altro Frenchie');
  assert.equal(guideCard(page('PRISTINE')).name, 'Pristine');
  assert.equal(guideCard(page('ALTRO FRENCHIE\nUn Frenchie en Italie')).name, 'Altro Frenchie', 'subtitle skipped without a label too');
  assert.equal(placeCard(page('RESTAURANT\nMAIYA')).why, 'guide page');
  assert.equal(guideCard('PRICES €16 to €35\nsome caption'), null, 'one field is not a guide page');
});
