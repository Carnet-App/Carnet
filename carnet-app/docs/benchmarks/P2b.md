### P2b — 2026-11-25 11:41 UTC

Worker tesseract.js 7.0.0 · core 7.0.0 (LSTM-only SIMD build, as Safari loads) · model app (@tesseract.js-data 4.0.0_best_int) · Node harness (browser numbers to follow on device)

**Travel (38 screenshots, 42 labelled places, offline extraction)**

| Measure | Result | 95% interval |
| --- | --- | --- |
| Recall: labelled places proposed | 27/42 (64%) | 49–77% |
| of which exact spelling | 25/42 | |
| Precision: proposals that are real places | 27/31 (87%) | 71–95% |
| Wrong proposals | 4 | |
| Proposals on the no-place slide | 1 | |
| “Type the name” cards | 4 | |
| Time per screenshot, p50 / p95 | 2808 / 3672 ms | |

| Text style | Key texts | Mean character error rate | Read exactly |
| --- | --- | --- | --- |
| printed | 29 | 3% | 26/29 |
| overlay | 9 | 6% | 8/9 |
| stylised | 11 | 17% | 6/11 |
| handwritten | 7 | 39% | 1/7 |

**Receipts (12 photos)**

| Measure | Result |
| --- | --- |
| Item amounts found | 27/59 (46%) |
| Extra amounts that aren't items | 2 |
| Printed total read correctly | 3/7 |
| “Adds up” shown | 3, of which wrong or unverifiable 0 |
| Amounts proposed on the parking notice | 0 |
| Time per receipt, p50 / p95 | 8980 / 22243 ms |

Peak process memory 627 MB (Node; not representative of Safari).
