// Turns receipt text (from the on-device reader) into lines, a total and service info.
// Prices: "12.50", "12,50", "£12.50", "€ 12,50", and "£6 50" where the reader lost the dot.
const PRICE = /(?:[£€$]\s?)?(-?\d{1,4}(?:[ .]\d{3})*[.,]\d{2}|(?<=[£€$]\s?)\d{1,4}\s\d{2})\s*(?:€|eur|gbp)?\s*[a-z<*]?\s*$/i;
const TOTAL = /\b(total|totaal|totale|gesamt|summe|net a payer|à payer|a payer|montant|amount due|balance to pay|to pay|bedrag)\b/i;
const SKIP = /\b(sous[- ]?total|subtotal|items total|tva|vat|btw|mwst|iva|ttc|ht\b|netto|cb|carte|card|visa|mastercard|amex|maestro|contactless|tendered|esp[eè]ces|cash|rendu|change|paiement|payment|betaling|betaald|merci|thank|ticket|table|couverts?|covers|serveur|server|addition|date|heure|time|siret|tel|tél|phone|clubcard|nectar|sparks|saving|savings|points|guest|aid|pan|auth|merchant|terminal|approved|balance|items\s*:|each|per kg|@)\b/i;

const num = (s) => parseFloat(s.replace(/\s(?=\d{2}$)/, '.').replace(/\s/g, '').replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.'));

export function parseReceipt(text) {
  const raw = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lines = [];
  let total = null;
  let servicePct = null;
  let serviceIncluded = /service\s+compris|service\s+inclus|prix\s+nets?|service\s+included|inclusief service/i.test(text);
  let wantTotal = false; // "TOTAL:" on its own line: the amount is on the next one

  for (let k = 0; k < raw.length; k++) {
    // Reader debris after the price ("£4.40 }  -", "£14.25 ‘2") and a £ read as "g".
    const l = raw[k].replace(/(?<=\d[.,]\d{2})(?:\s+\S{1,2})+\s*$/u, '').replace(/(^|\s)[gfE](?=\d{1,4}[.,]\d{2}\b)/g, '$1£');
    const svc = l.match(/service[^0-9]*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
    if (svc) servicePct = parseFloat(svc[1].replace(',', '.'));
    const m = l.match(PRICE);
    if (!m) {
      if (TOTAL.test(l) && !/sous|sub|items/i.test(l)) wantTotal = true;
      continue;
    }
    const price = num(m[1]);
    if (!isFinite(price)) continue;
    let name = l.slice(0, m.index).trim().replace(/[.\-_:\s£€$*]+$/, '');
    if ((wantTotal || TOTAL.test(l)) && !/sous|sub|items|before|guest|saving|clubcard|per /i.test(l)) {
      total = Math.max(total || 0, price);
      wantTotal = false;
      continue;
    }
    if (/service/i.test(l) && !serviceIncluded) {
      lines.push({ name: 'Service', price, service: true });
      continue;
    }
    // Product codes at the start (M&S "29386680 Food Paper Ba"), quantity markers, stray symbols.
    name = name.replace(/^\d{6,}\s+/, '').replace(/^[^A-Za-zÀ-ÿ0-9]+/, '').replace(/^(?:\S\s+)+(?=\d{1,2}\s+\p{L})/u, '').trim();
    if (SKIP.test(l) || !/[A-Za-zÀ-ÿ]{2}/.test(name) || price <= 0 || price > 2000) continue;
    // "2 x Café 3,00", "2 Café", "1 A Pepsi" (Belgian VAT letter) → quantity in the name
    const q = name.match(/^(\d{1,2})\s*(?:[x×*]|[A-D](?=\s))?\s+(.+)/i);
    if (q) name = +q[1] > 1 ? `${q[2]} ×${q[1]}` : q[2];
    lines.push({ name: name.replace(/\s{2,}/g, ' '), price });
  }
  const sum = Math.round(lines.reduce((a, b) => a + b.price, 0) * 100) / 100;
  return {
    lines,
    total: total ?? sum,
    sum,
    matchesTotal: !!(total == null || Math.abs(total - sum) < 0.05 || (servicePct && Math.abs(total - sum * (1 + servicePct / 100)) < 0.1)),
    serviceIncluded,
    servicePct,
  };
}
