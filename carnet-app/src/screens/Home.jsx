import { useMemo, useState } from 'react';
import { useStore, upsert, uid, resetLocal } from '../lib/store';
import { supabase } from '../lib/supabase';
import { Sheet, Avatar, Icon } from '../ui';
import { dayLabel, todayISO, daysBetween, api, money } from '../lib/util';
import { balances } from '../lib/money';
import Capture from './Capture';

export default function Home({ me, go }) {
  const s = useStore();
  const [newTrip, setNewTrip] = useState(false);
  const [newCity, setNewCity] = useState(false);
  const [menu, setMenu] = useState(false);
  const [capture, setCapture] = useState(false);
  const [newTab, setNewTab] = useState(false);
  const tabs = Object.values(s.trips).filter((t) => t.kind === 'tab').sort((a, b) => (b.created_at || b.start_date || '').localeCompare(a.created_at || a.start_date || ''));
  const myNet = (id) => balances(Object.values(s.expenses).filter((e) => e.trip_id === id), Object.values(s.settlements).filter((x) => x.trip_id === id))[me] || 0;
  const trips = Object.values(s.trips).filter((t) => t.kind !== 'tab').sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
  const today = todayISO();
  const now = trips.find((t) => t.start_date <= today && (t.end_date || t.start_date) >= today);
  const next = trips.filter((t) => t.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const featured = now || next;

  const cities = useMemo(() => {
    const m = {};
    for (const p of Object.values(s.places)) {
      if (p.owner && s.places[p.id] && p.city) {
        const k = p.city;
        m[k] = m[k] || { city: k, n: 0, visited: 0, ig: 0 };
        m[k].n++;
        if (p.visited) m[k].visited++;
        if (p.source === 'instagram') m[k].ig++;
      }
    }
    for (const t of trips) if (t.city && !m[t.city]) m[t.city] = { city: t.city, n: 0, visited: 0, ig: 0 };
    return Object.values(m).sort((a, b) => b.n - a.n);
  }, [s.places, s.trips]);

  const membersOf = (id) => Object.values(s.trip_members).filter((m) => m.trip_id === id);

  return (
    <div className="page">
      <div className="between">
        <h1 className="h1" style={{ fontSize: 44 }}>Carnet</h1>
        <button className="link mute" onClick={async () => { if (confirm('Sign out on this phone?')) { await supabase.auth.signOut(); await resetLocal(); } }}>Sign out</button>
      </div>

      <div className="k amber">Trips</div>
      {featured && (
        <button className="card dark col" style={{ textAlign: 'left', gap: 10, cursor: 'pointer' }} onClick={() => go({ view: 'trip', tripId: featured.id, tab: 'today' })}>
          <div className="between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="k" style={{ color: 'var(--gold)' }}>
                {now ? `Now · day ${daysBetween(now.start_date, today).length} of ${daysBetween(now.start_date, now.end_date).length}` : 'Next up'}
              </div>
              <div style={{ font: '400 32px/1.05 var(--serif)', marginTop: 8 }}>{featured.name}</div>
              <div className="s" style={{ color: '#B7AC9C' }}>{dayLabel(featured.start_date, { day: 'numeric', month: 'short' })} – {dayLabel(featured.end_date, { day: 'numeric', month: 'short' })}</div>
            </div>
            <div className="row" style={{ gap: 0 }}>
              {membersOf(featured.id).slice(0, 5).map((m, i) => <span key={m.id} style={{ marginLeft: i ? -8 : 0 }}><Avatar name={m.name || m.email} i={i} size={28} /></span>)}
            </div>
          </div>
        </button>
      )}
      <div className="col">
        {trips.filter((t) => t !== featured).map((t) => (
          <button key={t.id} className="card between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go({ view: 'trip', tripId: t.id, tab: 'plan' })}>
            <div><div className="k mute">{t.start_date > today ? 'Coming up' : 'Past'}</div><div className="n">{t.name}</div><div className="s">{dayLabel(t.start_date, { day: 'numeric', month: 'short' })} – {dayLabel(t.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
            <Icon n="arrow" size={18} />
          </button>
        ))}
        <button className="btn ghost block" style={{ borderStyle: 'dashed', borderColor: '#C9A96E', color: 'var(--amber)' }} onClick={() => setNewTrip(true)}>+ New trip</button>
      </div>

      <div className="between" style={{ marginTop: 8 }}>
        <span className="k amber">Tabs · splits outside a trip</span>
        <button className="link amber" onClick={() => setNewTab(true)}>+ Split a bill</button>
      </div>
      {tabs.map((t) => {
        const n = myNet(t.id);
        return (
          <button key={t.id} className="card between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go({ view: 'trip', tripId: t.id, tab: 'money' })}>
            <div><div className="n">{t.name}</div><div className="s">{membersOf(t.id).length} people</div></div>
            <div style={{ textAlign: 'right', font: '600 13px var(--sans)', color: n > 0.004 ? '#24563F' : n < -0.004 ? '#A8472A' : 'var(--mute)' }}>{n > 0.004 ? `owed ${money(n, t.currency)}` : n < -0.004 ? `you owe ${money(-n, t.currency)}` : 'square'}</div>
          </button>
        );
      })}
      {!tabs.length && <div className="s">Dinner, a night out, flat bills — split anything, with or without a trip. Friends don’t need the app.</div>}

      <div className="between" style={{ marginTop: 8 }}>
        <span className="k amber">City guides · yours, kept forever</span>
        <button className="link amber" onClick={() => setNewCity(true)}>+ City</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
        {cities.map((c) => (
          <button key={c.city} className="card col" style={{ textAlign: 'left', gap: 5, cursor: 'pointer' }} onClick={() => go({ view: 'guide', city: c.city })}>
            <div className="n" style={{ fontSize: 22 }}>{c.city}</div>
            <div className="s">{c.n} places{c.visited ? ` · ${c.visited} visited` : ''}</div>
            {c.ig > 0 && <span className="pill" style={{ background: '#F6E6EC', color: '#6B2944', alignSelf: 'flex-start' }}>{c.ig} from IG</span>}
          </button>
        ))}
      </div>
      {!cities.length && <div className="s">Start a trip or add a city, then send screenshots and links in — they’ll land in that city’s guide.</div>}
      <div className="s" style={{ textAlign: 'center' }}>Signed in as {me}<br /><span style={{ opacity: 0.6, fontSize: 12 }}>Version {__BUILD__} UTC</span></div>
      {(s.failed.length > 0 || s.outbox.length > 0) && (
        <div className="card s">
          {s.outbox.length} waiting to send · {s.failed.length} refused by the server{s.failed.length ? <> — last reason: “{s.failed[s.failed.length - 1].error}”</> : ''}
          <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => location.reload()}>Retry now</button></div>
        </div>
      )}

      <button className="fab" aria-label="Capture or split" onClick={() => setMenu(true)} style={{ bottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F3EEE6" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      {menu && (
        <Sheet onClose={() => setMenu(false)}>
          <button className="card dark between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { setMenu(false); setCapture(true); }}>
            <span><div className="n" style={{ color: '#F3EEE6' }}>Save a place</div><div className="s" style={{ color: '#B7AC9C' }}>Screenshot, reel or link → a city guide</div></span><Icon n="camera" color="#E2B36A" />
          </button>
          <button className="card between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { setMenu(false); setNewTab(true); }}>
            <span><div className="n">Split a bill</div><div className="s">Start a tab — no trip needed</div></span><Icon n="receipt" />
          </button>
          <button className="card between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { setMenu(false); setNewTrip(true); }}>
            <span><div className="n">New trip</div><div className="s">Dates, crew, schedule</div></span><Icon n="plan" />
          </button>
        </Sheet>
      )}
      {capture && <Capture me={me} onClose={() => setCapture(false)} />}
      {newTab && <NewTab me={me} pastPeople={pastPeople(s, me)} onClose={() => setNewTab(false)} onDone={(id) => go({ view: 'trip', tripId: id, tab: 'money' })} />}
      {newTrip && <NewTrip me={me} onClose={() => setNewTrip(false)} onDone={(id) => go({ view: 'trip', tripId: id, tab: 'today' })} />}
      {newCity && <NewCity onClose={() => setNewCity(false)} go={go} />}
    </div>
  );
}

export function CitySearch({ value, onPick, onText, placeholder = 'Paris, Berlin, Barcelona…' }) {
  const [q, setQ] = useState(value || '');
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState('');
  async function search() {
    if (!q.trim()) return;
    setMsg('Searching…');
    try {
      const all = (await api('/api/geo', { q: q.trim(), limit: 6 })).results || [];
      const cities = all.filter((r) => /city|town|village|administrative|state|municipality|borough|suburb/.test(r.osm_value || ''));
      setRes(cities.length ? cities : all);
      setMsg(all.length ? '' : 'No match — you can still create the trip with the name as typed.');
    } catch (e) {
      setRes([]);
      setMsg(`Search isn’t working (${e.message}) — the name as typed works fine.`);
    }
  }
  return (
    <div className="col">
      <div className="row">
        <input className="in" value={q} onChange={(e) => { setQ(e.target.value); onText?.(e.target.value); onPick?.(null); }} placeholder={placeholder}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())} />
        <button type="button" className="icon" aria-label="Search" onClick={search}><Icon n="search" size={18} /></button>
      </div>
      {msg && <div className="s">{msg}</div>}
      {res?.map((r, i) => (
        <button type="button" key={i} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => { setQ(r.name); setRes(null); onPick({ city: r.name, lat: r.lat, lng: r.lng }); }}>
          <div className="n">{r.name}</div><div className="s">{r.address || r.city}</div>
        </button>
      ))}
    </div>
  );
}

