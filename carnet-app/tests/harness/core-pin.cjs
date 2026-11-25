// Makes Node load the same Tesseract core build an iPhone loads, so harness results are
// comparable with the app.
//   CARNET_OCR_CORE=app     → node_modules/tesseract.js-core (what scripts/copy-ocr.js ships today)
//   CARNET_OCR_CORE=bundled → the core tesseract.js itself depends on
// Either way the build is the LSTM-only, plain-SIMD one: Safari has SIMD but not relaxed SIMD,
// and the app's worker asks for the LSTM-only build. Worker threads inherit this via execArgv.
const Module = require('module');
const path = require('path');
const mode = process.env.CARNET_OCR_CORE || 'app';
const root = mode === 'app'
  ? path.resolve(__dirname, '../../node_modules/tesseract.js-core')
  : path.dirname(require.resolve('tesseract.js-core/package.json', { paths: [path.dirname(require.resolve('tesseract.js/package.json', { paths: [path.resolve(__dirname, '../..')] }))] }));
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('tesseract.js-core/tesseract-core')) {
    return orig.call(this, path.join(root, 'tesseract-core-simd-lstm.js'), ...rest);
  }
  return orig.call(this, request, ...rest);
};
