// Loads the app's real reading modules under Node.
// The only changes are mechanical and needed to leave the browser: model and core paths,
// canvases from node-canvas, and canvases handed to Tesseract as PNG buffers.
// No reading logic is altered, so results reflect what the app does.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from 'canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(here, '../..');
const req = createRequire(path.join(APP, 'package.json'));
globalThis.__mkCanvas = () => createCanvas(1, 1);

// Model variants: 'app' = the files the app ships (public/ocr/lang), or an @tesseract.js-data variant.
function langDir(model) {
  if (model === 'app') return path.join(APP, 'public/ocr/lang');
  const dir = path.join(APP, 'tests/.cache/lang', model);
  mkdirSync(dir, { recursive: true });
  for (const l of ['eng', 'fra']) {
    const src = path.join(APP, 'node_modules/@tesseract.js-data', l, model, `${l}.traineddata.gz`);
    if (!existsSync(src)) throw new Error(`model ${model} missing for ${l}`);
    copyFileSync(src, path.join(dir, `${l}.traineddata.gz`));
  }
  return dir;
}

let n = 0;
export async function loadApp({ model = process.env.CARNET_OCR_MODEL || 'app' } = {}) {
  const out = path.join(APP, 'tests/.cache/mods', `${model}-${process.pid}-${n++}`);
  mkdirSync(out, { recursive: true });
  const tess = pathToFileURL(req.resolve('tesseract.js')).href;
  let cap = readFileSync(path.join(APP, 'src/lib/capture.js'), 'utf8')
    .replace(/workerPath: '[^']*',\s*corePath: '[^']*',\s*langPath: '[^']*',/, `langPath: ${JSON.stringify(langDir(model))},`)
    .replace("await import('tesseract.js')", `await import(${JSON.stringify(tess)})`)
    .replace("import jsQR from 'jsqr';", `import jsQR from ${JSON.stringify(pathToFileURL(req.resolve('jsqr')).href)};`)
    .replace('workerBlobURL: false,', "cacheMethod: 'none',") // never reuse a model cached by an earlier run
    .replaceAll("document.createElement('canvas')", 'globalThis.__mkCanvas()')
    .replace('await w.recognize(canvasOrImg, ', "await w.recognize(canvasOrImg.toBuffer ? canvasOrImg.toBuffer('image/png') : canvasOrImg, ")
    .replace('await w.recognize(bc)', "await w.recognize(bc.toBuffer('image/png'))");
  writeFileSync(path.join(out, 'capture.js'), cap);
  writeFileSync(path.join(out, 'receipt.js'), readFileSync(path.join(APP, 'src/lib/receipt.js'), 'utf8'));
  const capture = await import(pathToFileURL(path.join(out, 'capture.js')).href);
  const receipt = await import(pathToFileURL(path.join(out, 'receipt.js')).href);
  return { capture, receipt };
}

export async function imageCanvas(file, maxW = 1600) {
  const img = await loadImage(file);
  const s = Math.min(1, maxW / img.width);
  const c = createCanvas(Math.round(img.width * s), Math.round(img.height * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function versions(model) {
  const pj = (p) => JSON.parse(readFileSync(path.join(APP, p), 'utf8')).version;
  const core = (process.env.CARNET_OCR_CORE || 'app') === 'app'
    ? pj('node_modules/tesseract.js-core/package.json')
    : pj('node_modules/tesseract.js/node_modules/tesseract.js-core/package.json');
  return { worker: pj('node_modules/tesseract.js/package.json'), core, model: model === 'app' ? 'app (@tesseract.js-data 4.0.0)' : `@tesseract.js-data ${model}`, simd: 'LSTM-only SIMD build, as Safari loads' };
}
