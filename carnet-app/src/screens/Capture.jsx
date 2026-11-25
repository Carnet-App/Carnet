import { useMemo, useRef, useState } from 'react';
import { Sheet, Icon, CatTag } from '../ui';
import { upsert, uid } from '../lib/store';
import { readImage, readVideo, looksLikeTicket, parseTicket, notTheAccount, venueCandidates, areaHint, thumbBlob, postLayout, readOverlay, overlayCandidates, captionFacts, placeHint, firstLine, isStrong, tieredCandidates, typeHint } from '../lib/capture';
import { storeFile } from '../lib/files';
import { api, findVenue, similarity, distM, guessCategory, daysBetween, dayLabel, CATS, norm } from '../lib/util';
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

  // One or several screenshots (a long post split in two, every slide of a carousel…).
  // Each is read on its own; places found on more than one are merged into one listing.
  async function fromFiles(files) {
    files = [...(files || [])];
    if (!files.length) return;
    setStage('reading');
    const pages = [];
    try {
      for (const [i, file] of files.entries()) {
        const isVideo = file.type.startsWith('video');
        const of = files.length > 1 ? ` (${i + 1} of ${files.length})` : '';
        setProgress(isVideo ? 'Watching the recording for names on screen…' : `Reading the image${of}…`);
        const r = isVideo ? await readVideo(file, (p) => setProgress(`Watching the recording… ${Math.round(p * 100)}%`)) : await readImage(file);
        const thumb = r.canvas ? await thumbBlob(r.canvas) : null;
        // A post screenshot: caption first, words on the photo second, and the photo itself
        // (not the whole screen) as the place's picture.
        const post = !isVideo && r.canvas ? postLayout(r.lines, r.height) : null;
        const photo = post ? await thumbBlob(r.canvas, 900, post.media) : null;
        const first = notTheAccount(r.lines?.length ? firstLine({ post, lines: r.lines, height: r.height, text: r.text }) : venueCandidates(r.text), post?.handle);
        let overlay = { text: '', lines: [] };
        if (!isVideo && r.canvas && (post || !isStrong(first))) {
          setProgress(`${post ? 'Reading the caption and the photo' : 'Looking at text inside the pictures'}${of}…`);
          overlay = await readOverlay(r.canvas, post ? post.media : { y0: 0, y1: r.canvas.height }).catch(() => ({ text: '', lines: [] }));
        }
        const handle = post?.handle || (post?.caption || '').match(/^\s*([a-z0-9._]{3,30})\b/m)?.[1];
        const pic = notTheAccount(overlayCandidates(overlay.lines, { handle }), handle);
        pages.push({ ...r, thumb, photo: photo || thumb, post, first, pic, overlay: overlay.text, handle, isVideo,
          source: post ? 'instagram' : /instagram|follow|reels?|liked by/i.test(r.text) ? 'instagram' : /directions/i.test(r.text) ? 'google' : 'screenshot' });
      }
    } catch (e) {
      setProgress('Couldn’t read that one: ' + e.message);
      setStage('pick');
      return;
    }
    await understand(pages);
  }

  async function fromLink() {
    setStage('reading');
    let text = link;
    let source = 'manual';
    try {
      if (/maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\.|maps\.apple\.com/.test(link)) {
        setProgress('Opening the map link…');
        const g = await api('/api/maplink', { url: link });
        if (g.name) {
          // Exact place from the map app: no guessing needed.
          const near = g.lat != null ? { lat: g.lat, lng: g.lng } : null;
          const osm = navigator.onLine ? await findVenue(g.name, near).catch(() => []) : [];
          const close = osm.find((m) => near && distM(near, m) < 200);
          const opt = { name: g.name, lat: g.lat ?? close?.lat, lng: g.lng ?? close?.lng, address: close?.address || g.address || '', osm_value: close?.osm_value || '', city: close?.city || '' };
          setResult({ kind: 'venues', venues: [{ cand: { name: g.name, why: 'map link', weight: 20 }, options: [opt], pick: 0, keep: true, sure: true }], source: 'google', link, city: city || opt.city, collection: null });
          setStage('venues');
          return;
        }
        text = g.text || link;
        source = 'google';
      } else if (/instagram\.com/.test(link)) {
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
    await understand([{ text, source, first: venueCandidates(text), pic: [], link }]);
  }

  async function understand(pages) {
    const one = pages[0];
    if (pages.length === 1 && looksLikeTicket(one.text, one.qr)) {
      const tk = parseTicket(one.text);
      setResult({ kind: 'ticket', ...tk, qr: one.qr, thumb: one.thumb, text: one.text });
      setStage('ticket');
      return;
    }
    // Candidates from every page, each remembering the page's photo and what it said.
    const found = [];
    for (const pg of pages) {
      const cands = tieredCandidates(pg.first || [], pg.pic || [], pg.text || '');
      const facts = captionFacts(pg.post?.caption || '');
      const hintText = [pg.post?.caption, pg.overlay].filter(Boolean).join('\n');
      const area = areaHint(hintText || pg.text || '');
      const kind = typeHint([pg.post ? pg.post.caption : pg.text, pg.overlay].filter(Boolean).join('\n'));
      const fromPic = new Map((pg.pic || []).filter((c) => c.name).map((c) => [c.name.toLowerCase(), c]));
      for (const c of cands.slice(0, 6)) {
        const p = fromPic.get(c.name.toLowerCase());
        found.push({ c: { ...c, note: [p?.note, facts].filter(Boolean).join(' · ') || null, hint: p?.hint || placeHint(hintText) || null }, photo: pg.photo, area, kind });
      }
      // A quote with no readable name above it (handwriting, fancy type): still a place — ask its name.
      for (const q of (pg.pic || []).filter((c) => !c.name))
        if (!cands.some((c) => c.weight >= 5)) found.push({ c: { ...q, name: '' }, photo: pg.photo, area, kind, nameless: true });
    }
    // The same place on several screenshots (a long caption split in two): one listing.
    const merged = [];
    for (const f of found) {
      const ex = f.nameless ? null : merged.find((m) => !m.nameless && (norm(m.c.name) === norm(f.c.name) || similarity(m.c.name, f.c.name) >= 0.9));
      if (ex) {
        ex.c.weight = Math.max(ex.c.weight, f.c.weight);
        ex.c.note = [...new Set([ex.c.note, f.c.note].filter(Boolean))].join(' · ') || null;
        ex.c.hint ||= f.c.hint;
        ex.c.address ||= f.c.address;
      } else merged.push(f);
    }
    setProgress(navigator.onLine ? 'Checking those names on the map…' : 'Offline — these will be checked when you have signal.');
    const venues = [];
    for (const f of merged.slice(0, 14)) {
      const { c, photo, area, kind } = f;
      if (f.nameless) {
        venues.push({ cand: c, options: [], pick: null, keep: false, sure: false, photo, nameless: true, cat: guessCategory('', `${c.note || ''} ${kind || ''}`) });
        continue;
      }
      if (navigator.onLine && c.address) {
        // The screenshot gave us the address: place it there.
        const [spot] = (await api('/api/geo', { q: c.address, lat: near?.lat, lng: near?.lng }).catch(() => ({}))).results || [];
        const named = await findVenue(`${c.name} ${city}`.trim(), spot || near, c.type).catch(() => []);
        const there = spot ? named.filter((m) => distM(spot, m) < 250 && similarity(c.name, m.name) >= 0.6) : [];
        const opt = there[0] || (spot && { ...spot, name: c.name, address: c.address, osm_value: null });
        if (opt) {
          venues.push({ cand: c, options: [{ ...opt, sim: 1 }], pick: 0, keep: true, sure: true, photo });
          continue;
        }
      }
      let matches = [];
      if (navigator.onLine) {
        matches = await findVenue(`${c.name} ${area || ''} ${city}`.trim(), near, c.type || kind).catch(() => []);
        // Nothing close? Try again with the place the caption or quote mentions ("near Canal St Martin").
        if (c.hint && !matches.some((m) => similarity(c.name, m.name) >= 0.8))
          matches = [...matches, ...(await findVenue(`${c.name} ${c.hint} ${city}`.trim(), near, c.type || kind).catch(() => []))];
      }
      const scored = matches
        .map((m) => ({ ...m, sim: c.squash && norm(m.name).replace(/ /g, '') === c.squash ? 1 : similarity(c.name, m.name), far: near && distM(near, m) > 25000 }))
        .filter((m) => !m.far && !/^(city|town|village|country|state|county|administrative|region|province|postcode|suburb|neighbourhood|quarter|district|locality|political)$/.test(m.osm_value || ''))
        .filter((m) => m.sim >= 0.35)
        .filter((m, i, a) => a.findIndex((x) => distM(x, m) < 30 && norm(x.name) === norm(m.name)) === i)
        .sort((a, b) => b.sim - a.sim);
      const best = scored[0];
      const sure = best && best.sim >= 0.8 && (c.weight >= 3 || best.sim >= 0.95);
      if (!scored.length && c.weight < 4) continue; // weak guess with no match: don't bother asking
      venues.push({ cand: c, options: scored.slice(0, 3), pick: sure ? 0 : null, keep: sure, sure, photo });
    }
    for (const [i, v] of venues.entries()) if (!v.nameless) v.cat = catFor(v, merged[i]?.kind);
    let guessCity = city;
    if (!guessCity) {
      const counts = {};
      venues.filter((v) => v.sure).forEach((v) => { const c = v.options[0]?.city; if (c) counts[c] = (counts[c] || 0) + 1; });
      guessCity = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }
    setResult({ kind: 'venues', venues, thumb: one.photo || one.thumb, source: one.source, handle: one.handle, link: one.link, city: guessCity, collection: venues.length >= 3 ? '' : null, many: pages.length > 1 || venues.length > 1 });
    setStage('venues');
  }

  if (manual && t) return <ItemEditor t={t} me={me} onClose={onClose} />;
  if (manual) return <AddPlace city={city || 'Paris'} near={null} onClose={onClose} />;

  return (
    <Sheet full className="roomy" onClose={onClose}>
      <div className="between">
        <button className="link" style={{ textDecoration: 'none' }} onClick={onClose}>Close</button>
        <span className="k amber">Capture</span>
        <span style={{ width: 40 }} />
      </div>

      {stage === 'pick' && (
        <>
          <h1 className="h1" style={{ fontSize: 30 }}>What have you got?</h1>
          <button className="card dark between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => fileRef.current.click()}>
            <span><div className="n" style={{ color: '#F3EEE6' }}>Screenshot, photo or screen recording</div><div className="s" style={{ color: '#B7AC9C' }}>Posts, carousels, reels, tickets — pick several at once</div></span>
            <Icon n="camera" color="#E2B36A" />
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => fromFiles(e.target.files)} />
          <label className="f">Or paste a link — Instagram, a venue, a ticket page
            <div className="row">
              <input className="in" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://instagram.com/p/…" />
              <button className="btn" disabled={!link.trim()} onClick={fromLink}>Go</button>
            </div>
          </label>
          <button className="btn ghost block" onClick={() => setManual(true)}>{t ? 'Type it in — a plan, a booking or something private' : `Type a place name${city ? ' in ' + city : ''}`}</button>
          {progress && <div className="s">{progress}</div>}
          <div className="s hint">Tip: for a reel that saves the reveal for the end, screen-record it and send the recording — Carnet reads names off every frame.</div>
        </>
      )}

      {stage === 'reading' && <div className="empty" style={{ paddingTop: 80 }}><div className="n">{progress || 'Reading…'}</div><div className="s" style={{ marginTop: 8 }}>The first read takes a few seconds while the text reader warms up.</div></div>}

      {stage === 'ticket' && <TicketForm t={t} me={me} r={result} onDone={onClose} onNotTicket={() => understand([{ text: result.text, source: 'screenshot', thumb: result.thumb, photo: result.thumb, first: venueCandidates(result.text), pic: [] }])} />}
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

function catFor(v, kind) {
  const m = v.pick != null ? v.options[v.pick] : null;
  const fromMap = m?.osm_value ? guessCategory(m.osm_value) : 'explore';
  return fromMap !== 'explore' ? fromMap : guessCategory('', `${v.cand.name} ${v.cand.type || ''} ${kind || ''}`);
}

// "None of these" / a name the reader couldn't make out: type it and search again.
function FixName({ v, city, near, onFound, startOpen = false, placeholder = 'e.g. Le Syndicat' }) {
  const [open, setOpen] = useState(startOpen);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    const name = q.trim();
    if (!name) return;
    setBusy(true);
    let res = navigator.onLine ? await findVenue(`${name} ${city || ''}`.trim(), near).catch(() => []) : [];
    if (navigator.onLine && v.cand.hint && !res.some((m) => similarity(name, m.name) >= 0.8))
      res = [...res, ...(await findVenue(`${name} ${v.cand.hint} ${city || ''}`.trim(), near).catch(() => []))];
    const scored = res.map((m) => ({ ...m, sim: similarity(name, m.name) })).filter((m) => m.sim >= 0.35).sort((a, b) => b.sim - a.sim).slice(0, 3);
    const sure = scored[0]?.sim >= 0.8;
    const next = { cand: { ...v.cand, name, why: 'typed by you' }, options: scored, pick: sure ? 0 : null, keep: true, sure: false, nameless: false };
    onFound({ ...next, cat: v.catSet ? v.cat : catFor(next, null) });
    setBusy(false);
    setOpen(false);
  }
  if (!open)
    return <button className="chip" style={{ fontSize: 12, alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>✎ None of these — type the name</button>;
  return (
    <div className="row" style={{ gap: 8 }}>
      <input className="in grow" autoFocus={!startOpen} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder={placeholder} />
      <button className="btn" disabled={busy || !q.trim()} onClick={go}>{busy ? '…' : 'Find'}</button>
    </div>
  );
}

// Is this place already in the guide? Same name, or nearly the same name in nearly the same spot
// (saved before from another post, another day, another screenshot).
function existingFor(v, city, places) {
  const m = v.pick != null ? v.options[v.pick] : null;
  const name = m?.name || v.cand.name;
  if (!name) return null;
  return places.find((p) => p.city?.toLowerCase() === city.toLowerCase() && (
    norm(p.name) === norm(name) || similarity(p.name, name) >= 0.85 ||
    (m?.lat != null && p.lat != null && distM(m, p) < 60 && similarity(p.name, name) >= 0.5)
  )) || null;
}

function VenueReview({ t, r, setR, onDone }) {
  const [city, setCity] = useState(t?.trip.city || r.city || '');
  const [alsoTrip, setAlsoTrip] = useState(!!t);
  const [collection, setCollection] = useState(r.collection ?? null);
  const placesObj = useStore((s) => s.places);
  const places = useMemo(() => Object.values(placesObj || {}), [placesObj]);
  const upd = (i, patch) => setR((x) => ({ ...x, venues: x.venues.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const chosen = r.venues.filter((v) => v.keep && (v.cand.name || v.pick != null));
  const near = t?.trip.center_lat ? { lat: t.trip.center_lat, lng: t.trip.center_lng } : null;

  // Pictures: one per place when the screenshots showed several; otherwise one big one.
  const urls = useMemo(() => {
    const m = new Map();
    for (const v of r.venues) if (v.photo && !m.has(v.photo)) m.set(v.photo, URL.createObjectURL(v.photo));
    if (r.thumb && !m.has(r.thumb)) m.set(r.thumb, URL.createObjectURL(r.thumb));
    return m;
  }, [r.venues, r.thumb]);
  const picked = r.venues.find((v) => v.keep && v.pick != null)?.options[0];
  const hero = !r.many && (r.thumb ? urls.get(r.thumb) : picked?.google_id ? `/api/gphoto?id=${encodeURIComponent(picked.google_id)}` : null);

  async function save() {
    if (!city.trim()) return;
    localStorage.setItem('carnet-last-city', city.trim());
    const stored = new Map();
    const photoFor = async (blob) => {
      if (!blob) return null;
      if (!stored.has(blob)) stored.set(blob, await storeFile(blob));
      return stored.get(blob);
    };
    const onTrip = new Set((t?.items || []).map((i) => i.place_id).filter(Boolean));
    for (const v of chosen) {
      const m = v.pick != null ? v.options[v.pick] : null;
      const name = m?.name || v.cand.name;
      const photo = await photoFor(v.photo || r.thumb);
      const note = v.cand.note ? v.cand.note.slice(0, 600) : null;
      const ex = existingFor(v, city, places);
      let id;
      if (ex) {
        // Already saved: fill in what it's missing, keep what's there.
        id = ex.id;
        upsert('places', {
          ...ex,
          photo_path: ex.photo_path || photo,
          notes: [ex.notes, note].filter(Boolean).filter((x, k, a) => a.indexOf(x) === k).join('\n\n') || null,
          address: ex.address || m?.address || v.cand.address || null,
          lat: ex.lat ?? m?.lat ?? null, lng: ex.lng ?? m?.lng ?? null,
          needs_check: ex.needs_check && !m,
        });
      } else {
        id = uid();
        upsert('places', {
          id, city, name, category: v.cat || guessCategory(m?.osm_value, name),
          address: m?.address || v.cand.address || null, lat: m?.lat ?? null, lng: m?.lng ?? null,
          source: r.source, source_detail: r.handle ? '@' + r.handle : null, link: r.link || null,
          photo_path: photo, photo_url: m?.google_id ? `/api/gphoto?id=${encodeURIComponent(m.google_id)}` : null,
          notes: note, collection: collection || null, needs_check: !m,
        });
      }
      if (t && alsoTrip && city.toLowerCase() === t.trip.city?.toLowerCase() && !onTrip.has(id))
        upsert('items', { id: uid(), trip_id: t.trip.id, place_id: id, title: name, category: v.cat || guessCategory(m?.osm_value, name), status: 'idea', visibility: 'shared', lat: m?.lat ?? null, lng: m?.lng ?? null, address: m?.address || null });
    }
    onDone();
  }

  if (!r.venues.length)
    return <div className="empty">Couldn’t spot any place names in that.<br />Try a screenshot that shows the location tag or caption, or type it in.</div>;

  const count = r.venues.length;
  return (
    <>
      {hero && <img src={hero} alt="" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 18, display: 'block', background: '#E8E1D6' }} />}
      <h1 className="h1" style={{ fontSize: 28 }}>{count === 1 ? 'Found one place' : `${count} places`}</h1>
      <div className="card" style={{ padding: '4px 16px' }}>
        <div className="list">
          {r.venues.map((v, i) => {
            const ex = v.keep ? existingFor(v, city, places) : null;
            const pic = r.many && v.photo ? urls.get(v.photo) : null;
            return (
              <div key={i} className="col venue" style={{ padding: '10px 0', gap: 6 }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                  {pic && <img src={pic} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12, flex: 'none', background: '#E8E1D6' }} />}
                  <label className="row grow" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
                    {!v.nameless && <input type="checkbox" checked={v.keep} onChange={(e) => upd(i, { keep: e.target.checked })} style={{ width: 22, height: 22, accentColor: '#1E1A16', marginTop: 2 }} />}
                    <div className="grow">
                      <div className="n">{v.nameless ? 'Couldn’t read the name' : v.pick != null ? v.options[v.pick].name : `“${v.cand.name}”?`}</div>
                      <div className="s">
                        {v.nameless
                          ? v.cand.hint ? `Somewhere near ${v.cand.hint}` : 'What’s it called?'
                          : v.pick != null ? `${v.sure ? 'Matched' : 'You picked'} · ${v.options[v.pick].address || ''}` : v.options.length ? 'Not sure — is it one of these?' : navigator.onLine ? 'No match on the map — keep as a note?' : 'Will be checked when you have signal'}
                      </div>
                      {ex && <div className="s" style={{ color: 'var(--amber, #8A5A14)', marginTop: 2 }}>Already in your {city} guide — this adds to it</div>}
                    </div>
                  </label>
                </div>
                {v.cand.note && <div className="s" style={{ fontStyle: 'italic', lineHeight: 1.45 }}>“{v.cand.note.length > 160 ? v.cand.note.slice(0, 157) + '…' : v.cand.note}”</div>}
                {v.keep && !ex && !v.nameless && (
                  <div className="chips">
                    {Object.entries(CATS).map(([k, c]) => (
                      <button key={k} className={'chip' + ((v.cat || 'explore') === k ? ' on' : '')} style={{ fontSize: 12, ...((v.cat || 'explore') === k ? { background: c.color, borderColor: c.color, color: '#fff' } : {}) }} onClick={() => upd(i, { cat: k, catSet: true })}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {v.nameless && <FixName v={v} city={city} near={near} startOpen placeholder="Type the name you see" onFound={(patch) => upd(i, patch)} />}
                {!v.sure && !v.nameless && <FixName v={v} city={city} near={near} onFound={(patch) => upd(i, patch)} />}
                {!v.sure && !v.nameless && v.options.length > 0 && (
                  <div className="chips">
                    {v.options.map((o, k) => (
                      <button key={k} className={'chip' + (v.pick === k ? ' on' : '')} style={{ fontSize: 12 }} onClick={() => { const pick = v.pick === k ? null : k; upd(i, { pick, keep: true, ...(v.catSet ? {} : { cat: catFor({ ...v, pick }, null) }) }); }}>
                        {o.name}{o.address ? ' · ' + o.address.split(' ').slice(-2).join(' ') : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <label className="f">Save to the guide for<input className="in" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Which city?" /></label>
      {chosen.length >= 2 && (
        <label className="f">As a collection (optional)<input className="in" value={collection || ''} onChange={(e) => setCollection(e.target.value)} placeholder="Dua Lipa’s Paris, natural wine…" /></label>
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
