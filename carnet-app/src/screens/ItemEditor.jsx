import { useState, useRef, useEffect } from 'react';
import { loadImage, toCanvas, readQR, thumbBlob, isPdf, pdfTicket } from '../lib/capture';
import { storeFile, fileUrl } from '../lib/files';
import { Sheet, Seg, Icon } from '../ui';
import { upsert, remove, uid } from '../lib/store';
import { CATS, daysBetween, dayLabel, findVenue, guessCategory, ticketsOf, ticketFields, nameOf, tripNow } from '../lib/util';
import { needsApproval, propose, announce } from '../lib/proposals';
import { altsOf, swapIn, withoutAlt, rankLabel } from '../lib/alts';
import { costOf, costRow, findPrice } from '../lib/planCost';

// Add or edit something on the trip: from the guide, a search, or typed in.
export default function ItemEditor({ t, me, item, preset = {}, overrides = {}, onClose }) {
  const { trip, places } = t;
  const days = daysBetween(trip.start_date, trip.end_date);
  const [f, setF] = useState(() => {
    const b = {
      // A new plan is for today while the trip is on (the night running to 05:00), else its first day.
      title: '', category: 'explore', day: days.includes(tripNow().day) ? tripNow().day : days[0], start_time: '', end_time: '', visibility: 'shared', status: 'planned',
      notes: '', booking_ref: '', place_id: null, lat: null, lng: null, address: '',
      ...preset, ...(item || {}), ...overrides,
    };
    return { ...b, alternatives: altsOf(b), tickets: ticketsOf(b), photos: Array.isArray(b.photos) ? b.photos : [], start_time: (b.start_time || '').slice(0, 5), end_time: (b.end_time || '').slice(0, 5) };
  });
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const fromGuide = places.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  async function search() {
    const near = trip.center_lat ? { lat: trip.center_lat, lng: trip.center_lng } : null;
    setRes(await findVenue(q + ' ' + trip.city, near, null, { google: true, fillNames: true, name: q, city: trip.city }).catch(() => []));
  }
  function usePlace(p, fromSearch) {
    let place_id = p.id;
    if (fromSearch) {
      place_id = uid();
      upsert('places', { id: place_id, city: trip.city, name: p.name, category: guessCategory(p.osm_value, p.name), address: p.address, lat: p.lat, lng: p.lng, source: p.source });
    }
    setF((x) => ({ ...x, title: p.name, place_id, lat: p.lat, lng: p.lng, address: p.address || '', category: p.category || guessCategory(p.osm_value, p.name) }));
    setRes([]); setQ('');
  }

  const linked = costOf(t.expenses, item?.id);
  const [cost, setCost] = useState(() => linked
    ? { amount: String(linked.amount), currency: linked.currency || trip.currency || 'EUR', payer: linked.payer_email, who: Object.keys(linked.shares || {}), on: true }
    : { amount: '', currency: trip.currency || 'EUR', payer: me, who: t.members.map((m) => m.email.toLowerCase()), on: false });

  function saveCost(itemId, title, day) {
    if (!cost.on || !(parseFloat(String(cost.amount).replace(',', '.')) > 0)) return;
    upsert('expenses', costRow({ existing: linked, itemId, tripId: trip.id, title, day, amount: cost.amount, currency: cost.currency, payer: cost.payer, who: cost.who, newId: uid }));
  }

  function save() {
    const id = item?.id || uid();
    saveCost(id, f.title.trim(), f.day || null);
    const row = {
      id, trip_id: trip.id, place_id: f.place_id, category: f.category, day: f.day || null,
      start_time: f.start_time || null, end_time: f.end_time || null, visibility: f.visibility, status: f.status,
      lat: f.lat, lng: f.lng, address: f.address || null, booking_ref: f.booking_ref || null,
      ...ticketFields(f.tickets), photos: f.photos?.length ? f.photos : null, alternatives: f.alternatives?.length ? f.alternatives : null, attachment_local: f.attachment_local,
    };
    const after = { ...row, title: f.title.trim(), notes: f.notes || null };
    if (needsApproval(t, item, after)) {
      propose(t, item ? 'change' : 'add', item, after);
      onClose();
      return;
    }
    if (f.visibility === 'busy') {
      // The crew sees "Busy"; the real title and notes stay in a table only you can read.
      upsert('items', { ...row, title: 'Busy', notes: null });
      upsert('private_notes', { id, title: f.title, notes: f.notes || null });
    } else {
      upsert('items', after);
      if (item?.mine_private) remove('private_notes', id);
      announce(t, item, after);
    }
    onClose();
  }

  function del() {
    if (needsApproval(t, item, null)) {
      if (confirm('Propose removing this? An admin will approve it.')) { propose(t, 'remove', item, null); onClose(); }
      return;
    }
    if (confirm('Remove this from the trip?')) { remove('items', item.id); announce(t, item, null); onClose(); }
  }
  const asksApproval = needsApproval(t, item, { visibility: f.visibility, day: f.day });

  return (
    <Sheet title={item ? 'Edit' : 'Add to the trip'} onClose={onClose}>
      {!item && (
        <div className="col">
          <div className="row">
            <input className="in" placeholder="Search your guide or anywhere…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            <button className="icon" aria-label="Search the map" onClick={search}><Icon n="search" size={18} /></button>
          </div>
          {(q ? fromGuide : places.slice(0, 0)).map((p) => (
            <button key={p.id} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => usePlace(p)}>
              <div className="n">{p.name}</div><div className="s">From your {trip.city} guide · {p.address || ''}</div>
            </button>
          ))}
          {res.map((p, i) => (
            <button key={i} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => usePlace(p, true)}>
              <div className="n">{p.name}</div><div className="s">{p.source === 'google' ? 'Google' : 'Map'} · {p.address}</div>
            </button>
          ))}
        </div>
      )}
      <label className="f">What<input className="in" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Dinner, a gallery, coffee with a friend…" /></label>
      <div className="chips">
        {Object.entries(CATS).map(([k, c]) => (
          <button key={k} type="button" className={'chip' + (f.category === k ? ' on' : '')} onClick={() => set('category', k)}>{c.label}</button>
        ))}
      </div>
      <div className="row">
        <label className="f grow">Day
          <select className="in" value={f.day || ''} onChange={(e) => set('day', e.target.value || null)}>
            <option value="">No day yet</option>
            {days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
        </label>
        <label className="f" style={{ width: 96 }}>From<input className="in" type="time" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} /></label>
        <label className="f" style={{ width: 96 }}>To<input className="in" type="time" value={f.end_time} onChange={(e) => set('end_time', e.target.value)} /></label>
      </div>
      {f.start_time && f.end_time && f.end_time <= f.start_time && <div className="s" style={{ textAlign: 'right', marginTop: -4 }}>Ends the next morning, {f.end_time}</div>}
      <label className="f">Status</label>
      <Seg value={f.status} onChange={(v) => set('status', v)} options={[['idea', 'Idea'], ['planned', 'Planned'], ['booked', 'Booked']]} label="Status" />
      <label className="f">Who can see it</label>
      <Seg value={f.visibility} onChange={(v) => set('visibility', v)} options={[['shared', 'Everyone'], ['busy', 'Busy only'], ['hidden', 'Just me']]} label="Visibility" />
      <div className="s">{{ shared: 'The whole crew sees it.', busy: 'The crew sees a grey “busy” block — not what it is.', hidden: 'Only you can see it.' }[f.visibility]}</div>
      {f.alternatives?.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <label className="f">Backups</label>
          <div className="card" style={{ padding: 0 }}>
            {f.alternatives.map((a, i) => (
              <div key={(a.place_id || a.title) + i} className="row" style={{ padding: '9px 12px', gap: 8, borderTop: i ? '1px solid var(--line)' : 0 }}>
                <span className="s" style={{ width: 30, fontWeight: 600, color: 'var(--amber)' }}>{rankLabel(i)}</span>
                <span className="grow" style={{ font: '400 16px var(--serif)' }}>{a.title}</span>
                <button className="link" onClick={() => { const n = swapIn(f, i); Object.entries(n).forEach(([k, v]) => set(k, v)); }}>Swap in</button>
                <button className="link mute" aria-label={'Remove ' + a.title} onClick={() => set('alternatives', withoutAlt(f, i).alternatives || [])}>Remove</button>
              </div>
            ))}
          </div>
          <div className="s">Swapping makes it the plan and keeps {f.title} as the first backup. Save to keep the change.</div>
        </div>
      )}
      <CostField t={t} me={me} cost={cost} setCost={setCost} linked={linked} hint={f.price_hint} booked={f.status === 'booked'} />
      <PhotoField f={f} set={set} tripId={trip.id} me={me} members={t.members} />
      <TicketField f={f} set={set} tripId={trip.id} me={me} members={t.members} />
      {f.status === 'booked' && <label className="f">Booking ref<input className="in" value={f.booking_ref || ''} onChange={(e) => set('booking_ref', e.target.value)} /></label>}
      <label className="f">Notes<textarea className="in" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></label>
      {asksApproval && <div className="card dashed s">This changes the shared schedule, so it goes to {t.members.filter((m) => ['owner', 'admin'].includes(m.role)).map((m) => m.name || m.email.split('@')[0]).join(' or ') || 'the trip admin'} to approve. Ideas with no day, and your own Busy / Just-me time, go straight in.</div>}
      <button className="btn block" disabled={!f.title.trim()} onClick={save}>{asksApproval ? 'Propose' : item ? 'Save' : 'Add'}</button>
      {item?.created_by_email && <div className="s" style={{ textAlign: 'center' }}>Added by {item.created_by_email === me ? 'you' : nameOf(t.members, item.created_by_email)}{item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</div>}
      {item && <button className="btn ghost block" onClick={del}>{needsApproval(t, item, null) ? 'Propose removing' : 'Remove'}</button>}
    </Sheet>
  );
}

