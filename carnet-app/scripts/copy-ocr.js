// Copies the on-device OCR engine + language data into public/ so the app works offline.
import { cpSync, mkdirSync } from 'node:fs';
const out = 'public/ocr';
mkdirSync(out + '/lang', { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', out + '/worker.min.js');
for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'])
  cpSync('node_modules/tesseract.js-core/' + f, out + '/' + f);
cpSync('node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', out + '/lang/eng.traineddata.gz');
cpSync('node_modules/@tesseract.js-data/fra/4.0.0/fra.traineddata.gz', out + '/lang/fra.traineddata.gz');
console.log('OCR assets copied');
