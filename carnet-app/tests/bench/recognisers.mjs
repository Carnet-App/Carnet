// Recogniser feasibility: identical heading crops through each candidate engine.
//   node --require ./tests/harness/core-pin.cjs tests/bench/recognisers.mjs [--write]
// Env: CARNET_FIXTURES (needs crops.json + crops/), CARNET_ALT_OCR (folder where @gutenye/ocr-node is installed; optional)
// Nothing here ships in the app. Results with OCR text stay in the private folder.
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from 'canvas';
import { APP } from '../harness/load.mjs';
import { editDistance, fold } from '../harness/metrics.mjs';

const FIX = process.env.CARNET_FIXTURES;
if (!FIX) { console.log('CARNET_FIXTURES not set; skipping.'); process.exit(0); }
const crops = JSON.parse(readFileSync(path.join(FIX, 'crops.json'), 'utf8'));
const req = createRequire(path.join(APP, 'package.json'));
const { createWorker } = req('tesseract.js');
const cer = (exp, got) => Math.min(1, editDistance(fold(exp), fold(got || '')) / fold(exp).length);
const rss = () => process.memoryUsage().rss;
const dirSize = (d) => readdirSync(d).reduce((a, f) => a + statSync(path.join(d, f)).size, 0);

// Scale a crop so its height is ~64 px (about a 36–40 px capital height for one line).
async function scaled(file, h = 64) {
  const img = await loadImage(file);
  const s = h / img.height;
  const pad = 16;
  const c = createCanvas(Math.round(img.width * s) + pad * 2, h + pad * 2);
  const g = c.getContext('2d');
  // Pad with the crop's own edge colour so no artificial border appears.
  g.drawImage(img, 0, 0, 1, 1, 0, 0, c.width, c.height);
  g.drawImage(img, pad, pad, img.width * s, h);
  return c;
}
// The app's current photo-text pre-processing: keep only near-white pixels.
function whiteOnly(c) {
  const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const lo = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]), hi = Math.max(d.data[i], d.data[i + 1], d.data[i + 2]);
    const v = lo > 205 && hi - lo < 40 ? 0 : 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  const o = createCanvas(c.width, c.height); o.getContext('2d').putImageData(d, 0, 0); return o;
}

async function tesseract(model, prep) {
  const langPath = model === 'app' ? path.join(APP, 'public/ocr/lang') : path.join(APP, 'node_modules/@tesseract.js-data/eng', model).replace('/eng/', '/eng/');
  // Both languages from the same model family.
  const dir = path.join(APP, 'tests/.cache/lang', model);
  mkdirSync(dir, { recursive: true });
  for (const l of ['eng', 'fra']) {
    const src = model === 'app' ? path.join(APP, 'public/ocr/lang', `${l}.traineddata.gz`) : path.join(APP, 'node_modules/@tesseract.js-data', l, model, `${l}.traineddata.gz`);
    writeFileSync(path.join(dir, `${l}.traineddata.gz`), readFileSync(src));
  }
  const m0 = rss(), t0 = Date.now();
  const w = await createWorker(['eng', 'fra'], 1, { langPath: dir, gzip: true, cacheMethod: 'none' });
  await w.setParameters({ tessedit_pageseg_mode: '7' });
  const init = Date.now() - t0;
  return {
    id: `tesseract ${model}${prep ? ' + white-only' : ''}`, size: dirSize(dir), init, mem0: m0,
    read: async (file) => { let c = await scaled(file); if (prep) c = whiteOnly(c); const { data } = await w.recognize(c.toBuffer('image/png')); return data.text.trim(); },
    stop: () => w.terminate(),
  };
}

async function paddle() {
  const dir = process.env.CARNET_ALT_OCR;
  if (!dir) return null;
  const alt = createRequire(path.join(dir, 'package.json'));
  const Ocr = (await import(alt.resolve('@gutenye/ocr-node'))).default;
  const models = path.join(dir, 'node_modules/@gutenye/ocr-models');
  const m0 = rss(), t0 = Date.now();
  const ocr = await Ocr.create();
  const init = Date.now() - t0;
  const assets = path.join(models, 'assets');
  return {
    id: 'PaddleOCR PP-OCRv4 mobile (ONNX)', size: dirSize(assets), init, mem0: m0,
    read: async (file) => { const c = await scaled(file, 64); const p = path.join(FIX, 'crops', '.tmp.png'); writeFileSync(p, c.toBuffer('image/png')); const out = await ocr.detect(p); return (out.texts || []).map((l) => l.text).join(' ').trim(); },
    stop: async () => {},
  };
}

const engines = [() => tesseract('app', false), () => tesseract('4.0.0_best_int', false), () => tesseract('app', true), paddle];
const results = [];
for (const make of engines) {
  const e = await make();
  if (!e) continue;
  let peak = rss(); const tick = setInterval(() => { peak = Math.max(peak, rss()); }, 20);
  await e.read(path.join(FIX, 'crops', crops[0].id + '.png')); // warm-up
  const rows = [];
  for (const c of crops) {
    const t0 = Date.now();
    const got = await e.read(path.join(FIX, 'crops', c.id + '.png'));
    rows.push({ id: c.id, style: c.style, expected: c.text, got, ms: Date.now() - t0, cer: cer(c.text, got), exact: fold(got).replace(/\s+/g, ' ') === fold(c.text) });
  }
  clearInterval(tick);
  results.push({ engine: e.id, sizeMB: +(e.size / 1e6).toFixed(1), initMs: e.init, peakMB: Math.round((peak - e.mem0) / 1e6), rows });
  await e.stop();
  console.error(`${e.id}: ${rows.map((r) => `${r.id}=${JSON.stringify(r.got)}`).join('  ')}`);
}

const styles = ['handwritten', 'stylised', 'printed'];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
let md = `### Recogniser feasibility — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n\nSame ${crops.length} crops for every engine (7 handwritten, 3 stylised, 2 printed), each scaled to 64 px high and read as one line. Node, x86 CPU; phone timings will differ.\n\n| Engine | Model download | Start-up | Warm read, median | Extra memory | ${styles.map((s) => `${s[0].toUpperCase() + s.slice(1)}: exact · mean CER`).join(' | ')} |\n| --- | --- | --- | --- | --- | ${styles.map(() => '---').join(' | ')} |\n`;
for (const r of results) {
  md += `| ${r.engine} | ${r.sizeMB} MB | ${r.initMs} ms | ${med(r.rows.map((x) => x.ms))} ms | ${r.peakMB} MB | ${styles.map((s) => { const xs = r.rows.filter((x) => x.style === s); return `${xs.filter((x) => x.exact).length}/${xs.length} · ${Math.round((xs.reduce((a, x) => a + x.cer, 0) / xs.length) * 100)}%`; }).join(' | ')} |\n`;
}
writeFileSync(path.join(FIX, 'results', 'recognisers.json'), JSON.stringify(results, null, 1));
console.log(md);
if (process.argv.includes('--write')) { mkdirSync(path.join(APP, 'docs/benchmarks'), { recursive: true }); writeFileSync(path.join(APP, 'docs/benchmarks/recognisers.md'), md); }
process.exit(0);
