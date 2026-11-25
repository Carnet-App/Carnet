import { useMemo, useRef, useState } from 'react';
import { Sheet, Seg, Icon, Avatar } from '../ui';
import { upsert, remove, uid } from '../lib/store';
import { balances, simplify, pairwise, itemShares } from '../lib/money';
import { toMinor, fromMinor, evenMinor, allocate, sharesValid, expenseFields } from '../lib/minor';
import { splitInputs } from '../lib/receipt';
import { parseReceipt } from '../lib/receipt';
import { loadImage, toCanvas, readReceipt, thumbBlob } from '../lib/capture';
import { storeFile } from '../lib/files';
import { money, nameOf } from '../lib/util';
import { notify } from '../lib/push';
import { saveInspection } from '../lib/inspect';
import InspectPanel from './InspectPanel';

export default function Money({ t, me }) {
  const { members, expenses, settlements, trip } = t;
  const cur = trip.currency || 'EUR';
  const [simp, setSimp] = useState(() => localStorage.getItem('carnet-simplify') !== 'no');
  const [add, setAdd] = useState(null);
  const [scan, setScan] = useState(false);
  const net = useMemo(() => balances(expenses, settlements), [expenses, settlements]);
  const transfers = simp ? simplify(net) : pairwise(expenses, settlements);
  const total = expenses.reduce((a, e) => a + +e.amount, 0);
  const myShare = expenses.reduce((a, e) => a + (+e.shares?.[me] || 0), 0);
  const name = (e) => (e === me ? 'You' : nameOf(members, e));

  // One tap, one settlement: a repeat tap on the same transfer while it saves does nothing.
  const paying = useRef(new Set());
  function markPaid(x) {
    const key = `${x.from}|${x.to}|${toMinor(x.amount, cur)}`;
    if (paying.current.has(key)) return;
    if (!confirm(`Mark ${money(x.amount, cur)} from ${name(x.from)} to ${name(x.to)} as paid?`)) return;
    paying.current.add(key);
    setTimeout(() => paying.current.delete(key), 4000);
    const id = uid();
    upsert('settlements', { id, client_key: id, trip_id: trip.id, from_email: x.from, to_email: x.to, amount: x.amount,
      currency: cur, amount_minor: toMinor(x.amount, cur), schema_version: 2 });
  }

  return (
    <div className="page">
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div><div className="k amber">{trip.name} · {members.length} of you</div><h1 className="h1">Expenses</h1></div>
        <div style={{ textAlign: 'right' }}><div style={{ font: '500 24px/1 var(--serif)' }}>{money(total, cur)}</div><div className="s">your share {money(myShare, cur)}</div></div>
      </div>
      <div className="row">
        <button className="btn grow" onClick={() => setScan(true)}><Icon n="receipt" size={18} color="#F3EEE6" />Scan a receipt</button>
        <button className="btn ghost grow" onClick={() => setAdd({})}>+ Add a cost</button>
      </div>

      <div className="card dark col" style={{ gap: 10 }}>
        <div className="between">
          <span className="k" style={{ color: 'var(--gold)' }}>To settle up</span>
          <label className="row" style={{ font: '500 12px var(--sans)', color: '#E9E2D6', gap: 8, cursor: 'pointer' }}>
            Simplify
            <input type="checkbox" checked={simp} onChange={(e) => { setSimp(e.target.checked); localStorage.setItem('carnet-simplify', e.target.checked ? 'yes' : 'no'); }} style={{ width: 20, height: 20, accentColor: '#E2B36A' }} />
          </label>
        </div>
        {transfers.map((x, i) => (
          <div key={i} className="row" style={{ background: '#2B2621', borderRadius: 12, padding: '8px 10px' }}>
            <div className="grow" style={{ font: '500 13px var(--sans)' }}>{name(x.from)} → {name(x.to)}</div>
            <div style={{ font: '500 18px var(--serif)' }}>{money(x.amount, cur)}</div>
            <button className="btn sm" style={{ background: 'transparent', border: '1px solid #5A5148' }} onClick={() => markPaid(x)}>Paid</button>
          </div>
        ))}
        {!transfers.length && <div className="s" style={{ color: '#B7AC9C' }}>{expenses.length ? 'Everyone’s square.' : 'Nothing to settle yet.'}</div>}
        {transfers.length > 0 && <div className="s" style={{ color: '#B7AC9C' }}>{simp ? 'Fewest transfers — everyone still ends up exactly square.' : 'Who owes whom, netted pair by pair.'}</div>}
      </div>

      <div className="card" style={{ padding: '2px 14px' }}>
        <div className="list">
          {expenses.map((e) => (
            <button key={e.id} className="li" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setAdd(e)}>
              <Avatar name={nameOf(members, e.payer_email)} i={Math.max(0, members.findIndex((m) => m.email === e.payer_email))} size={26} />
              <div className="grow"><div className="n" style={{ fontSize: 16 }}>{e.title}</div><div className="s">{name(e.payer_email)} paid · {e.method || 'evenly'}</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ font: '600 13px var(--sans)' }}>{money(e.amount, e.currency)}</div><div className="s">you {money(e.shares?.[me] || 0, e.currency)}</div></div>
            </button>
          ))}
          {!expenses.length && <div className="empty">Tickets, taxis, shop runs and dinners all go here.</div>}
        </div>
      </div>
      {settlements.length > 0 && <div className="s">{settlements.length} payment{settlements.length > 1 ? 's' : ''} marked as paid.</div>}

      {add && <CostSheet t={t} me={me} e={add.id ? add : null} onClose={() => setAdd(null)} />}
      {scan && <ReceiptSplit t={t} me={me} onClose={() => setScan(false)} />}
    </div>
  );
}

