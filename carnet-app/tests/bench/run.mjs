// Benchmark: node --require ./tests/harness/core-pin.cjs tests/bench/run.mjs --config A0 [--write]
// Env: CARNET_FIXTURES (private folder with manifest.json), CARNET_OCR_CORE (app|bundled), CARNET_OCR_MODEL (app|4.0.0|4.0.0_best_int)
// Detailed results (with OCR text) go to $CARNET_FIXTURES/results/ — private. Only the summary below may be committed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadApp, imageCanvas, versions, APP } from '../harness/load.mjs';
import { extractTravel, extractReceipt } from '../harness/pipeline.mjs';
import { bestCER, matchPlace, wilson, amountRecall } from '../harness/metrics.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const config = arg('config', 'A0');
const only = arg('only', '');
const FIX = process.env.CARNET_FIXTURES;
if (!FIX) { console.log('CARNET_FIXTURES not set: private fixtures unavailable, skipping benchmark.'); process.exit(0); }
const man = JSON.parse(readFileSync(path.join(FIX, 'manifest.json'), 'utf8'));
const model = process.env.CARNET_OCR_MODEL || 'app';
const { capture: C, receipt: R } = await loadApp({ model });
let peak = 0; const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);

const detail = { config, versions: versions(model), when: new Date().toISOString(), travel: [], receipts: [] };
const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : '—');
const ci = (k, n) => { const [a, b] = wilson(k, n); return n ? `${Math.round(a * 100)}–${Math.round(b * 100)}%` : '—'; };

// ── Travel
const t = { labelled: 0, found: 0, exact: 0, proposed: 0, correct: 0, wrong: 0, nameless: 0, negFalse: 0, ms: [] };
const cerBy = {};
for (const f of man.travel) {
  if (only && !f.id.includes(only)) continue;
  const res = await extractTravel(C, await imageCanvas(path.join(FIX, f.file)));
  const hits = f.places.map((p) => res.shown.map((s) => matchPlace(s.name, p)).find(Boolean) || null);
  const correctProps = res.shown.filter((s) => f.places.some((p) => matchPlace(s.name, p)));
  t.labelled += f.places.length; t.found += hits.filter(Boolean).length; t.exact += hits.filter((h) => h === 'exact').length;
  t.proposed += res.shown.length; t.correct += correctProps.length; t.wrong += res.shown.length - correctProps.length;
  t.nameless += res.nameless; t.ms.push(res.ms);
  if (f.negative) t.negFalse += res.shown.length;
  const allText = [res.text, res.overlay].join('\n');
  const cers = f.keyTexts.map((k) => ({ ...k, cer: bestCER(k.text, allText) }));
  for (const c of cers) (cerBy[c.style] ||= []).push(c.cer);
  detail.travel.push({ id: f.id, ms: res.ms, post: res.post, shown: res.shown, nameless: res.nameless, hits, cers, text: res.text, overlay: res.overlay });
  console.error(`  ${f.id}: ${res.shown.map((s) => s.name).join(' | ') || '—'}${res.nameless ? ` (+${res.nameless} nameless)` : ''} · ${res.ms} ms`);
}

// ── Receipts
const r = { n: 0, totalLabelled: 0, totalRight: 0, itemsHit: 0, itemsN: 0, extra: 0, reconciledClaims: 0, reconciledWrong: 0, negItems: 0, ms: [] };
for (const f of man.receipts) {
  if (only && !f.id.includes(only)) continue;
  const res = await extractReceipt(C, R, await imageCanvas(path.join(FIX, f.file), 2400));
  const amounts = res.parsed.lines.filter((l) => !l.service).map((l) => l.price);
  r.n++; r.ms.push(res.ms);
  let rec = null;
  if (f.negative) r.negItems += amounts.length;
  if (f.items) { rec = amountRecall(f.items, amounts); r.itemsHit += rec.hit; r.itemsN += rec.n; r.extra += rec.extra; }
  const printed = res.parsed.lines.length || res.parsed.total ? res.parsed.total : null;
  if (f.total != null) { r.totalLabelled++; if (printed != null && Math.abs(printed - f.total) < 0.005) r.totalRight++; }
  if (res.parsed.matchesTotal && amounts.length) {
    r.reconciledClaims++;
    if (f.total == null || !f.items || Math.abs(res.parsed.sum - f.items.reduce((a, b) => a + b, 0)) > 0.005) r.reconciledWrong++;
  }
  detail.receipts.push({ id: f.id, ms: res.ms, angle: res.angle, conf: res.conf, total: res.parsed.total, sum: res.parsed.sum, matchesTotal: res.parsed.matchesTotal, amounts, recall: rec, text: res.text });
  console.error(`  ${f.id}: ${amounts.length} lines, total ${res.parsed.total}, ${rec ? `${rec.hit}/${rec.n} amounts` : ''} · ${res.ms} ms`);
}
clearInterval(tick);

const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)] : 0);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const v = detail.versions;
const md = `### ${config} — ${detail.when.slice(0, 16).replace('T', ' ')} UTC

Worker tesseract.js ${v.worker} · core ${v.core} (${v.simd}) · model ${v.model} · Node harness (browser numbers to follow on device)

**Travel (${man.travel.length} screenshots, ${t.labelled} labelled places, offline extraction)**

| Measure | Result | 95% interval |
| --- | --- | --- |
| Recall: labelled places proposed | ${t.found}/${t.labelled} (${pct(t.found, t.labelled)}) | ${ci(t.found, t.labelled)} |
| of which exact spelling | ${t.exact}/${t.labelled} | |
| Precision: proposals that are real places | ${t.correct}/${t.proposed} (${pct(t.correct, t.proposed)}) | ${ci(t.correct, t.proposed)} |
| Wrong proposals | ${t.wrong} | |
| Proposals on the no-place slide | ${t.negFalse} | |
| “Type the name” cards | ${t.nameless} | |
| Time per screenshot, p50 / p95 | ${med(t.ms)} / ${p95(t.ms)} ms | |

| Text style | Key texts | Mean character error rate | Read exactly |
| --- | --- | --- | --- |
${Object.entries(cerBy).map(([s, a]) => `| ${s} | ${a.length} | ${(avg(a) * 100).toFixed(0)}% | ${a.filter((x) => x === 0).length}/${a.length} |`).join('\n')}

**Receipts (${r.n} photos)**

| Measure | Result |
| --- | --- |
| Item amounts found | ${r.itemsHit}/${r.itemsN} (${pct(r.itemsHit, r.itemsN)}) |
| Extra amounts that aren't items | ${r.extra} |
| Printed total read correctly | ${r.totalRight}/${r.totalLabelled} |
| “Adds up” shown | ${r.reconciledClaims}, of which wrong or unverifiable ${r.reconciledWrong} |
| Amounts proposed on the parking notice | ${r.negItems} |
| Time per receipt, p50 / p95 | ${med(r.ms)} / ${p95(r.ms)} ms |

Peak process memory ${Math.round(peak / 1e6)} MB (Node; not representative of Safari).
`;
mkdirSync(path.join(FIX, 'results'), { recursive: true });
writeFileSync(path.join(FIX, 'results', `${config}.json`), JSON.stringify(detail, null, 1));
console.log(md);
if (process.argv.includes('--write')) {
  mkdirSync(path.join(APP, 'docs/benchmarks'), { recursive: true });
  writeFileSync(path.join(APP, 'docs/benchmarks', `${config}.md`), md);
}
process.exit(0);
