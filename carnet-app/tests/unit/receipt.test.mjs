import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, splitInputs } from '../../src/lib/receipt.js';
import { itemShares } from '../../src/lib/money.js';

test('a clean Tesco-style receipt: items and total', () => {
  const r = parseReceipt(`TESCO\n2 Tesco Mini Danish Pastries £4.50\n£2.25 each\n1 Tesco Maple And Pecan Plait 2 £2.10\n1 Tesco All Butter Croissant 2 £2.10\n1 Tesco Cinnamon Swirls 2 Pack £2.10\nTOTAL: £10.80\nCard £10.80`);
  assert.deepEqual(r.lines.map((l) => l.price), [4.5, 2.1, 2.1, 2.1]);
  assert.equal(r.total, 10.8);
  assert.equal(r.matchesTotal, true);
});

test('a lost decimal point after the currency sign ("£6 50")', () => {
  assert.equal(parseReceipt('1 x Elderflower Fizz £6 50').lines[0].price, 6.5);
});

test('"TOTAL:" with the amount on the next line', () => {
  assert.equal(parseReceipt('1 Latte 3.60\nTOTAL:\n£3.60').total, 3.6);
});

test('F2: a receipt with no printed total is not reported as reconciled', () => {
  const r = parseReceipt('1 Latte 3.60\n1 Croissant 2.10');
  assert.notEqual(r.matchesTotal, true);
});

test('F1: a printed service charge survives into the split', () => {
  const r = parseReceipt('1 Steak 24.00\n1 Wine 8.00\nService 4.00\nTOTAL 36.00');
  assert.equal(r.validation, 'reconciled');
  const { lines, adjustments, tipPct } = splitInputs(r);
  const { total } = itemShares(lines.map((l) => ({ price: l.price, who: ['a@x', 'b@x'] })), tipPct, null, 'GBP', adjustments);
  assert.equal(Math.round(total * 100), 3600);
});

test('a printed service percentage with no service line becomes the tip', () => {
  const r = parseReceipt('1 Steak 24.00\n1 Wine 8.00\nService 12.5%\nTOTAL 36.00');
  assert.equal(splitInputs(r).tipPct, 12.5);
  assert.equal(r.validation, 'reconciled');
});

test('a printed total that does not match is a difference, not reconciled', () => {
  const r = parseReceipt('1 Steak 24.00\n1 Wine 8.00\nTOTAL 40.00');
  assert.equal(r.validation, 'difference');
});

test('quantities are kept as separate fields, not folded into the name', () => {
  const l = parseReceipt('3 Tesco All Butter Croissant £6.45\n£2.15 each').lines[0];
  assert.equal(l.quantity, 3);
  assert.equal(l.unitPrice, 2.15);
});

test('F3: the check follows edits — fixing a misread line reconciles, breaking one shows the gap', async () => {
  const { checkTotal } = await import('../../src/lib/receipt.js');
  assert.deepEqual(checkTotal(3600, 3100, 400), { status: 'difference', diff: 100 });
  assert.deepEqual(checkTotal(3600, 3200, 400), { status: 'reconciled', diff: 0 });
  assert.deepEqual(checkTotal(null, 3200, 0), { status: 'unverified', diff: null });
  assert.equal(checkTotal(3600, 3200, 0, 12.5).status, 'reconciled');
});

// Layouts seen on real receipts, written out with made-up items.
const P = (t) => parseReceipt(t);
const prices = (r) => r.lines.filter((l) => !l.service).map((l) => l.price);

test('quantity × unit price columns, VAT codes after the amounts', () => {
  const r = P('WATER 0,75 L 2,000 x 4,40 E+ 8,80\nSPRITZ 4,000 x 7,00 E+ 28,00\nBURGER 1,000 x 11,50 F- 11,50\nUKUPNO € 48,30');
  assert.deepEqual(prices(r), [8.8, 28, 11.5]);
  assert.equal(r.lines[0].quantity, 2);
  assert.equal(r.lines[0].unitPrice, 4.4);
  assert.equal(r.validation, 'reconciled');
});

