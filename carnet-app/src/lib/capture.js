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
  }
  return workerP;
}

export async function loadImage(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, url };
}

function toCanvas(src, maxW = 1600) {
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
  const w = await ocrWorker();
  const { data } = await w.recognize(canvasOrImg, {}, { text: true, blocks: true });
  onProgress?.(1);
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || [])
    lines.push({ text: (l.text || '').trim(), y: l.bbox.y0, h: l.bbox.y1 - l.bbox.y0, conf: l.confidence });
  return { text: data.text || '', lines, height: canvasOrImg.height || 1 };
}

export async function readImage(file, onProgress) {
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
  const counts = (t) => (t.match(/(?:^|\s)\(?\d[\d.,]*\s?[kKmM]?(?=\s|$)/g) || []).length;
  const bar = lines.find((l) => l.y > height * 0.3 && l.y < height * 0.97 && counts(l.text) >= 3 && l.text.length < 70);
  if (!bar) return null;
  const header = lines.filter((l) => l.y > height * 0.03 && l.y < height * 0.16 && l.conf > 60).pop();
  const y0 = header ? Math.round(header.y + header.h + height * 0.01) : Math.round(height * 0.1);
  const y1 = Math.round(bar.y - height * 0.005);
  if (y1 - y0 < height * 0.2) return null;
  const caption = [];
  let last = bar.y + bar.h;
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    if (l.y <= bar.y + bar.h / 2) continue;
    if (caption.length && l.y - last > height * 0.05) break;
    if (/^(follow|suggested|more posts)\b/i.test(l.text)) break;
    caption.push(l);
    last = l.y + l.h;
    if (/\b(ago|il y a)\b|^\d+\s?[smhdw]$/i.test(l.text) || (/^\d{1,2}\s/.test(l.text) && MONTH.test(l.text))) break; // the date ends a caption
  }
  return { media: { y0, y1 }, caption: caption.map((l) => l.text).join('\n') };
}

