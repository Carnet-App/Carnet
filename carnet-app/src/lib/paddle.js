// The second receipt reader: PaddleOCR's PP-OCRv4 detector + recogniser, run on the phone with
// ONNX Runtime. No OpenCV: the few geometry steps it needs (text regions → straightened line images)
// are done here. It reads the upright colour photo; Tesseract keeps its own black-and-white copy.
// Kept free of browser-only calls so the Node benchmark runs the very same code (ort and a canvas
// maker are passed in).

const DET_THRESH = 0.03; // a low bar: regions come out generous, and unclipping widens them further
const UNCLIP = 1.5;
const REC_H = 48;
const MIN_CONF = 0.5;

// ── Geometry ──────────────────────────────────────────────────────────
function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// Smallest rectangle around the points, as centre, size along its own axes, and angle (radians),
// with the width axis kept within ±45° of horizontal.
export function minRect(points) {
  const h = hull(points);
  if (h.length < 3) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, a: 0 };
  }
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i], q = h[(i + 1) % h.length];
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of h) { const u = x * c + y * s, v = -x * s + y * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, a, u0, u1, v0, v1 };
  }
  let { a, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const c = Math.cos(a), s = Math.sin(a);
  let w = u1 - u0, hh = v1 - v0;
  // Normalise: angle within ±45°, swapping width and height as the axis turns.
  while (a > Math.PI / 4) { a -= Math.PI / 2; [w, hh] = [hh, w]; }
  while (a <= -Math.PI / 4) { a += Math.PI / 2; [w, hh] = [hh, w]; }
  return { cx: cu * c - cv * s, cy: cu * s + cv * c, w, h: hh, a };
}

// Text regions in the detector's map: connected areas above the threshold, each as a rectangle
// widened the way PaddleOCR "unclips" (distance = area × 1.5 / perimeter on every side).
export function regions(prob, W, H, thresh = DET_THRESH) {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || prob[start] <= thresh) continue;
    // Flood fill (8-neighbours), keeping each row's leftmost and rightmost pixel for the outline.
    let sp = 0; stack[sp++] = start; seen[start] = 1;
    const rows = new Map();
    let n = 0;
    while (sp) {
      const i = stack[--sp]; n++;
      const x = i % W, y = (i / W) | 0;
      const r = rows.get(y);
      if (!r) rows.set(y, [x, x]); else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (!seen[j] && prob[j] > thresh) { seen[j] = 1; stack[sp++] = j; }
        }
      }
    }
    if (n < 6) continue;
    const pts = [];
    for (const [y, [x0, x1]] of rows) pts.push([x0, y], [x1 + 1, y], [x0, y + 1], [x1 + 1, y + 1]);
    const r = minRect(pts);
    if (Math.min(r.w, r.h) < 3) continue;
    const d = (r.w * r.h * UNCLIP) / (2 * (r.w + r.h));
    const g = { ...r, w: r.w + 2 * d, h: r.h + 2 * d };
    if (Math.min(g.w, g.h) < 5) continue;
    out.push(g);
  }
  return out;
}

// ── Models ────────────────────────────────────────────────────────────
// PaddleOCR's own preprocessing as the ONNX exports expect it here: BGR planes, 0–1, no mean/std.
function toTensor(ort, img, W, H) {
  const d = img.data, n = W * H, f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { f[i] = d[i * 4 + 2] / 255; f[n + i] = d[i * 4 + 1] / 255; f[2 * n + i] = d[i * 4] / 255; }
  return new ort.Tensor('float32', f, [1, 3, H, W]);
}

export async function createReader({ ort, det, rec, dict, mkCanvas, sessionOptions = {} }) {
  const [detS, recS] = [await ort.InferenceSession.create(det, sessionOptions), await ort.InferenceSession.create(rec, sessionOptions)];
  const chars = [...dict.split('\n'), ' '];
  const run = async (s, t) => (await s.run({ [s.inputNames[0]]: t }))[s.outputNames[0]];

  async function readLine(src, r) {
    // Straighten the rectangle onto its own canvas, then scale to the recogniser's 48 px height.
    let w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h)), a = r.a;
    if (h / w >= 1.5) { [w, h] = [h, w]; a += Math.PI / 2; } // a tall box: vertical text, turn it
    const W = Math.max(8, Math.round((w * REC_H) / h));
    const c = mkCanvas(W, REC_H);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, REC_H);
    g.scale(W / w, REC_H / h);
    g.translate(w / 2, h / 2);
    g.rotate(-a);
    g.translate(-r.cx, -r.cy);
    g.drawImage(src, 0, 0);
    const out = await run(recS, toTensor(ort, g.getImageData(0, 0, W, REC_H), W, REC_H));
    // Greedy CTC: best class per step, repeats and blanks (0) dropped.
    const [, T, C] = out.dims, p = out.data;
    let text = '', sum = 0, k = 0, prev = -1;
    for (let t = 0; t < T; t++) {
      let bi = 0, bv = -Infinity;
      for (let j = 0; j < C; j++) { const v = p[t * C + j]; if (v > bv) { bv = v; bi = j; } }
      if (bi !== 0 && bi !== prev) { text += chars[bi - 1] ?? ''; sum += bv; k++; }
      prev = bi;
    }
    return { text, conf: k ? sum / k : 0 };
  }

  // Read a canvas: text lines with their boxes, then joined into rows top to bottom.
  async function read(src, { maxSide = 1600, onLine } = {}) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    const W = Math.max(32, Math.ceil((src.width * s) / 32) * 32), H = Math.max(32, Math.ceil((src.height * s) / 32) * 32);
    const c = mkCanvas(W, H);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, W, H);
    const prob = (await run(detS, toTensor(ort, g.getImageData(0, 0, W, H), W, H))).data;
    const boxes = regions(prob, W, H);
    const lines = [];
    for (const [i, r] of boxes.entries()) {
      const l = await readLine(c, r);
      onLine?.(i + 1, boxes.length);
      const text = l.text.trim();
      if (!text || l.conf < MIN_CONF) continue;
      // The box's real corners (a tilted line reaches lower at one end), as the reference does.
      const co = Math.cos(r.a), sn = Math.sin(r.a);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [r.cx + (u * r.w / 2) * co - (v * r.h / 2) * sn, r.cy + (u * r.w / 2) * sn + (v * r.h / 2) * co]);
      const ys = corners.map((p) => p[1]), xs = corners.map((p) => p[0]);
      lines.push({ text, conf: l.conf, x: Math.min(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
    return { lines, text: joinRows(lines) };
  }
  return { read };
}

// Boxes whose vertical middles sit within each other's height make one row, read left to right.
export function joinRows(lines) {
  const rows = [];
  for (const b of [...lines].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1))) {
    const mid = (b.y0 + b.y1) / 2, h = b.y1 - b.y0;
    const row = rows.find((r) => Math.abs(r.mid - mid) < Math.min(r.h, h) * 0.55);
    if (row) row.items.push(b); else rows.push({ mid, h, items: [b] });
  }
  return rows.sort((a, b) => a.mid - b.mid).map((r) => r.items.sort((a, b) => a.x - b.x).map((b) => b.text).join('  ')).join('\n');
}