test('name on one line, unit / quantity / total on the next', () => {
  const r = P('CAULIFLOWER PISTACHIO\n14,50 2,00 29,00 H\nPULLED PORK 21,00 1,00 21,00 H\nUkupno: 50,00 EUR');
  assert.deepEqual(prices(r), [29, 21]);
  assert.equal(r.lines[0].name, 'CAULIFLOWER PISTACHIO');
  assert.equal(r.lines[0].quantity, 2);
  assert.equal(r.validation, 'reconciled');
});

test('"2 x £5.00 £10.00" under its name; "£2.25 each" is a unit price, not an item', () => {
  const r = P('2 Almond Croissant\n2 x £5.00 £10.00\n2 Natas £3.50\nTotal £13.50');
  assert.deepEqual(prices(r), [10, 3.5]);
  assert.equal(r.lines[0].quantity, 2);
  assert.equal(r.lines[0].unitPrice, 5);
  const t = P('2 Mini Pastries £4.50\n£2.25 each\n1 Plait £2.10\nTOTAL: £6.60');
  assert.deepEqual(prices(t), [4.5, 2.1]);
  assert.equal(t.lines[0].unitPrice, 2.25);
});

test('unit and line-total columns; "1x" quantities with a VAT letter', () => {
  const r = P('1 Doppelter Espresso 4,20 4,20 A\n1 Salat 5,50 5,50 A\nSumme in € 9,70');
  assert.deepEqual(prices(r), [4.2, 5.5]);
  const b = P('1x cappuchino 3,70 A\n1x nachos 11,50 B\n1x Samen doorgeven 0,00 D\nA 21% 3,70\nBTW: 0,64\nTotaal: EUR 15,20\nBancontact 15,20');
  assert.deepEqual(prices(b), [3.7, 11.5]);
  assert.equal(b.validation, 'reconciled');
});

test('the total the lines add up to wins over "balance to pay" after a deposit', () => {
  const r = P('1 Camera Body 1599.00\nTotal: 1599.00\nMc 159.90\nSale Value: 1599.00\nTotal Deposit: 159.90\nBalance To Pay: 1439.10');
  assert.deepEqual(prices(r), [1599]);
  assert.equal(r.printedTotal, 1599);
  assert.equal(r.validation, 'reconciled');
});

test('savings are discounts; a percentage service line is the service', () => {
  const r = P('PEPPERS £0.70\nCHICKEN £9.50\nBalance before Saving £10.20\nPrice Saving -£0.01\nBalance to Pay £10.19');
  assert.deepEqual(prices(r), [0.7, 9.5]);
  assert.deepEqual(r.adjustments.map((a) => a.amount), [-0.01]);
  assert.equal(r.validation, 'reconciled');
  const s = P('1 Chicken = 16.80\n2 Mojito = 16.00\nSubtotal 32.80\n12.5% Serv 4.10\nTotal £36.90');
  assert.equal(s.lines.find((l) => l.service).price, 4.1);
  assert.equal(s.validation, 'reconciled');
  assert.equal(s.currency, 'GBP');
});

test('tax tables and card slips are not items', () => {
  const r = P('Linguine 20,00€ 20,00€\nTOTAL TTC 20,00€\nSoit par client 6,66€\nPDV 13% 13,00 111,50 14,50\nNetto 61,25');
  assert.deepEqual(prices(r), [20]);
  assert.equal(r.currency, 'EUR');
});

test('the amount paid backs up a total that was missed or misread', () => {
  const r = parseReceipt('2 Natas £3.50\n2 Croissant £3.50\nTotal\nVAT 20% £1.17\nCard payment £7.00');
  assert.equal(r.printedTotal, 7);
  assert.equal(r.validation, 'reconciled', 'the VAT line under a bare "Total" is not the total');
  const s = parseReceipt('Food Paper Ba £0.40\nCALDON GLD SL £10.75\nBalance to Pay £11.15\nYour total saving today is £0.01');
  assert.equal(s.printedTotal, 11.15, '"total saving" is not the total');
});

test('a payment slip with no item lines: the amount, nothing to check it against', () => {
  const r = parseReceipt('DETTAGLIO PAGAMENTI: 313.36\nC. CREDITO');
  assert.equal(r.printedTotal, 313.36);
  assert.equal(r.validation, 'unverified');
  assert.equal(r.lines.length, 0);
});
