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
  const { data } = await w.recognize(canvasOrImg);
  onProgress?.(1);
  return data.text || '';
}

export async function readImage(file, onProgress) {
  const { img, url } = await loadImage(file);
  const canvas = toCanvas(img);
  const qr = readQR(canvas);
  const text = await readText(canvas, onProgress);
  return { text, qr, url, canvas };
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
    const text = await readText(c);
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

export function thumbBlob(canvas, w = 640) {
  const s = Math.min(1, w / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s);
  c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
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

// Candidate venue names from an Instagram post / screenshot / caption.
export function venueCandidates(text) {
  const out = [];
  const add = (name, why, weight) => {
    name = name.replace(/[#*_|•·]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}')]+$/gu, '');
    if (name.length < 3 || name.length > 48) return;
    if (/^(follow|like|reply|view|liked|more|sponsored|original audio|see translation|comments?|share|save)\b/i.test(name)) return;
    const k = name.toLowerCase();
    const ex = out.find((o) => o.name.toLowerCase() === k);
    if (ex) ex.weight += weight;
    else out.push({ name, why, weight });
  };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const pin = l.match(/(?:📍|📌|location:|address:|adresse\s*:)\s*(.+)/i);
    if (pin) add(pin[1].split(/[,–—-]/)[0], 'pin / location', 5);
    for (const m of l.matchAll(/@([a-z0-9._]{3,30})/gi)) add(m[1].replace(/[._]/g, ' '), '@mention', 2);
    const num = l.match(/^\s*(?:\d{1,2}[.)]|[-•])\s*(.+)/);
    if (num) add(num[1].split(/[,–—:(-]/)[0], 'list item', 3);
  }
  // The location tag sits on the line right under the account name in a post screenshot.
  for (let i = 0; i < Math.min(lines.length - 1, 12); i++) {
    if (/^[a-z0-9._]{3,30}$/i.test(lines[i]) && lines[i + 1] && lines[i + 1].length < 45 && !/\d{2}:\d{2}/.test(lines[i + 1]))
      add(lines[i + 1].split(',')[0], 'location tag', 4);
  }
  // Short title-case lines are good guesses too.
  for (const l of lines.slice(0, 40)) {
    if (l.length <= 32 && /^[A-ZÀ-Ý0-9][\p{L}0-9'’&\- ]+$/u.test(l) && l.split(' ').length <= 5) add(l, 'heading', 1);
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 8);
}

export function areaHint(text) {
  const m = text.match(/\b(\d{1,2})(?:e|ème|er|th)\b/);
  return m ? m[0] : null;
}
