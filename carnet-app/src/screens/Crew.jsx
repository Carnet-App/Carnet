import { useState } from 'react';
import { Sheet, Avatar, Icon } from '../ui';
import { upsert, remove, uid, flush } from '../lib/store';
import { authHeader } from '../lib/supabase';
import { findVenue, dayLabel, nameOf } from '../lib/util';

// People on the trip, where you're staying, and trip settings.
export default function Crew({ t, me, onClose, go }) {
  const { trip, members, stays } = t;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [stayQ, setStayQ] = useState('');
  const [stayRes, setStayRes] = useState(null);
  const [stayDates, setStayDates] = useState({ from: trip.start_date, to: trip.end_date });
  const isOwner = members.find((m) => m.email.toLowerCase() === me)?.role === 'owner';
  const myName = nameOf(members, me);

  async function sendInvite(m) {
    setMsg(`Emailing ${m.name || m.email}…`);
    await flush();
    try {
      const r = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ tripId: trip.id, email: m.email, name: m.name, from: myName }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      upsert('trip_members', { id: m.id, invited_at: new Date().toISOString() });
      setMsg(`Invite sent to ${m.email}.`);
    } catch (e) {
      setMsg(`Couldn’t email (${e.message}). You can send the link yourself instead.`);
    }
  }
  function addPerson() {
    const e = email.trim().toLowerCase();
    if (!e.includes('@')) return;
    const m = { id: uid(), trip_id: trip.id, email: e, name: name.trim() || e.split('@')[0], role: 'member' };
    upsert('trip_members', m);
    setName(''); setEmail('');
    if (navigator.onLine) sendInvite(m);
    else setMsg('Added. The invite email goes when you’re back online — tap Resend.');
  }
  function shareLink(m) {
    const text = `Join ${trip.name} on Carnet — open https://trips.sebwalker.co.uk on your phone and sign in with ${m.email}.`;
    navigator.share ? navigator.share({ text }).catch(() => {}) : navigator.clipboard.writeText(text).then(() => setMsg('Copied.'));
  }
  async function findStay() {
    setStayRes(await findVenue(`${stayQ} ${trip.city}`, trip.center_lat ? { lat: trip.center_lat, lng: trip.center_lng } : null).catch(() => []));
  }
  function addStay(r) {
    upsert('stays', { id: uid(), trip_id: trip.id, name: r.name, address: r.address || null, lat: r.lat ?? null, lng: r.lng ?? null, from_date: stayDates.from, to_date: stayDates.to });
    setStayQ(''); setStayRes(null);
  }

  return (
    <Sheet title={trip.name} onClose={onClose}>
      <div className="k mute">Crew</div>
      <div className="card" style={{ padding: '2px 14px' }}>
        <div className="list">
          {members.map((m, i) => (
            <div key={m.id} className="li">
              <Avatar name={m.name || m.email} i={i} size={36} />
              <div className="grow">
                <div className="n">{m.name || m.email}{m.email.toLowerCase() === me ? ' (you)' : ''}</div>
                <div className="s">{m.role === 'owner' ? 'Organiser' : m.invited_at ? `Invited ${new Date(m.invited_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : m.email}</div>
              </div>
              {m.email.toLowerCase() !== me && (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm ghost" onClick={() => sendInvite(m)}>{m.invited_at ? 'Resend' : 'Invite'}</button>
                  <button className="icon" style={{ width: 34, height: 34 }} aria-label={'Share link with ' + (m.name || m.email)} onClick={() => shareLink(m)}><Icon n="link" size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <label className="f">Add people to this trip</label>
      <input className="in" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="row">
        <input className="in" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn" disabled={!email.includes('@')} onClick={addPerson}>Add</button>
      </div>
      <div className="s">They get an email with a link to join — no password, no app store. Their plans and costs sync with yours.</div>
      {msg && <div className="card s">{msg}</div>}

      <div className="k mute" style={{ marginTop: 6 }}>Home base · used for every travel time</div>
      {stays.map((s) => (
        <div key={s.id} className="card between">
          <div><div className="n">{s.name}</div><div className="s">{s.address || ''}{s.from_date ? ` · ${dayLabel(s.from_date, { day: 'numeric', month: 'short' })}–${dayLabel(s.to_date, { day: 'numeric', month: 'short' })}` : ''}</div></div>
          <button className="icon" aria-label="Remove" onClick={() => remove('stays', s.id)}><Icon n="trash" size={16} /></button>
        </div>
      ))}
      <div className="row">
        <input className="in" placeholder="Hotel, Airbnb or street address" value={stayQ} onChange={(e) => setStayQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && findStay()} />
        <button className="icon" aria-label="Find" onClick={findStay}><Icon n="search" size={18} /></button>
      </div>
      {stayRes && (
        <>
          <div className="row">
            <label className="f grow">From<input className="in" type="date" value={stayDates.from || ''} onChange={(e) => setStayDates({ ...stayDates, from: e.target.value })} /></label>
            <label className="f grow">To<input className="in" type="date" value={stayDates.to || ''} onChange={(e) => setStayDates({ ...stayDates, to: e.target.value })} /></label>
          </div>
          {stayRes.map((r, i) => (
            <button key={i} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => addStay(r)}>
              <div className="n">{r.name}</div><div className="s">{r.address}</div>
            </button>
          ))}
          {!stayRes.length && <div className="s">No match — try the street address.</div>}
        </>
      )}

      <div className="k mute" style={{ marginTop: 6 }}>Trip</div>
      <div className="row">
        <label className="f grow">From<input className="in" type="date" defaultValue={trip.start_date} onBlur={(e) => upsert('trips', { id: trip.id, start_date: e.target.value })} /></label>
        <label className="f grow">To<input className="in" type="date" defaultValue={trip.end_date} onBlur={(e) => upsert('trips', { id: trip.id, end_date: e.target.value })} /></label>
      </div>
      <label className="f">Currency<select className="in" value={trip.currency || 'EUR'} onChange={(e) => upsert('trips', { id: trip.id, currency: e.target.value })}>{['EUR', 'GBP', 'USD', 'CHF', 'DKK', 'SEK', 'CZK', 'PLN', 'HUF'].map((c) => <option key={c}>{c}</option>)}</select></label>
      <button className="btn ghost block" onClick={() => go({ view: 'home' })}>All trips & city guides</button>
      {isOwner && <button className="link mute" onClick={() => { if (confirm(`Delete ${trip.name} for everyone? Guides are kept.`)) { remove('trips', trip.id); go({ view: 'home' }); } }}>Delete this trip</button>}
    </Sheet>
  );
}
