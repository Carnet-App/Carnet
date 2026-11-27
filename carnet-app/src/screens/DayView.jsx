import { useEffect, useState } from 'react';
import { kindFor, kindForDay, kindWords, fetchNearby, fresh, dismiss, catOf, fromYourList } from '../lib/nearby';
import { lengthFor } from '../lib/slots';
import { upsert, uid } from '../lib/store';
import { getMe } from '../lib/me';
import { walkMin } from '../lib/util';
import { altsOf, rankLabel } from '../lib/alts';
import { Icon, CatTag, Sheet } from '../ui';
import { buildDay } from '../lib/schedule';
import { cat, hm, fromMin, dur, stayFor, tripNow, nameOf, dayLabel } from '../lib/util';
import { span } from '../lib/schedule';
import ItemEditor from './ItemEditor';
import { PlaceDetail } from './Places';
import { VisitSheet } from './VisitBlock';

// A plan, opened: the same sheet as in Places, leading with this visit; a plan that isn't a place
// (a train, "Pack") gets just the visit.
export function ItemSheet({ t, me, item, onClose }) {
  const it = t.items.find((i) => i.id === item.id) || item;
  const place = it.place_id ? t.places.find((p) => p.id === it.place_id) : null;
  return place
    ? <PlaceDetail p={place} item={it} t={t} me={me} tripId={t.trip.id} onClose={onClose} />
    : <VisitSheet t={t} me={me} item={it} onClose={onClose} />;
}

