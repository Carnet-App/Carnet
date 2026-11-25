import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Icon, Sheet, CatTag, StatusPill } from '../ui';
import { upsert, remove, uid, useStore } from '../lib/store';
import { getMe } from '../lib/me';
import { fileUrl } from '../lib/files';
import { useCityPlaces } from '../lib/hooks';
import { CATS, cat, findVenue, guessCategory, walkMin, stayFor, todayISO, api, nameOf, useLocation, distM } from '../lib/util';
import ItemEditor from './ItemEditor';
import Capture from './Capture';
const MapView = lazy(() => import('./MapView'));

export function PlacePhoto({ p, size = 54, style }) {
  const [src, setSrc] = useState(p.photo_url || null);
  useEffect(() => {
    let alive = true;
    if (p.photo_path) fileUrl(p.photo_path).then((u) => alive && setSrc(u || p.photo_url || null));
    else setSrc(p.photo_url || null);
    return () => { alive = false; };
  }, [p.photo_path, p.photo_url]);
  return src ? <img className="thumb" src={src} alt="" style={{ width: size, height: size, ...style }} loading="lazy" /> : <span className="thumb" style={{ width: size, height: size, background: cat(p.category).bg, ...style }} />;
}

const SRC = { instagram: ['IG', '#F6E6EC', '#6B2944'], screenshot: ['Screenshot', '#F6E6EC', '#6B2944'], friend: ['Friend', '#E1F0E8', '#24563F'], osm: ['Map', '#ECEAFA', '#4A3F9C'], google: ['Google', '#ECEAFA', '#4A3F9C'], manual: ['Added', '#EDE9E2', '#4F473E'] };

