// Turns receipt text (from the on-device reader) into item lines, a printed total, service and
// discounts. Works line by line, but understands the common layouts:
//   "2 Natas £3.50"                          quantity in front, line total at the end
//   "1x cappuchino 3,70 A"                   VAT letter after the price
//   "PRIRODNA VODA 0,75 L 2,000 x 4,40 E+ 8,80"   quantity × unit price, then the line total
//   "Doppelter Espresso 4,20 4,20 A"         unit price and line total columns
//   "CAULIFLOWER PISTACHIO" / "14,50 2,00 29,00 H"   name on one line, its numbers on the next
//   "2 Almond Croissant" / "2 x £5.00 £10.00"         the same, with "×"
//   "£2.25 each"                              unit price for the line above, not an item
//   "Nectar Price Saving -£0.85"              a discount
// Totals are recognised in English, French, Dutch, German, Croatian and Italian; when several
// are printed (Total / Balance to Pay / Sale Value), the one the lines add up to is chosen.

// A money amount: 12.50, 12,50, £12.50, € 12,50, 1.234,50, -0.85, and "£6 50" (lost decimal point).
const AMOUNT = /(?:(?<![\p{L}+])(-)\s?)?(?:[£€$]|eur|gbp)?\s?(\d{1,4}(?:[.,\s]\d{3})*[.,]\s?\d{2}(?!\d)|(?<=[£€$]\s?)\d{1,4}\s\d{2}(?!\d))(?:\s?(?:€|eur|gbp))?/giu;
const QTY_X = /(?:^|\s)(\d{1,3}(?:[.,]\d{1,3})?)\s?[x×*](?=\s|$)/i; // "2 x £5.00", "2,000 x 4,40"
const TAX_TAIL = /(?:\s+(?:[A-HPT]|[A-F][+-]|[A-H]\)|\*{1,2}|<))+\s*$/; // VAT letters and markers after prices
const TOTAL = /\b(total(?:\s+ttc)?|totaal|totale|gesamt|summe(?: in)?|ukupno|montant(?: [àa] payer)?|net [àa] payer|[àa] payer|amount due|balance to pay|total to pay|to pay|bedrag|importe|sale value|grand total)\b/i;
// The amount actually paid (card slip, payment line): a second witness for the total.
const PAID = /\b(card payment|card tendered|cash tendered|bancontact|kartica|c\.?\s?credito|dettaglio pagamenti|totaal betaald|montant pay[ée]|amount paid|paid|payconiq)\b/i;
// "Your total saving today", "total points": not the bill's total.
const NOT_TOTAL = /\b(total sav\w*|sav(?:ing|ed)s? today|total points|points total|total deposit|total discount)\b/i;
const SUBTOTAL = /\b(sous[- ]?total|sub[- ]?total|items total|zwischensumme|balance before saving)\b/i;
const SERVICE = /\b(service|serv\b|servizio|bedienung|pourboire|gratuity|tip\b)/i;
// Lines that are never items: tax tables, payment, card slips, receipt furniture.
const SKIP = /\b(tva|vat|btw|mwst|iva|pdv|porez|steuer|netto|brutto|osnovica|iznos|rekapitulacija|ht\b|cb\b|carte|card|visa|mastercard|maestro|amex|kartica|bancontact|contactless|paypass|tendered|esp[eè]ces|cash|bargeld|gotovina|rendu|change|r[uü]ckgeld|paiement|payment|pagamento|pagamenti|betaling|betaald|kreditkarte|ec-karte|merci|thank|danke|hvala|bedankt|ticket\s*n|table|tafel|tisch|stol|couverts?|covers|serveur|server|operater|vendeur|addition|date|datum|heure|time|tijd|vrijeme|siret|oib|tel|t[ée]l|phone|clubcard|nectar points|sparks|points|per guest|par client|aid|pan seq|auth|merchant|terminal|approved|item value|weight|deposit|reprint|rabatt in|items\s*:|per kg|kg\b)\b/i;
const MONEY_CUR = (t) => (/£|gbp/i.test(t) ? 'GBP' : /€|\beur\b/i.test(t) ? 'EUR' : /\bchf\b/i.test(t) ? 'CHF' : /\$|usd/i.test(t) ? 'USD' : null);

