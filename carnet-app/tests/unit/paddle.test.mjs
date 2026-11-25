import test from 'node:test';
import assert from 'node:assert/strict';
import { minRect, regions, joinRows } from '../../src/lib/paddle.js';
import { believability } from '../../src/lib/receipt.js';

test('smallest rectangle: level and tilted text lines', () => {
  const r = minRect([[10, 20], [110, 20], [110, 40], [10, 40]]);
  assert.ok(Math.abs(r.w - 100) < 1e-6 && Math.abs(r.h - 20) < 1e-6 && Math.abs(r.a) < 1e-6);
  assert.deepEqual([r.cx, r.cy], [60, 30]);
  // The same box turned 10°: width stays the long side, angle comes back.
  const a = (10 * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const t = minRect([[0, 0], [100, 0], [100, 20], [0, 20]].map(([x, y]) => [x * c - y * s, x * s + y * c]));
  assert.ok(Math.abs(t.w - 100) < 1e-6 && Math.abs(t.h - 20) < 1e-6 && Math.abs(t.a - a) < 1e-6);
});

test('text regions from the detector map, widened like PaddleOCR', () => {
  const W = 60, H = 30, p = new Float32Array(W * H);
  for (let y = 10; y < 16; y++) for (let x = 5; x < 45; x++) p[y * W + x] = 0.9; // one word
  p[2 * W + 50] = 0.9; // a speck: ignored
  const [r, ...rest] = regions(p, W, H);
  assert.equal(rest.length, 0);
  const d = (40 * 6 * 1.5) / (2 * 46);
  assert.ok(Math.abs(r.w - (40 + 2 * d)) < 1e-6 && Math.abs(r.h - (6 + 2 * d)) < 1e-6);
});

test('boxes on the same line join into one row, left to right', () => {
  const text = joinRows([
    { text: '2.10', x: 300, y0: 102, y1: 122 }, { text: 'Croissant', x: 10, y0: 100, y1: 120 },
    { text: 'TOTAL', x: 10, y0: 140, y1: 160 }, { text: 'TESCO', x: 100, y0: 10, y1: 40 },
  ]);
  assert.equal(text, 'TESCO\nCroissant  2.10\nTOTAL');
});

test('the more believable reading: adds up beats more lines', () => {
  const adds = { lines: [{ price: 2 }, { price: 3 }], printedTotal: 5, matchesTotal: true };
  const more = { lines: [{ price: 2 }, { price: 3 }, { price: 9 }, { price: 1 }], printedTotal: 5, matchesTotal: false };
  const none = { lines: [{ price: 2 }], printedTotal: null, matchesTotal: false };
  assert.ok(believability(adds) > believability(more));
  assert.ok(believability(more) > believability(none));
});