function NewTrip({ me, onClose, onDone }) {
  const [city, setCity] = useState(null);
  const [cityText, setCityText] = useState('');
  const [name, setName] = useState('');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const ok = (city || cityText.trim()) && start && end >= start;
  function create() {
    const id = uid();
    const c = city?.city || cityText.trim().replace(/^./, (x) => x.toUpperCase());
    upsert('trips', { id, name: name.trim() || c, city: c, center_lat: city?.lat ?? null, center_lng: city?.lng ?? null, start_date: start, end_date: end });
    if (!city) api('/api/geo', { q: c, limit: 1 }).then((r) => r.results?.[0] && upsert('trips', { id, center_lat: r.results[0].lat, center_lng: r.results[0].lng })).catch(() => {});
    upsert('trip_members', { id: uid(), trip_id: id, email: me, name: me.split('@')[0], role: 'owner' });
    onDone(id);
  }
  return (
    <Sheet title="New trip" onClose={onClose}>
      <label className="f">Where</label>
      <CitySearch onPick={setCity} onText={setCityText} />
      {city && <div className="s">✓ {city.city} — travel times and searches will centre here.</div>}
      <label className="f">Trip name (optional)<input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder={city?.city || 'Paris'} /></label>
      <div className="row">
        <label className="f grow">From<input className="in" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
        <label className="f grow">To<input className="in" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <div className="s">Next: add where you’re staying and who’s coming, from the people button on the Today screen.</div>
      <button className="btn block" disabled={!ok} onClick={create}>Create trip</button>
    </Sheet>
  );
}