function CostSheet({ t, me, e, onClose }) {
  const emails = t.members.map((m) => m.email.toLowerCase());
  // An edit keeps the cost's own currency (F6); a new cost uses the trip's.
  const cur = (e?.currency || t.trip.currency || 'EUR').toUpperCase();
  // The id is fixed when the sheet opens, so a double tap saves the same row twice, not two rows.
  const [id] = useState(() => e?.id || uid());
  const [title, setTitle] = useState(e?.title || '');
  const [amount, setAmount] = useState(e?.amount ? String(e.amount) : '');
  const [payer, setPayer] = useState(e?.payer_email || me);
  // An even split stays even; anything else (custom, from a receipt, by %) opens as the
  // amounts it actually has, so saving a title change doesn't re-split it evenly (F4).
  const startShares = e ? e.shares_minor || Object.fromEntries(Object.entries(e.shares || {}).map(([k, v]) => [k, toMinor(v, cur)])) : null;
  const wasEven = !e || (() => {
    const ks = Object.keys(startShares);
    const even = evenMinor(e.amount_minor ?? toMinor(e.amount, cur), ks);
    return ks.length > 0 && ks.every((k) => even[k] === startShares[k]);
  })();
  const [mode, setMode] = useState(wasEven ? 'evenly' : 'custom');
  const [who, setWho] = useState(e ? Object.keys(e.shares || {}) : emails);
  const [custom, setCustom] = useState(wasEven ? {} : Object.fromEntries(Object.entries(startShares).map(([k, v]) => [k, String(fromMinor(v, cur))])));
  const amtMinor = toMinor(amount, cur);
  const amt = fromMinor(amtMinor, cur);
  const customMinor = Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, toMinor(v, cur)]).filter(([, v]) => v));
  const customSum = fromMinor(Object.values(customMinor).reduce((a, b) => a + b, 0), cur);
  // Custom shares must add up exactly, to the penny (F7).
  const ok = title.trim() && amtMinor > 0 && (mode === 'evenly' ? who.length > 0 : sharesValid(amtMinor, customMinor));
  const changedSplit = !e || mode !== (wasEven ? 'evenly' : 'custom') || amtMinor !== (e.amount_minor ?? toMinor(e.amount, cur)) ||
    (mode === 'evenly' ? who.join() !== Object.keys(e.shares || {}).join() : JSON.stringify(customMinor) !== JSON.stringify(Object.fromEntries(Object.entries(startShares).filter(([, v]) => v))));
  const saving = useRef(false);

  function save() {
    if (saving.current) return;
    saving.current = true;
    const sharesMinor = mode === 'evenly' ? evenMinor(amtMinor, who) : customMinor;
    const method = !changedSplit ? e.method : mode === 'evenly' ? (who.length === emails.length ? 'evenly' : who.map((x) => nameOf(t.members, x)).join(' + ')) : 'custom';
    if (!e) notify(t.trip.id, { title: `${nameOf(t.members, me)} added ${title.trim()}`, body: `${money(amt, cur)} · you owe ${money(fromMinor(sharesMinor[me] || 0, cur), cur)}`, tag: 'money' });
    upsert('expenses', {
      ...(e || {}), id, client_key: e?.client_key || id, trip_id: t.trip.id, title: title.trim(), payer_email: payer, method,
      ...expenseFields({ amountMinor: amtMinor, sharesMinor, currency: cur, kind: e?.kind || 'expense', adjustments: changedSplit ? [] : e?.adjustments || [], validation: changedSplit ? 'manual' : e?.validation || 'manual' }),
    });
    onClose();
  }

  return (
    <Sheet title={e ? 'Edit cost' : 'Add a cost'} onClose={onClose}>
      <label className="f">What<input className="in" value={title} onChange={(x) => setTitle(x.target.value)} placeholder="Taxi home, club tickets…" /></label>
      <label className="f">Amount<input className="in" inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} placeholder="0.00" /></label>
      <label className="f">Paid by<select className="in" value={payer} onChange={(x) => setPayer(x.target.value)}>{t.members.map((m) => <option key={m.id} value={m.email.toLowerCase()}>{m.name || m.email}</option>)}</select></label>
      <Seg value={mode} onChange={setMode} options={[['evenly', 'Split evenly'], ['custom', 'Custom amounts']]} label="Split method" />
      {mode === 'evenly' ? (
        <div className="chips">
          {t.members.map((m) => {
            const k = m.email.toLowerCase();
            const on = who.includes(k);
            return <button key={m.id} className={'chip' + (on ? ' on' : '')} onClick={() => setWho(on ? who.filter((x) => x !== k) : [...who, k])}>{m.name || m.email}{on && amtMinor ? ' · ' + money(fromMinor(evenMinor(amtMinor, who)[k], cur), cur) : ''}</button>;
          })}
        </div>
      ) : (
        <div className="col">
          {t.members.map((m) => {
            const k = m.email.toLowerCase();
            return <label key={m.id} className="row" style={{ font: '500 14px var(--sans)' }}><span className="grow">{m.name || m.email}</span><input className="in" style={{ width: 110 }} inputMode="decimal" value={custom[k] || ''} onChange={(x) => setCustom({ ...custom, [k]: x.target.value })} placeholder="0.00" /></label>;
          })}
          <div className="s">{money(customSum, cur)} of {money(amt, cur)} assigned</div>
        </div>
      )}
      <button className="btn block" disabled={!ok} onClick={save}>{e ? 'Save' : 'Add cost'}</button>
      {e && <button className="btn ghost block" onClick={() => { if (confirm('Delete this cost?')) { remove('expenses', e.id); onClose(); } }}>Delete</button>}
    </Sheet>
  );
}