// A ticket for this plan: a screenshot or photo of it. The QR code is read on the phone and saved,
// so Wallet can show a crisp code offline; the image is kept too, for tickets without one.
function TicketField({ f, set, tripId, me, members }) {
  const ref = useRef();
  const [busy, setBusy] = useState('');
  const list = f.tickets || [];
  // One file can hold several tickets (a PDF with one per page): each becomes its own ticket.
  async function read(file) {
    let qr = null, page;
    if (isPdf(file)) {
      // An e-ticket PDF: the codes are read from the PDF itself, sharp at any size.
      const t = await pdfTicket(file);
      if (!t.canvas) throw new Error('that PDF has no pages');
      const price = findPrice(t.text);
      if (price) set('price_hint', price);
      if (t.tickets.length) {
        const out = [];
        for (const k of t.tickets) out.push({ qr: k.qr, path: await storeFile(await thumbBlob(k.canvas, 1200), { tripId }), by: me || null });
        return out;
      }
      page = t.canvas;
    } else {
      const { img } = await loadImage(file);
      // Small codes need the full resolution; try that, then a smaller copy (blur helps some).
      for (const w of [3000, 1600, 900]) { qr = readQR(toCanvas(img, w)); if (qr) break; }
      page = toCanvas(img, 1600);
    }
    const path = await storeFile(await thumbBlob(page, 1200), { tripId });
    return [{ qr: qr || null, path, by: me || null }];
  }
  // Several at once: one PDF per person, or a screenshot of each ticket.
  async function add(files) {
    if (!files.length) return;
    const got = [], missed = [];
    for (const [i, file] of files.entries()) {
      setBusy(files.length > 1 ? `Reading ticket ${i + 1} of ${files.length}…` : 'Reading the ticket…');
      try {
        const ks = await read(file);
        if (ks.length > 1) setBusy(`Found ${ks.length} tickets in ${file.name}…`);
        for (const k of ks) {
          // The same ticket added twice (same code) is kept once.
          if (k.qr && [...list, ...got].some((x) => x.qr === k.qr)) { missed.push(`${file.name}: a ticket already added`); continue; }
          got.push(k);
        }
      } catch (e) { missed.push(`${file.name}: ${e.message}`); }
    }
    if (got.length) {
      set('tickets', [...list, ...got]);
      if (got.length > 1) setBusy(`Added ${got.length} tickets.`);
      if (f.status !== 'booked') set('status', 'booked');
    }
    const noQr = got.filter((k) => !k.qr).length;
    setBusy([noQr && `${noQr === got.length && got.length === 1 ? 'No QR code found on that' : `${noQr} without a QR code`}. The image is saved and shows in Wallet.`, missed.length && `Couldn’t add ${missed.join('; ')}`].filter(Boolean).join(' '));
  }
  const move = (i, d) => { const n = [...list]; [n[i], n[i + d]] = [n[i + d], n[i]]; set('tickets', n); };
  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="f">{list.length > 1 ? `Tickets · ${list.length}` : 'Ticket'}</label>
      {list.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {list.map((k, i) => (
            <div key={(k.qr || k.path) + i} className="between" style={{ padding: '10px 12px', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <div className="s" style={{ flex: 1 }}>
                <div>{list.length > 1 && <b style={{ color: 'var(--ink)' }}>{i + 1}. </b>}{k.qr ? 'QR code · works offline' : 'Ticket image'}</div>
                {(k.by || (i === 0 && f.created_by_email)) && <div style={{ fontSize: 12, opacity: 0.75 }}>Added by {(k.by || f.created_by_email) === me ? 'you' : nameOf(members, k.by || f.created_by_email)}</div>}
              </div>
              {list.length > 1 && i > 0 && <button className="link" onClick={() => move(i, -1)} aria-label="Move up">↑</button>}
              <button className="link" onClick={() => { set('tickets', list.filter((_, j) => j !== i)); setBusy(''); }}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <button className="btn ghost block" onClick={() => ref.current?.click()}>{list.length ? '+ Add another ticket' : 'Add tickets (PDF, screenshot or photo)'}</button>
      <input ref={ref} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = ''; }} />
      {list.length === 0 && <div className="s">Pick several at once for a ticket per person.</div>}
      {busy && <div className="s">{busy}</div>}
    </div>
  );
}

// Pictures of the place itself (the room, the menu, the door to look for) — not tickets. The first
// one stands in as the plan's picture wherever the place has none.
function useFileUrl(path) {
  const [src, setSrc] = useState(null);
  useEffect(() => { let on = true; path ? fileUrl(path).then((u) => on && setSrc(u)).catch(() => {}) : setSrc(null); return () => { on = false; }; }, [path]);
  return src;
}
function PhotoThumb({ k, onOpen, onRemove }) {
  const src = useFileUrl(k.path);
  return (
    <div style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: '#E8E1D6' }}>
      {src && <img src={src} alt="" onClick={onOpen} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }} />}
      <button aria-label="Remove photo" onClick={onRemove} style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13, border: 0, background: 'rgba(30,26,22,.7)', color: '#fff', cursor: 'pointer', font: '500 15px/1 var(--sans)' }}>×</button>
    </div>
  );
}
function PhotoField({ f, set, tripId, me, members }) {
  const ref = useRef();
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(null);
  const list = f.photos || [];
  async function add(files) {
    const got = [];
    for (const [i, file] of files.entries()) {
      setBusy(files.length > 1 ? `Adding photo ${i + 1} of ${files.length}…` : 'Adding the photo…');
      try {
        const { img } = await loadImage(file);
        got.push({ path: await storeFile(await thumbBlob(toCanvas(img, 1600), 1600), { tripId }), by: me || null });
      } catch (e) { setBusy(`Couldn’t add ${file.name}: ${e.message}`); }
    }
    if (got.length) { set('photos', [...list, ...got]); setBusy(''); }
  }
  const big = useFileUrl(open?.path);
  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="f">{list.length ? `Photos · ${list.length}` : 'Photos'}</label>
      {list.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
          {list.map((k, i) => <PhotoThumb key={k.path} k={k} onOpen={() => setOpen(k)} onRemove={() => set('photos', list.filter((_, j) => j !== i))} />)}
        </div>
      )}
      <button className="btn ghost block" onClick={() => ref.current?.click()}>{list.length ? '+ Add more photos' : 'Add photos of the place'}</button>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = ''; }} />
      {busy && <div className="s">{busy}</div>}
      {open && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(20,17,14,.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 }}>
          {big && <img src={big} alt="" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 12 }} />}
          <div className="s" style={{ color: '#E8E1D6' }}>{open.by ? `Added by ${open.by === me ? 'you' : nameOf(members, open.by)} · ` : ''}tap to close</div>
        </div>
      )}
    </div>
  );
}

