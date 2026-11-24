import { useMemo, useRef, useState } from 'react';
import { Sheet, Icon, CatTag } from '../ui';
import { upsert, uid } from '../lib/store';
import { readImage, readVideo, looksLikeTicket, parseTicket, venueCandidates, areaHint, thumbBlob } from '../lib/capture';
import { storeFile } from '../lib/files';
import { api, findVenue, similarity, distM, guessCategory, daysBetween, dayLabel } from '../lib/util';
import ItemEditor from './ItemEditor';
import { AddPlace } from './Places';
import { useStore } from '../lib/store';

// Screenshots, screen recordings, links and tickets in → places and plans out.
// Unsure matches are always shown as a question, never saved blindly.
// Works inside a trip (t given) or on its own (saves to a city guide; tickets pick a trip).
export default function Capture({ t, me, onClose, defaultCity }) {
  const fileRef = useRef();
  const [stage, setStage] = useState('pick'); // pick | reading | ticket | venues | manual
  const [progress, setProgress] = useState('');
  const [link, setLink] = useState('');
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState(false);
  const city = t?.trip.city || defaultCity || localStorage.getItem('carnet-last-city') || '';
  const near = t?.trip.center_lat ? { lat: t.trip.center_lat, lng: t.trip.center_lng } : null;
  const [adding, setAdding] = useState(false);

  async function fromFile(file) {
    if (!file) return;
    setStage('reading');
    try {
      const isVideo = file.type.startsWith('video');
      setProgress(isVideo ? 'Watching the recording for names on screen…' : 'Reading the image on your phone…');
      const r = isVideo ? await readVideo(file, (p) => setProgress(`Watching the recording… ${Math.round(p * 100)}%`)) : await readImage(file);
      const thumb = r.canvas ? await thumbBlob(r.canvas) : null;
      await understand({ text: r.text, qr: r.qr, thumb, source: /instagram|follow|reels?|liked by/i.test(r.text) ? 'instagram' : 'screenshot' });
    } catch (e) {
      setProgress('Couldn’t read that one: ' + e.message);
      setStage('pick');
    }
  }

  async function fromLink() {
    setStage('reading');
    let text = link;
    let source = 'manual';
    try {
      if (/instagram\.com/.test(link)) {
        setProgress('Fetching the caption from Instagram…');
        const r = await api('/api/ig', { url: link });
        text = r.text || '';
        source = 'instagram';
        if (!text) {
          setProgress('Instagram didn’t share that caption. A screenshot will work instead.');
          setStage('pick');
          return;
        }
      } else if (/^https?:\/\//.test(link)) {
        setProgress('Reading the page…');
        const r = await api('/api/og', { url: link });
        text = [r.title, r.description].filter(Boolean).join('\n');
        source = 'manual';
      }
    } catch {
      setProgress('No signal — saved as a note to look up later.');
    }
    await understand({ text, source, link });
  }

  async function understand({ text, qr, thumb, source, link: srcLink }) {
    if (looksLikeTicket(text, qr)) {
      const tk = parseTicket(text);
      setResult({ kind: 'ticket', ...tk, qr, thumb, text });
      setStage('ticket');
      return;
    }
    const cands = venueCandidates(text);
    const handle = text.match(/^\s*([a-z0-9._]{3,30})\s*$/im)?.[1];
    const area = areaHint(text);
    setProgress(navigator.onLine ? 'Checking those names on the map…' : 'Offline — these will be checked when you have signal.');
    const venues = [];
    for (const c of cands.slice(0, 6)) {
      let matches = [];
      if (navigator.onLine) matches = await findVenue(`${c.name} ${area || ''} ${city}`.trim(), near).catch(() => []);
      const scored = matches
        .map((m) => ({ ...m, sim: similarity(c.name, m.name), far: near && distM(near, m) > 25000 }))
        .filter((m) => !m.far)
        .sort((a, b) => b.sim - a.sim);
      const best = scored[0];
      // Confident only if the name really matches and it's in this city.
      const sure = best && best.sim >= 0.8 && (c.weight >= 3 || best.sim >= 0.95);
      venues.push({ cand: c, options: scored.slice(0, 3), pick: sure ? 0 : null, keep: sure, sure });
    }
    // Not in a trip and no city yet? Take it from what matched.
    let guessCity = city;
    if (!guessCity) {
      const counts = {};
      venues.filter((v) => v.sure).forEach((v) => { const c = v.options[0]?.city; if (c) counts[c] = (counts[c] || 0) + 1; });
      guessCity = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }
    setResult({ kind: 'venues', venues, thumb, source, handle, link: srcLink, city: guessCity, collection: cands.length >= 3 ? '' : null });
    setStage('venues');
  }

  if (manual && t) return <ItemEditor t={t} me={me} onClose={onClose} />;
  if (manual) return <AddPlace city={city || 'Paris'} near={null} onClose={onClose} />;

  return (
    <Sheet full onClose={onClose}>
      <div className="between">
        <button className="link" style={{ textDecoration: 'none' }} onClick={onClose}>Close</button>
        <span className="k amber">Capture</span>
        <span style={{ width: 40 }} />
      </div>

      {stage === 'pick' && (
        <>
          <h1 className="h1" style={{ fontSize: 30 }}>What have you got?</h1>
          <button className="card dark between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => fileRef.current.click()}>
            <span><div className="n" style={{ color: '#F3EEE6' }}>Screenshot, photo or screen recording</div><div className="s" style={{ color: '#B7AC9C' }}>Instagram posts, reels, tickets, menus — read on your phone</div></span>
            <Icon n="camera" color="#E2B36A" />
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => fromFile(e.target.files[0])} />
          <label className="f">Or paste a link — Instagram, a venue, a ticket page
            <div className="row">
              <input className="in" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://instagram.com/p/…" />
              <button className="btn" disabled={!link.trim()} onClick={fromLink}>Go</button>
            </div>
          </label>
          <button className="btn ghost block" onClick={() => setManual(true)}>{t ? 'Type it in — a plan, a booking or something private' : `Type a place name${city ? ' in ' + city : ''}`}</button>
          {progress && <div className="s">{progress}</div>}
          <div className="s">Tip: for a reel that saves the reveal for the end, screen-record it and send the recording — Carnet reads names off every frame.</div>
        </>
      )}

      {stage === 'reading' && <div className="empty" style={{ paddingTop: 80 }}><div className="n">{progress || 'Reading…'}</div><div className="s" style={{ marginTop: 8 }}>The first read takes a few seconds while the text reader warms up.</div></div>}

      {stage === 'ticket' && <TicketForm t={t} me={me} r={result} onDone={onClose} onNotTicket={() => understand({ text: result.text, source: 'screenshot', thumb: result.thumb })} />}
      {stage === 'venues' && <VenueReview t={t} r={result} setR={setResult} onDone={onClose} />}
    </Sheet>
  );
}

