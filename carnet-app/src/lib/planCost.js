// What a plan cost, in Split: a booked plan (tickets for the Eiffel Tower) can carry its cost as an
// ordinary shared expense, linked by receipt.item_id. Change it on the plan or in Split — it's one row.
import { toMinor, evenMinor, expenseFields } from './minor.js';

export const costOf = (expenses, itemId) => (itemId ? (expenses || []).find((e) => e.receipt?.item_id === itemId) : null) || null;

export function costRow({ existing, itemId, tripId, title, day, amount, currency, payer, who, newId }) {
  const amountMinor = toMinor(amount, currency);
  const people = who.length ? who : [payer];
  const id = existing?.id || newId();
  return {
    ...(existing || {}), id, client_key: existing?.client_key || id, trip_id: tripId, title, payer_email: payer, method: 'evenly',
    spent_on: day || existing?.spent_on || new Date().toLocaleDateString('en-CA'),
    receipt: { ...(existing?.receipt || {}), item_id: itemId },
    ...expenseFields({ amountMinor, sharesMinor: evenMinor(amountMinor, people), currency, kind: 'expense', validation: 'manual' }),
  };
}

// The price on a ticket or booking confirmation: an amount on a total/price line if there is one
// ("Total 116,00 €", "Montant TTC : 58.00 EUR"), otherwise the largest amount with a currency.
const MONEY = /(?:([€£$])\s?(\d{1,5}(?:[.,]\d{2})?)|(\d{1,5}(?:[.,]\d{2})?)\s?(€|£|\$|EUR|GBP|USD)(?![A-Za-z]))/gi;
const SYM = { '€': 'EUR', '£': 'GBP', $: 'USD', EUR: 'EUR', GBP: 'GBP', USD: 'USD' };
export function findPrice(text = '') {
  const lines = text.split(/\n/);
  const found = [];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(MONEY)) {
      const amount = parseFloat((m[2] || m[3]).replace(',', '.'));
      if (!(amount > 0)) continue;
      found.push({ amount, currency: SYM[(m[1] || m[4]).toUpperCase()] || 'EUR', total: /\b(total|montant|amount|prix|price|paid|pay[ée]|à payer|ttc|grand total)\b/i.test(l + ' ' + (lines[i - 1] || '')) });
    }
  });
  if (!found.length) return null;
  const totals = found.filter((f) => f.total);
  const pick = (totals.length ? totals : found).reduce((a, b) => (b.amount > a.amount ? b : a));
  return { amount: pick.amount, currency: pick.currency };
}
