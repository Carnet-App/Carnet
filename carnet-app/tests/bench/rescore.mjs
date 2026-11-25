// Re-scores saved receipt OCR text (results/<config>.json) with the current parser: parser changes
// measured in seconds, without re-reading the images.
//   node tests/bench/rescore.mjs R0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseReceipt } from '../../src/lib/receipt.js';
import { amountRecall } from '../harness/metrics.mjs';
const FIX = process.env.CARNET_FIXTURES;
if (!FIX) { console.log('CARNET_FIXTURES not set'); process.exit(0); }
const config = process.argv[2] || 'R0';
const man = JSON.parse(readFileSync(path.join(FIX, 'manifest.json'), 'utf8'));
const res = JSON.parse(readFileSync(path.join(FIX, 'results', `${config}.json`), 'utf8'));
const by = Object.fromEntries(res.receipts.map((r) => [r.id, r]));
const t = { hit: 0, n: 0, extra: 0, totalN: 0, totalRight: 0, claims: 0, wrong: 0, neg: 0 };
const verbose = process.argv.includes('-v');
for (const f of man.receipts) {
  const r = by[f.id];
  if (!r) continue;
  const p = parseReceipt(r.text);
  const amounts = p.lines.filter((l) => !l.service).map((l) => l.price);
  if (f.negative) t.neg += amounts.length;
  let rec = null;
  if (f.items) { rec = amountRecall(f.items, amounts); t.hit += rec.hit; t.n += rec.n; t.extra += rec.extra; }
  if (f.total != null) { t.totalN++; if (p.printedTotal != null && Math.abs(p.printedTotal - f.total) < 0.005) t.totalRight++; }
  if (p.matchesTotal) { t.claims++; if (f.total == null || Math.abs(p.printedTotal - f.total) > 0.005) t.wrong++; }
  if (verbose) console.log(f.id.padEnd(4), rec ? `${rec.hit}/${rec.n}`.padEnd(6) : '      ', `extra ${rec?.extra ?? '-'}`.padEnd(9), `total ${p.printedTotal ?? '—'} (${f.total ?? '?'})`.padEnd(24), p.validation, '·', f.label);
}
console.log(`${config} text, current parser: amounts ${t.hit}/${t.n} (${Math.round((100 * t.hit) / t.n)}%), extra ${t.extra}, totals ${t.totalRight}/${t.totalN}, "adds up" ${t.claims} (wrong ${t.wrong}), amounts on non-bills ${t.neg}`);