function TicketForm({ t: given, me, r, onDone, onNotTicket }) {
  const tripsObj = useStore((s) => s.trips);
  const allTrips = useMemo(() => Object.values(tripsObj).filter((x) => x.kind !== 'tab').sort((a, b) => (b.start_date || '').localeCompare(a.start_date || '')), [tripsObj]);
  const [tripId, setTripId] = useState(given?.trip.id || allTrips.find((x) => r.day && x.start_date <= r.day && x.end_date >= r.day)?.id || allTrips[0]?.id || '');
  const trip = given?.trip || allTrips.find((x) => x.id === tripId);
  const t = { trip: trip || { start_date: null, end_date: null } };
  const days = daysBetween(t.trip.start_date, t.trip.end_date);
  const [f, setF] = useState({ title: r.title, day: days.includes(r.day) ? r.day : r.day || days[0], time: r.time || '', ref: r.ref || '', category: guessCategory('', r.text) });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    if (!trip) return;
    const path = r.thumb ? await storeFile(r.thumb, { tripId: t.trip.id }) : null;
    upsert('items', {
      id: uid(), trip_id: t.trip.id, title: f.title, category: f.category, day: f.day || null, start_time: f.time || null,
      status: 'booked', visibility: 'shared', booking_ref: f.ref || null, qr_text: r.qr || null, attachment_path: path,
    });
    onDone();
  }
  return (
    <>
      <div className="k" style={{ color: '#24563F' }}>{r.qr ? 'Ticket · QR code found' : 'Looks like a booking'}</div>
      <h1 className="h1" style={{ fontSize: 28 }}>Add to the trip as booked</h1>
      {!given && (
        allTrips.length ? (
          <label className="f">Which trip<select className="in" value={tripId} onChange={(e) => setTripId(e.target.value)}>{allTrips.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        ) : <div className="card dashed s">Tickets live in a trip’s Wallet — make a trip first, or save the place to a guide instead.</div>
      )}
      <label className="f">What<input className="in" value={f.title} onChange={(e) => set('title', e.target.value)} /></label>
      <div className="row">
        <label className="f grow">Day<select className="in" value={f.day || ''} onChange={(e) => set('day', e.target.value)}>{[...new Set([f.day, ...days].filter(Boolean))].map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}</select></label>
        <label className="f" style={{ width: 110 }}>Time<input className="in" type="time" value={f.time} onChange={(e) => set('time', e.target.value)} /></label>
      </div>
      <label className="f">Booking ref<input className="in" value={f.ref} onChange={(e) => set('ref', e.target.value)} /></label>
      <div className="s">{r.qr ? 'The QR code is saved in Wallet and works offline.' : 'The screenshot is saved in Wallet.'}</div>
      <button className="btn block" disabled={!trip} onClick={save}>Save to plan + Wallet</button>
      <button className="btn ghost block" onClick={onNotTicket}>Not a ticket — look for places instead</button>
    </>
  );
}

