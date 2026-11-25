// Lists receipts whose lines don't add up, with what was read, the truth and any corrections.
//   node tests/bench/gaps.mjs P4b
import { readFileSync } from 'node:fs';
import { parseReceipt } from '../../src/lib/receipt.js';
const FIX = process.env.CARNET_FIXTURES;
const man = JSON.parse(readFileSync(FIX + '/manifest.json', 'utf8'));
const res = JSON.parse(readFileSync(FIX + '/results/' + process.argv[2] + '.json', 'utf8'));
for (const r of res.receipts) {
  const p = parseReceipt(r.text); const f = man.receipts.find((x) => x.id === r.id);
  if (p.validation !== 'difference' && !p.corrections.length) continue;
  console.log(r.id, p.validation, 'total', p.printedTotal, 'sum', p.sum.toFixed(2), 'corr', JSON.stringify(p.corrections));
  console.log('   read ', p.lines.map((l) => l.price + (l.service ? 's' : '')).join(' '), '| adj', p.adjustments.map((a) => a.amount).join(' '));
  console.log('   truth', (f.items || []).join(' '));
}