// Used two ways: inside a trip (t given) or as a city guide on its own (city given).
export default function Places({ t, me, city, onBack, open }) {
  const cityName = t?.trip.city || city;
  const all = useCityPlaces(cityName);
  const [c, setC] = useState('all');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toTrip, setToTrip] = useState(null);
  const [map, setMap] = useState(false);
  const [cap, setCap] = useState(false);
  const home = t ? stayFor(t.stays, todayISO()) : null;
  const onTrip = useMemo(() => new Map((t?.items || []).filter((i) => i.place_id).map((i) => [i.place_id, i])), [t?.items]);

  const [within, setWithinState] = useState(() => { try { return +localStorage.getItem('carnet.placesWithin') || 0; } catch { return 0; } });
  const setWithin = (v) => { setWithinState(v); try { localStorage.setItem('carnet.placesWithin', String(v)); } catch {} };
  const here = useLocation();
  // Walking times from you when you're in town; otherwise from where you're staying.
  const mid = useMemo(() => { const v = all.filter((p) => p.lat != null); if (!v.length) return null; const m = (k) => v.map((p) => p[k]).sort((a, b) => a - b)[v.length >> 1]; return { lat: m('lat'), lng: m('lng') }; }, [all]);
  const inTown = (x) => x && (!mid || distM(mid, x) < 30000);
  const from = inTown(here) ? here : inTown(home) ? home : null;
  // Name the stay ("Hôtel Jules") rather than calling it home; long names → "your stay".
  const stayLabel = from === here ? 'you' : home?.name && home.name.length <= 24 ? home.name : 'your stay';
  const myId = getMe().id;
  const mine = (p) => !p.owner || !myId || p.owner === myId;
  const others = all.some((p) => !mine(p));
  const walked = all.map((p) => ({ ...p, walk: walkMin(from, p) }));
  const list = walked
    .filter((p) => c === 'all' || p.category === c)
    .filter((p) => filter === 'all' || (filter === 'ig' ? p.source === 'instagram' : filter === 'new' ? !p.visited : filter === 'check' ? p.needs_check : filter === 'mine' ? mine(p) : filter === 'crew' ? !mine(p) : true))
    .filter((p) => !within || !from || (p.walk != null && p.walk <= within))
    .sort((a, b) => (b.needs_check ? 1 : 0) - (a.needs_check ? 1 : 0) || (a.walk ?? 9e9) - (b.walk ?? 9e9) || a.name.localeCompare(b.name));
  const checks = all.filter((p) => p.needs_check).length;
  const count = (m) => walked.filter((p) => p.walk != null && p.walk <= m && (c === 'all' || p.category === c)).length;

  return (
    <div className="page">
      {onBack && <button className="link" style={{ alignSelf: 'flex-start', textDecoration: 'none' }} onClick={onBack}>‹ Carnet</button>}
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="k amber">{t ? `${cityName} guide · adding to ${t.trip.name}` : `City guide · ${all.length} places`}</div>
          <h1 className="h1">{t ? 'Places' : cityName}</h1>
        </div>
        <div className="row">
          <button className="icon" aria-label="Map" onClick={() => setMap(true)}><Icon n="map" size={20} /></button>
          <button className="icon" aria-label="Add a place" onClick={() => setAdding(true)}><Icon n="plus" size={20} /></button>
        </div>
      </div>
      <div className="chips">
        <button className={'chip' + (c === 'all' ? ' on' : '')} onClick={() => setC('all')}>All</button>
        {Object.entries(CATS).filter(([k]) => k !== 'other').map(([k, v]) => (
          <button key={k} className={'chip' + (c === k ? ' on' : '')} onClick={() => setC(k)}>{v.label}</button>
        ))}
      </div>
      <div className="chips">
        {[['all', 'Everything'], ['new', 'Not been yet'], ...(others ? [['mine', 'Just mine'], ['crew', 'From the crew']] : []), ['ig', 'From Instagram'], ...(checks ? [['check', `To check (${checks})`]] : [])].map(([k, l]) => (
          <button key={k} className={'chip' + (filter === k ? ' on' : '')} style={{ fontSize: 12 }} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {from && (
        <div className="chips">
          {[[0, 'Any distance'], [10, '10 min walk'], [20, '20 min'], [30, '30 min']].map(([m, l]) => (
            <button key={m} className={'chip' + (within === m ? ' on' : '')} style={{ fontSize: 12 }} onClick={() => setWithin(m)}>{l}{m ? ` (${count(m)})` : ''}</button>
          ))}
        </div>
      )}
      <div className="col">
        {list.map((p) => {
          const it = onTrip.get(p.id);
          const s = SRC[p.source] || SRC.manual;
          return (
            <div key={p.id} className="card row" style={{ padding: '10px 12px' }}>
              <button className="row grow" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setDetail(p)}>
                <PlacePhoto p={p} />
                <div className="grow">
                  <CatTag c={p.category} extra={p.needs_check ? 'check this one' : p.collection || ''} />
                  <div className="n">{p.name}</div>
                  <div className="row" style={{ gap: 6, marginTop: 3 }}>
                    <span className="pill" style={{ background: p.visited ? '#E1F0E8' : s[1], color: p.visited ? '#24563F' : s[2] }}>{p.visited ? 'Visited' : s[0]}</span>
                    <span className="s">{p.walk != null ? `${p.walk} min walk from ${stayLabel}` : p.address || ''}{!mine(p) && onTrip.get(p.id)?.created_by_email ? ` · ${nameOf(t.members, onTrip.get(p.id).created_by_email)}` : ''}</span>
                  </div>
                </div>
              </button>
              {t && (it ? <StatusPill s={it.status} /> : (
                <button className="icon" aria-label={'Add ' + p.name + ' to the trip'} onClick={() => setToTrip(p)}><Icon n="plus" size={18} /></button>
              ))}
            </div>
          );
        })}
        {!list.length && <div className="empty">Nothing here yet. Send in a screenshot or Instagram link with +, or add a place by name.</div>}
      </div>

      {detail && <PlaceDetail p={detail} onClose={() => setDetail(null)} />}
      {adding && <AddPlace city={cityName} near={home || (t?.trip.center_lat ? { lat: t.trip.center_lat, lng: t.trip.center_lng } : null)} onClose={() => setAdding(false)} />}
      {toTrip && (
        <ItemEditor t={t} me={me} preset={{ title: toTrip.name, place_id: toTrip.id, lat: toTrip.lat, lng: toTrip.lng, address: toTrip.address, category: toTrip.category, status: 'idea', day: null }} onClose={() => setToTrip(null)} />
      )}
      {!t && (
        <button className="fab" aria-label="Save a place from a screenshot or link" onClick={() => setCap(true)} style={{ bottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
          <Icon n="camera" color="#F3EEE6" size={24} />
        </button>
      )}
      {cap && <Capture me={me} defaultCity={cityName} onClose={() => setCap(false)} />}
      {map && <Suspense fallback={null}><MapView t={t} places={all} onClose={() => setMap(false)} /></Suspense>}
    </div>
  );
}

export function AddPlace({ city, near, onClose, onAdded }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  async function search() {
    setBusy(true);
    setRes(await findVenue(`${q} ${city}`, near, null, { google: true, fillNames: true, name: q, city }).catch(() => []));
    setBusy(false);
  }
  function add(r) {
    const id = uid();
    upsert('places', {
      id, city, name: r.name, category: guessCategory(r.osm_value, r.name), address: r.address || null, lat: r.lat ?? null, lng: r.lng ?? null,
      source: r.source || 'manual', photo_url: r.google_id ? `/api/gphoto?id=${encodeURIComponent(r.google_id)}` : null, needs_check: r.lat == null,
    });
    onAdded?.(id);
    onClose();
  }
  return (
    <Sheet title={`Add to ${city}`} onClose={onClose}>
      <div className="row">
        <input className="in" autoFocus placeholder="Name of the place" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="icon" aria-label="Search" onClick={search}><Icon n="search" size={18} /></button>
      </div>
      {busy && <div className="s">Looking it up…</div>}
      {res?.map((r, i) => (
        <button key={i} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => add(r)}>
          <CatTag c={guessCategory(r.osm_value, r.name)} extra={r.source === 'google' ? 'Google' : 'Map'} />
          <div className="n">{r.name}</div><div className="s">{r.address}</div>
        </button>
      ))}
      {res && !res.length && <div className="s">No match{navigator.onLine ? '' : ' (you’re offline)'}.</div>}
      {q.trim() && <button className="btn ghost block" onClick={() => add({ name: q.trim(), source: 'manual' })}>Keep “{q.trim()}” as a note — find it later</button>}
    </Sheet>
  );
}

export function PlaceDetail({ p: initial, onClose }) {
  const [p, setP] = useState(initial);
  const [link, setLink] = useState(initial.link || '');
  const [matches, setMatches] = useState(null);
  const [msg, setMsg] = useState('');
  const save = (patch) => { const n = { ...p, ...patch }; setP(n); upsert('places', { id: p.id, ...patch }); };

  async function photoFromSite() {
    if (!link) return;
    setMsg('Looking at the website…');
    try {
      const r = await api('/api/og', { url: link });
      if (r.image) { save({ photo_url: r.image, link }); setMsg('Photo from the venue’s own site.'); }
      else setMsg('That site doesn’t publish a preview image.');
    } catch { setMsg('Couldn’t reach that site.'); }
  }
  async function check() {
    setMsg('Looking it up…');
    setMatches(await findVenue(`${p.name} ${p.city}`, null, null, { google: true, fillNames: true, name: p.name, city: p.city }).catch(() => []));
    setMsg('');
  }

  return (
    <Sheet onClose={onClose}>
      <PlacePhoto p={p} size={undefined} style={{ width: '100%', height: 180, borderRadius: 14 }} />
      <div>
        <CatTag c={p.category} extra={p.source_detail || ''} />
        <h2 className="h2" style={{ marginTop: 4 }}>{p.name}</h2>
        <div className="s">{p.address || 'No address yet'}</div>
      </div>
      {p.needs_check && (
        <div className="card dashed col">
          <div className="k amber">Not sure which place this is</div>
          <button className="btn sm" onClick={check}>Find it on the map</button>
          {matches?.map((m, i) => (
            <button key={i} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => { save({ name: m.name, lat: m.lat, lng: m.lng, address: m.address, needs_check: false, category: guessCategory(m.osm_value, m.name) }); setMatches(null); }}>
              <div className="n">{m.name}</div><div className="s">{m.address}</div>
            </button>
          ))}
          {matches && !matches.length && <div className="s">No match found. You can keep it as a note.</div>}
        </div>
      )}
      <div className="chips">
        {Object.entries(CATS).map(([k, v]) => <button key={k} className={'chip' + (p.category === k ? ' on' : '')} onClick={() => save({ category: k })}>{v.label}</button>)}
      </div>
      <label className="row" style={{ justifyContent: 'space-between', font: '500 14px var(--sans)' }}>Been here<input type="checkbox" checked={!!p.visited} onChange={(e) => save({ visited: e.target.checked })} style={{ width: 22, height: 22, accentColor: '#1E1A16' }} /></label>
      <label className="f">Notes<textarea className="in" defaultValue={p.notes || ''} onBlur={(e) => save({ notes: e.target.value })} /></label>
      <label className="f">Website or link
        <div className="row"><input className="in" value={link} onChange={(e) => setLink(e.target.value)} onBlur={() => link !== (p.link || '') && save({ link })} placeholder="https://" />
          <button className="btn sm ghost" onClick={photoFromSite} disabled={!link}>Photo</button></div>
      </label>
      {msg && <div className="s">{msg}</div>}
      {p.lat != null && <a className="btn ghost block" href={`https://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=w`} target="_blank" rel="noreferrer">Directions in Maps</a>}
      <AddedBy p={p} />
      <button className="link mute" onClick={() => { if (confirm('Delete from your guide?')) { remove('places', p.id); onClose(); } }}>Delete from guide</button>
    </Sheet>
  );
}

// Who added a place, and from what. Places you see but didn't add come from the trip, where the
// plan pointing at it says who put it there.
const SOURCE = { instagram: 'Instagram', screenshot: 'a screenshot', google: 'Google Maps', osm: 'the map', web: 'a website', friend: 'a friend', manual: 'typed in', tiktok: 'TikTok' };
function AddedBy({ p }) {
  const items = useStore((s) => s.items);
  const members = useStore((s) => s.trip_members);
  const me = getMe();
  const mine = !p.owner || p.owner === me.id;
  const via = Object.values(items || {}).find((i) => i.place_id === p.id && i.created_by_email);
  const email = mine ? me.email : via?.created_by_email;
  const who = mine ? 'you' : email ? nameOf(Object.values(members || {}), email) : 'someone on the trip';
  const when = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  const from = SOURCE[p.source] || null;
  return <div className="s" style={{ textAlign: 'center' }}>Added by {who}{when ? ` · ${when}` : ''}{from ? ` · from ${from}` : ''}</div>;
}
