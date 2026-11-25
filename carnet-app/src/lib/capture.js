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
    const w = await ocrWorker();
    await w.setParameters({ tessedit_pageseg_mode: '7' }); // one line of text
    try {
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
        const { data } = await w.recognize(bc);
        const t = (data.text || '').trim();
        if (data.confidence > 60 && /\p{L}{3,}/u.test(t)) extra.push({ text: t, y: a, h: b - a, conf: data.confidence, band: true });
      }
    } finally {
      await w.setParameters({ tessedit_pageseg_mode: '3' });
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
const STOP = /\b(the|a|an|of|in|for|and|near|to|on|so|with|from|that|is|are|you|your|this|it|at|by|where|when|till|until|under)\b/i;
const sentence = (t) => t.replace(/[“”"«»_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const squash = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export function overlayCandidates(lines, { handle } = {}) {
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
    }
    // "SUGAAR IS THAT DREAM MIX…": the quote names the place itself.
    if (!name) name = q.map(sayIs).find(Boolean) || null;
    if (false) name = q.join(' ').match(/(?:^|[“"\s])([A-ZÀ-Ý][A-ZÀ-Ý'’&-]{2,}(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’&-]{2,}){0,3})\s+(?:IS|1S|ES|ARE|HAS)\s/u)?.[1] || null;
    out.push({ name: name || '', why: name ? 'on the photo · name above a quote' : 'on the photo · quote', weight: name ? 8 : 4, note: quote, hint: placeHint(quote) });
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
    const lone = L.filter((l, i) => !used.has(i) && l.text.split(/\s+/).length <= 4 && !STOP.test(l.text) && !junk(l.text) && !/[.!?]$/.test(l.text) && !/[€£$]|\d{1,2}\s?(am|pm|h)\b|midnight|sunrise/i.test(l.text) && /\p{L}{3,}/u.test(l.text))
      .sort((a, b) => b.h - a.h);
    lone.slice(0, 2).filter((l, k) => !k || l.h >= lone[0].h * 0.8).forEach((l, k) => out.push({ name: l.text, why: k ? 'on the photo' : 'on the photo · biggest text', weight: k ? 3 : 5 }));
  }
  // Facts worth keeping as the note: price, hours, music.
  const facts = L.filter((l, i) => !used.has(i) && /[€£$]\s?\d|\d{1,2}\s?(am|pm|h)\b|midnight|sunrise|till|until|techno|house|jazz|disco|entry|free/i.test(l.text)).map((l) => l.text);
  if (facts.length) for (const o of out) o.note = [o.note, ...facts].filter(Boolean).join(' · ');
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
  if (post) return tag(venueCandidates(post.caption), 'caption').filter((c) => c.weight >= 2);
  const clean = (lines || []).filter((l) => l.conf >= 80 && l.text);
  if (!clean.length) return tag(venueCandidates(text), 'text');
  return tag(venueCandidates(clean.map((l) => l.text).join('\n'), clean, height), 'on screen');
}
export const isStrong = (cands) => cands.some((c) => c.weight >= 4);
export function tieredCandidates(first, picture, text) {
  if (isStrong(first)) return first;
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
  // Article and list headlines: "Best natural wine in Paris", "10 places to eat in Berlin"
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
export function venueCandidates(text, lines = null, height = 1) {
  const out = [];
  const add = (name, why, weight) => {
    // OCR leaves icon debris at line ends ("ROJO oO m6 x"): drop trailing 1–2 character bits.
    name = name.replace(/(\s+\S{1,2})+\s*$/u, (m) => (/[A-ZÀ-Ý]{2}/.test(m) ? m : ''));
    name = name.replace(/^\s*\d{1,2}[.)]\s+/, '');
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

  // Instagram location tag: "victoiretaverne 📍 Les Puces de Vanves, Porte de Vanves, Paris"
  // (the pin often reads as junk like "Ÿ").
  for (const l of all.slice(0, 6)) {
    const m = l.match(/^[a-z0-9._]{3,30}\s+(?:\S{1,2}\s+)?(\p{Lu}[^,]{2,40}),\s*\p{Lu}[^,]*(?:,|$)/u);
    if (m) add(m[1], 'location tag', 6);
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
    // On a list page the numbered items are the places; the big text is the article title.
    const listed = out.filter((o) => o.why === 'list item').length >= 2;
    const big = listed ? [] : [...body].sort((a, b) => b.h - a.h).slice(0, 3);
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
