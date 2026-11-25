import test from 'node:test';
import assert from 'node:assert/strict';
import { nameMatch, rankResults, handleName, isPlace } from '../../src/lib/match.js';

// Map results as recorded by the inspector on a real import (public map data, names only).
const R = (name, osm, lat = 48.86, lng = 2.35) => ({ name, osm_value: osm, lat, lng });
const LOOKUPS = [
  { name: 'Double Dragon', results: [R('Double Dragon', 'restaurant')], want: 'Double Dragon' },
  { name: 'Caveau de la Huchette', squash: 'caveaudelahuchette', results: [R('Caveau de la Huchette', 'nightclub')], want: 'Caveau de la Huchette' },
  { name: 'Early June', results: [R('Early June', 'restaurant')], want: 'Early June' },
  { name: 'Cone S', results: [R('Pine Cone Court', 'residential'), R('South Bristle Cone Court', 'residential'), R('North Bristle Cone Drive', 'residential'), R('Cone Shed', 'shed')], want: null },
  { name: 'dualipa', results: [R('Duplica Dénia', 'copyshop'), R('key duplicates', 'car_parts'), R('Saint Isidore Parish', 'place_of_worship'), R('11th Arrondissement', 'suburb'), R('11e Avenue', 'cafe')], want: null },
  { name: 'Bish rot Des Tournelles', alts: ['Bistrot Des Tournelles'], results: [R('Saint Parascheva Church', 'place_of_worship'), R('Allai Bishaam road', 'unclassified'), R('Birhen Dolorosa Parish Church', 'place_of_worship')], want: null },
  { name: 'Les Puces de Vanves', results: [R('Marché aux puces de la porte de Vanves', 'marketplace'), R('Porte de Vanves', 'station'), R('Porte de Vanves', 'tram_stop')], want: null, offer: 'Marché aux puces de la porte de Vanves' },
  { name: 'LAPERLE', results: [R('L’apérette', 'bar'), R('Labelle Poissonerie', 'seafood'), R('La Lacelle Bourg', 'bus_stop'), R('Labelle Gap', 'residential'), R('Rue Vieille du Temple', 'living_street')], want: null },
  { name: 'cafe la perle', alts: ['LAPERLE'], results: [R('Café La Perle', 'cafe'), R('Rue Vieille du Temple', 'living_street')], want: 'Café La Perle' },
  { name: 'le carmen', results: [R('Paris', 'administrative'), R('Paris', 'city'), R('Conservatoire national supérieur de musique et de danse de Paris', 'college'), R('Cathedral of Notre Dame', 'place_of_worship'), R('Université Paris I Panthéon-Sorbonne', 'university')], want: null },
  { name: 'lamenagerieparis', results: [R('BGL BNP Paribas', 'bank')], want: null },
  // Second import, 25 Nov 11:30
  { name: 'Bish rot Des Tournelles', alts: ['Bistrot Des Tournelles'], results: [R('Saint Parascheva Church', 'place_of_worship'), R('Allai Bishaam road', 'unclassified'), R('Bistrot des Tournelles', 'restaurant'), R("Bistrot de l'Oulette", 'restaurant')], want: 'Bistrot des Tournelles' },
  { name: 'cafe la perle', alts: ['LAPERLE'], results: [R('La perle noire', 'pub'), R('L’apérette', 'bar'), R('La Lacelle Bourg', 'bus_stop')], want: null },
  { name: 'cafe charlot', results: [R('Café Charlot', 'restaurant')], want: 'Café Charlot' },
  { name: 'le carmen', results: [R('Le Carmen', 'bar'), R('Calle Arco de Paris', 'residential'), R('Los Parisones', 'locality')], want: 'Le Carmen' },
  { name: 'Double Dr ragon', results: [R('Double Dragon', 'restaurant'), R('Double Tree Drive', 'residential')], want: 'Double Dragon' },
  { name: 'Septime', results: [R('Septime La Cave', 'wine_bar')], want: null, offer: 'Septime La Cave' },
];

test('phase 2 exit: no false automatic map confirmations on recorded lookups', () => {
  for (const l of LOOKUPS) {
    const r = rankResults(l.name, l.results, { city: 'Paris', alts: l.alts, squash: l.squash });
    const auto = r.sure ? r.best.name : null;
    assert.equal(auto, l.want, `${l.name}: confirmed ${auto}, expected ${l.want}`);
    if (l.offer) assert.equal(r.scored[0]?.name, l.offer, `${l.name}: offers ${r.scored[0]?.name}`);
  }
});

test('the other reading of a line finds the place the misread missed', () => {
  const r = rankResults('Bish rot Des Tournelles', [R('Bistrot des Tournelles', 'restaurant')], { city: 'Paris', alts: ['Bistrot Des Tournelles'] });
  assert.equal(r.sure, true);
});

test('transport stops, streets and districts are never offered as places', () => {
  for (const osm of ['station', 'tram_stop', 'bus_stop', 'residential', 'living_street', 'suburb', 'city', 'administrative', 'house'])
    assert.equal(isPlace({ name: 'X', osm_value: osm }), false, osm);
  assert.equal(isPlace({ name: 'X', osm_value: 'bar' }), true);
  assert.equal(isPlace({ name: null, osm_value: 'bar' }), false, 'a nameless result is not a named place');
});

test('two branches far apart: ask which, never pick one', () => {
  const r = rankResults('Café Charlot', [R('Café Charlot', 'cafe', 48.863, 2.362), R('Café Charlot', 'cafe', 48.85, 2.30)], { city: 'Paris' });
  assert.equal(r.sure, false);
  assert.equal(r.branches, 1);
});

test('handles become names', () => {
  assert.equal(handleName('lecornichon.paris'), 'le cornichon');
  assert.equal(handleName('cafecharlotparis'), 'cafe charlot');
  assert.equal(handleName('chezjeannette'), 'chez jeannette');
  assert.equal(handleName('lecarmen_paris'), 'le carmen');
  assert.equal(handleName('bar.calders'), 'bar calders');
});

test('name matching: same place spelled differently, different places kept apart', () => {
  assert.ok(nameMatch('LAPERLE', 'Café La Perle') >= 0.9);
  assert.ok(nameMatch('Cafe Charlot', 'Café Charlot') === 1);
  assert.ok(nameMatch('Septime', 'Septime La Cave') < 0.9);
  assert.ok(nameMatch('Chez Janou', 'Chez Jeannette') < 0.6);
  assert.ok(nameMatch('Le Bar', 'Bar Le Syndicat') < 0.6);
});