function VenueReview({ t, r, setR, onDone }) {
  const [city, setCity] = useState(t?.trip.city || r.city || '');
  const [alsoTrip, setAlsoTrip] = useState(!!t);
  const [collection, setCollection] = useState(r.collection ?? null);
  const upd = (i, patch) => setR((x) => ({ ...x, venues: x.venues.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const chosen = r.venues.filter((v) => v.keep);

  async function save() {
    if (!city.trim()) return;
    localStorage.setItem('carnet-last-city', city.trim());
    const photo = r.thumb ? await storeFile(r.thumb) : null;
    for (const v of chosen) {
      const m = v.pick != null ? v.options[v.pick] : null;
      const id = uid();
      upsert('places', {
        id, city, name: m?.name || v.cand.name, category: guessCategory(m?.osm_value, (m?.name || '') + ' ' + v.cand.name),
        address: m?.address || null, lat: m?.lat ?? null, lng: m?.lng ?? null,
        source: r.source, source_detail: r.handle ? '@' + r.handle : null, link: r.link || null,
        photo_path: photo, photo_url: m?.google_id ? `/api/gphoto?id=${encodeURIComponent(m.google_id)}` : null,
        collection: collection || null, needs_check: !m,
      });
      if (t && alsoTrip && city.toLowerCase() === t.trip.city?.toLowerCase())
        upsert('items', { id: uid(), trip_id: t.trip.id, place_id: id, title: m?.name || v.cand.name, category: guessCategory(m?.osm_value, v.cand.name), status: 'idea', visibility: 'shared', lat: m?.lat ?? null, lng: m?.lng ?? null, address: m?.address || null });
    }
    onDone();
  }

  if (!r.venues.length)
    return <div className="empty">Couldn’t spot any place names in that.<br />Try a screenshot that shows the location tag or caption, or type it in.</div>;

  return (
    <>
      <h1 className="h1" style={{ fontSize: 28 }}>{r.venues.length === 1 ? 'Found one place' : `${r.venues.length} possible places`}</h1>
      <div className="s">Ticked ones matched clearly. Anything unsure asks you first.</div>
      <div className="card" style={{ padding: '4px 14px' }}>
        <div className="list">
          {r.venues.map((v, i) => (
            <div key={i} className="col" style={{ padding: '10px 0', gap: 6 }}>
              <label className="row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={v.keep} onChange={(e) => upd(i, { keep: e.target.checked })} style={{ width: 22, height: 22, accentColor: '#1E1A16' }} />
                <div className="grow">
                  <div className="n">{v.pick != null ? v.options[v.pick].name : `“${v.cand.name}”?`}</div>
                  <div className="s">
                    {v.pick != null ? `${v.sure ? 'Matched' : 'You picked'} · ${v.options[v.pick].address || ''}` : v.options.length ? 'Not sure — is it one of these?' : navigator.onLine ? 'No match on the map — keep as a note?' : 'Will be checked when you have signal'}
                    {' · '}<i>{v.cand.why}</i>
                  </div>
                </div>
              </label>
              {!v.sure && v.options.length > 0 && (
                <div className="chips" style={{ paddingLeft: 32 }}>
                  {v.options.map((o, k) => (
                    <button key={k} className={'chip' + (v.pick === k ? ' on' : '')} style={{ fontSize: 12 }} onClick={() => upd(i, { pick: v.pick === k ? null : k, keep: true })}>
                      {o.name}{o.address ? ' · ' + o.address.split(' ').slice(-2).join(' ') : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <label className="f">Save to the guide for<input className="in" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Which city?" /></label>
      {chosen.length >= 2 && (
        <label className="f">As a collection (optional)<input className="in" value={collection || ''} onChange={(e) => setCollection(e.target.value)} placeholder="Natural wine bars, 11e" /></label>
      )}
      {t && (
        <label className="row" style={{ justifyContent: 'space-between', font: '500 14px var(--sans)' }}>
          Also add to {t.trip.name} as ideas
          <input type="checkbox" checked={alsoTrip} onChange={(e) => setAlsoTrip(e.target.checked)} style={{ width: 22, height: 22, accentColor: '#1E1A16' }} />
        </label>
      )}
      <button className="btn block" disabled={!chosen.length || !city.trim()} onClick={save}>Save {chosen.length} place{chosen.length === 1 ? '' : 's'}</button>
    </>
  );
}