// Photograph the bill → tap who had what → submit to trip expenses. Runs entirely on the phone.
function ReceiptSplit({ t, me, onClose }) {
  const fileRef = useRef();
  const emails = t.members.map((m) => m.email.toLowerCase());
  const cur = (t.trip.currency || 'EUR').toUpperCase();
  const [id] = useState(() => uid());
  const [busy, setBusy] = useState('');
  const [r, setR] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [lines, setLines] = useState([]);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('item');
  const [tip, setTip] = useState(0);
  const [payer, setPayer] = useState(me);
  const [pct, setPct] = useState(() => Object.fromEntries(emails.map((e) => [e, Math.round(100 / emails.length)])));
  const [thumb, setThumb] = useState(null);
  const [inspect, setInspect] = useState(null);

  async function read(file) {
    if (!file) return;
    setBusy('Reading the receipt on your phone…');
    try {
      const t0 = performance.now();
      const { img } = await loadImage(file);
      const photo = toCanvas(img, 2400);
      // Cut out the paper, turn it upright, even out the light, read it row by row.
      const res = await readReceipt(photo, setBusy);
      const parsed = parseReceipt(res.text);
      const log = { kind: 'receipt', totalMs: performance.now() - t0, size: [photo.width, photo.height], angle: res.angle, ocrConfidence: Math.round(res.conf), text: res.text, parsed };
      saveInspection(log);
      setInspect(log);
      setThumb(await thumbBlob(photo, 900));
      setR(parsed);
      // A printed service amount is kept as its own line (F1); a printed % with no amount
      // pre-fills the tip; "service compris" → none.
      const start = splitInputs(parsed);
      setLines(start.lines.map((l) => ({ ...l, who: [...emails] })));
      setAdjustments(start.adjustments);
      setTip(start.tipPct);
      setTitle(res.text.split('\n').map((s) => s.trim()).find((s) => /[A-Za-z]{3}/.test(s) && s.length < 40) || 'Dinner');
      setBusy('');
    } catch (e) { setBusy('Couldn’t read that: ' + e.message); }
  }

  const sub = fromMinor(lines.reduce((a, l) => a + toMinor(l.price, cur), 0), cur);
  const adjMinor = adjustments.map((a) => ({ ...a, minor: toMinor(a.amount, cur) }));
  let result;
  if (mode === 'item') result = itemShares(lines.map((l) => ({ price: l.price, who: l.who })), tip, payer, cur, adjMinor).minor;
  else {
    const base = toMinor(sub, cur) + adjMinor.reduce((a, x) => a + x.minor, 0);
    const total = base + Math.round((base * tip) / 100);
    const weights = mode === 'even' ? Object.fromEntries(emails.map((e) => [e, 1])) : Object.fromEntries(emails.map((e) => [e, pct[e] || 0]));
    result = { shares: allocate(total, weights), total };
  }
  const shown = (m) => fromMinor(m || 0, cur);
  const unassigned = mode === 'item' && lines.some((l) => !l.who.length);

  // Locked from the first tap: the photo upload takes a moment and a second tap used to add the bill twice (F8).
  const [sending, setSending] = useState(false);
  async function submit() {
    if (sending) return;
    setSending(true);
    const path = thumb ? await storeFile(thumb, { tripId: t.trip.id }).catch(() => null) : null;
    notify(t.trip.id, { title: `${nameOf(t.members, me)} split ${title || 'the bill'}`, body: `${money(shown(result.total), cur)} · see your share`, tag: 'money' });
    // Reconciled only if the lines weren't changed after reading a matching printed total.
    const edited = JSON.stringify(lines.map((l) => [l.name, toMinor(l.price, cur)])) !== JSON.stringify((r?.lines || []).filter((l) => !l.service).map((l) => [l.name, toMinor(l.price, cur)]));
    const validation = !r?.validation ? 'manual' : edited ? 'manual' : r.validation;
    upsert('expenses', {
      id, client_key: id, trip_id: t.trip.id, title: title || 'Dinner', payer_email: payer,
      method: { item: 'per item, from receipt', even: 'evenly, from receipt', pct: 'by %, from receipt' }[mode],
      ...expenseFields({ amountMinor: result.total, sharesMinor: result.shares, currency: cur, adjustments: adjMinor.map(({ kind, label, minor }) => ({ kind, label, amount_minor: minor })), validation }),
      receipt: { lines, tip, adjustments, serviceIncluded: r?.serviceIncluded }, receipt_path: path,
    });
    onClose();
  }

  return (
    <Sheet full onClose={onClose}>
      <div className="between"><button className="link" style={{ textDecoration: 'none' }} onClick={onClose}>Close</button><span className="k amber">Split the bill</span><span style={{ width: 40 }} /></div>
      {!r ? (
        <>
          <h1 className="h1" style={{ fontSize: 30 }}>Photograph the bill</h1>
          <button className="btn block" onClick={() => fileRef.current.click()}><Icon n="camera" color="#F3EEE6" size={18} />Take or choose a photo</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => read(e.target.files[0])} />
          <div className="s">Read on your phone — works with no signal. Flat, well-lit and the whole receipt in frame works best.</div>
          <button className="btn ghost block" onClick={() => { setR({ lines: [], serviceIncluded: false }); setLines([{ name: '', price: '', who: [...emails] }]); }}>Type the items in instead</button>
          {busy && <div className="s">{busy}</div>}
        </>
      ) : (
        <>
          <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} style={{ font: '400 26px var(--serif)', border: 0, background: 'transparent', padding: 0 }} aria-label="Name for this bill" placeholder="Name this bill" />
          <label className="f">Paid by<select className="in" value={payer} onChange={(e) => setPayer(e.target.value)}>{t.members.map((m) => <option key={m.id} value={m.email.toLowerCase()}>{m.name || m.email}</option>)}</select></label>
          <Seg value={mode} onChange={setMode} options={[['item', 'Per item'], ['even', 'Evenly'], ['pct', 'By %']]} label="Split method" />
          <div className="card" style={{ padding: '2px 12px' }}>
            <div className="list">
              {lines.map((l, i) => (
                <div key={i} className="row" style={{ padding: '7px 0', flexWrap: 'wrap', gap: 6 }}>
                  <input className="in grow" style={{ height: 36, font: '500 15px var(--serif)', border: 0, padding: 0, background: 'transparent', minWidth: 120 }} value={l.name} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Item" />
                  {mode === 'item' && (
                    <div className="row" style={{ gap: 4 }}>
                      {t.members.map((m, k) => {
                        const em = m.email.toLowerCase();
                        const on = l.who.includes(em);
                        return (
                          <button key={m.id} aria-label={(on ? 'Remove ' : 'Add ') + (m.name || m.email)} onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, who: on ? x.who.filter((w) => w !== em) : [...x.who, em] } : x)))}
                            style={{ width: 30, height: 30, borderRadius: '50%', font: '600 11px var(--sans)', cursor: 'pointer', ...(on ? { background: ['#1E1A16', '#2F6B57', '#8E3A5C', '#4A3F9C', '#8A5A14', '#2E5C8A'][k % 6], color: '#fff', border: 0 } : { background: 'transparent', color: '#8A8074', border: '1px dashed #CFC5B6' }) }}>
                            {(m.name || m.email)[0].toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <input className="in" inputMode="decimal" style={{ width: 74, height: 36, textAlign: 'right' }} value={l.price} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, price: e.target.value.replace(',', '.') } : x)))} />
                </div>
              ))}
            </div>
            <button className="link" onClick={() => setLines([...lines, { name: '', price: '', who: [...emails] }])}>+ Add a line</button>
          </div>
          {adjustments.map((a, i) => (
            <div key={i} className="between">
              <div><div style={{ font: '500 13px var(--sans)' }}>{a.label || 'Service'} on the bill</div><div className="s">Shared in proportion to what each had</div></div>
              <div className="row" style={{ gap: 6 }}>
                <input className="in" inputMode="decimal" style={{ width: 74, height: 36, textAlign: 'right' }} value={a.amount} onChange={(e) => setAdjustments(adjustments.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(',', '.') } : x)))} aria-label="Service amount" />
                <button className="link" onClick={() => setAdjustments(adjustments.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          ))}
          {mode === 'pct' && (
            <div className="col">
              {t.members.map((m) => {
                const em = m.email.toLowerCase();
                return <label key={m.id} className="row" style={{ font: '500 14px var(--sans)' }}><span className="grow">{m.name || m.email}</span><input className="in" style={{ width: 80 }} inputMode="numeric" value={pct[em] ?? 0} onChange={(e) => setPct({ ...pct, [em]: +e.target.value || 0 })} />%</label>;
              })}
            </div>
          )}
          <div className="between">
            <div>
              <div style={{ font: '500 13px var(--sans)' }}>{r.serviceIncluded ? 'Service compris' : r.servicePct ? `Service ${r.servicePct}% on the bill` : 'Tip'}</div>
              <div className="s">{r.serviceIncluded ? 'Already in the prices. Tip on top?' : 'Shared in proportion to what each had'}</div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              {[0, 5, 10, 12.5].map((x) => <button key={x} className={'chip' + (tip === x ? ' on' : '')} style={{ padding: '7px 9px', fontSize: 12 }} onClick={() => setTip(x)}>{x ? x + '%' : 'None'}</button>)}
            </div>
          </div>
          {r.validation === 'difference' && <div className="card dashed s">The receipt’s total says {money(r.printedTotal, cur)}, the lines add up to {money(r.sum, cur)}. Check for a missed or misread line.</div>}
          {r.validation === 'unverified' && r.lines?.length > 0 && <div className="card dashed s">No total found on the receipt, so these lines couldn’t be checked against it. Worth a quick look.</div>}
          <div className="card dark col">
            <div className="between"><span className="k" style={{ color: 'var(--gold)' }}>Total {money(shown(result.total), cur)}</span>{tip ? <span className="s" style={{ color: '#B7AC9C' }}>incl. {tip}% tip</span> : null}</div>
            <div className="row wrap">
              {t.members.map((m) => (
                <div key={m.id} style={{ flex: '1 1 90px', background: '#2B2621', borderRadius: 12, padding: '8px 10px' }}>
                  <div className="s" style={{ color: '#B7AC9C' }}>{m.name || m.email}</div>
                  <div style={{ font: '500 19px var(--serif)' }}>{money(shown(result.shares[m.email.toLowerCase()]), cur)}</div>
                </div>
              ))}
            </div>
            <button className="btn gold block" disabled={unassigned || !result.total || sending} onClick={submit}>{unassigned ? 'Give every line a name first' : sending ? 'Adding…' : 'Submit to trip expenses →'}</button>
          </div>
          <InspectPanel data={inspect} />
        </>
      )}
    </Sheet>
  );
}
