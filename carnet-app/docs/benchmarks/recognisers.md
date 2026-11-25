### Recogniser feasibility — 2026-11-25 01:50 UTC

Same 12 crops for every engine (7 handwritten, 3 stylised, 2 printed), each scaled to 64 px high and read as one line. Node, x86 CPU; phone timings will differ.

| Engine | Model download | Start-up | Warm read, median | Extra memory | Handwritten: exact · mean CER | Stylised: exact · mean CER | Printed: exact · mean CER |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tesseract app | 17.2 MB | 353 ms | 56 ms | 231 MB | 0/7 · 54% | 2/3 · 33% | 1/2 · 4% |
| tesseract 4.0.0_best_int | 3.7 MB | 141 ms | 58 ms | 75 MB | 0/7 · 54% | 2/3 · 33% | 1/2 · 4% |
| tesseract app + white-only | 17.2 MB | 325 ms | 36 ms | 115 MB | 1/7 · 25% | 1/3 · 36% | 2/2 · 0% |
| PaddleOCR PP-OCRv4 mobile (ONNX) | 16.2 MB | 286 ms | 51 ms | 115 MB | 2/7 · 8% | 1/3 · 28% | 2/2 · 0% |

**Reading these numbers**

- Twelve crops is a feasibility signal, not a verdict: handwritten results rest on 7 headings from one publisher's font. The holdout set decides.
- PaddleOCR's handwritten misses are one character each (Juue, Pregouda, Llamato, Dragou, Cacines); Tesseract's are mostly unusable (su., ag, pi, Zanes). Near-misses can be confirmed by strict name matching against a map result or a local index; unusable reads can't.
- The two Tesseract model files read identically: the `4.0.0` file is the same integer LSTM network as `4.0.0_best_int` plus the legacy engine, which an LSTM-only build never uses. Shipping `best_int` saves 13.5 MB with no accuracy change.
- Timings are Node on an x86 server. In a browser, ONNX Runtime Web runs as WebAssembly and will be slower; it needs measuring on an iPhone before any decision.
- Cost as a targeted fallback (recognition model only, our own region finder doing detection): about 10.0 MB model + 3.8 MB runtime, compressed, downloaded only the first time a heading defeats Tesseract.
- The model's character list (Chinese + Latin) has é, è, à, É but not ê, ç, ô, û, ï, € or £: unsuitable for receipts and some French names. PaddleOCR's Latin-script model needs the same benchmark before any adoption.
- Licences: npm wrapper and packaging MIT; PaddleOCR models Apache-2.0 (to confirm from the PaddleOCR repository); ONNX Runtime Web MIT.
- Not yet tested: a handwriting-specific recogniser (for example TrOCR). Its models are hosted on Hugging Face, which this build environment can't reach; and at roughly 60 MB or more, it's unlikely to suit a phone download.
