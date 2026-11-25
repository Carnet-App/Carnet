import { useState, useRef } from 'react';
import { loadImage, toCanvas, readQR, thumbBlob } from '../lib/capture';
import { storeFile } from '../lib/files';
import { Sheet, Seg, Icon } from '../ui';
import { upsert, remove, uid } from '../lib/store';
import { CATS, daysBetween, dayLabel, findVenue, guessCategory } from '../lib/util';
import { needsApproval, propose, announce } from '../lib/proposals';

// Add or edit something on the trip: from the guide, a search, or typed in.
export default function ItemEditor({ t, me, item, preset = {}, onClose }) {
  const { trip, places } = t;
  const days = daysBetween(trip.start_date, trip.end_date);
  const [f, setF] = useState(() => {
    const b = {
      title: '', category: 'explore', day: days[0], start_time: '', end_time: '', visibility: 'shared', status: 'planned',
      notes: '', booking_ref: '', place_id: null, lat: null, lng: null, address: '',
      ...preset, ...(item || {}),
    };
    return { ...b, start_time: (b.start_time || '').slice(0, 5), end_time: (b.end_time || '').slice(0, 5) };
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

  function save() {
    const id = item?.id || uid();
    const row = {
      id, trip_id: trip.id, place_id: f.place_id, category: f.category, day: f.day || null,
      start_time: f.start_time || null, end_time: f.end_time || null, visibility: f.visibility, status: f.status,
      lat: f.lat, lng: f.lng, address: f.address || null, booking_ref: f.booking_ref || null,
      qr_text: f.qr_text || null, attachment_path: f.attachment_path || null, attachment_local: f.attachment_local,
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
      <TicketField f={f} set={set} tripId={trip.id} />
      {f.status === 'booked' && <label className="f">Booking ref<input className="in" value={f.booking_ref || ''} onChange={(e) => set('booking_ref', e.target.value)} /></label>}
      <label className="f">Notes<textarea className="in" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></label>
      {asksApproval && <div className="card dashed s">This changes the shared schedule, so it goes to {t.members.filter((m) => ['owner', 'admin'].includes(m.role)).map((m) => m.name || m.email.split('@')[0]).join(' or ') || 'the trip admin'} to approve. Ideas with no day, and your own Busy / Just-me time, go straight in.</div>}
      <button className="btn block" disabled={!f.title.trim()} onClick={save}>{asksApproval ? 'Propose' : item ? 'Save' : 'Add'}</button>
      {item && <button className="btn ghost block" onClick={del}>{needsApproval(t, item, null) ? 'Propose removing' : 'Remove'}</button>}
    </Sheet>
  );
}

// A ticket for this plan: a screenshot or photo of it. The QR code is read on the phone and saved,
// so Wallet can show a crisp code offline; the image is kept too, for tickets without one.
function TicketField({ f, set, tripId }) {
  const ref = useRef();
  const [busy, setBusy] = useState('');
  async function add(file) {
    if (!file) return;
    setBusy('Reading the ticket…');
    try {
      const { img } = await loadImage(file);
      // Small codes need the full resolution; try that, then a smaller copy (blur helps some).
      let qr = null;
      for (const w of [3000, 1600, 900]) { qr = readQR(toCanvas(img, w)); if (qr) break; }
      const path = await storeFile(await thumbBlob(toCanvas(img, 1600), 1200), { tripId });
      set('qr_text', qr);
      set('attachment_path', path);
      if (f.status !== 'booked') set('status', 'booked');
      setBusy(qr ? '' : 'No QR code found on that. The image is saved and shows in Wallet.');
    } catch (e) { setBusy('Couldn’t read that: ' + e.message); }
  }
  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="f">Ticket</label>
      {(f.qr_text || f.attachment_path) && (
        <div className="between card" style={{ padding: '10px 12px' }}>
          <div className="s">{f.qr_text ? 'QR code saved · shows in Wallet, works offline' : 'Ticket image saved · shows in Wallet'}</div>
          <button className="link" onClick={() => { set('qr_text', null); set('attachment_path', null); setBusy(''); }}>Remove</button>
        </div>
      )}
      <button className="btn ghost block" onClick={() => ref.current?.click()}>{f.qr_text || f.attachment_path ? 'Replace ticket' : 'Add ticket (screenshot or photo)'}</button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { add(e.target.files?.[0]); e.target.value = ''; }} />
      {busy && <div className="s">{busy}</div>}
    </div>
  );
}