function NewCity({ onClose, go }) {
  const [txt, setTxt] = useState('');
  return (
    <Sheet title="New city guide" onClose={onClose}>
      <CitySearch onPick={(c) => c && go({ view: 'guide', city: c.city })} onText={setTxt} />
      <button className="btn block" disabled={!txt.trim()} onClick={() => go({ view: 'guide', city: txt.trim().replace(/^./, (x) => x.toUpperCase()) })}>Open guide</button>
    </Sheet>
  );
}

function pastPeople(s, me) {
  const m = {};
  for (const x of Object.values(s.trip_members)) {
    const e = x.email?.toLowerCase();
    if (e && e !== me && !e.endsWith('@guest.carnet')) m[e] = x.name || e.split('@')[0];
  }
  return Object.entries(m).map(([email, name]) => ({ email, name }));
}

function NewTab({ me, pastPeople, onClose, onDone }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [guests, setGuests] = useState([]);
  const [g, setG] = useState('');
  const count = 1 + picked.length + guests.length;
  function create() {
    const id = uid();
    upsert('trips', { id, kind: 'tab', name: name.trim() || 'Split', city: null, start_date: todayISO(), end_date: todayISO(), approval: false });
    upsert('trip_members', { id: uid(), trip_id: id, email: me, name: me.split('@')[0], role: 'owner' });
    for (const p of pastPeople.filter((p) => picked.includes(p.email))) upsert('trip_members', { id: uid(), trip_id: id, email: p.email, name: p.name, role: 'member' });
    for (const n of guests) upsert('trip_members', { id: uid(), trip_id: id, email: `guest-${uid().slice(0, 8)}@guest.carnet`, name: n, role: 'member' });
    onDone(id);
  }
  return (
    <Sheet title="Split a bill" onClose={onClose}>
      <label className="f">What’s it for<input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dinner with Sam, Friday out, flat bills…" /></label>
      {pastPeople.length > 0 && (
        <>
          <label className="f">Who’s in</label>
          <div className="chips">
            {pastPeople.map((p) => {
              const on = picked.includes(p.email);
              return <button key={p.email} className={'chip' + (on ? ' on' : '')} onClick={() => setPicked(on ? picked.filter((x) => x !== p.email) : [...picked, p.email])}>{p.name}</button>;
            })}
          </div>
        </>
      )}
      <label className="f">Add someone without the app</label>
      <div className="row">
        <input className="in" value={g} onChange={(e) => setG(e.target.value)} placeholder="Name" onKeyDown={(e) => e.key === 'Enter' && g.trim() && (setGuests([...guests, g.trim()]), setG(''))} />
        <button className="btn" disabled={!g.trim()} onClick={() => { setGuests([...guests, g.trim()]); setG(''); }}>Add</button>
      </div>
      {guests.length > 0 && <div className="chips">{guests.map((n, i) => <button key={i} className="chip on" onClick={() => setGuests(guests.filter((_, j) => j !== i))}>{n} ×</button>)}</div>}
      <div className="s">{count} {count === 1 ? 'person (add more, or anyone later)' : 'people'} · works offline, settles up the same way as trips.</div>
      <button className="btn block" onClick={create}>Start the tab</button>
    </Sheet>
  );
}