const num = (s) => {
  s = s.trim();
  if (/^\d{1,4}\s\d{2}$/.test(s)) return parseFloat(s.replace(' ', '.'));
  // The last separator before two digits is the decimal point; the others group thousands.
  s = s.replace(/([.,])\s(\d{2})$/, '$1$2');
  const m = s.match(/^(.*)[.,](\d{2})$/);
  if (!m) return NaN;
  return parseFloat(m[1].replace(/[.,\s]/g, '') + '.' + m[2]);
};
const c2 = (n) => Math.round(n * 100);

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT)) {
    const v = num(m[2]);
    if (isFinite(v)) out.push({ value: m[1] ? -v : v, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

export function parseReceipt(text) {
  const raw = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lines = [];
  const adjustments = [];
  const totals = [];
  const paid = [];
  const subtotals = [];
  let servicePct = null;
  let serviceIncluded = /service\s+compris|service\s+inclus|prix\s+nets?|service\s+included|inclusief service|servizio incluso/i.test(text);
  let wantTotal = null; // "TOTAL:" alone on its line: its amount is on the next one
  let pending = null; // a name line with no amount yet: its numbers may be on the next line
  let afterTotal = false; // below the total: payment, tax tables, card slip

  for (let k = 0; k < raw.length; k++) {
    // Reader debris after the price ("£4.40 }  -"), a £ read as "g"/"f"/"E" before a price.
    const l = raw[k].replace(/(?<=\d[.,]\d{2})(?:\s+[^\w\s]{1,2})+\s*$/u, '').replace(/(^|\s)[gfE](?=\d{1,4}[.,]\d{2}\b)/g, '$1£');
    const svcPct = l.match(/(?:service|serv)[^0-9]*?(\d{1,2}(?:[.,]\d{1,2})?)\s*%|(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:service|serv)/i);
    if (svcPct) servicePct = parseFloat((svcPct[1] || svcPct[2]).replace(',', '.'));
    // Percentages and volumes/weights aren't money ("12.5%", "0,75 L", "1.0 l", "4.460 kg").
    const lm = l.replace(/\d{1,2}(?:[.,]\d{1,2})?\s*%/g, (m) => ' '.repeat(m.length)).replace(/\d+[.,]\s?\d+\s?(?:l|cl|ml|kg|g|lt)\b/gi, (m) => ' '.repeat(m.length));
    const am = amountsIn(lm);
    const label = (am.length ? l.slice(0, am[0].index) : l).replace(TAX_TAIL, '').trim();

    if (!am.length) {
      // "TOTAL:" on its own; not a column header row ("Artikl Cijena Kol. Ukupno PG").
      const short = l.split(/\s+/).length <= 3;
      if (short && TOTAL.test(l) && !SUBTOTAL.test(l)) { wantTotal = 'total'; pending = null; continue; }
      if (short && SUBTOTAL.test(l)) { wantTotal = 'subtotal'; pending = null; continue; }
      // "£2.25 each" without a parsed amount is handled below; a plain text line may be an item name.
      pending = !afterTotal && /\p{L}{3}/u.test(l) && !SKIP.test(l) && !/^(soft drinks|wine|snacks|desserts|starters|sides|roasts|mains|drinks|food)\b/i.test(l) ? l : pending && /^\s*\p{Ll}/u.test(l) ? pending : null;
      continue;
    }
    const last = am[am.length - 1].value;

    // Totals and subtotals (including "TOTAL:" on the line before).
    // What was paid, wherever it's printed (often below the total, among card details).
    if (PAID.test(label) && last > 0) { paid.push(last); if (!wantTotal) { pending = null; continue; } }
    // "Total" on its own line, then "VAT 20% £4.99": the next line is tax, not the total.
    if (wantTotal && SKIP.test(l) && !PAID.test(l)) wantTotal = null;
    if (NOT_TOTAL.test(l)) { pending = null; continue; }
    if (wantTotal || (TOTAL.test(label) && !SUBTOTAL.test(label)) || SUBTOTAL.test(label)) {
      const kind = SUBTOTAL.test(label) ? 'subtotal' : TOTAL.test(label) ? 'total' : wantTotal;
      const soFar = lines.reduce((a, b) => a + b.price, 0);
      if (/balance before saving/i.test(label)) subtotals.push(last);
      else (kind === 'subtotal' ? subtotals : totals).push(last);
      // A real total isn't smaller than the items above it: only then is the rest payment and tax.
      if (kind === 'total' && last >= soFar * 0.95) afterTotal = true;
      wantTotal = null; pending = null;
      continue;
    }
    wantTotal = null;

    // Printed service charge, as an amount.
    if (SERVICE.test(label) && !serviceIncluded && last > 0) {
      lines.push({ name: 'Service', price: last, service: true });
      pending = null;
      continue;
    }
    // "£2.25 each": the unit price of the line above.
    if (/\beach\b|\bea\.?\b|\bpro stk\b|\bla pi[eè]ce\b/i.test(l)) {
      const prev = lines[lines.length - 1];
      if (prev && !prev.service) prev.unitPrice = am[0].value;
      continue;
    }
    if (afterTotal || SKIP.test(l)) { pending = null; continue; }

    // Discounts and savings.
    if (last < 0) {
      adjustments.push({ kind: 'discount', label: label || 'Discount', amount: last });
      pending = null;
      continue;
    }

    // Quantity and unit price, from "2 x 4,40" or from unit/qty/total columns.
    let quantity = null, unitPrice = null;
    const qx = l.match(QTY_X);
    if (qx) {
      quantity = parseFloat(qx[1].replace(',', '.'));
      const after = am.find((a) => a.index > l.indexOf(qx[0]));
      if (after && after !== am[am.length - 1]) unitPrice = after.value;
    } else if (am.length >= 3) {
      // Unit, quantity, total ("14,50 2,00 29,00"): quantity × unit = total.
      const [a, b, c] = am.slice(-3).map((x) => x.value);
      if (Math.abs(c2(a * b) - c2(c)) <= 1) { unitPrice = a; quantity = b; }
      else if (Math.abs(c2(a * c) - c2(b)) <= 1) { unitPrice = c; quantity = a; }
    } else if (am.length === 2) {
      const [a, b] = am.map((x) => x.value);
      if (c2(a) === c2(b)) unitPrice = a;
      else if (b > a && Math.abs(b / a - Math.round(b / a)) < 0.001 && Math.round(b / a) <= 20) { unitPrice = a; quantity = Math.round(b / a); }
    }
    const price = last;

    // The name: text before the numbers, else the name line just above.
    let name = label.replace(QTY_X, ' ').replace(/^\d{6,}\s+/, '').replace(/^[^\p{L}\d]+/u, '').replace(/[\s=:.\-_*£€$]+$/u, '').trim();
    const lead = name.match(/^(\d{1,2})\s*(?:[x×*]\s*)?(?=\p{L})/u) || name.match(/^(\d{1,2})\s+(?:[A-D]\s+)?(?=\S)/);
    if (lead) {
      quantity ??= +lead[1];
      name = name.slice(lead[0].length).replace(/^[A-D]\s+/, '').trim();
    }
    if (!/\p{L}{3}/u.test(name) && pending) {
      name = pending.replace(/^(\d{1,2})\s*(?:[x×*]\s*)?/, (m, q) => { quantity ??= +q; return ''; }).trim();
      pending = null;
    } else pending = null;
    if (!/\p{L}{3}/u.test(name) || price <= 0 || price > 5000) continue;
    if (unitPrice != null && quantity == null && c2(unitPrice) !== c2(price) && unitPrice > 0) {
      const q = price / unitPrice;
      if (Math.abs(q - Math.round(q)) < 0.001) quantity = Math.round(q);
    }
    const line = { name: name.replace(/\s{2,}/g, ' '), price };
    if (quantity != null && quantity !== 1) line.quantity = quantity;
    if (unitPrice != null && c2(unitPrice) !== c2(price)) line.unitPrice = unitPrice;
    if (quantity === 1 && unitPrice == null) line.quantity = 1;
    lines.push(line);
  }

  const items = c2(lines.filter((l) => !l.service).reduce((a, b) => a + b.price, 0));
  const service = c2(lines.filter((l) => l.service).reduce((a, b) => a + b.price, 0));
  const discount = c2(adjustments.reduce((a, b) => a + b.amount, 0));
  const sum = (items + service + discount) / 100;
  // Several totals printed: the one the lines add up to; otherwise the first "total" read.
  const fits = (t) => Math.abs(c2(t) - (items + service + discount)) <= 1 ||
    (!service && servicePct && Math.abs(c2(t) - Math.round((items + discount) * (1 + servicePct / 100))) <= 2);
  // A printed total the lines add up to; else an amount paid they add up to; else the first total
  // read, else what was paid (a payment slip with no item lines, a total too faint to read).
  const total = totals.find(fits) ?? paid.find(fits) ?? totals[0] ?? paid[0] ?? null;
  let validation = 'unverified';
  // With no item lines there is nothing to check the total against.
  if (total != null && (items || service)) validation = fits(total) ? 'reconciled' : 'difference';
  else if (subtotals.length && subtotals.some((s) => Math.abs(c2(s) - items) <= 1) && !service) validation = 'unverified';
  return {
    lines,
    adjustments,
    total: total ?? sum,
    printedTotal: total,
    subtotal: subtotals[0] ?? null,
    sum,
    validation,
    matchesTotal: validation === 'reconciled',
    serviceIncluded,
    servicePct,
    currency: MONEY_CUR(text),
    // Any money at all on it? (A bag-drop slip or parcel receipt has none.)
    anyMoney: /[£€$]\s?\d|\d[.,]\d{2}(?!\d)/.test(text),
  };
}

// What the split screen starts from: item lines, a printed service amount and any discounts kept
// as their own adjustments (never folded into the tip), and a tip pre-filled only from a printed
// percentage when no service amount was printed.
export function splitInputs(r) {
  const service = (r.lines || []).filter((l) => l.service);
  const adjustments = [
    ...service.map((l) => ({ kind: 'service', label: l.name || 'Service', amount: l.price })),
    ...(r.adjustments || []),
  ];
  return {
    lines: (r.lines || []).filter((l) => !l.service),
    adjustments,
    tipPct: r.serviceIncluded || service.length ? 0 : r.servicePct || 0,
  };
}

// The receipt's own total against the lines as they stand now (after any edits), in minor units.
// reconciled: they agree · unverified: no total was read · difference: they don't, by `diff`.
export function checkTotal(printedMinor, itemsMinor, adjustmentsMinor = 0, servicePct = null) {
  if (printedMinor == null) return { status: 'unverified', diff: null };
  const plain = itemsMinor + adjustmentsMinor;
  if (Math.abs(printedMinor - plain) <= 1) return { status: 'reconciled', diff: 0 };
  if (servicePct && Math.abs(printedMinor - Math.round(plain * (1 + servicePct / 100))) <= 2) return { status: 'reconciled', diff: 0 };
  return { status: 'difference', diff: printedMinor - plain };
}
