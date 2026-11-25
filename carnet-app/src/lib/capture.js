import { parseReceipt, lineAmount, chooseAlternatives, evidenceAlts } from './receipt.js';
import { handleName, squashName } from './match.js';
// Reading screenshots, screen recordings, receipts and tickets — all on the phone.
import jsQR from 'jsqr';

let workerP;
async function ocrWorker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker(['eng', 'fra'], 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/',
        langPath: '/ocr/lang',
        gzip: true,
        workerBlobURL: false,
      });
    })();
    // A failed start (offline before the models were cached, say) must not fail every later read.
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

// Every read goes through one queue and sets its whole profile, so one read's settings can
// never leak into the next (before this, the first screenshot of a session read differently).
export const OCR_PROFILES = {
  document: { tessedit_pageseg_mode: '3', preserve_interword_spaces: '0' },
  rows: { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' },
  line: { tessedit_pageseg_mode: '7', preserve_interword_spaces: '0' },
};
const toInput = (img) => img; // the test harness swaps this for a PNG buffer
let ocrQueue = Promise.resolve();
export function recognise(img, profile = 'document') {
  const job = ocrQueue.then(async () => {
    const w = await ocrWorker();
    await w.setParameters(OCR_PROFILES[profile]);
    const { data } = await w.recognize(toInput(img), {}, { text: true, blocks: true });
    return data;
  });
  ocrQueue = job.catch(() => undefined); // a failed read doesn't block the ones after it
  return job;
}

export async function loadImage(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, url };
}

export function toCanvas(src, maxW = 1600) {
  const w = src.videoWidth || src.naturalWidth || src.width;
  const h = src.videoHeight || src.naturalHeight || src.height;
  const s = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function readQR(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
  return r?.data || null;
}

export async function readText(canvasOrImg, onProgress) {
  const data = await recognise(canvasOrImg, 'document');
  onProgress?.(1);
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || [])
    lines.push({ text: (l.text || '').trim(), y: l.bbox.y0, h: l.bbox.y1 - l.bbox.y0, x: l.bbox.x0, w: l.bbox.x1 - l.bbox.x0, conf: l.confidence });
  return { text: data.text || '', lines, height: canvasOrImg.height || 1 };
}

// ── Receipts ──────────────────────────────────────────────────────────
// Photos of receipts come with tables, hands, shadows and sideways paper. Before reading:
// cut out the paper, turn it upright, even out the light, and read it as rows (so each item
// stays on the same line as its price).
function paperBox(src) {
  const w = 400, s = w / src.width, h = Math.round(src.height * s);
  const c = globalThis.__mkCanvas ? globalThis.__mkCanvas() : document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const rows = new Float32Array(h), cols = new Float32Array(w);
  // "Bright" relative to this photo's own light: a receipt in a dim restaurant is still the brightest thing.
  const lum = [];
  for (let i = 0; i < d.length; i += 16) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  lum.sort((a, b) => a - b);
  const bright = Math.max(90, lum[Math.floor(lum.length * 0.95)] * 0.72);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, lo = Math.min(d[i], d[i + 1], d[i + 2]), hi = Math.max(d[i], d[i + 1], d[i + 2]);
    if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > bright && hi - lo < 70) { rows[y]++; cols[x]++; }
  }
  const run = (arr, n, min) => { // longest stretch where enough of the line is paper
    let best = [0, n], cur = -1, gap = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n && arr[i] >= min) { if (cur < 0) cur = i; gap = 0; }
      else if (cur >= 0 && (++gap > n * 0.03 || i === n)) { const e = i - gap + 1; if (e - cur > best[1] - best[0] || best[1] - best[0] === n) best = [cur, e]; cur = -1; gap = 0; }
    }
    return best;
  };
  const [y0, y1] = run(rows, h, w * 0.12);
  const [x0, x1] = run(cols, w, (y1 - y0) * 0.12);
  const pad = 0.03;
  const bx = Math.max(0, (x0 / s) - src.width * pad), by = Math.max(0, (y0 / s) - src.height * pad);
  const bw = Math.min(src.width - bx, (x1 - x0) / s + src.width * pad * 2), bh = Math.min(src.height - by, (y1 - y0) / s + src.height * pad * 2);
  // A "paper" that's most of the photo or a sliver isn't a useful crop.
  if (bw * bh > src.width * src.height * 0.92 || bw < src.width * 0.15 || bh < src.height * 0.15) return { x: 0, y: 0, w: src.width, h: src.height };
  return { x: bx, y: by, w: bw, h: bh };
}
// Receipt image preparation: 'sauvola' (default), 'local' (the old fixed threshold), 'gray'.
let RECEIPT_PREP = 'sauvola';
export const _setReceiptPrep = (m) => { RECEIPT_PREP = m; };
function prepared(src, box, angle, width) {
  const rot = angle % 180 !== 0;
  const s = width / (rot ? box.h : box.w);
  const W = Math.round((rot ? box.h : box.w) * s), H = Math.round((rot ? box.w : box.h) * s);
  const c = globalThis.__mkCanvas ? globalThis.__mkCanvas() : document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.translate(W / 2, H / 2);
  g.rotate((angle * Math.PI) / 180);
  g.drawImage(src, box.x, box.y, box.w, box.h, -(box.w * s) / 2, -(box.h * s) / 2, box.w * s, box.h * s);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Even out the light: compare each pixel with its neighbourhood (shadows and glare cancel out).
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += gray[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  // Paper brightness, from the brighter half of the crop: what "background" means for this photo.
  const hist = new Uint32Array(256);
  for (let i = 0; i < W * H; i++) hist[Math.min(255, gray[i] | 0)]++;
  const pct = (p) => { let n = 0; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= W * H * p) return v; } return 255; };
  const paper = Math.max(60, pct(0.75));
  if (RECEIPT_PREP === 'gray') {
    // Contrast stretch only, Tesseract binarises itself.
    const lo = pct(0.02), hi = paper;
    for (let i = 0; i < W * H; i++) { const v = Math.max(0, Math.min(255, ((gray[i] - lo) / Math.max(1, hi - lo)) * 255)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c;
  }
  const I2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { const v = gray[y * W + x]; row += v * v; I2[(y + 1) * (W + 1) + x + 1] = I2[y * (W + 1) + x + 1] + row; } }
  const r = RECEIPT_PREP === 'local' ? Math.max(8, Math.round(W / 40)) : Math.max(10, Math.round(W / 30));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1), ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
    const n = (xb - xa) * (yb - ya);
    const sum = (A) => A[yb * (W + 1) + xb] - A[ya * (W + 1) + xb] - A[yb * (W + 1) + xa] + A[ya * (W + 1) + xa];
    const mean = sum(I) / n;
    let v;
    if (RECEIPT_PREP === 'local') v = mean < 115 ? 255 : gray[y * W + x] < mean * 0.86 ? 0 : 255;
    else {
      // Sauvola, with the dynamic range taken from this photo's paper, not a fixed 128: dim
      // restaurant photos keep their print. Only areas far darker than the paper (table, hand) blank.
      const sd = Math.sqrt(Math.max(0, sum(I2) / n - mean * mean));
      const R = Math.max(32, paper / 2);
      v = mean < paper * 0.35 ? 255 : gray[y * W + x] < mean * (1 + 0.2 * (sd / R - 1)) ? 0 : 255;
    }
    const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
