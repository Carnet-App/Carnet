# Carnet recognition and money benchmarks

Summaries only. The images they are measured on (screenshots, receipts) and the raw OCR text are private and are never committed. They live in a folder outside the repository that you point the scripts at with `CARNET_FIXTURES`.

## Running

```
npm test                                   # unit suite: money, receipts, capture rules, sync, worker. Offline, seconds.

export CARNET_FIXTURES=/path/to/private-fixtures   # contains manifest.json, travel/, receipts/, crops.json, crops/
CARNET_OCR_CORE=app     npm run bench -- --config A0 --write                   # the app as shipped
CARNET_OCR_CORE=bundled npm run bench -- --config A1 --write                   # matching worker and core
CARNET_OCR_CORE=bundled CARNET_OCR_MODEL=4.0.0_best_int npm run bench -- --config B0-best_int --write
CARNET_ALT_OCR=/path/to/scratch-with-@gutenye/ocr-node node --require ./tests/harness/core-pin.cjs tests/bench/recognisers.mjs --write
```

Without `CARNET_FIXTURES` the benchmarks print a note and exit, so CI stays green on machines without the private set.

## What the numbers mean

- **Travel:** offline extraction only (no map lookups). A labelled place counts as found when a proposal is within 20% edit distance of its name after removing accents and punctuation; “exact” means identical in that loose form. Proposals counted are the ones the review screen would show with no signal (confidence weight ≥ 4) plus “type the name” cards.
- **Character error rate (CER):** edit distance between the labelled text and the best-matching window of all OCR output, divided by the labelled length. Case folded; accents and punctuation kept.
- **Receipts:** item amounts matched as a multiset in pence; “extra” are amounts proposed that aren't labelled items; “adds up shown” counts receipts where the app would say the lines match the total, and how many of those it can't actually back up.
- **Intervals:** Wilson 95%. With 12 labelled places, an interval spans about 50 points: these sets show direction, not precision. The holdout set (≥ 100 images) decides phase exits.
- **Harness vs browser:** the Node harness loads the app's own `capture.js` and `receipt.js`, the same core build an iPhone uses (LSTM-only SIMD) and the same model files. Browser runs on a real phone are authoritative for timing and memory.