// Words laid over a photo are usually white or near-white: keep only those pixels, enlarged,
// so the reader isn't looking for letters in the food.
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
  for (let i = 0; i < d.length; i += 4) {
    const lo = Math.min(d[i], d[i + 1], d[i + 2]), hi = Math.max(d[i], d[i + 1], d[i + 2]);
    const ink = lo > 205 && hi - lo < 40;
    d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
  }
  g.putImageData(img, 0, 0);
  const { lines } = await readText(c);
  return lines.filter((l) => l.conf > 75 && /\p{L}{3,}/u.test(l.text)).map((l) => l.text.replace(/^[^\p{L}\p{N}@#📍]+/u, '')).join('\n');
}

// Caption first, then the words on the photo, then (only if both are empty) the rest of the screen.
export function zonedCandidates(caption, overlay, text) {
  const tag = (cs, where) => cs.map((c) => ({ ...c, why: `${where} · ${c.why}` }));
  const cap = tag(venueCandidates(caption), 'caption').filter((c) => c.weight >= 2);
  if (cap.some((c) => c.weight >= 4)) return cap;
  // Overlay text is short and clean: "ROJO, Paris" → also try what comes before the comma.
  const ovText = [overlay, ...overlay.split('\n').map((l) => l.split(/[,|–—]/)[0])].join('\n');
  const ov = tag(venueCandidates(ovText), 'on the photo').map((c) => ({ ...c, weight: Math.max(c.weight, 4) }));
  const both = [...cap, ...ov];
  return both.length ? both : venueCandidates(text);
}

// "hidden bar in Le Marais" → where to look and what kind of place.
export function typeHint(text) {
  return text.match(/\b(wine bar|cocktail bar|bar|restaurant|bistro|brasserie|caf[ée]|coffee|bakery|boulangerie|club|gallery|museum|market|rooftop)\b/i)?.[1] || null;
}

// ── Understanding what came in ─────────────────────────────────────────
const TICKET = /\b(billet|ticket|e-?ticket|booking|réservation|reservation|confirmation|order|commande|entry|admission|door|qr|scan|seat|place\s+\d)\b/i;

export function looksLikeTicket(text, qr) {
  if (qr) return true;
  return (text.match(new RegExp(TICKET, 'gi')) || []).length >= 2;
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
  return false;
}

// Candidate venue names from a screenshot / caption / page text.
// lines (with positions and sizes) come from the on-device reader when there's an image.
export function venueCandidates(text, lines = null, height = 1) {
  const out = [];
  const add = (name, why, weight) => {
    // OCR leaves icon debris at line ends ("ROJO oO m6 x"): drop trailing 1–2 character bits.
    name = name.replace(/(\s+\S{1,2})+\s*$/u, (m) => (/[A-ZÀ-Ý]{2}/.test(m) ? m : ''));
    name = name.replace(/[#*_|•·]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}')]+$/gu, '');
    if (name.length < 3 || name.length > 48 || junk(name)) return;
    const k = name.toLowerCase();
    const ex = out.find((o) => o.name.toLowerCase() === k);
    if (ex) { ex.weight += weight; if (weight > 3) ex.why = why; }
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
  // A Google Maps place card is about one place: don't guess at map labels around it.
  const card = out.filter((o) => o.why === 'Google Maps place');
  if (card.length) return card;

  // "medowski.k Rojo, 8 Rue de Beauce, 75003 Paris": a name followed by a street address
  // (Instagram location tags, captions, listings). The strongest signal there is.
  const STREET = '(?:rue|bd|boulevard|avenue|av\\.?|place|pl\\.?|quai|passage|impasse|cit[ée]|all[ée]e|chemin|square|cours|villa|faubourg|fbg|route|straße|strasse|str\\.?|calle|carrer|via|street|st\\.?|road|rd\\.?|lane|ave)';
  const addrRe = new RegExp(`^(?:@?([a-z0-9._]{3,30})\\s+)?(.+?)\\s*[,–—-]\\s*(\\d{1,4}\\s*(?:bis|ter)?\\s*,?\\s*${STREET}\\b.*)$`, 'iu');
  for (const l of all) {
    const m = l.match(addrRe);
    if (!m) continue;
    // Handles are lowercase: "Bar Calders, 25 Carrer…" keeps "Bar".
    const name = (m[1] && /[A-Z]/.test(m[1]) ? `${m[1]} ${m[2]}` : m[2]).trim();
    add(name, 'name + address', 15);
    const hit = out.find((o) => o.why === 'name + address' && !o.address);
    if (hit) hit.address = m[3].replace(/\s+/g, ' ').trim();
  }
  const addressed = out.filter((o) => o.why === 'name + address');
  if (addressed.length) return addressed;

  for (const l of all) {
    const pin = l.match(/(?:📍|📌|location:|address:|adresse\s*:)\s*(.+)/i);
    if (pin) add(pin[1].split(/[,–—-]/)[0], 'pin / location', 5);
    for (const m of l.matchAll(/@([a-z0-9._]{3,30})/gi)) add(m[1].replace(/[._]/g, ' '), '@mention', 2);
    const num = l.match(/^\s*(?:\d{1,2}[.)]|[-•])\s*(.+)/);
    if (num) add(num[1].split(/[,–—:(-]/)[0], 'list item', 3);
  }
  // Instagram: the location tag sits on the line right under the account name.
  if (!isMaps)
    for (let i = 0; i < Math.min(all.length - 1, 12); i++) {
      if (/^[a-z0-9._]{3,30}$/i.test(all[i]) && all[i + 1] && all[i + 1].length < 45 && !/\d{2}:\d{2}/.test(all[i + 1]))
        add(all[i + 1].split(',')[0], 'location tag', 4);
    }
  // The biggest text on screen (below the status bar) is usually the name.
  if (lines?.length) {
    const body = lines.filter((l) => l.y > height * 0.06 && l.text && l.conf > 75); // photos make low-confidence 'text'
    const big = [...body].sort((a, b) => b.h - a.h).slice(0, 3);
    big.forEach((l, i) => add(l.text, 'largest text', 4 - i));
  }
  // Short title-case lines are weak guesses (skipped on map screenshots: street labels).
  if (!isMaps)
    for (const l of all.slice(0, 40)) {
      if (l.length <= 32 && /^[A-ZÀ-Ý0-9][\p{L}0-9'’&\- ]+$/u.test(l) && l.split(' ').length <= 5) add(l, 'heading', 1);
    }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 8);
}

export function areaHint(text) {
  const arr = text.match(/\b(\d{1,2})(?:e|ème|er|th)\b/);
  if (arr) return arr[0];
  // "in Le Marais", "in Pigalle", "à Belleville"
  const m = text.match(/\b(?:in|à|dans)\s+((?:le|la|les|the)\s+)?([A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+)?)/u);
  return m && !/^(Paris|Berlin|Barcelona|London|Instagram)$/i.test(m[2]) ? `${m[1] || ''}${m[2]}`.trim() : null;
}
