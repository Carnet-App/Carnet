// Runs the second receipt reader off the main thread, so the screen stays responsive.
// Models and the runtime are fetched the first time a receipt needs them, then kept offline.
import * as ort from 'onnxruntime-web/wasm';
import { createReader } from './paddle.js';

// The runtime's .wasm is bundled by Vite (assets/ort-wasm-…), fetched only when this worker starts.
ort.env.wasm.numThreads = 1; // no cross-origin isolation on this site, so no threads

let reader = null;
async function load() {
  if (reader) return reader;
  const get = async (p, as) => { const r = await fetch(p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r[as](); };
  const [det, rec, dict] = await Promise.all([get('/ocr/paddle/det.onnx', 'arrayBuffer'), get('/ocr/paddle/rec.onnx', 'arrayBuffer'), get('/ocr/paddle/keys.txt', 'text')]);
  reader = await createReader({ ort, det: new Uint8Array(det), rec: new Uint8Array(rec), dict, mkCanvas: (w, h) => new OffscreenCanvas(w, h), sessionOptions: { executionProviders: ['wasm'] } });
  return reader;
}

self.onmessage = async ({ data: { id, bitmap } }) => {
  try {
    const r = await load();
    self.postMessage({ id, stage: 'reading' });
    const res = await r.read(bitmap, { onLine: (i, n) => i % 8 === 0 && self.postMessage({ id, stage: 'progress', i, n }) });
    bitmap.close?.();
    self.postMessage({ id, ok: true, text: res.text });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message || e) });
  }
};