export default function DayView({ t, me, day, pos }) {
  const [edit, setEdit] = useState(null);
  const [slot, setSlot] = useState(null);
  const [open, setOpen] = useState(null);
  const home = stayFor(t.stays, day);
  const now = tripNow();
  const { rows, loose } = buildDay({ items: t.items, day, home: (day === now.day && pos) || home, now, places: t.places });
  // What each free slot is for, knowing the rest of the day (lunch after a coffee, not more brunch).
  const dayItems = t.items.filter((i) => i.day === day);
  const kindAt = (r) => kindForDay(r.from, dayItems, r.prev?.category);

  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map((r, i) => {
        if (r.kind === 'travel')
          return (
            <div key={i} className="tr"><Icon n="walk" size={12} w={2} />{r.minutes} min walk</div>
          );
        if (r.kind === 'gap') {
          const k = kindAt(r);
          return (
            <div key={i} className="tl">
              <div className="tm">{fromMin(r.from)}</div>
              <div className="it" role="button" tabIndex={0} onClick={() => setSlot(r)} style={{ background: 'transparent', border: '1.5px dashed #C9A96E', cursor: 'pointer', minWidth: 0, overflow: 'hidden' }}>
                <div className="between"><div className="k amber">{r.open ? 'Free from here' : `Free · ${dur(r.minutes)}`}</div><span className="s" style={{ color: '#8A5A14', fontWeight: 600 }}>Fill it ›</span></div>
                {(() => { const mine = r.near ? fromYourList(t.places, t.items, r.near, { kind: k, max: 3, maxWalk: 20, foodOnly: false }) : []; r.ideas = mine.length ? mine : r.ideas; return null; })()}
                {r.ideas.length ? (
                  <div className="col" style={{ gap: 6, marginTop: 4 }}>
                    {r.ideas.map((p) => (
                      <button key={p.id} className="between" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
                        onClick={(e) => e.stopPropagation() || setEdit({ preset: { title: p.name, place_id: p.id, lat: p.lat, lng: p.lng, address: p.address, category: p.category, day, start_time: fromMin(r.from + (p.walk || 0)) } })}>
                        <span style={{ minWidth: 0 }}><span className="n" style={{ fontSize: 15 }}>{p.name}</span> <span className="s">· <span style={{ color: cat(p.category).color, fontWeight: 600 }}>{cat(p.category).label}</span>{p.walk != null ? ` · ${p.walk} min` : ''}</span></span>
                        <Icon n="plus" size={16} />
                      </button>
                    ))}
                  </div>
                ) : null}
                {r.minutes >= 60 && r.near && day >= now.day && k && (
                  <div onClick={(e) => e.stopPropagation()}><Nearby near={r.near} kind={k} words={kindWords(k, r.from)} guide={t.places} few={r.ideas.length === 0}
                    onAdd={(s) => setEdit({ preset: { title: s.name, lat: s.lat, lng: s.lng, address: s.address, category: catOf(s), day, start_time: fromMin(r.from + (walkMin(r.near, s) || 0)) } })}
                    onSave={(s) => upsert('places', { id: uid(), owner: getMe().id, city: t.trip.city, name: s.name, lat: s.lat, lng: s.lng, address: s.address, category: catOf(s), source: 'osm', source_detail: 'suggested nearby', link: s.website || null, notes: [s.cuisine, s.hours].filter(Boolean).join(' · ') || null })} /></div>
                )}
                {!r.ideas.length && !(r.minutes >= 60 && r.near && day >= now.day && k) && <div className="s">{r.near ? 'Tap to see what’s near your plans.' : 'Tap to see ideas. Give the plans around it a place on the map and suggestions will be nearby.'}</div>}
              </div>
            </div>
          );
        }
        const it = r.item;
        const busyOther = it.visibility === 'busy' && !it.mine_private;
        const c = cat(it.category);
        const st = busyOther ? { background: '#EDE9E2', borderColor: '#DCD5CA' } : it.visibility !== 'shared' ? { background: '#EDE9E2', borderColor: '#DCD5CA' } : { background: c.bg, borderColor: c.bg };
        return (
          <div key={(r.fromYesterday ? 'y' : '') + it.id} className="col" style={{ gap: 4 }}>
            <div className="tl">
            <div className="tm">{r.fromYesterday ? '00:00' : hm(it.start_time)}</div>
            <button className="it" style={st} onClick={() => !busyOther && setOpen(it)} disabled={busyOther}>
              {busyOther ? (
                <><div className="k mute">Busy</div><div className="n">{nameOf(t.members, it.created_by_email)} has something on</div></>
              ) : (
                <>
                  <CatTag c={it.category} extra={[it.status === 'booked' && 'booked', it.status === 'idea' && 'idea', it.visibility === 'busy' && 'crew sees “busy”', it.visibility === 'hidden' && 'only you'].filter(Boolean).join(' · ')} />
                  <div className="n" style={{ color: 'var(--ink)' }}>{it.title}</div>
                  {altsOf(it).length > 0 && <div className="s" style={{ marginTop: 2 }}>Or {altsOf(it).map((a, i) => `${rankLabel(i)}: ${a.title}`).join(' · ')}</div>}
                  {(it.end_time || it.address || r.fromYesterday) && <div className="s">{r.fromYesterday ? `from ${dayLabel(it.day, { weekday: 'short' })} ${hm(it.start_time)} · ` : ''}{it.end_time ? `until ${hm(it.end_time)}${!r.fromYesterday && span(it).overnight ? ' (next day)' : ''}` : ''}{it.end_time && it.address ? ' · ' : ''}{it.address || ''}</div>}
                </>
              )}
            </button>
            </div>
            {!busyOther && !r.fromYesterday && rows[i + 1]?.kind !== 'gap' && rows[i + 2]?.kind !== 'gap' && <NearThis t={t} it={it} day={day} today={now.day} onPick={(p, at) => setEdit({ preset: { title: p.name, place_id: p.id, lat: p.lat, lng: p.lng, address: p.address, category: p.category, day, start_time: at } })} />}
          </div>
        );
      })}
      {t.proposals.filter((p) => p.status === 'pending' && p.kind !== 'remove' && (p.payload?.day || p.before?.day) === day).map((p) => {
        const a = { ...(p.before || {}), ...(p.payload || {}) };
        return (
          <div key={p.id} className="tl">
            <div className="tm">{hm(a.start_time)}</div>
            <div className="it" style={{ background: 'transparent', border: '1.5px dashed #C9A96E', cursor: 'default', minWidth: 0, overflow: 'hidden' }}>
              <div className="k amber">{nameOf(t.members, p.proposed_by_email)} proposes{p.kind === 'change' ? ' a change' : ''} · waiting</div>
              <div className="n" style={{ color: 'var(--mute)' }}>{a.title}</div>
            </div>
          </div>
        );
      })}
      {loose.length > 0 && (
        <>
          <div className="k mute" style={{ marginTop: 8 }}>Sometime this day</div>
          {loose.map((it) => (
            <button key={it.id} className="card between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(it)}>
              <span><CatTag c={it.category} /><div className="n">{it.title}</div></span><Icon n="pen" size={16} />
            </button>
          ))}
        </>
      )}
      {!rows.some((r) => r.kind === 'item') && !loose.length && <div className="empty">Nothing planned yet — tap + to add something.</div>}
      {slot && <FreeSlot t={t} day={day} r={slot} onClose={() => setSlot(null)}
        onAdd={(p, at) => { setSlot(null); setEdit({ preset: { title: p.name, place_id: p.id && !p.osm ? p.id : undefined, lat: p.lat, lng: p.lng, address: p.address, category: p.category || catOf(p), day, start_time: at } }); }} />}
      {edit && <ItemEditor t={t} me={me} item={edit.item} preset={edit.preset} onClose={() => setEdit(null)} />}
      {open && <ItemSheet t={t} me={me} item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Places nearby that aren't in your guide yet, for this free time: a few, best-described first.
// Save one to the guide, put it on the plan here, or wave it away.
function Nearby({ near, kind, words, guide, few, onAdd, onSave }) {
  const [list, setList] = useState(null);
  const [gone, setGone] = useState(0);
  const [saved, setSaved] = useState({});
  const [open, setOpen] = useState(few);
  useEffect(() => {
    if (!open || !navigator.onLine) return;
    let on = true;
    fetchNearby(near, kind).then((l) => on && setList(l));
    return () => { on = false; };
  }, [open, near.lat, near.lng, kind]);
  if (!open) return <button className="link" style={{ alignSelf: 'flex-start', marginTop: 6, fontSize: 13 }} onClick={() => setOpen(true)}>{words} nearby?</button>;
  if (!navigator.onLine) return null;
  const shown = list ? fresh(list, guide).slice(0, 3) : [];
  if (list && !shown.length) return null;
  return (
    <div className="col" style={{ gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px dashed #E3D3B4' }} data-gone={gone}>
      <div className="s" style={{ fontWeight: 600, color: '#8A5A14' }}>{words} nearby · not in your guide</div>
      {!list && <div className="s">Looking around…</div>}
      {shown.map((s) => (
        <div key={s.osm} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="n" style={{ fontSize: 15 }}>{s.name}</div>
            <div className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[s.cuisine, `${walkMin(near, s)} min`, s.website && 'has a website'].filter(Boolean).join(' · ')}</div>
          </div>
          {saved[s.osm] ? <span className="s" style={{ color: '#24563F', alignSelf: 'center' }}>Saved</span> : (
            <button className="chip" style={{ fontSize: 12, padding: '4px 9px' }} onClick={() => { onSave(s); setSaved({ ...saved, [s.osm]: 1 }); }}>Save</button>
          )}
          <button className="icon" aria-label={'Add ' + s.name + ' to the plan here'} style={{ width: 30, height: 30 }} onClick={() => onAdd(s)}><Icon n="plus" size={14} /></button>
          <button className="icon" aria-label={'Not for me: ' + s.name} style={{ width: 30, height: 30 }} onClick={() => { dismiss(s.osm); setGone(gone + 1); }}><Icon n="close" size={13} /></button>
        </div>
      ))}
      {shown.length > 0 && <div className="s" style={{ fontSize: 11.5 }}>From OpenStreetMap — no ratings, so worth a look first.</div>}
    </div>
  );
}

// Under a sight on the plan: places from your own list a short walk away, for what suits the
// time it ends (lunch after a morning museum, a drink after a show). Tap to put one straight after.
const SIGHTS = new Set(['culture', 'explore', 'dance', 'other']);
function NearThis({ t, it, day, today, onPick }) {
  if (!SIGHTS.has(it.category) || it.lat == null || day < today) return null;
  const end = span(it).end;
  const list = fromYourList(t.places, t.items, it, { kind: kindForDay(end, t.items.filter((i) => i.day === day), it.category), max: 3, maxWalk: 15 });
  if (!list.length) return null;
  return (
    <div className="row" style={{ marginLeft: 56, gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="s" style={{ fontSize: 12 }}>Near this, from your list:</span>
      {list.map((p) => (
        <button key={p.id} className="chip" style={{ fontSize: 12, padding: '4px 9px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={() => onPick(p, fromMin(Math.min(end + p.walk, 23 * 60 + 45)))}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: cat(p.category).color }} />{p.name} · {p.walk} min
        </button>
      ))}
    </div>
  );
}

// Tapping free time: what's near the plans either side of it — your own list first, for what suits
// the time, then (if you want more) places nearby that aren't in your guide yet.
function FreeSlot({ t, day, r, onClose, onAdd }) {
  const [kind, setKind] = useState(kindForDay(r.from, t.items.filter((i) => i.day === day), r.prev?.category) || 'any');
  const [more, setMore] = useState(false);
  const [osm, setOsm] = useState(null);
  const [saved, setSaved] = useState({});
  const end = r.open ? null : r.to;
  const anchors = [r.after, r.before].filter((a) => a && a.lat != null).filter((a, i, all) => all.findIndex((b) => b.name === a.name) === i);
  // Start: near what comes next, early enough to finish and walk over in time; otherwise when the
  // slot opens plus the walk there from wherever you'll be. To 5 minutes.
  const at = (p, a) => {
    const len = lengthFor(p.category || catOf(p));
    if (a && a === r.after && end != null) {
      const t0 = Math.floor((end - len - (walkMin(p, r.after) || 0)) / 5) * 5;
      if (t0 >= r.from) return fromMin(t0);
    }
    return fromMin(Math.ceil((r.from + Math.min(walkMin(r.before || r.after, p) || 0, 30)) / 5) * 5);
  };
  const shown = new Set();
  const sections = anchors.map((a) => {
    const list = fromYourList(t.places, t.items, a, { kind: kind === 'any' ? null : kind, max: 6, maxWalk: 20, foodOnly: kind !== 'any' })
      .filter((p) => (kind === 'any' || p.category === kind) && !shown.has(p.id));
    list.forEach((p) => shown.add(p.id));
    return { a, list };
  });
  const near = anchors[0];
  useEffect(() => {
    if (!more || !near || kind === 'any') return;
    let on = true;
    setOsm(null);
    fetchNearby(near, kind).then((l) => on && setOsm(fresh(l, t.places).slice(0, 6)));
    return () => { on = false; };
  }, [more, kind, near?.lat]);
  return (
    <Sheet title={`Free ${fromMin(r.from)}${end != null ? `–${fromMin(end)}` : ' onwards'}`} onClose={onClose}>
      <div className="row" style={{ gap: 6 }}>
        {[['eat', 'Eat'], ['drink', 'Drink'], ['coffee', 'Coffee'], ['any', 'Anything']].map(([k, l]) => (
          <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      {!anchors.length && <div className="s">Nothing on the plan around this time has a place on the map yet, so there's nothing to look near.</div>}
      {sections.map(({ a, list }) => (
        <div key={a.name} className="col" style={{ gap: 6 }}>
          <div className="k mute">Near {a.name} · from your list</div>
          {list.length ? (
            <div className="card" style={{ padding: 0 }}>
              {list.map((p, i) => (
                <button key={p.id} className="row" onClick={() => onAdd(p, at(p, a))} style={{ width: '100%', gap: 10, padding: '10px 12px', background: 'none', border: 0, borderTop: i ? '1px solid var(--line)' : 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                  <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: cat(p.category).color }} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="n" style={{ fontSize: 16, display: 'block' }}>{p.name}</span>
                    <span className="s"><span style={{ color: cat(p.category).color, fontWeight: 600 }}>{cat(p.category).label}</span> · {p.walk} min walk</span>
                  </span>
                  <span className="s" style={{ fontWeight: 600 }}>Add {at(p, a)}</span>
                </button>
              ))}
            </div>
          ) : <div className="s">Nothing {kind === 'any' ? '' : `for ${kind === 'eat' ? 'food' : kind === 'drink' ? 'a drink' : 'coffee'} `}from your list within 20 minutes.</div>}
        </div>
      ))}
      {near && kind !== 'any' && (!more ? (
        <button className="btn ghost block" onClick={() => setMore(true)}>More nearby, not in your guide</button>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          <div className="k mute">Near {near.name} · not in your guide · OpenStreetMap</div>
          {!osm && <div className="s">Looking around…</div>}
          {osm && !osm.length && <div className="s">Nothing more found nearby.</div>}
          {osm?.map((s) => (
            <div key={s.osm} className="row" style={{ gap: 8 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="n" style={{ fontSize: 15 }}>{s.name}</div>
                <div className="s">{[s.cuisine, `${walkMin(near, s)} min`].filter(Boolean).join(' · ')}</div>
              </div>
              {saved[s.osm] ? <span className="s" style={{ color: '#24563F' }}>Saved</span> : (
                <button className="chip" style={{ fontSize: 12 }} onClick={() => { upsert('places', { id: uid(), owner: getMe().id, city: t.trip.city, name: s.name, lat: s.lat, lng: s.lng, address: s.address, category: catOf(s), source: 'osm', source_detail: 'suggested nearby', link: s.website || null, notes: [s.cuisine, s.hours].filter(Boolean).join(' · ') || null }); setSaved({ ...saved, [s.osm]: 1 }); }}>Save</button>
              )}
              <button className="chip" style={{ fontSize: 12 }} onClick={() => onAdd({ ...s, id: null, category: catOf(s) }, at({ ...s, category: catOf(s) }, near))}>Add</button>
            </div>
          ))}
        </div>
      ))}
    </Sheet>
  );
}