async function readRows(canvas) {
  const data = await recognise(canvas, 'rows'); // one block of rows
  const rows = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || [])
    rows.push({ text: (l.text || '').replace(/\n$/, ''), y0: l.bbox.y0, y1: l.bbox.y1, x0: l.bbox.x0 });
  return { text: data.text || '', conf: data.confidence || 0, rows };
}

// Faint price column (dim restaurant photo, print fading on the right): read the right-hand part
// on its own, without the threshold that wiped it, and put each amount back on the line at the
// same height. Only lines that have a name and no amount are filled.
const HAS_AMOUNT = /\d[.,]\s?\d{2}(?!\d)/;
async function recoverColumn(src, box, angle, main) {
  const was = RECEIPT_PREP;
  RECEIPT_PREP = 'gray';
  const full = prepared(src, box, angle, 1800);
  RECEIPT_PREP = was;
  const x = Math.round(full.width * 0.58), w = full.width - x;
  const k = 1.5;
  const c = globalThis.__mkCanvas ? globalThis.__mkCanvas() : document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(full.height * k);
  const g = c.getContext('2d');
  g.drawImage(full, x, 0, w, full.height, 0, 0, c.width, c.height);
  const col = await readRows(c);
  const found = col.rows.filter((r) => HAS_AMOUNT.test(r.text)).map((r) => ({ text: r.text.trim(), y: (r.y0 + r.y1) / 2 / k }));
  if (!found.length) return null;
  const used = new Set();
  let added = 0;
  const lines = main.rows.map((r) => {
    if (HAS_AMOUNT.test(r.text) || !/\p{L}{3}/u.test(r.text)) return r.text;
    const mid = (r.y0 + r.y1) / 2, h = Math.max(12, r.y1 - r.y0);
    let best = null;
    for (const [i, a] of found.entries()) if (!used.has(i) && Math.abs(a.y - mid) < h * 0.7 && (!best || Math.abs(a.y - mid) < Math.abs(best.a.y - mid))) best = { i, a };
    if (!best) return r.text;
    used.add(best.i);
    added++;
    return `${r.text}  ${best.a.text}`;
  });
  return added ? { text: lines.join('\n'), added } : null;
}
const REREAD_ROWS = false;
async function rereadRows(src, box, angle, pick, parsed) {
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const items = parsed.lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.service && l.src);
  if (items.length < 3 || items.length > 40) return null;
  const was = RECEIPT_PREP;
  RECEIPT_PREP = 'gray';
  const gray = prepared(src, box, angle, pick.canvas.width);
  RECEIPT_PREP = was;
  const alts = {}, rowOf = {};
  for (const { l, i } of items) {
    const row = pick.rows.find((r) => norm(r.text) === l.src) || pick.rows.find((r) => norm(r.text).includes(l.src.slice(0, 14)));
    if (!row) continue;
    rowOf[i] = row;
    const pad = Math.max(4, Math.round((row.y1 - row.y0) * 0.25)), y = Math.max(0, row.y0 - pad), h = Math.min(pick.canvas.height - y, row.y1 - row.y0 + pad * 2);
    const vs = [];
    for (const base of [pick.canvas, gray]) {
      const k = 2;
      const c = globalThis.__mkCanvas ? globalThis.__mkCanvas() : document.createElement('canvas');
      c.width = base.width * k; c.height = h * k;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(base, 0, y, base.width, h, 0, 0, c.width, c.height);
      const d = await recognise(c, 'line');
      const a = lineAmount((d.text || '').replace(/\n/g, ' '));
      if (a) vs.push(a.value);
    }
    // The line's own quantity × unit price is a reading too ("14,50 2,00 20,00": 29,00).
    vs.push(...evidenceAlts(l));
    if (vs.length) alts[i] = vs;
  }
  const pickAlt = chooseAlternatives(parsed.lines, parsed.printedTotal, alts, parsed.servicePct && !parsed.lines.some((l) => l.service) ? parsed.servicePct : null);
  if (!pickAlt) return null;
  let text = pick.text;
  const corrections = [];
  for (const { i, to } of pickAlt) {
    const row = rowOf[i], was2 = lineAmount(row.text);
    if (!was2) return null;
    const dec = /,\d{2}$/.test(was2.text.replace(/[^\d.,]/g, '')) ? ',' : '.';
    const fixed = row.text.replace(was2.text, was2.text.replace(/\d[\d\s.,]*\d/, to.toFixed(2).replace('.', dec)));
    text = text.replace(row.text, fixed);
    corrections.push({ name: parsed.lines[i].name, from: parsed.lines[i].price, to, reason: 'a closer look at that line' });
  }
  return { text, corrections };
}
const priceCount = (t) => (t.match(/[£€$]?\s?\d{1,4}[.,]\d{2}\b/g) || []).length;
// A screenshot of a photo (the Photos app, a chat): the phone's own interface above and below is
// plain white or black. Keep only the photo, so the receipt is found inside it, not the white UI.
export function screenshotPhoto(src) {
  if (src.height / src.width < 1.9) return src;
  const w = 200, k = w / src.width, h = Math.round(src.height * k);
  const c = globalThis.__mkCanvas ? globalThis.__mkCanvas() : document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const ui = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    let flat = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const chroma = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      if ((l > 236 && chroma < 16) || l < 10) flat++;
    }
    ui[y] = flat > w * 0.92 ? 1 : 0;
  }
  // The longest stretch of picture rows (short gaps allowed).
  let best = [0, 0], cur = -1, gap = 0;
  const maxGap = Math.round(h * 0.015);
  for (let y = 0; y <= h; y++) {
    if (y < h && !ui[y]) { if (cur < 0) cur = y; gap = 0; }
    else if (cur >= 0 && (++gap > maxGap || y === h)) { const e = y - gap + 1; if (e - cur > best[1] - best[0]) best = [cur, e]; cur = -1; gap = 0; }
  }
  const len = best[1] - best[0];
  if (len < h * 0.25 || len > h * 0.88) return src;
  const y0 = Math.round(best[0] / k), y1 = Math.round(best[1] / k);
  const out = globalThis.__mkCanvas ? globalThis.__mkCanvas() : document.createElement('canvas');
  out.width = src.width; out.height = y1 - y0;
  out.getContext('2d').drawImage(src, 0, y0, src.width, y1 - y0, 0, 0, src.width, y1 - y0);
  return out;
}
export async function readReceipt(src, onProgress) {
  src = screenshotPhoto(src);
  const box = paperBox(src);
  // Which way up? Read a small copy each way and keep the one with the most prices and best confidence.
  let best = null;
  let box2 = box;
  const portrait = box.h >= box.w;
  for (const angle of portrait ? [0, 90, 270] : [90, 270, 0]) {
    onProgress?.('Finding which way up it is…');
    let t = await readRows(prepared(src, box, angle, 900));
    // Cut-out found no prices at all? Try the whole photo before giving up on this way up.
    if (!priceCount(t.text) && box.w * box.h < src.width * src.height * 0.9) {
      const whole = { x: 0, y: 0, w: src.width, h: src.height };
      const t2 = await readRows(prepared(src, whole, angle, 900));
      if (priceCount(t2.text) > priceCount(t.text)) { t = t2; box2 = whole; } else box2 = box;
    } else box2 = box;
    const score = priceCount(t.text) * 10 + t.conf;
    if (!best || score > best.score) best = { angle, score, box: box2 };
    if (priceCount(t.text) >= 3 && t.conf > 70) break; // clearly readable: no need to try the others
  }
  onProgress?.('Reading the receipt…');
  // Two ways of evening out the light suit different photos (Sauvola keeps faint and dim print,
  // the older fixed threshold suits small screenshots). Read with the first; if the lines don't
  // add up to a printed total, read with the second too and keep the better reading.
  const tries = RECEIPT_PREP === 'sauvola' ? ['sauvola', 'local'] : [RECEIPT_PREP];
  let pick = null;
  for (const mode of tries) {
    const was = RECEIPT_PREP;
    RECEIPT_PREP = mode;
    const c = prepared(src, best.box, best.angle, 1800);
    RECEIPT_PREP = was;
    const r = await readRows(c);
    const p = parseReceipt(r.text);
    const score = (p.validation === 'reconciled' ? 1000 : 0) + (p.printedTotal != null ? 50 : 0) + 10 * p.lines.length + r.conf / 10;
    if (!pick || score > pick.score) pick = { ...r, score, canvas: c, prep: mode, parsed: p };
    if (p.validation === 'reconciled') break;
    if (mode !== tries[tries.length - 1]) onProgress?.('Having another look…');
  }
  // Item names with no prices next to them: the price column faded. Try to recover it.
  if (pick.parsed.validation !== 'reconciled') {
    const named = pick.rows.filter((r) => /\p{L}{3}/u.test(r.text) && !HAS_AMOUNT.test(r.text)).length;
    if (named >= 3 && pick.parsed.lines.length < named) {
      onProgress?.('Looking closer at the prices…');
      const rec = await recoverColumn(src, best.box, best.angle, pick).catch(() => null);
      if (rec) {
        const p = parseReceipt(rec.text);
        const score = (p.validation === 'reconciled' ? 1000 : 0) + (p.printedTotal != null ? 50 : 0) + 10 * p.lines.length + pick.conf / 10;
        if (score > pick.score) pick = { ...pick, text: rec.text, score, recovered: rec.added };
      }
    }
  }
  // The lines don't add up to the printed total: look closer at each priced row, read in two
  // ways, and take the single combination of readings that makes everything add up.
  let corrections = [];
  const parsed = parseReceipt(pick.text);
  // Off for now: on the 55-receipt set it corrected nothing the column check doesn't, and added
  // several seconds (docs/benchmarks/P4.md). Kept for the second reader, whose rows it can use.
  if (REREAD_ROWS && parsed.validation === 'difference' && parsed.printedTotal != null) {
    onProgress?.('Checking the prices against the total…');
    const fix = await rereadRows(src, best.box, best.angle, pick, parsed).catch(() => null);
    if (fix) ({ text: pick.text, corrections } = { text: fix.text, corrections: fix.corrections });
  }
  return { text: pick.text, conf: pick.conf, angle: best.angle, canvas: pick.canvas, prep: pick.prep, recovered: pick.recovered || 0, corrections };
}

