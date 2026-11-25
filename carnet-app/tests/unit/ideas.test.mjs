import test from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, slotOf, ticketsOf, ticketFields } from '../../src/lib/util.js';

test('area from an address', () => {
  assert.equal(areaOf('12 Rue de Charonne, 75011 Paris, France', 'Paris'), '11e');
  assert.equal(areaOf('Place du Tertre, 75018 Paris', 'Paris'), '18e');
  assert.equal(areaOf('Rue de Rivoli, 75001 Paris', 'Paris'), '1er');
  assert.equal(areaOf('Avenue Foch, 75116 Paris', 'Paris'), '16e');
  assert.equal(areaOf('Oranienstraße 12, Kreuzberg, Berlin, 10999, Germany', 'Berlin'), 'Kreuzberg');
  assert.equal(areaOf('Somewhere', 'Paris'), null);
  assert.equal(areaOf(null), null);
});

test('time of day an idea suits', () => {
  assert.equal(slotOf({ title: 'Saint Laurent Rive Droite Café', category: 'coffee' }), 'morning');
  assert.equal(slotOf({ title: 'Marché aux puces de la porte de Vanves', category: 'explore' }), 'morning');
  assert.equal(slotOf({ title: 'Le Cornichon', category: 'eat' }), 'day');
  assert.equal(slotOf({ title: 'Le Cornichon', category: 'eat', notes: 'book for dinner' }), 'evening');
  assert.equal(slotOf({ title: 'ROJO', category: 'drink' }), 'evening');
  assert.equal(slotOf({ title: 'Caveau de la Huchette', category: 'dance' }), 'late');
  assert.equal(slotOf({ title: 'Thing', category: 'other' }), 'any');
});

test('several tickets: the first stays where older apps look', () => {
  const two = [{ qr: 'A', path: 'p/a.jpg' }, { qr: null, path: 'p/b.jpg' }];
  assert.deepEqual(ticketFields(two), { qr_text: 'A', attachment_path: 'p/a.jpg', tickets: two });
  assert.deepEqual(ticketFields([two[0]]), { qr_text: 'A', attachment_path: 'p/a.jpg', tickets: null });
  assert.deepEqual(ticketFields([]), { qr_text: null, attachment_path: null, tickets: null });
  assert.deepEqual(ticketsOf({ qr_text: 'X', attachment_path: null }), [{ qr: 'X', path: null }]);
  assert.deepEqual(ticketsOf({ qr_text: 'A', tickets: two }), two);
  assert.deepEqual(ticketsOf({}), []);
});
