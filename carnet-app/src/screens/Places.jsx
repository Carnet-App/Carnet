import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Icon, Sheet, CatTag, StatusPill } from '../ui';
import { upsert, remove, uid, useStore } from '../lib/store';
import { getMe } from '../lib/me';
import { usePlaceRatings, useAllRatings, mineOf, tally, rate } from '../lib/ratings';
import { fileUrl } from '../lib/files';
import { useCityPlaces } from '../lib/hooks';
import { CATS, cat, findVenue, guessCategory, walkMin, stayFor, todayISO, api, nameOf, useLocation, distM, dayLabel, hm, tripNow } from '../lib/util';
import ItemEditor from './ItemEditor';
import Capture from './Capture';
import AddToPlan from './AddToPlan';
import { backupIndex } from '../lib/alts';
import { fromYourList } from '../lib/nearby';
import { hoursLine, closedDays, priceSigns, openAt } from '../lib/facts';
import { bestNow, whyTag } from '../lib/bestNow';
import VisitBlock from './VisitBlock';
import { useHop, hasTransit, linesText } from '../lib/travel';
import { lastReport, onReport } from '../lib/googleFill';
const PinPicker = lazy(() => import('./PinPicker'));
const MapView = lazy(() => import('./MapView'));

export function PlacePhoto({ p, size = 54, style }) {
  const [src, setSrc] = useState(p.photo_url || null);
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [src]);
  useEffect(() => {
    let alive = true;
    if (p.photo_path) fileUrl(p.photo_path).then((u) => alive && setSrc(u || p.photo_url || null));
    else setSrc(p.photo_url || null);
    return () => { alive = false; };
  }, [p.photo_path, p.photo_url]);
  return src && !bad ? <img className="thumb" src={src} alt="" style={{ width: size, height: size, ...style }} loading="lazy" onError={() => setBad(true)} /> : <span className="thumb" style={{ width: size, height: size, background: cat(p.category).bg, ...style }} />;
}

const SRC = { instagram: ['IG', '#F6E6EC', '#6B2944'], screenshot: ['Screenshot', '#F6E6EC', '#6B2944'], friend: ['Friend', '#E1F0E8', '#24563F'], osm: ['Map', '#ECEAFA', '#4A3F9C'], google: ['Google', '#ECEAFA', '#4A3F9C'], manual: ['Added', '#EDE9E2', '#4F473E'] };

// A place is unfinished until it has a pin on the map, an address and nobody's unsure which it is.
export const unfinished = (p) => !!p.needs_check || p.lat == null || !p.address;
const missing = (p) => (p.lat == null ? 'no pin yet' : p.needs_check ? 'check which place' : !p.address ? 'no address' : '');

