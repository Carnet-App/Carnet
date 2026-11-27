import test from 'node:test';
import assert from 'node:assert/strict';
// Stand-in canvases: a "page" lists its codes with where they sit; a crop keeps the codes inside it.
globalThis.document = { createElement: () => { const c = { width: 0, height: 0, codes: [] }; c.getContext = () => ({ drawImage: (src, x, y, w, h) => { c.codes = (src.codes || []).filter((k) => k.x >= x && k.x < x + w && k.y >= y && k.y < y + h).map((k) => ({ ...k, x: k.x - x, y: k.y - y })); } }); return c; } };
const { ticketsInPages, codesOnPage } = await import('../../src/lib/capture.js');
const read = (c) => c.codes?.[0]?.qr || null; // like a real reader: one code per picture
const page = (codes) => ({ canvas: { width: 1000, height: 1400, codes } });

test('one ticket per page: every page’s code, each with its whole page', () => {
  const pages = [1, 2, 3, 4].map((n) => page([{ qr: 'EIFFEL-' + n, x: 500, y: 300 }]));
  const t = ticketsInPages(pages, read);
  assert.deepEqual(t.map((k) => k.qr), ['EIFFEL-1', 'EIFFEL-2', 'EIFFEL-3', 'EIFFEL-4']);
  assert.equal(t[2].canvas, pages[2].canvas);
});
test('two or four to a sheet: each code found in its own part of the page', () => {
  assert.deepEqual(codesOnPage(page([{ qr: 'A', x: 500, y: 300 }, { qr: 'B', x: 500, y: 1000 }]).canvas, read).map((k) => k.qr).sort(), ['A', 'B']);
  const four = codesOnPage(page([{ qr: 'A', x: 200, y: 300 }, { qr: 'B', x: 700, y: 300 }, { qr: 'C', x: 200, y: 1000 }, { qr: 'D', x: 700, y: 1000 }]).canvas, read);
  assert.deepEqual(four.map((k) => k.qr).sort(), ['A', 'B', 'C', 'D']);
});
test('the same code on two pages (a receipt page repeating it) is one ticket', () => {
  assert.equal(ticketsInPages([page([{ qr: 'X', x: 10, y: 10 }]), page([{ qr: 'X', x: 10, y: 10 }])], read).length, 1);
});