// PDFs (e-tickets, booking confirmations, bills): each page drawn on the phone. The PDF's own text
// is used when it has one (exact, and instant); only a scanned PDF is read with OCR.
export const isPdf = (file) => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
async function pdfDoc(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}
export async function pdfPages(file, { maxPages = 4, width = 1600 } = {}) {
  const doc = await pdfDoc(file);
  const out = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / base.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const tc = await page.getTextContent();
    // The text layer as lines, top to bottom, in the same shape OCR gives.
    const rows = [];
    for (const it of tc.items) {
      if (!it.str?.trim()) continue;
      const [x, yUp] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = Math.abs(it.transform[3]) * vp.scale;
      const y = yUp - h;
      const row = rows.find((r) => Math.abs(r.y - y) < h * 0.5);
      if (row) row.parts.push({ x, s: it.str }); else rows.push({ y, h, parts: [{ x, s: it.str }] });
    }
    rows.sort((a, b) => a.y - b.y);
    const lines = rows.map((r) => ({ text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim(), y: r.y, h: r.h, x: Math.min(...r.parts.map((p) => p.x)), w: 0, conf: 99 }));
    out.push({ canvas: c, lines, text: lines.map((l) => l.text).join('\n') });
  }
  return out;
}
// A QR code anywhere on the first pages, read sharp (tickets often put it small, or on page 2).
export async function pdfTicket(file) {
  const pages = await pdfPages(file, { width: 2000 });
  let qr = null;
  for (const p of pages) { qr = readQR(p.canvas); if (qr) break; }
  return { qr, canvas: pages[0]?.canvas, text: pages.map((p) => p.text).join('\n') };
}
export async function readPdf(file, onProgress) {
  onProgress?.('Opening the PDF…');
  const pages = await pdfPages(file, { width: 1600 });
  if (!pages.length) throw new Error('that PDF has no pages');
  let qr = null;
  for (const p of pages) { qr = readQR(p.canvas); if (qr) break; }
  if (!qr) for (const p of (await pdfPages(file, { width: 2400, maxPages: 2 }))) { qr = readQR(p.canvas); if (qr) break; }
  const first = pages[0];
  if (pages.some((p) => p.text.trim().length > 20)) {
    const text = pages.map((p) => p.text).join('\n');
    return { text, lines: first.lines, height: first.canvas.height, qr, canvas: first.canvas, pdf: true };
  }
  // A scanned PDF: read the first page like a photo.
  const { text, lines, height } = await readText(first.canvas, onProgress);
  return { text, lines, height, qr, canvas: first.canvas, pdf: true };
}

export async function readImage(file, onProgress) {
  if (isPdf(file)) return readPdf(file, onProgress);
  const { img, url } = await loadImage(file);
  const canvas = toCanvas(img);
  const qr = readQR(canvas);
  const { text, lines, height } = await readText(canvas, onProgress);
  return { text, lines, height, qr, url, canvas };
}