// What the Google tidy-up did on this phone (see lib/googleFill), shown until dismissed.
function GoogleNote() {
  const [r, setR] = useState(lastReport);
  const [gone, setGone] = useState(false);
  useEffect(() => onReport((x) => { setR(x); setGone(false); }), []);
  if (!r || gone || (!r.running && !r.tried && !r.stopped)) return null;
  const done = [r.pinned && `pinned ${r.pinned}`, r.photos && `added ${r.photos} photo${r.photos === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  const text = r.running
    ? `Checking your places with Google… ${r.tried} of ${r.of}`
    : r.stopped === 'off' ? 'Google isn’t switched on yet, so places stay as they are.'
    : `Google checked ${r.tried} of your places: ${done || 'no sure matches'}.` +
      (r.stopped === 'limit' ? ' Today’s Google allowance is used up; the rest carry on tomorrow.' : r.stopped === 'day' ? ' The rest carry on tomorrow.' : r.stopped === 'error' ? ' It stopped early; it’ll try again next time.' : '');
  return (
    <div className="row" style={{ background: '#ECEAFA', color: '#4A3F9C', borderRadius: 12, padding: '9px 12px', gap: 8, font: '400 13.5px var(--sans)' }}>
      <Icon n="search" size={16} color="#4A3F9C" /><span className="grow">{text}</span>
      {!r.running && <button aria-label="Dismiss" onClick={() => setGone(true)} style={{ background: 'none', border: 0, cursor: 'pointer', display: 'flex' }}><Icon n="close" size={14} color="#4A3F9C" /></button>}
    </div>
  );
}

// A filter as a small pill holding a native dropdown (the phone's own picker), dark when set.
function Drop({ value, options, onChange, label }) {
  const on = value !== options[0][0];
  const text = options.find(([k]) => k === value)?.[1] || options[0][1];
  return (
    <span className={'chip' + (on ? ' on' : '')} style={{ position: 'relative', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', flex: 'none' }}>
      {on ? text : label}
      {on ? <button aria-label={'Clear ' + label} onClick={() => onChange(options[0][0])} style={{ position: 'relative', zIndex: 2, background: 'none', border: 0, color: 'inherit', padding: 0, marginLeft: 2, cursor: 'pointer', display: 'flex' }}><Icon n="close" size={12} color="#F3EEE6" /></button>
        : <Icon n="chev-down" size={12} />}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: on ? 'calc(100% - 22px)' : '100%', cursor: 'pointer' }}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </span>
  );
}

const keep = (k, d) => { try { return localStorage.getItem('carnet.places.' + k) || d; } catch { return d; } };
const BANDS = [[10, 'Around the corner', 'under 10 min'], [20, 'A short walk', '10–20 min'], [35, 'Further', '20–35 min'], [Infinity, 'Further afield', 'over 35 min']];

// Used two ways: inside a trip (t given) or as a city guide on its own (city given).
export default function Places({ t, me, city, onBack, open }) {
  const cityName = t?.trip.city || city;
  const all = useCityPlaces(cityName);
  const [c, setC] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSortS] = useState(() => keep('sort2', 'best'));
  const [view, setViewS] = useState(() => keep('view', 'cards'));
  const [food, setFood] = useState('any');
  const [price, setPrice] = useState('0');
  const [openNow, setOpenNow] = useState(false);
  const [showPassed, setShowPassed] = useState(false);
  const [within, setWithinS] = useState(() => keep('within', '0'));
  const [who, setWho] = useState('any');
  const [status, setStatus] = useState('all');
  const remember = (k, set) => (v) => { set(v); try { localStorage.setItem('carnet.places.' + k, v); } catch {} };
  const setSort = remember('sort2', setSortS), setWithin = remember('within', setWithinS), setView = remember('view', setViewS);
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);
  const [quick, setQuick] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [map, setMap] = useState(false);
  const [cap, setCap] = useState(false);
  const home = t ? stayFor(t.stays, todayISO()) : null;
  const onTrip = useMemo(() => new Map((t?.items || []).filter((i) => i.place_id).map((i) => [i.place_id, i])), [t?.items]);
  const backups = useMemo(() => backupIndex(t?.items), [t?.items]);

  const here = useLocation();
  // Walking times from you when you're in town; otherwise from where you're staying.
  const mid = useMemo(() => { const v = all.filter((p) => p.lat != null); if (!v.length) return null; const m = (k) => v.map((p) => p[k]).sort((a, b) => a - b)[v.length >> 1]; return { lat: m('lat'), lng: m('lng') }; }, [all]);
  const inTown = (x) => x && (!mid || distM(mid, x) < 30000);
  const from = inTown(here) ? here : inTown(home) ? home : null;
  const myId = getMe().id;
  const rated = useAllRatings();
  const been = (p) => { const m = mineOf(rated.get(p.id)); return m ? m.visited : !!p.visited; };
  const mine = (p) => !p.owner || !myId || p.owner === myId;
  const others = all.some((p) => !mine(p));
  const walked = useMemo(() => all.map((p) => ({ ...p, walk: walkMin(from, p) })), [all, from?.lat, from?.lng]);
  const norm = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Everything but the category, so the category counts show what each would give.
  const base = walked
    .filter((p) => !q.trim() || norm(p.name + ' ' + (p.address || '') + ' ' + (p.notes || '')).includes(norm(q.trim())))
    .filter((p) => who === 'any' || (who === 'me' ? mine(p) : !mine(p)))
    .filter((p) => status === 'all' || (status === 'new' ? !been(p) : status === 'visited' ? been(p) : status === 'liked' ? tally(rated.get(p.id)).up > 0 : status === 'planned' ? onTrip.get(p.id)?.day || backups.has(p.id) : status === 'unplanned' ? !onTrip.get(p.id)?.day && !backups.has(p.id) : status === 'ig' ? p.source === 'instagram' : status === 'unfinished' ? unfinished(p) : true))
    .filter((p) => !+within || !from || (p.walk != null && p.walk <= +within))
    .filter((p) => food === 'any' || (p.cuisine || '').toLowerCase().split(/,\s*/).includes(food))
    .filter((p) => !+price || (p.price_level && p.price_level <= +price))
    .filter((p) => !openNow || openAt(p.hours)?.open);
  const list = base.filter((p) => c === 'all' || p.category === c)
    .sort(sort === 'az' ? (a, b) => a.name.localeCompare(b.name) : sort === 'recent' ? (a, b) => (b.created_at || '').localeCompare(a.created_at || '') : (a, b) => (a.walk ?? 9e9) - (b.walk ?? 9e9) || a.name.localeCompare(b.name));
  const counts = base.reduce((m, p) => ({ ...m, [p.category]: (m[p.category] || 0) + 1 }), {});
  // Cuisines on the list, for the Food filter; price only once something has one.
  const cuisines = [...new Set(all.flatMap((p) => (p.cuisine || '').toLowerCase().split(/,\s*/)).filter(Boolean))].sort();
  const priced = all.some((p) => p.price_level);
  const timed = all.some((p) => p.hours?.periods?.length);
  // "Best now" needs a now and a here: you're in town, or the trip is on today.
  const now = tripNow();
  const tripOn = t && t.trip.start_date <= now.day && (t.trip.end_date || t.trip.start_date) >= now.day;
  const bestOn = sort === 'best' && (tripOn || inTown(here));
  const best = useMemo(() => bestOn ? bestNow(list, {
    ratings: rated, mineOf, showPassed,
    dayItems: (t?.items || []).filter((i) => i.day === now.day),
    plannedToday: new Set((t?.items || []).filter((i) => i.day === now.day && i.place_id).map((i) => i.place_id)),
  }) : null, [bestOn, list, rated, showPassed, t?.items, now.day]);
  const todo = all.filter(unfinished).length;
  const groups = best
    ? best.groups.map((g) => ({ title: g.title, sub: '', rows: g.rows, key: g.key }))
    : (sort === 'near' || sort === 'best') && from
    ? BANDS.map(([max, title, sub], i) => ({ title, sub, rows: list.filter((p) => p.walk != null && p.walk < max && (i === 0 || p.walk >= BANDS[i - 1][0])) }))
      .concat([{ title: 'Not on the map yet', sub: '', rows: list.filter((p) => p.walk == null) }]).filter((g) => g.rows.length)
    : [{ title: '', sub: '', rows: list }];

  return (
    <div className="page">
      {onBack && <button className="link" style={{ alignSelf: 'flex-start', textDecoration: 'none' }} onClick={onBack}>‹ Carnet</button>}
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="k amber">{t ? `${cityName} guide · adding to ${t.trip.name}` : `City guide · ${all.length} places`}</div>
          <h1 className="h1">{t ? 'Places' : cityName}</h1>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <div role="tablist" aria-label="List style" className="seg">
            {[['cards', 'Cards'], ['list', 'List']].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
          </div>
          <button className="icon" aria-label="Map" onClick={() => setMap(true)}><Icon n="map" size={20} /></button>
          <button className="icon" aria-label="Add a place" onClick={() => setAdding(true)}><Icon n="plus" size={20} /></button>
        </div>
      </div>

      <label className="row" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '0 12px', gap: 8 }}>
        <Icon n="search" size={16} color="#8a8175" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${all.length} places`} aria-label="Search places" style={{ flex: 1, border: 0, background: 'transparent', padding: '10px 0', outline: 'none', fontSize: 15 }} />
        {q && <button aria-label="Clear search" onClick={() => setQ('')} style={{ background: 'none', border: 0, cursor: 'pointer', display: 'flex' }}><Icon n="close" size={14} /></button>}
      </label>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', paddingRight: 24, maskImage: 'linear-gradient(to right, #000 88%, transparent)', WebkitMaskImage: 'linear-gradient(to right, #000 88%, transparent)' }}>
        <button className={'chip' + (c === 'all' ? ' on' : '')} style={{ flex: 'none' }} onClick={() => setC('all')}>All {base.length}</button>
        {Object.entries(CATS).filter(([k]) => counts[k] || c === k).map(([k, v]) => (
          <button key={k} className={'chip' + (c === k ? ' on' : '')} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setC(c === k ? 'all' : k)}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: c === k ? '#F3EEE6' : v.color }} />{v.label} {counts[k] || 0}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', paddingRight: 24, maskImage: 'linear-gradient(to right, #000 88%, transparent)', WebkitMaskImage: 'linear-gradient(to right, #000 88%, transparent)' }}>
        <Drop label="Best now" value={sort} onChange={setSort} options={[['best', 'Best now'], ['near', 'Nearest'], ['recent', 'Recently added'], ['az', 'A to Z']]} />
        {timed && <button className={'chip' + (openNow ? ' on' : '')} style={{ fontSize: 12.5, padding: '6px 10px', flex: 'none' }} onClick={() => setOpenNow(!openNow)}>Open now</button>}
        {cuisines.length > 1 && <Drop label="Food" value={food} onChange={setFood} options={[['any', 'Any food'], ...cuisines.map((k) => [k, k[0].toUpperCase() + k.slice(1)])]} />}
        {priced && <Drop label="Price" value={price} onChange={setPrice} options={[['0', 'Any price'], ['1', '€ only'], ['2', '€€ or less'], ['3', '€€€ or less']]} />}
        {from && <Drop label="Any distance" value={String(within)} onChange={setWithin} options={[['0', 'Any distance'], ['10', '≤ 10 min walk'], ['20', '≤ 20 min walk'], ['30', '≤ 30 min walk']]} />}
        {others && <Drop label="Anyone" value={who} onChange={setWho} options={[['any', 'Added by anyone'], ['me', 'Added by me'], ['crew', 'Added by the crew']]} />}
        <Drop label="Status" value={status} onChange={setStatus} options={[['all', 'Any status'], ['new', 'Not been yet'], ['visited', 'Been'], ['liked', 'Liked'], ...(t ? [['planned', 'On a day'], ['unplanned', 'Not on a day']] : []), ['ig', 'From Instagram'], ['unfinished', 'Unfinished']]} />
      </div>

      <GoogleNote />
      {todo > 0 && status !== 'unfinished' && (
        <button className="row" onClick={() => setStatus('unfinished')} style={{ background: '#F6EAD3', color: '#6B4510', border: 0, borderRadius: 12, padding: '9px 12px', gap: 8, textAlign: 'left', cursor: 'pointer', font: '400 13.5px var(--sans)' }}>
          <Icon n="alert" size={16} color="#6B4510" /><span className="grow">{todo} unfinished — no pin, no address or not sure which place</span><b style={{ fontWeight: 600 }}>Show</b>
        </button>
      )}
      {status === 'unfinished' && <div className="s">Open one to pin it on the map or find it by name.</div>}

      {best?.strip.length > 0 && !q.trim() && c === 'all' && <NowStrip rows={best.strip} onOpen={setDetail} />}

      {groups.map((g) => (
        <div key={g.key || g.title || 'all'} className="col" style={{ gap: 6 }}>
          {g.title && <div className="k" style={{ marginTop: 4, color: GROUP_COLOR[g.key] || 'var(--mute)' }}>{g.title}{g.sub ? ` · ${g.sub}` : ''}</div>}
          <div className={view === 'cards' ? 'col' : ''} style={view === 'cards' ? { gap: 8 } : { borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--card)' }}>
            {g.rows.map((p, i) => <PlaceRow key={p.id} p={p} first={!i} rich={view === 'cards'} faded={g.key === 'been' || g.key === 'done'} it={onTrip.get(p.id)} backup={backups.get(p.id)} t={t} been={been(p)} votes={rated.get(p.id)} by={!mine(p) && onTrip.get(p.id)?.created_by_email ? nameOf(t.members, onTrip.get(p.id).created_by_email) : null} onOpen={() => setDetail(p)} onAdd={() => setQuick(p)} />)}
          </div>
        </div>
      ))}
      {best && (best.passed > 0 || showPassed) && (
        <button className="link mute" style={{ alignSelf: 'center' }} onClick={() => setShowPassed(!showPassed)}>{showPassed ? 'Hide the ones you passed on' : `Show ${best.passed} you passed on`}</button>
      )}
      {!list.length && <div className="empty">{all.length ? 'Nothing matches. Clear a filter above.' : 'Nothing here yet. Send in a screenshot or Instagram link with +, or add a place by name.'}</div>}

      {detail && <PlaceDetail p={detail} t={t} me={me} tripId={t?.trip.id} onClose={() => setDetail(null)} />}
      {adding && <AddPlace city={cityName} near={home || (t?.trip.center_lat ? { lat: t.trip.center_lat, lng: t.trip.center_lng } : null)} onClose={() => setAdding(false)} />}
      {quick && t && (
        <Sheet title={quick.name} onClose={() => setQuick(null)}>
          <AddToPlan t={t} me={me} p={quick} onDone={() => setTimeout(() => setQuick(null), 900)} onEdit={(it) => { setQuick(null); setEditItem(it); }} />
        </Sheet>
      )}
      {editItem && <ItemEditor t={t} me={me} item={editItem} onClose={() => setEditItem(null)} />}
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

// One place in the list: a stripe in its category's colour, picture, name, and a line of what
// matters (type, walk, who added it, been / thumbs, or what's missing). On the right, when it's
// on the plan, or + to put it there.
const GROUP_COLOR = { now: '#A8472A', later: '#8E3A5C', any: '#2E5C8A', done: 'var(--mute)', been: '#24563F' };
const TONE = { open: '#2F6B57', warn: '#8A5A14', later: '#8A5A14', closed: '#A8472A' };
const away = (w) => (w > 45 ? `${(w * 80 / 1300).toFixed(1)} km` : `${w} min`);
// Why the place is worth it, in a line: cuisine and price, else the start of its note.
const whyLine = (p) => [p.cuisine, p.price_text || priceSigns(p)].filter(Boolean).join(' · ') || (p.notes ? p.notes.split('\n')[0].slice(0, 70) : '');

// Places that suit right now and are a short walk away, across the top of the list.
function NowStrip({ rows, onOpen }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="between"><div className="k">Fits now · near you</div><div className="s">a short walk · open</div></div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -20px', padding: '0 20px' }}>
        {rows.map((p) => {
          const k = cat(p.category);
          const hl = hoursLine(p.hours);
          return (
            <button key={p.id} onClick={() => onOpen(p)} style={{ width: 160, flex: 'none', background: 'var(--card)', border: '1px solid var(--soft)', borderRadius: 14, overflow: 'hidden', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', opacity: p.forLater ? 0.85 : 1 }}>
              <PlacePhoto p={p} size={undefined} style={{ display: 'block', width: '100%', height: 84, borderRadius: 0, objectFit: 'cover' }} />
              <span className="col" style={{ padding: '8px 10px', gap: 3 }}>
                <span className="pill" style={{ alignSelf: 'flex-start', background: k.bg, color: k.color, fontSize: 11 }}>{whyTag(p)}</span>
                <span style={{ font: '400 17px/1.15 var(--serif)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                <span className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.walk != null && away(p.walk), hl?.text].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlaceRow({ p, first, rich, faded, it, backup, t, been, votes, by, onOpen, onAdd }) {
  const k = cat(p.category);
  const miss = missing(p);
  const when = it?.day ? `${dayLabel(it.day, { weekday: 'short' })}${it.start_time ? ' ' + hm(it.start_time) : ''}` : null;
  const hl = hoursLine(p.hours);
  const why = whyLine(p);
  if (rich) return (
    <div className="row" style={{ gap: 12, padding: 10, alignItems: 'flex-start', background: miss ? 'transparent' : 'var(--card)', border: miss ? '1.5px dashed #C9A96E' : '1px solid var(--soft)', borderRadius: 16, opacity: faded ? 0.72 : 1 }}>
      <button onClick={onOpen} className="row grow" style={{ gap: 12, background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0, color: 'inherit', alignItems: 'flex-start' }}>
        <PlacePhoto p={p} size={72} style={{ borderRadius: 12 }} />
        <span className="col" style={{ minWidth: 0, flex: 1, gap: 3 }}>
          <span style={{ font: '400 19px/1.15 var(--serif)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
          <span className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: k.color, fontWeight: 600 }}>{k.label}</span>{p.walk != null ? ` · ${away(p.walk)}` : ''}{by ? ` · ${by}` : ''}</span>
          {miss ? <span style={{ font: '500 13px var(--sans)', color: '#8A5A14' }}>{miss[0].toUpperCase() + miss.slice(1)} — open it to finish</span>
            : why && <span style={{ font: '400 13px/1.35 var(--sans)', color: '#3A332C', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{why}</span>}
          {(hl || been || votes?.length) && <span className="row s" style={{ gap: 6 }}>{hl && <span style={{ color: TONE[hl.tone], fontWeight: 600 }}>{hl.text}</span>}{been && <span style={{ color: '#24563F' }}>been</span>}<Votes list={votes} /></span>}
        </span>
      </button>
      <RowEnd p={p} it={it} when={when} backup={backup} t={t} onAdd={onAdd} />
    </div>
  );
  return (
    <div className="row" style={{ gap: 10, padding: '9px 12px 9px 0', borderTop: first ? 0 : '1px solid var(--soft)', borderLeft: `4px solid ${k.color}`, opacity: faded ? 0.72 : 1 }}>
      <button onClick={onOpen} className="row grow" style={{ gap: 10, background: 'none', border: 0, padding: '0 0 0 8px', textAlign: 'left', cursor: 'pointer', minWidth: 0, color: 'inherit' }}>
        <PlacePhoto p={p} size={46} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', font: '400 17px/1.15 var(--serif)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
          <span className="row s" style={{ gap: 5, marginTop: 2, flexWrap: 'nowrap', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span style={{ color: k.color, fontWeight: 600 }}>{k.label}</span>
            {p.walk != null && <span>· {away(p.walk)}</span>}
            {miss && <span style={{ color: '#8A5A14' }}>· {miss}</span>}
            {!miss && hl && <span style={{ color: TONE[hl.tone] }}>· {hl.text}</span>}
            {!miss && !hl && been && <span style={{ color: '#24563F' }}>· been</span>}
            {by && <span>· {by}</span>}
            <Votes list={votes} />
          </span>
        </span>
      </button>
      <RowEnd p={p} it={it} when={when} backup={backup} t={t} onAdd={onAdd} small />
    </div>
  );
}

// The right-hand end of a row: when it's on the plan, that it's a backup, or + to put it there.
function RowEnd({ p, it, when, backup, t, onAdd, small }) {
  if (!t) return null;
  if (!it && backup) return <span className="pill" style={{ flex: 'none', background: '#F6EAD3', color: '#6B4510' }}>{backup.item.day ? `${dayLabel(backup.item.day, { weekday: 'short' })} ${hm(backup.item.start_time)} · ` : ''}{backup.rank}</span>;
  if (it) return <span className="pill" style={{ flex: 'none', ...(it.status === 'booked' ? { background: '#E1F0E8', color: '#24563F' } : when ? { background: '#1E1A16', color: '#F3EEE6' } : { background: '#EDE9E2', color: '#5F574C' }) }}>{it.status === 'booked' ? (when ? `${when} · booked` : 'Booked') : when || 'Idea'}</span>;
  return <button className="icon" aria-label={'Add ' + p.name + ' to the plan'} onClick={onAdd} style={{ width: small ? 34 : 44, height: small ? 34 : 44, flex: 'none' }}><Icon n="plus" size={16} /></button>;
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

// One sheet for a place, opened from Places or from the Plan. From the Plan it leads with the visit
// (when, tickets, cost); from Places with what the place is like and putting it on the plan.
export function PlaceDetail({ p: initial, onClose, tripId, t, me, item: visit }) {
  const fromPlan = !!visit;
  const [pinning, setPinning] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [other, setOther] = useState(null);
  const guide = useCityPlaces(initial.city);
  const [p, setP] = useState(initial);
  const [link, setLink] = useState(initial.link || '');
  const [matches, setMatches] = useState(null);
  const [msg, setMsg] = useState('');
  const [naming, setNaming] = useState(false);
  const [noting, setNoting] = useState(false);
  const here = useLocation();
  const ownsIt = !p.owner || !getMe().id || p.owner === getMe().id;
  // Only the person who added a place can change its details (the server holds to that too).
  const save = (patch) => { const n = { ...p, ...patch }; setP(n); if (ownsIt) upsert('places', { id: p.id, ...patch }); else setMsg('Only the person who added this place can change its details — your rating below is yours to set.'); };
  const ratings = usePlaceRatings(p.id);
  const trip = useStore((s) => Object.values(s.items || {}).find((i) => i.place_id === p.id)?.trip_id);

  async function photoFromSite() {
    if (!link) return;
    setMsg('Looking at the website…');
    try {
      const r = await api('/api/og', { url: link });
      if (r.image) { save({ photo_url: r.image, link }); setMsg('Photo from the venue’s own site.'); }
      else setMsg('That site doesn’t publish a preview image.');
    } catch { setMsg('Couldn’t reach that site.'); }
  }
  async function check(name = p.name) {
    setMsg('Looking it up…');
    setMatches(await findVenue(`${name} ${p.city}`, null, null, { google: true, fillNames: true, name, city: p.city }).catch(() => []));
    setMsg('');
  }
  // A misread name ("Maya" for "Maiya") is often why nothing matches: fix it, then look again.
  const items = useStore((s) => s.items);
  function rename(next) {
    setNaming(false);
    const name = next.trim();
    if (!name || name === p.name) return;
    const old = p.name;
    save({ name });
    // The plan entries made from this place still carry the old spelling: bring them along.
    if (t?.canEdit) Object.values(items || {}).filter((i) => i.place_id === p.id && i.title === old).forEach((i) => upsert('items', { ...i, title: name }));
    if (unfinished(p)) check(name);
  }

  const walk = here && p.lat != null ? walkMin(here, p) : null;
  // From where you are: on foot, or by Métro/RER when it's a long walk and that's quicker.
  const way = useHop(here, p.lat != null ? p : null, { enabled: hasTransit(p.city) });
  const fromYou = way && way.mode === 'walk' ? ` · ${way.walk} min walk from you` : '';
  const hl = hoursLine(p.hours);
  const shut = closedDays(p.hours);
  const facts = [
    hl && ['Now', hl.text, hl.tone === 'open' ? '#2F6B57' : hl.tone === 'closed' ? '#A8472A' : '#8A5A14'],
    (p.price_text || p.price_level) && ['Price', p.price_text || priceSigns(p)],
    p.cuisine && ['Food', p.cuisine],
    shut && ['Closed', shut],
  ].filter(Boolean).slice(0, 3);
  // What it was saved for: the caption or guide text it came with.
  const quote = p.notes && p.source && p.source !== 'manual' ? p.notes.split(/\n\s*\n/)[0].slice(0, 220) : null;
  const share = () => navigator.share?.({ title: p.name, text: [p.name, p.address].filter(Boolean).join(' — '), url: p.link || (p.lat != null ? `https://maps.apple.com/?q=${encodeURIComponent(p.name)}&ll=${p.lat},${p.lng}` : undefined) }).catch(() => {});
  const actions = [
    p.lat != null && ['nav', 'Directions', `https://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=w`],
    p.link && ['globe', 'Website', p.link],
    navigator.share && ['share', 'Share', null],
  ].filter(Boolean);

  return (
    <Sheet onClose={onClose}>
      {/* A photo across the top when there is one; otherwise just the close button, beside the name. */}
      {(p.photo_url || p.photo_path) ? (
        <div style={{ position: 'relative' }}>
          <PlacePhoto p={p} size={undefined} style={{ display: 'block', width: '100%', height: fromPlan ? 150 : 190, borderRadius: 14, objectFit: 'cover' }} />
          <button aria-label="Close" onClick={onClose} style={{ position: 'absolute', top: 8, right: 8, width: 40, height: 40, borderRadius: 20, border: 0, background: 'rgba(250,248,243,.92)', boxShadow: '0 1px 4px rgba(30,26,22,.25)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon n="close" size={16} /></button>
        </div>
      ) : (
        <button aria-label="Close" onClick={onClose} className="icon" style={{ position: 'absolute', top: 14, right: 16, zIndex: 2 }}><Icon n="close" size={16} /></button>
      )}
      <div style={{ paddingRight: p.photo_url || p.photo_path ? 0 : 48 }}>
        <CatTag c={p.category} extra={[p.cuisine, p.source_detail].filter(Boolean).join(' · ')} />
        {naming ? (
          <form className="row" style={{ gap: 8, marginTop: 4 }} onSubmit={(e) => { e.preventDefault(); rename(e.target.elements.name.value); }}>
            <input name="name" className="in grow" defaultValue={p.name} autoFocus aria-label="Name" style={{ fontSize: 18 }} />
            <button className="btn sm">Save</button>
            <button type="button" className="btn sm ghost" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <div className="row" style={{ gap: 8, marginTop: 4, alignItems: 'baseline' }}>
            <h2 className="h2 grow" style={{ margin: 0 }}>{p.name}</h2>
            {ownsIt && <button className="link mute" style={{ fontSize: 13.5 }} onClick={() => setNaming(true)}>Edit name</button>}
          </div>
        )}
        <div className="s" style={{ fontSize: 13.5 }}>{p.address || 'No address yet'}{fromYou}</div>
        {way?.mode === 'transit' && (
          <div className="row" style={{ gap: 6, marginTop: 4, font: '500 13.5px var(--sans)' }}><Icon n="metro" size={15} w={2} />
            <span><b style={{ fontWeight: 600 }}>{way.minutes} min</b> by {linesText(way.lines)} from you<span className="s" style={{ fontSize: 13 }}> · or {way.walk} min walk</span></span>
          </div>
        )}
      </div>

      {fromPlan && <VisitBlock t={t} me={me} item={visit} onEdit={() => setEditItem(visit)} />}

      {actions.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          {actions.map(([icon, label, href]) => href
            ? <a key={label} className="act" href={href} target="_blank" rel="noreferrer"><Icon n={icon} size={18} />{label}</a>
            : <button key={label} className="act" onClick={share}><Icon n={icon} size={18} />{label}</button>)}
        </div>
      )}

      {facts.length > 0 && (
        <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
          {facts.map(([k, v, col]) => (
            <div key={k} className="card" style={{ flex: 1, padding: '9px 10px', minWidth: 0 }}>
              <div className="k mute" style={{ fontSize: 9.5 }}>{k}</div>
              <div style={{ font: '600 14px var(--sans)', marginTop: 3, color: col || 'var(--ink)' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {quote && !noting && (
        <button className="card col" style={{ gap: 6, background: '#FBF6EE', textAlign: 'left', cursor: ownsIt ? 'pointer' : 'default' }} onClick={() => ownsIt && setNoting(true)}>
          <div style={{ font: 'italic 400 18px/1.3 var(--serif)', color: '#3A332C' }}>“{quote}”</div>
          <div className="s">From {SOURCE[p.source] || 'where it was saved'}{p.source_detail ? ` · ${p.source_detail}` : ''}</div>
        </button>
      )}

      {unfinished(p) && (
        <div className="card dashed col">
          <div className="k amber">Unfinished · {missing(p)}</div>
          {ownsIt ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm grow" onClick={() => setPinning(true)}><Icon n="pin" size={16} color="#F3EEE6" />Pin it on the map</button>
              <button className="btn sm ghost grow" onClick={() => check()}>Find it by name</button>
            </div>
          ) : <div className="s">Only the person who added it can finish it.</div>}
          {matches?.map((m, i) => (
            <button key={i} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => { save({ name: m.name, lat: m.lat, lng: m.lng, address: m.address, needs_check: false, category: guessCategory(m.osm_value, m.name), ...(m.google_id ? { google_id: m.google_id } : {}) }); setMatches(null); }}>
              <div className="n">{m.name}</div><div className="s">{m.address}</div>
            </button>
          ))}
          {matches && !matches.length && <div className="s">No match for “{p.name}”. Is the spelling right? <button className="link" onClick={() => setNaming(true)}>Edit the name</button>, or pin it on the map instead.</div>}
        </div>
      )}

      {t && !fromPlan && <AddToPlan t={t} me={me} p={p} onEdit={setEditItem} />}

      {p.lat != null && (() => {
        const near = fromYourList(guide.filter((x) => x.id !== p.id), [], p, { max: 5, maxWalk: 15 });
        return near.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            <div className="k mute">Near it, from your list</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {near.map((x) => (
                <button key={x.id} className="chip" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setOther(x)}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: cat(x.category).color }} />{x.name} · {x.walk} min
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {other && <PlaceDetail p={other} t={t} me={me} tripId={tripId} onClose={() => setOther(null)} />}

      <RatingBlock p={p} ratings={ratings} tripId={tripId || trip} />

      {ownsIt && <FactsEditor p={p} save={save} />}

      <div className="chips">
        {Object.entries(CATS).map(([k, v]) => <button key={k} className={'chip' + (p.category === k ? ' on' : '')} onClick={() => save({ category: k })}>{v.label}</button>)}
      </div>
      {(!quote || noting) && <label className="f">Notes<textarea className="in" autoFocus={noting} defaultValue={p.notes || ''} onBlur={(e) => { save({ notes: e.target.value }); setNoting(false); }} /></label>}
      <label className="f">Website or link
        <div className="row"><input className="in" value={link} onChange={(e) => setLink(e.target.value)} onBlur={() => link !== (p.link || '') && save({ link })} placeholder="https://" />
          <button className="btn sm ghost" onClick={photoFromSite} disabled={!link}>Photo</button></div>
      </label>
      {msg && <div className="s">{msg}</div>}
      {p.lat != null && ownsIt && <button className="link mute" onClick={() => setPinning(true)}>Pin in the wrong spot? Move it</button>}
      {pinning && (
        <Suspense fallback={null}>
          <PinPicker p={p} start={t ? stayFor(t.stays, todayISO()) : null} onClose={() => setPinning(false)}
            onPick={({ lat, lng, address }) => { save({ lat, lng, address: address || p.address || null, needs_check: false }); setPinning(false); setMsg(address ? `Pinned at ${address}.` : 'Pinned. No address found for that spot — add one in the notes if it helps.'); }} />
        </Suspense>
      )}
      {fromPlan && <button className="link mute" onClick={() => setEditItem(visit)}>All details (time, tickets, backups, remove)</button>}
      {editItem && <ItemEditor t={t} me={me} item={editItem} onClose={() => setEditItem(null)} />}
      <AddedBy p={p} />
      {!fromPlan && ownsIt && <button className="link mute" onClick={() => { if (confirm('Delete from your guide?')) { remove('places', p.id); onClose(); } }}>Delete from guide</button>}
    </Sheet>
  );
}

// Cuisine and price, set by tap when nothing captured them (or to correct them).
function FactsEditor({ p, save }) {
  const [open, setOpen] = useState(false);
  if (!['eat', 'drink', 'coffee'].includes(p.category)) return null;
  if (!open) return <button className="link mute" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>{p.cuisine || p.price_level ? 'Change food & price' : 'Add food & price'}</button>;
  return (
    <div className="card col" style={{ gap: 10 }}>
      <label className="f">What kind of food or drink<input className="in" defaultValue={p.cuisine || ''} placeholder="Nepali, natural wine, ramen…" onBlur={(e) => save({ cuisine: e.target.value.trim() || null, facts_src: { ...(p.facts_src || {}), cuisine: 'you' } })} /></label>
      <div className="col" style={{ gap: 6 }}><span className="k mute">Price a head</span>
        <div className="row" style={{ gap: 6 }}>
          {[1, 2, 3, 4].map((n) => <button key={n} className={'chip' + (p.price_level === n ? ' on' : '')} onClick={() => save({ price_level: p.price_level === n ? null : n, facts_src: { ...(p.facts_src || {}), price: 'you' } })}>{'€'.repeat(n)}</button>)}
        </div>
        <div className="s">€ under 15 · €€ 15–35 · €€€ 35–70 · €€€€ more</div>
      </div>
      <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(false)}>Done</button>
    </div>
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

// Thumbs counts, small: "▲ 2  ▼ 1".
export function Votes({ list }) {
  const { up, down } = tally(list);
  if (!up && !down) return null;
  return (
    <span className="row" style={{ gap: 6, font: '600 12px var(--sans)' }}>
      {up > 0 && <span className="row" style={{ gap: 2, color: '#24563F' }}><Icon n="up" size={13} w={2} />{up}</span>}
      {down > 0 && <span className="row" style={{ gap: 2, color: '#A8472A' }}><Icon n="down" size={13} w={2} />{down}</span>}
    </span>
  );
}

// Been here? Then thumbs up or down. Yours to set; everyone else's shown underneath.
function RatingBlock({ p, ratings, tripId }) {
  const mine = mineOf(ratings);
  const members = useStore((s) => s.trip_members);
  const visited = mine ? mine.visited : !!p.visited;
  const vote = mine?.vote || 0;
  const others = ratings.filter((r) => r !== mine && (r.visited || r.vote));
  const name = (e) => nameOf(Object.values(members || {}), e);
  const thumb = (v) => {
    const on = vote === v;
    const col = v > 0 ? '#24563F' : '#A8472A';
    return (
      <button aria-pressed={on} aria-label={v > 0 ? 'Thumbs up' : 'Thumbs down'} onClick={() => rate(p, ratings, { vote: on ? 0 : v }, tripId)}
        style={{ flex: 1, height: 46, borderRadius: 14, cursor: 'pointer', border: '1.5px solid ' + (on ? col : 'var(--line)'), background: on ? (v > 0 ? '#E1F0E8' : '#F7E9E3') : 'var(--card)', color: on ? col : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, font: '600 14px var(--sans)' }}>
        <Icon n={v > 0 ? 'up' : 'down'} size={20} w={on ? 2.2 : 1.7} />{v > 0 ? 'Loved it' : 'Not for us'}
      </button>
    );
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <label className="row" style={{ justifyContent: 'space-between', font: '500 14px var(--sans)' }}>Been here
        <input type="checkbox" checked={visited} onChange={(e) => rate(p, ratings, { visited: e.target.checked }, tripId)} style={{ width: 22, height: 22, accentColor: '#1E1A16' }} />
      </label>
      <div className="row" style={{ gap: 8 }}>{thumb(1)}{thumb(-1)}</div>
      {others.length > 0 && (
        <div className="s">{others.map((r) => `${name(r.email)} ${r.vote > 0 ? 'loved it' : r.vote < 0 ? 'wasn’t keen' : 'has been'}`).join(' · ')}</div>
      )}
    </div>
  );
}
