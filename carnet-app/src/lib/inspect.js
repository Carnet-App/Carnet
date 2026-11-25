// Developer capture inspector. Turned on with ?inspect in the address (and off with ?inspect=off).
// Everything stays on this phone: records are kept in IndexedDB, never sent anywhere.
import { get, set } from 'idb-keyval';

export function inspecting() {
  try {
    const q = new URLSearchParams(location.search).get('inspect');
    if (q === 'off') localStorage.removeItem('carnet-inspect');
    else if (q !== null) localStorage.setItem('carnet-inspect', '1');
    return localStorage.getItem('carnet-inspect') === '1';
  } catch {
    return false;
  }
}

// Keep the last 20 imports.
export async function saveInspection(record) {
  if (!inspecting()) return;
  try {
    const list = (await get('carnet-inspections')) || [];
    await set('carnet-inspections', [{ ...record, at: new Date().toISOString() }, ...list].slice(0, 20));
  } catch {}
}

// OCR lines in a compact form: text, top, height, confidence (and left/width when the reader gave them).
export const compactLines = (lines = []) => lines.map((l) => ({ t: l.text, y: Math.round(l.y), h: Math.round(l.h), c: Math.round(l.conf ?? l.confidence ?? 0), ...(l.band ? { band: true } : {}) }));
