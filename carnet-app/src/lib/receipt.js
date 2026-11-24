// Turns receipt text (from the on-device reader) into lines, a total and service info.
const PRICE = /(-?\d{1,4}(?:[ .]\d{3})*[.,]\d{2})\s*(?:€|eur|e)?\s*[a-z]?$/i;
const SKIP = /\b(total|sous[- ]?total|subtotal|tva|vat|ttc|ht\b|cb|carte|visa|mastercard|amex|esp[eè]ces|cash|rendu|change|montant|net a payer|à payer|a payer|paiement|payment|merci|ticket|table|couverts?|serveur|server|addition|date|heure|siret|tel|tél)\b/i;

const num = (s) => parseFloat(s.replace(/\s/g, '').replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.'));

export function parseReceipt(text) {
  const raw = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lines = [];
  let total = null;
  let servicePct = null;
  let serviceIncluded = /service\s+compris|service\s+inclus|prix\s+nets?|service\s+included/i.test(text);

  for (const l of raw) {
    const svc = l.match(/service[^0-9]*(\d{1,2}(?:[.,]\d)?)\s*%/i);
    if (svc) servicePct = parseFloat(svc[1].replace(',', '.'));
    const m = l.match(PRICE);
    if (!m) continue;
    const price = num(m[1]);
    if (!isFinite(price)) continue;
    let name = l.slice(0, m.index).trim().replace(/[.\-_:\s]+$/, '');
    if (/\b(total|net a payer|à payer|a payer|montant)\b/i.test(l) && !/sous|sub/i.test(l)) {
      total = Math.max(total || 0, price);
      continue;
    }
    if (/service/i.test(l) && !serviceIncluded) {
      lines.push({ name: 'Service', price, service: true });
      continue;
    }
    if (SKIP.test(l) || name.length < 2 || price <= 0 || price > 2000) continue;
    // "2 x Café 3,00" or "2 Café" → keep the quantity in the name
    const q = name.match(/^(\d{1,2})\s*[x×*]?\s+(.+)/i);
    if (q) name = `${q[2]} ×${q[1]}`;
    name = name.replace(/^[^A-Za-zÀ-ÿ0-9]+/, '');
    lines.push({ name, price });
  }
  const sum = Math.round(lines.reduce((a, b) => a + b.price, 0) * 100) / 100;
  return {
    lines,
    total: total ?? sum,
    sum,
    matchesTotal: total == null || Math.abs(total - sum) < 0.05,
    serviceIncluded,
    servicePct,
  };
}