// Screen recordings: look at ~1 frame a second, skip frames that barely changed.
export async function readVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.playsInline = true;
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = j; });
  const duration = Math.min(v.duration || 0, 90);
  const step = duration > 45 ? 2 : 1;
  const seen = new Set();
  const texts = [];
  let last = null, qr = null, firstCanvas = null;
  for (let t = 0.3; t < duration; t += step) {
    v.currentTime = t;
    await new Promise((r) => (v.onseeked = r));
    const c = toCanvas(v, 900);
    if (!firstCanvas) firstCanvas = c;
    const sig = signature(c);
    if (last && diff(sig, last) < 6) continue;
    last = sig;
    qr = qr || readQR(c);
    const { text } = await readText(c);
    for (const line of text.split('\n')) {
      const k = line.trim().toLowerCase();
      if (k.length > 2 && !seen.has(k)) { seen.add(k); texts.push(line.trim()); }
    }
    onProgress?.(t / duration);
  }
  return { text: texts.join('\n'), qr, url, canvas: firstCanvas };
}
function signature(c) {
  const s = document.createElement('canvas');
  s.width = 16; s.height = 16;
  const x = s.getContext('2d');
  x.drawImage(c, 0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data;
  return Array.from({ length: 256 }, (_, i) => (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3);
}
const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

export function thumbBlob(canvas, w = 640, box = null) {
  const y0 = box ? box.y0 : 0, sh = box ? box.y1 - box.y0 : canvas.height;
  const s = Math.min(1, w / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s);
  c.height = Math.round(sh * s);
  c.getContext('2d').drawImage(canvas, 0, y0, canvas.width, sh, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
}

// ── Social post screenshots ───────────────────────────────────────────
// Instagram / TikTok / Threads posts stack: header · photo · action bar (counts) · caption.
// The caption is the most trustworthy text; text laid over the photo comes second;
// the photo itself is the place's picture, not something to read words out of.
export function postLayout(lines, height) {
  if (!lines?.length) return null;
  // The post's header row: "service95 ✓ Follow". Its account name is the post's own handle.
  const followRow = lines.find((l) => l.y < height * 0.3 && /\bfollow(ing)?\b/i.test(l.text));
  let handle = followRow?.text.match(/([a-z0-9._]{3,30})\s*\S{0,3}\s*follow/i)?.[1]?.toLowerCase() || null;
  const counts = (t) => (t.match(/(?:^|\s)\(?\d[\d.,]*\s?[kKmM]?(?=\s|$)/g) || []).length;
  const bar = lines.find((l) => l.y > height * 0.3 && l.y < height * 0.97 && counts(l.text) >= 3 && l.text.length < 70);
  let barTop = bar ? bar.y : null, barEnd = bar ? bar.y + bar.h / 2 : null;
  if (!bar) {
    // Icons misread ("Q 428K Qas V3")? Anchor on the caption instead: it starts with the account name.
    const cap = lines.find((l) => l.y > height * 0.5 && l.conf > 85 && (handle ? l.text.toLowerCase().startsWith(handle) : /^[a-z0-9._]{3,30}\s+[\p{L}📍]/u.test(l.text)));
    if (!cap) return null;
    barTop = cap.y - height * 0.06;
    barEnd = cap.y - 1;
    handle ||= cap.text.match(/^([a-z0-9._]{3,30})/)?.[1]?.toLowerCase() || null;
  }
  const header = followRow || lines.filter((l) => l.y > height * 0.03 && l.y < height * 0.16 && l.conf > 60).pop();
  const y0 = header ? Math.round(header.y + header.h + height * 0.01) : Math.round(height * 0.1);
  const y1 = Math.round(barTop - height * 0.005);
  if (y1 - y0 < height * 0.2) return null;
  const caption = [];
  let last = barEnd;
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    if (l.y <= barEnd) continue;
    if (caption.length && l.y - last > height * 0.05) break;
    if (/^(follow|suggested|more posts)\b/i.test(l.text)) break;
    caption.push(l);
    last = l.y + l.h;
    if (/\b(ago|il y a)\b|^\d+\s?[smhdw]$/i.test(l.text) || (/^\d{1,2}\s/.test(l.text) && MONTH.test(l.text))) break; // the date ends a caption
  }
  handle ||= caption[0]?.text.match(/^([a-z0-9._]{3,30})\s/)?.[1]?.toLowerCase() || null;
  return { media: { y0, y1 }, caption: caption.map((l) => l.text).join('\n'), handle };
}

// The account's own name, "Follow" buttons and the like are never the place.
export function notTheAccount(cands, handle) {
  const h = handle ? squash(handle) : null;
  return cands.filter((c) => !c.name || (!/\bfollow(ing)?\b/i.test(c.name) && !(h && h.length >= 4 && squash(c.name).includes(h))));
}

// Words laid over a photo are usually white or near-white: keep only those pixels, enlarged,
// so the reader isn't looking for letters in the food. Two passes:
//  - the whole picture, for paragraphs (quotes, captions burnt into the image);
//  - each separate line of text on its own, which finds a lone big word ("VIRAGE") that the
//    paragraph pass skips.
export async function readOverlay(canvas, box) {
  const sh = box.y1 - box.y0;
  const s = Math.min(2, 2000 / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s);
  c.height = Math.round(sh * s);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, box.y0, canvas.width, sh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const rows = new Uint32Array(c.height);
  for (let i = 0; i < d.length; i += 4) {
    const lo = Math.min(d[i], d[i + 1], d[i + 2]), hi = Math.max(d[i], d[i + 1], d[i + 2]);
    const ink = lo > 205 && hi - lo < 40;
    d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
    if (ink) rows[(i / 4 / c.width) | 0]++;
  }
  g.putImageData(img, 0, 0);
  const full = (await readText(c)).lines.filter((l) => l.conf > 60 && l.text);

  // Bands of ink one text-line tall that the first pass didn't read confidently.
  const bands = [];
  const thr = Math.max(3, c.width * 0.004);
  let start = -1, gap = 0;
  for (let y = 0; y <= c.height; y++) {
    if (y < c.height && rows[y] >= thr) { if (start < 0) start = y; gap = 0; }
    else if (start >= 0 && ++gap > Math.max(4, c.height * 0.006)) {
      const end = y - gap + 1;
      const hgt = end - start;
      if (hgt >= c.height * 0.012 && hgt <= c.height * 0.09) bands.push([start, end]);
      start = -1; gap = 0;
    }
  }
  const extra = [];
  const todo = bands.filter(([a, b]) => !full.some((l) => l.conf > 80 && l.y < b && l.y + l.h > a)).slice(0, 8);
  if (todo.length) {
    for (const [a, b] of todo) {
      const pad = 8, top = Math.max(0, a - pad), hh = Math.min(c.height, b + pad) - top;
      const k = 64 / hh;
      const bc = document.createElement('canvas');
      bc.width = Math.round(c.width * k) + 40;
      bc.height = 94;
      const bg = bc.getContext('2d');
      bg.fillStyle = '#fff';
      bg.fillRect(0, 0, bc.width, bc.height);
      bg.drawImage(c, 0, top, c.width, hh, 20, 15, c.width * k, 64);
      const data = await recognise(bc, 'line'); // one line of text
      const t = (data.text || '').trim();
      if (data.confidence > 60 && /\p{L}{3,}/u.test(t)) extra.push({ text: t, y: a, h: b - a, conf: data.confidence, band: true });
    }
  }
  const lines = [...full, ...extra].sort((x, y) => x.y - y.y).map((l) => ({ ...l, text: l.text.replace(/^[^\p{L}\p{N}@#📍“"«<€£$]+/u, '').trim() })).filter((l) => /\p{L}{2,}/u.test(l.text));
  return { text: lines.filter((l) => l.conf > 75 || l.band).map((l) => l.text).join('\n'), lines };
}

// ── Text laid over photos: names, quotes, facts ──────────────────────
// Editorial posts put the place's name just above a quote:
//   Bistrot Des Tournelles
//   "A TRADITIONAL FRENCH BISTRO NEAR PLACE DE LA BASTILLE…"
// The name is the candidate; the quote is the note; places it mentions narrow the search.
const QUOTE_OPEN = /^[“"«<‘']/;
// A line made only of everyday words isn't a name ("right now", "must visit", "so good").
const EVERYDAY = new Set(['right', 'now', 'here', 'there', 'new', 'best', 'top', 'just', 'really', 'very', 'so', 'must', 'visit', 'today', 'tonight', 'this', 'that', 'week', 'weekend', 'insane', 'crazy', 'guide', 'love', 'why', 'how', 'what', 'more', 'good', 'great', 'favourite', 'favorite', 'spot', 'spots', 'place', 'places', 'only', 'ever', 'still', 'again', 'omg', 'wow', 'yes', 'no', 'my', 'our', 'go', 'come', 'see', 'try']);
const everyday = (t) => { const w = t.toLowerCase().match(/\p{L}+/gu) || []; return w.length > 0 && w.every((x) => EVERYDAY.has(x) || STOP.test(x)); };
// "78 Rue Vieille du Temple Fashion crowd crossroads" → "78 Rue Vieille du Temple": a street
// address written on the picture, cut where the sentence after it starts.
const PIC_ADDR = /\b(\d{1,4}\s*(?:bis|ter)?,?\s+(?:rue|avenue|av\.?|bd|boulevard|place|quai|passage|impasse|all[ée]e|cours|chemin|square|villa|faubourg|carrer|calle|via|straße|strasse|street|road|lane))\s+(.*)$/iu;
const LINK = /^(du|de|des|la|le|l['’]\S*|d['’]\S*|del|di|der|the|of)$/i;
export function pictureAddress(lines) {
  for (const l of lines) {
    const m = (l.text || l).match(PIC_ADDR);
    if (!m) continue;
    // The street name: capitalised words and the small words between them; stop at the first
    // other word, and drop a capitalised word that starts the next sentence ("… Temple Fashion crowd").
    const words = m[2].split(/\s+/);
    const name = [];
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (/^[\p{Lu}\d]/u.test(w) && !(name.length && words[k + 1] && /^[a-z]/.test(words[k + 1]) && !LINK.test(words[k + 1]))) name.push(w);
      else if (LINK.test(w) && words[k + 1] && /^[\p{Lu}\d]/u.test(words[k + 1])) name.push(w);
      else break;
    }
    if (name.length) return `${m[1]} ${name.join(' ')}`.replace(/[.,;:]+$/, '');
    // "12 rue de charonne" written in lower case: keep up to three words.
    return `${m[1]} ${words.slice(0, 3).join(' ')}`.replace(/[.,;:]+$/, '');
  }
  return null;
}
const STOP = /\b(the|a|an|of|in|for|and|near|to|on|so|with|from|that|is|are|you|your|this|it|at|by|where|when|till|until|under)\b/i;
const sentence = (t) => t.replace(/[“”"«»_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const squash = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export function overlayCandidates(lines, { handle } = {}) {
  let alts = null;
  const me = handle ? squash(handle) : null;
  const L = lines.map((l) => ({ ...l, text: l.text.replace(/\b\d+\s*\/\s*\d+\b/g, '').replace(/^[^\p{L}\p{N}“"«<‘'€£$]+/u, '').trim() })).filter((l) => {
    const t = l.text;
    if (!t) return false;
    if (/^\d+\s*\/\s*\d+$/.test(t)) return false;                 // carousel counter "3/9"
    if (/\b[\w-]+\.(com|fr|co|net|io|de|es|uk)\b/i.test(t)) return false; // "SERVICE95.COM"
    if (me && squash(t) === me) return false;                     // the account's own watermark
    return true;
  });
  const out = [];
  const used = new Set();
  // Name above a quote.
  for (let i = 0; i < L.length; i++) {
    if (!QUOTE_OPEN.test(L[i].text)) continue;
    const q = [];
    for (let j = i; j < L.length && q.length < 8; j++) {
      q.push(L[j].text);
      used.add(j);
      if (/[”"»]\s*$|\.\s*$/.test(L[j].text) && j > i) break;
    }
    const quote = sentence(q.join(' '));
    const above = L[i - 1];
    let name = null;
    if (above && !used.has(i - 1) && above.text.split(/\s+/).length <= 5 && !STOP.test(above.text) && !junk(above.text) && L[i].y - (above.y + above.h) < L[i].h * 3) {
      name = above.text;
      used.add(i - 1);
      // The same line read twice (full pass and line pass): keep the other reading too, and let
      // the map decide ("Bish rot Des Tournelles" / "Bistrot Des Tournelles").
      alts = L.filter((l, k) => k !== i - 1 && !used.has(k) && l.y < above.y + above.h && l.y + l.h > above.y && l.text !== above.text && !QUOTE_OPEN.test(l.text)).map((l) => l.text);
      alts.forEach((t) => used.add(L.findIndex((l) => l.text === t)));
    }
    // "SUGAAR IS THAT DREAM MIX…": the quote names the place itself.
    if (!name) name = q.map(sayIs).find(Boolean) || null;
    if (false) name = q.join(' ').match(/(?:^|[“"\s])([A-ZÀ-Ý][A-ZÀ-Ý'’&-]{2,}(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’&-]{2,}){0,3})\s+(?:IS|1S|ES|ARE|HAS)\s/u)?.[1] || null;
    out.push({ name: name || '', why: name ? 'on the photo · name above a quote' : 'on the photo · quote', weight: name ? 8 : 4, note: quote, hint: placeHint(quote), ...(name && alts?.length ? { alts } : {}) });
    alts = null;
  }
  // "SUGAAR IS THAT DREAM MIX…" even when the opening quote mark wasn't read.
  if (!out.some((o) => o.name)) {
    const n = L.map((l) => sayIs(l.text)).find(Boolean);
    if (n) {
      const q = out.find((o) => !o.name);
      if (q) Object.assign(q, { name: n, weight: 7, why: 'on the photo · named in the quote' });
      else out.push({ name: n, why: 'on the photo · named in the quote', weight: 7, note: sentence(L.map((l) => l.text).join(' ')), hint: placeHint(L.map((l) => l.text).join(' ')) });
    }
  }
  // A quote whose opening line wasn't read ("…SERVING UP SMALL PLATES ON RUE DE CHARONNE.”"):
  // it's still a quote, not a name.
  const quoted = L.filter((l) => /[“”«»]/.test(l.text));
  if (!out.length && quoted.length) {
    const from = L.indexOf(quoted[0]);
    const tail = L.slice(Math.max(0, from - 3), L.indexOf(quoted[quoted.length - 1]) + 1).map((l) => l.text).join(' ');
    out.push({ name: '', why: 'on the photo · quote', weight: 4, note: sentence(tail), hint: placeHint(tail) });
    L.forEach((l, i) => { if (i >= from - 3 && i <= L.indexOf(quoted[quoted.length - 1])) used.add(i); });
  }
  // A lone short line, biggest first ("VIRAGE"), when there's no quote to anchor on.
  if (!out.length) {
    const lone = L.filter((l, i) => !used.has(i) && l.text.split(/\s+/).length <= 4 && !STOP.test(l.text) && !everyday(l.text) &&
      !/\bfollow\b/i.test(l.text) && !(/^\p{Lu}?[\p{Ll}\s'’]+\b(wine bar|bar|caf[eé]|restaurant|rooftop|spot|club)$/u.test(l.text)) && !junk(l.text) && !/[.!?]$/.test(l.text) && !/[€£$]|\d{1,2}\s?(am|pm|h)\b|midnight|sunrise/i.test(l.text) && /\p{L}{3,}/u.test(l.text))
      .sort((a, b) => b.h - a.h);
    lone.slice(0, 2).filter((l, k) => !k || l.h >= lone[0].h * 0.8).forEach((l, k) => out.push({ name: l.text, why: k ? 'on the photo' : 'on the photo · biggest text', weight: k ? 3 : 5 }));
  }
  // Facts worth keeping as the note: price, hours, music.
  const facts = L.filter((l, i) => !used.has(i) && /[€£$]\s?\d|\d{1,2}\s?(am|pm|h)\b|midnight|sunrise|till|until|techno|house|jazz|disco|entry|free/i.test(l.text)).map((l) => l.text);
  if (facts.length) for (const o of out) o.note = [o.note, ...facts].filter(Boolean).join(' · ');
  // One named place on the picture and an address written on it: they go together.
  const named = out.filter((o) => o.name);
  const addr = named.length === 1 ? pictureAddress(L) : null;
  if (addr) named[0].address = addr;
  return out;
}

// Places a caption or quote mentions: "near Canal St Martin", "on Rue de Charonne",
// "in the 11th", "Passage des Panoramas", "Saint-Germain-des-Prés".
function sayIs(t) {
  const m = t.match(/(?:^|[“"\s])([A-ZÀ-Ý][A-ZÀ-Ý'’&-]{2,}(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’&-]{2,}){0,3})\s+(?:IS|1S|ES|ARE|HAS)\s+(?:THAT|THE|A|AN|WHERE|ONE)\b/u);
  if (!m || STOP.test(m[1]) || junk(m[1])) return null;
  return m[1].toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
export function placeHint(text) {
  const t = text.replace(/\s+/g, ' ');
  const street = t.match(/\b((?:rue|place|passage|canal|quai|boulevard|bd|avenue|parc|jardin|march[ée]|square|pont|porte|cour|galerie)\s+(?:(?:de|du|des|la|le|les|d'|st|saint|sainte)\s*)*[\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)/iu);
  if (street) return street[1].replace(/\s+(so|where|with|and|for|the|serving|from)$/i, '').replace(/\b\p{L}/gu, (m) => m.toUpperCase()).replace(/\b(De|Du|Des|La|Le|Les)\b/g, (m) => m.toLowerCase());
  const arr = t.match(/\bin the (\d{1,2})(?:st|nd|rd|th)\b/i) || t.match(/\b(\d{1,2})(?:e|ème|er)\b/);
  if (arr) return `${arr[1]}e`;
  const named = t.match(/\b(saint-germain(?:-des-pr[ée]s)?|le marais|marais|pigalle|montmartre|belleville|oberkampf|bastille|canal saint-martin|batignolles|république|châtelet|les halles)\b/i);
  return named ? named[1] : null;
}

// Facts from a caption worth saving with the place: opening hours, prices.
export function captionFacts(text) {
  return (text || '').split(/(?<=[.!?])\s+|\n+/).filter((x) => /\b\d{1,2}\s?(am|pm|h\d{0,2})\b|\b\d{1,2}[:h]\d{2}\b|[€£$]\s?\d|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?\b/i.test(x)).map((x) => x.trim()).slice(0, 2).join(' ');
}

// Two lines of evidence, in order:
//  1. the screen's own text: a post's caption, or a website / app's clean UI text (the reader is
//     confident about it, >= 80%);
//  2. text inside pictures: words laid over a photo, read separately.
// Anything else on screen is only a last resort.
const tag = (cs, where) => cs.map((c) => ({ ...c, why: `${where} · ${c.why}` }));
export function firstLine({ post, lines, height, text }) {
  if (post) return tag(venueCandidates(post.caption, null, 1, { social: true, handle: post.handle }), 'caption').filter((c) => c.weight >= 2);
  const clean = (lines || []).filter((l) => l.conf >= 80 && l.text);
  if (!clean.length) return tag(venueCandidates(text), 'text');
  return tag(venueCandidates(clean.map((l) => l.text).join('\n'), clean, height), 'on screen');
}
export const isStrong = (cands) => cands.some((c) => c.weight >= 4);
// Evidence from the screen's own text and from text inside pictures is merged, never one
// hiding the other: a strong caption doesn't suppress a different place named on the photo.
export function tieredCandidates(first, picture, text) {
  const pic = picture.filter((c) => c.name);
  const seen = new Set();
  const both = [...first, ...pic].filter((c) => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()));
  return both.length ? both.sort((a, b) => b.weight - a.weight).slice(0, 8) : venueCandidates(text);
}

// "hidden bar in Le Marais" → where to look and what kind of place.
export function typeHint(text) {
  return text.match(/\b(wine bar|cocktail bar|bar|restaurant|bistro|brasserie|caf[ée]|coffee|bakery|boulangerie|club|gallery|museum|market|rooftop)\b/i)?.[1] || null;
}

// ── Understanding what came in ─────────────────────────────────────────
const TICKET = /\b(billet|ticket|e-?ticket|booking|réservation|reservation|confirmation|order|commande|entry|admission|door|qr|scan|seat|place\s+\d)\b/i;

// A QR code alone isn't a ticket (menus, wifi, loyalty cards have them): it needs booking words
// too, or one booking word plus a date and time.
export function looksLikeTicket(text, qr) {
  const words = (text.match(new RegExp(TICKET, 'gi')) || []).length;
  const when = /\b\d{1,2}[:h]\d{2}\b/.test(text) && (/\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/.test(text) || MONTH.test(text));
  if (qr) return words >= 2 || (words >= 1 && when);
  return words >= 2;
}

const MONTHS = { jan: 1, janv: 1, feb: 2, fev: 2, fév: 2, mar: 3, mars: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aout: 8, août: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, déc: 12 };
export function parseTicket(text, year = new Date().getFullYear()) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 2);
  let day = null, time = null, ref = null;
  const dm = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (dm) {
    const y = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3];
    day = `${y}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  } else {
    const wm = text.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th|er)?\s+([a-zéû]{3,5})\.?\s*(\d{4})?/);
    if (wm && MONTHS[wm[2]]) day = `${wm[3] || year}-${String(MONTHS[wm[2]]).padStart(2, '0')}-${String(wm[1]).padStart(2, '0')}`;
  }
  const tm = text.match(/\b([01]?\d|2[0-3])[:hH.]([0-5]\d)\b/);
  if (tm) time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
  const rm = text.match(/\b(?:ref(?:erence|érence)?|booking|order|commande|n°|no\.?|confirmation)\s*[:#]?\s*([A-Z0-9\-]{5,})/i);
  if (rm) ref = rm[1];
  const title = lines.find((l) => /[A-Za-z]{3}/.test(l) && !TICKET.test(l) && l.length < 60) || lines[0] || 'Ticket';
  return { title, day, time, ref };
}

// Words from app screens (Google Maps, Instagram, browsers) that are never a venue name.
const UI = /^(directions|start|reserve|call|share|save|saved|website|menu|overview|reviews|photos|about|updates|open|closed|closes|opens|search|dogs allowed|top rated|know before you go|visitors|follow|following|like|reply|view|liked|more|sponsored|original audio|see translation|comments?|send|message|order online|book|tickets?|map|explore|you|go|done|cancel|edit)\b/i;
const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;

function junk(name) {
  const letters = (name.match(/\p{L}/gu) || []).length;
  if (letters < 3) return true;
  // OCR noise ("3 ibd", "oO m6"): a real name has a proper word in it.
  if (!/\p{L}{4,}/u.test(name) && !/\p{Lu}{3,}/u.test(name)) return true;
  if (/\d{1,2}[:h.]\d{2}/.test(name)) return true;               // times
  if (/^\d/.test(name) && MONTH.test(name)) return true;           // dates
  if (/^(\d+\s*)+(min|hr|h|km|m|mi)\b/i.test(name)) return true; // distances
  if (/\d[.,]\d\s*[★*]|\(\d[\d,.]*\)/.test(name)) return true;   // ratings
  if (/€|£|\$/.test(name)) return true;
  if (UI.test(name)) return true;
  if (/\b(password|passcode|sign in|sign up|log in|login|username|forgot|verification code)\b/i.test(name)) return true; // login and account screens
  // Article and list headlines: "Best natural wine in Paris", "10 places to eat in Berlin"
  // Headline phrases on photos: "Berlin's dreamiest hideaway", "hidden wine bar", "architectural gem".
  if (/\b(hidden|gem|hideaway|cosiest|coziest|coolest|dreamiest|chicest|prettiest|loveliest|iconic|secret|pov)\b/i.test(name) || /\p{L}+['’]s\s+(most|best|\p{L}+est)\b/iu.test(name)) return true;
  if (/^(the\s+)?(\d+\s+)?(best|top|our|where to|guide|favou?rite|must|hidden gems?)\b/i.test(name) || /\b(places|spots|bars|restaurants)\s+(to|in|for)\b/i.test(name)) return true;
  return false;
}

// Candidate venue names from a screenshot / caption / page text.
// lines (with positions and sizes) come from the on-device reader when there's an image.
const GENERIC_TAG = /^(bars?|clubs?|restaurants?|cafes?|coffee|brunch|wine|cocktails?|techno|house|nightlife|foodie|foodporn|instagood|reels?|fyp|foryou|viral|explore|summer|vintage|antiques?|fleamarket|hiddengems?|travelgram|wanderlust|weekend|love|art|music|dj|rave|drinks?|dinner|lunch)$/;
// "caveaudelahuchette" → "Caveau de la Huchette"
const PARTS = ['della', 'des', 'del', 'de', 'du', 'di', 'la', 'le', 'les', 'chez', 'the', 'of', 'and', 'et'];
function particles(t) { // "dela" → ["de","la"], or null
  if (!t) return [];
  for (const p of PARTS) if (t.startsWith(p)) { const r = particles(t.slice(p.length)); if (r) return [p, ...r]; }
  return null;
}
export function splitTag(t) {
  let best = null;
  for (let i = 3; i <= t.length - 5; i++)
    for (let j = i + 2; j <= t.length - 3; j++) {
      const ps = particles(t.slice(i, j));
      if (ps && (!best || ps.length > best.ps.length || (ps.length === best.ps.length && i === best.i && j > best.j))) best = { i, j, ps };
    }
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  if (!best) return cap(t);
  return [cap(t.slice(0, best.i)), ...best.ps, splitTag(t.slice(best.j))].join(' ');
}
// opts.social: a post layout was detected (so "account name, then a line" can be a location tag).
// opts.handle: the post's own account name, when known.
export function venueCandidates(text, lines = null, height = 1, opts = {}) {
  const out = [];
  const add = (name, why, weight) => {
    // OCR leaves icon debris at line ends ("ROJO oO m6 x"): drop trailing 1–2 character bits.
    name = name.replace(/(\s+\S{1,2})+\s*$/u, (m) => (/[A-ZÀ-Ý]{2}/.test(m) ? m : ''));
    name = name.replace(/^\s*\d{1,2}[.)]\s+/, '');
    name = name.replace(/[#*_|•·]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}')]+$/gu, '');
    if (name.length < 3 || name.length > 48 || junk(name)) return;
    const k = name.toLowerCase();
    const ex = out.find((o) => o.name.toLowerCase() === k);
    if (ex) { ex.weight += weight; if (weight > 3) ex.why = why; if (ex.name === ex.name.toLowerCase() && name !== k) ex.name = name; }
    else out.push({ name, why, weight });
  };
  const all = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Google Maps place card: the name sits right above the rating line ("3.8 ★★★★ (387)").
  const isMaps =
    /^\d[.,]\d\b.*\(\d[\d,.]*\)/m.test(text) ||
    (text.match(/\b(directions|start|reserve|call|website|order online)\b/gi) || []).length >= 2;
  for (let i = 1; i < all.length; i++) {
    if (/^\d[.,]\d\b.*\(\d[\d,.]*\)/.test(all[i]) || (isMaps && /^\d[.,]\d\b/.test(all[i]))) {
      add(all[i - 1], 'Google Maps place', 12);
      const typeLine = all[i + 1] || '';
      if (out.length) out[out.length - 1].type = typeLine.split(/[·•-]/)[0].trim();
    }
  }
  // A Maps card or a name with an address anchors the screen: weak guesses are dropped at the
  // end, but other well-evidenced places on the same screen are kept.
  let anchored = out.some((o) => o.why === 'Google Maps place');

  // "medowski.k Rojo, 8 Rue de Beauce, 75003 Paris": a name followed by a street address
  // (Instagram location tags, captions, listings). The strongest signal there is.
  const STREET = '(?:rue|bd|boulevard|avenue|av\\.?|place|pl\\.?|quai|passage|impasse|cit[ée]|all[ée]e|chemin|square|cours|villa|faubourg|fbg|route|straße|strasse|str\\.?|calle|carrer|via|street|st\\.?|road|rd\\.?|lane|ave)';
  const addrRe = new RegExp(`^(?:@?([a-z0-9._]{3,30})\\s+)?(.+?)\\s*[,–—-]\\s*(\\d{1,4}\\s*(?:bis|ter)?\\s*,?\\s*${STREET}\\b.*)$`, 'iu');
  for (const l of all) {
    const m = l.match(addrRe);
    if (!m) continue;
    // Only a real-looking handle is dropped ("medowski.k", "rojo_paris", or the post's own):
    // "chez janou, 2 rue…" keeps "chez" and "Bar Calders, 25 Carrer…" keeps "Bar".
    const isHandle = m[1] && (/[._\d]/.test(m[1]) || (opts.handle && m[1].toLowerCase() === opts.handle.toLowerCase()));
    const name = (m[1] && !isHandle ? `${m[1]} ${m[2]}` : m[2]).replace(/^(also try|try|visit|check out|go to|head to)\s+/i, '').trim();
    add(name, 'name + address', 15);
    const hit = out.find((o) => o.why === 'name + address' && !o.address);
    if (hit) hit.address = m[3].replace(/\s+/g, ' ').trim();
  }
  anchored ||= out.some((o) => o.why === 'name + address');

  // Instagram location tag: "victoiretaverne 📍 Les Puces de Vanves, Porte de Vanves, Paris"
  // (the pin often reads as junk like "Ÿ").
  for (const [li, l] of all.slice(0, 6).entries()) {
    const m = l.match(/^([a-z0-9._]{3,30})\s+(?:\S{1,2}\s+)?(\p{Lu}[^,]{2,40}),\s*\p{Lu}[^,]*(?:,|$)/u);
    // "and Joshua Fontaine (La Candelaria, …": "and" isn't an account name.
    if (m && !STOP.test(m[1]) && (/[._\d]/.test(m[1]) || m[1] === opts.handle || li === 0)) add(m[2], 'location tag', 6);
  }
  // Hashtags that aren't generic: #caveaudelahuchette → "Caveau de la Huchette", checked on the map.
  for (const m of text.matchAll(/#([\p{L}\d_]{6,40})/gu)) {
    const t = m[1].toLowerCase();
    if (GENERIC_TAG.test(t) || /paris|berlin|london|barcelona|france|europe|travel|food|night|party|guide/.test(t)) continue;
    const before = out.length;
    add(splitTag(t), 'hashtag', 3);
    if (out.length > before) out[out.length - 1].squash = t.replace(/[^a-z0-9]/g, '');
  }

  for (const l of all) {
    const pin = l.match(/(?:📍|📌|location:|address:|adresse\s*:)\s*(.+)/i)
      // The pin emoji usually reaches us as a stray symbol: "Ÿ Kraftwerk Berlin", "? The Lobby at…",
      // "natalia.lately Ÿ Café Honolulu: Warschauer Str. 39/40, 10243 Berlin".
      || l.match(/^(?:[a-z0-9._]{3,30}\s+)?[Ÿ?{¥¢©®§•]\s+(\p{Lu}.{2,80})$/u);
    if (pin) {
      const [head, ...rest] = pin[1].split(/\s*[:,|–—]\s+|\s+@/);
      const tail = rest.join(', ');
      // What follows is an address if it has a house number: keep it.
      const addr = /\d/.test(tail) ? tail.replace(/,?\s*\d{5}\s+\p{L}+$/u, '').replace(/,\s*[\p{L} -]+$/u, (m) => (/\d/.test(m) ? m : '')).trim() : null;
      const before = out.length;
      add(head, 'pin / location', addr ? 12 : 7);
      const hit = out.find((o) => o.name.toLowerCase() === head.trim().toLowerCase().replace(/[^\p{L}\p{N}')]+$/u, '')) || (out.length > before ? out[out.length - 1] : null);
      if (hit && addr && !hit.address) hit.address = addr;
    }
    const called = l.match(/\b(?:[Ii]t['’]s|[Ii]t is|is)\s+called\s+(\p{Lu}[\p{L}'’&-]*(?:\s+\p{Lu}[\p{L}'’&-]*){0,3})/u);
    if (called) add(called[1], 'named in the caption', 6);
    const inThe = l.match(/(?:^|[,.]\s+)(\p{Lu}[\p{L}'’&-]+(?:\s+\p{Lu}[\p{L}'’&-]+){0,3})\s+in\s+the\s+\d{1,2}(?:st|nd|rd|th|e|ème)\b/u);
    if (inThe) add(inThe[1], 'named in the caption', 4);
    for (const m of l.matchAll(/@([a-z0-9._]{3,30})/gi)) {
      // "S95 founder @dualipa", "📸 @someone", "with @friend": a person, not a place.
      if (/(?:founder|co-?founder|chef|owner|by|with|ft\.?|feat\.?|photo(?:s|graphy)?|📸|dj|host(?:ed)? by|thanks|cc)\s*:?\s*$/i.test(l.slice(0, m.index)) && !/thanks to\s*$/i.test(l.slice(0, m.index))) continue;
      const before = out.length;
      add(handleName(m[1]), '@mention', 2);
      if (out.length > before) out[out.length - 1].squash = squashName(handleName(m[1]));
    }
    const num = l.match(/^\s*(?:\d{1,2}[.)]|[-•])\s*(.+)/);
    if (num) add(num[1].split(/[,–—:(-]/)[0], 'list item', 3);
  }
  // Instagram: the location tag sits on the line right under the account name. Only on a
  // screen already recognised as a social post; elsewhere "username / Forgot your password" isn't a place.
  if (!isMaps && opts.social)
    for (let i = 0; i < Math.min(all.length - 1, 12); i++) {
      if (/^[a-z0-9._]{3,30}$/i.test(all[i]) && all[i + 1] && all[i + 1].length < 45 && !/\d{2}:\d{2}/.test(all[i + 1]))
        add(all[i + 1].split(',')[0], 'location tag', 4);
    }
  // The biggest text on screen (below the status bar) is usually the name.
  if (lines?.length) {
    const body = lines.filter((l) => l.y > height * 0.06 && l.text && l.conf > 75); // photos make low-confidence 'text'
    // On a list page the numbered items are the places; the big text is the article title.
    const listed = out.filter((o) => o.why === 'list item').length >= 2;
    const big = listed ? [] : [...body].sort((a, b) => b.h - a.h).slice(0, 3);
    big.forEach((l, i) => add(l.text, 'largest text', 4 - i));
  }
  // A short capitals heading straight above a paragraph about it ("BAR OMI" / "After Onii-San and…").
  for (let i = 0; i < all.length - 1; i++) {
    const h = all[i], next = all[i + 1];
    if (h.length <= 40 && h === h.toUpperCase() && /\p{Lu}{2,}/u.test(h) && h.split(/\s+/).length <= 6 && next.length >= 40 && /^[‘'“"«]?\p{Lu}/u.test(next) && /\p{Ll}/u.test(next))
      add(h.replace(/\s+[\p{P}\p{S}]+$/u, ''), 'heading above its description', 6);
  }
  // Short title-case lines are weak guesses (skipped on map screenshots: street labels).
  if (!isMaps)
    for (const l of all.slice(0, 40)) {
      if (l.length <= 32 && /^[A-ZÀ-Ý0-9][\p{L}0-9'’&\- ]+$/u.test(l) && l.split(' ').length <= 5) add(l, 'heading', 1);
    }
  const kept = anchored ? out.filter((o) => o.weight >= 3) : out;
  return kept.sort((a, b) => b.weight - a.weight).slice(0, 8);
}

export function areaHint(text) {
  const arr = text.match(/\b(\d{1,2})(?:e|ème|er|th)\b/);
  if (arr) return arr[0];
  // "in Le Marais", "in Pigalle", "à Belleville"
  const m = text.match(/\b(?:in|à|dans)\s+((?:le|la|les|the)\s+)?([A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+)?)/u);
  return m && !/^(Paris|Berlin|Barcelona|London|Instagram)$/i.test(m[2]) ? `${m[1] || ''}${m[2]}`.trim() : null;
}

// ── Map apps: a place's own card (Google Maps) ───────────────────────
// The card reads: name · "4.7 ★★★★★ (737)" · travel time · "Cocktail bar · €10–20" · Open/Closed,
// then Directions / Overview / Reviews. The name is the line above the rating; the bookmark,
// share and close icons to its right come out of OCR as short junk ("ED Qh) @", "oh x"), so trailing
// tokens that aren't words are cut. A long name wraps onto a second line ("Stolen Moon Cocktail / Bar").
const RATING = /^\s*\d(?:\s?[.,]\s?\d|\d)?\s.{0,24}\(\s*\d[\d,.\s]*\)/;
const junkTail = (s) => {
  const w = s.trim().split(/\s+/);
  while (w.length > 1) {
    const last = w[w.length - 1];
    if (last.length <= 2 || /[^\p{L}\p{N}'’&.-]/u.test(last) || (/^[a-z]/.test(last) && /^\p{Lu}/u.test(w[0]) && last.length <= 3)) w.pop();
    else break;
  }
  return w.join(' ');
};
export function mapsSheet(text = '') {
  if (!/\b(directions|overview|reviews)\b/i.test(text)) return null;
  const L = text.split('\n').map((s) => s.trim());
  const i = L.findIndex((l, k) => k > 0 && RATING.test(l));
  if (i < 1) return null;
  // The type line ("Cocktail bar · €10–20", "Restaurant · ££") within the next few lines.
  const typeLine = L.slice(i + 1, i + 5).find((l) => /^[\p{L} &'’-]{3,40}\s*[-·•:]\s*(?:[€£$]|\d)/u.test(l) || /^[\p{L} &'’-]{3,40}$/u.test(l) && !/\b(open|closed|closes|opens|hr|min|km)\b/i.test(l));
  const category = typeLine ? typeLine.split(/\s*[-·•:]\s*/)[0].trim() : null;
  let k = i - 1;
  while (k > 0 && !L[k]) k--;
  let name = junkTail(L[k]);
  // A wrapped name: a lone word under a heading line ("Bar" under "Stolen Moon Cocktail"). The icons
  // sit beside the first line of the name, so that's the line that had junk cut, not this one.
  if (name === L[k] && /^\p{Lu}[\p{L}'’&.-]{1,14}$/u.test(name) && k > 0 && L[k - 1]) {
    const above = junkTail(L[k - 1]);
    const words = above.split(/\s+/);
    if (above !== L[k - 1] && /^\p{Lu}/u.test(above) && words.length >= 2 && words.every((w) => /^\p{L}[\p{L}'’&.-]+$/u.test(w))) name = `${above} ${name}`;
  }
  if (!name || name.length < 2 || !/\p{L}{2}/u.test(name)) return null;
  return { name, category };
}
