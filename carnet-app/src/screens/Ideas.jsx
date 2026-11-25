import { useEffect, useMemo, useState } from 'react';
import { fileUrl } from '../lib/files';
import { Seg } from '../ui';
import { PlacePhoto } from './Places';
import { cat, areaOf, slotOf, SLOTS, walkMin, distM, stayFor, useLocation, dayLabel, nameOf } from '../lib/util';

const SORTS = [['when', 'Time of day'], ['near', 'Nearest'], ['area', 'Area']];
const saved = () => { try { return localStorage.getItem('carnet.ideasSort') || 'when'; } catch { return 'when'; } };

// Loose ideas for the trip, made browsable: grouped by when in the day they suit,
// by how close they are, or by area. Each row has its picture and a quick "put it on <day>".
export default function Ideas({ t, ideas, day, onOpen }) {
  const [sort, setSortState] = useState(saved);
  const setSort = (v) => { setSortState(v); try { localStorage.setItem('carnet.ideasSort', v); } catch {} };
  const here = useLocation();
  const stay = stayFor(t.stays, day);
  // Distances from where you are, if you're in the city; otherwise from where you're staying.
  const nearStay = here && (!stay || distM(here, stay) < 30000);
  const from = nearStay ? here : stay;
  const fromLabel = nearStay ? 'from you' : stay?.name && stay.name.length <= 20 ? `from ${stay.name}` : 'from your stay';
  const placeOf = useMemo(() => new Map(t.places.map((p) => [p.id, p])), [t.places]);

  const rows = useMemo(() => ideas.map((it) => {
    const p = it.place_id ? placeOf.get(it.place_id) : null;
    const loc = it.lat != null ? it : p;
    return { it, p, walk: from ? walkMin(from, loc) : null, area: areaOf(it.address || p?.address, t.trip.city), slot: slotOf(it) };
  }), [ideas, placeOf, from?.lat, from?.lng, t.trip.city]);

  const byWalk = (a, b) => (a.walk ?? 1e9) - (b.walk ?? 1e9) || a.it.title.localeCompare(b.it.title);
  let groups;
  if (sort === 'near') groups = [{ key: 'all', label: from ? `Walking time ${fromLabel}` : 'Nearest (no location yet)', rows: [...rows].sort(byWalk) }];
  else if (sort === 'area') {
    const m = new Map();
    rows.forEach((r) => { const k = r.area || 'Area not known'; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    groups = [...m.entries()]
      .map(([k, rs]) => ({ key: k, label: k, rows: rs.sort(byWalk), min: Math.min(...rs.map((r) => r.walk ?? 1e9)) }))
      .sort((a, b) => (a.key === 'Area not known') - (b.key === 'Area not known') || b.rows.length - a.rows.length || a.min - b.min);
  } else groups = SLOTS.map((s) => ({ key: s.key, label: s.label, hint: s.hint, rows: rows.filter((r) => r.slot === s.key).sort(byWalk) })).filter((g) => g.rows.length);

  return (
    <div className="col" style={{ gap: 8, marginTop: 10 }}>
      <div className="between">
        <div className="k mute">Ideas with no day yet · {ideas.length}</div>
      </div>
      <Seg value={sort} options={SORTS} onChange={setSort} label="Sort ideas" />
      {groups.map((g) => (
        <div key={g.key} className="col" style={{ gap: 4 }}>
          {groups.length > 1 || sort !== 'near' ? (
            <div className="between" style={{ marginTop: 6 }}>
              <span style={{ font: '500 17px/1.2 var(--serif)' }}>{g.label}{g.hint && <span className="s"> · {g.hint}</span>}</span>
              <span className="s">{g.rows.length}</span>
            </div>
          ) : <div className="s">{g.label}</div>}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {g.rows.map((r, i) => <Row key={r.it.id} r={r} first={!i} day={day} sort={sort} onOpen={onOpen} t={t} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ r, first, day, sort, onOpen, t }) {
  const { it, p, walk, area } = r;
  const c = cat(it.category);
  const by = it.created_by_email && t.me && it.created_by_email.toLowerCase() !== t.me ? nameOf(t.members, it.created_by_email) : null;
  const meta = [c.label, sort !== 'area' && area, walk != null && (walk > 45 ? `${(walk * 80 / 1300).toFixed(1)} km away` : `${walk} min walk`), by && `from ${by}`].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderTop: first ? 0 : '1px solid var(--line)' }}>
      <button onClick={() => onOpen(it)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
        {p && (p.photo_url || p.photo_path) ? <PlacePhoto p={p} size={44} /> : it.photos?.[0]?.path ? <OwnPhoto path={it.photos[0].path} /> : p ? <PlacePhoto p={p} size={44} /> : <span className="thumb" style={{ width: 44, height: 44, background: c.bg, color: c.color, display: 'grid', placeItems: 'center', font: '500 18px var(--serif)' }}>{(it.title || '?').trim()[0]}</span>}
        <span style={{ minWidth: 0 }}>
          <div style={{ font: '500 17px/1.2 var(--serif)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
          <div className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: c.color, fontWeight: 600 }}>{meta.split(' · ')[0]}</span>{meta.includes(' · ') ? ' · ' + meta.split(' · ').slice(1).join(' · ') : ''}</div>
        </span>
      </button>
      <button className="pill" onClick={() => onOpen(it, { day, status: it.status === 'idea' ? 'planned' : it.status })} style={{ border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', cursor: 'pointer', whiteSpace: 'nowrap' }} aria-label={`Put ${it.title} on ${dayLabel(day)}`}>
        + {dayLabel(day, { weekday: 'short' })}
      </button>
    </div>
  );
}

function OwnPhoto({ path }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { let on = true; fileUrl(path).then((u) => on && setSrc(u)).catch(() => {}); return () => { on = false; }; }, [path]);
  return <span className="thumb" style={{ width: 44, height: 44, background: '#E8E1D6', display: 'block', overflow: 'hidden' }}>{src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</span>;
}
