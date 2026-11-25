### R5 — second receipt reader: PaddleOCR (ONNX) vs Tesseract — 2026-11-25

55 private receipt photos/screenshots (same set as P4b), every reading scored by the same parser (`tests/bench/rescore.mjs` logic).
Paddle run through onnxruntime-node with the PP-OCR detector + recogniser; image long side 1600 px; boxes joined into rows by vertical overlap.
Nothing here ships yet. No cloud, no paid service.

| Reader | Item amounts | Extra (non-item) amounts | Printed total right | "Adds up" (wrong) |
| --- | --- | --- | --- | --- |
| Tesseract, current app (P4b text) | 154/298 (52%) | 63 | 22/38 | 11 (1) |
| Paddle PP-OCRv4 (ch det + rec, 15.6 MB) | 156/298 (52%) | 22 | 25/38 | 10 (0) |
| Paddle PP-OCRv5 mobile rec (21 MB, has £ €) | 153/298 (51%) | 17 | 23/38 | 11 (0) |
| Paddle v4, best of 0° / 90° / 270° | 162/298 (54%) | 21 | 29/38 | 13 (0) |
| **Tesseract + Paddle v4, app picks the more believable reading** | **177/298 (59%)** | 35 | **29/38** | **18 (1)** |
| Tesseract + Paddle v4 + v5 | 182/298 (61%) | 34 | 29/38 | 19 (1) |
| Oracle: better of the two per receipt (answer key) | 204/298 (68%) | | | |

"More believable": adds up to its printed total, else has a printed total closest to its items, else more items. No answer key used.
The one wrong "adds up" is the known Fujifilm case (same misread in a line and the total).

Time (Node, 2-core server, native ONNX): median 2.2 s, max 5.1 s per receipt for Paddle v4. Safari/WASM on an iPhone still to measure.
Paddle misses: sideways photos (no turning; the app already finds the way up, so give it the upright image), and very dim/dot-matrix print.