// What it cost, in Split: tickets bought for the group become an ordinary shared cost, linked to
// this plan. A price found on a ticket PDF is offered; edits here and in Split are the same cost.
function CostField({ t, me, cost, setCost, linked, hint, booked }) {
  const up = (k, v) => setCost({ ...cost, [k]: v });
  const name = (e) => (e === me ? 'You' : nameOf(t.members, e));
  if (!cost.on) {
    if (!booked && !hint) return null;
    return (
      <button className="btn ghost block" onClick={() => setCost({ ...cost, on: true, ...(hint && !cost.amount ? { amount: String(hint.amount), currency: hint.currency } : {}) })}>
        {hint ? `Add ${hint.currency === 'GBP' ? '£' : hint.currency === 'USD' ? '$' : '€'}${hint.amount.toFixed(2)} from the ticket to Split` : 'Add what the tickets cost to Split'}
      </button>
    );
  }
  const n = cost.who.length || 1;
  const amt = parseFloat(String(cost.amount).replace(',', '.')) || 0;
  return (
    <div className="col" style={{ gap: 8, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: 12 }}>
      <div className="between"><label className="f" style={{ margin: 0 }}>Cost · in Split</label>
        {!linked && <button className="link mute" onClick={() => up('on', false)}>Not now</button>}</div>
      {hint && !linked && <div className="s">Found {hint.amount.toFixed(2)} {hint.currency} on the ticket.</div>}
      <div className="row" style={{ gap: 8 }}>
        <input className="in grow" inputMode="decimal" placeholder="0.00" value={cost.amount} onChange={(e) => up('amount', e.target.value)} aria-label="Amount" />
        <select className="in" style={{ width: 90 }} value={cost.currency} onChange={(e) => up('currency', e.target.value)} aria-label="Currency">{['EUR', 'GBP', 'USD', 'CHF', 'DKK', 'SEK', 'NOK', 'CZK', 'HUF', 'PLN'].map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <label className="f" style={{ margin: 0 }}>Paid by<select className="in" value={cost.payer} onChange={(e) => up('payer', e.target.value)}>{t.members.map((m) => <option key={m.id} value={m.email.toLowerCase()}>{name(m.email.toLowerCase())}</option>)}</select></label>
      <div className="s">For</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {t.members.map((m) => {
          const k = m.email.toLowerCase();
          const on = cost.who.includes(k);
          return <button key={m.id} className={'chip' + (on ? ' on' : '')} onClick={() => up('who', on ? cost.who.filter((x) => x !== k) : [...cost.who, k])}>{name(k)}</button>;
        })}
      </div>
      {amt > 0 && <div className="s">{n} {n === 1 ? 'person' : 'people'} · {(amt / n).toFixed(2)} {cost.currency} each · saved with the plan</div>}
      {linked && <div className="s">Already in Split — changes here update it.</div>}
    </div>
  );
}
