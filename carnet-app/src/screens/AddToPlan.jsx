import { useState } from 'react';
import { upsert, uid } from '../lib/store';
import { daysBetween, dayLabel, hm, tripNow } from '../lib/util';
import { needsApproval, propose, announce } from '../lib/proposals';
import { PARTS, freeSlot, partSummary, lengthFor, busyOn } from '../lib/slots';
import { FOOD_DRINK, withAlt, backupIndex, altsOf, rankLabel } from '../lib/alts';

// Put a place on the trip from the place itself: a day, a part of the day (or an exact time),
// with a look at what's already there. Once it's on, a single line says when, with Change.
export default function AddToPlan({ t, me, p, onEdit, compact, onDone }) {
  const item = (t.items || []).find((i) => i.place_id === p.id);
  const days = daysBetween(t.trip.start_date, t.trip.end_date);
  const today = tripNow().day;
  const [day, setDay] = useState(() => item?.day || days.find((d) => d >= today) || days[0] || null);
  const [part, setPart] = useState(p.category === 'coffee' ? 'morning' : ['drink', 'dance'].includes(p.category) ? 'evening' : 'afternoon');
  const [exact, setExact] = useState('');
  const [done, setDone] = useState('');
  const mins = lengthFor(p.category);

  const backup = backupIndex(t.items).get(p.id);
  if (backup && !item && !done) {
    return (
      <div className="row" style={{ background: '#F6EAD3', color: '#6B4510', borderRadius: 12, padding: '10px 12px', gap: 8, font: '500 14px var(--sans)' }}>
        <span className="grow">{backup.rank} choice for {backup.item.title}{backup.item.day ? ` · ${dayLabel(backup.item.day)}${backup.item.start_time ? ' ' + hm(backup.item.start_time) : ''}` : ''}</span>
        {onEdit && <button className="link" style={{ color: '#6B4510' }} onClick={() => onEdit(backup.item)}>Open</button>}
      </div>
    );
  }
  if (item?.day && !done) {
    return (
      <div className="row" style={{ background: '#E1F0E8', color: '#24563F', borderRadius: 12, padding: '10px 12px', gap: 8, font: '500 14px var(--sans)' }}>
        <span className="grow">On the plan · {dayLabel(item.day)}{item.start_time ? ` · ${hm(item.start_time)}` : ''}{item.status === 'booked' ? ' · booked' : ''}</span>
        {onEdit && <button className="link" style={{ color: '#24563F' }} onClick={() => onEdit(item)}>Change</button>}
      </div>
    );
  }
  if (done) return <div className="row" style={{ background: '#E1F0E8', color: '#24563F', borderRadius: 12, padding: '10px 12px', font: '500 14px var(--sans)' }}>{done}</div>;

  const slot = day ? freeSlot(t.items || [], day, part, mins, item?.id) : null;
  const time = exact || slot?.time || null;
  const end = time ? (() => { const [h, m] = time.split(':').map(Number); const e = h * 60 + m + mins; return `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`; })() : null;

  // Food and drink can be a backup for what's already there in that part of the day.
  const partDef = PARTS.find((x) => x.key === part);
  const rivals = FOOD_DRINK.has(p.category) && day ? busyOn(t.items || [], day)
    .filter((b) => (exact ? true : b.start < partDef.to && b.end > partDef.from) && b.id !== item?.id)
    .map((b) => (t.items || []).find((i) => i.id === b.id))
    .filter((i) => i && FOOD_DRINK.has(i.category) && i.place_id !== p.id && altsOf(i).length < 5) : [];

  function asBackup(main) {
    const patch = withAlt(main, p, me);
    if (!patch) { setDone(`Already a choice for ${main.title}`); return; }
    const row = { ...main, ...patch };
    if (needsApproval(t, main, row)) { propose(t, 'change', main, row); setDone('Sent to the trip admins to approve'); }
    else { upsert('items', row); setDone(`${rankLabel(altsOf(row).length - 1)} choice for ${main.title} · ${dayLabel(main.day)} ${hm(main.start_time)}`); }
    onDone?.();
  }

  function add(asIdea) {
    const id = item?.id || uid();
    const row = {
      ...(item || {}), id, trip_id: t.trip.id, place_id: p.id, title: item?.title || p.name, category: item?.category || p.category,
      lat: p.lat ?? null, lng: p.lng ?? null, address: p.address || null, visibility: item?.visibility || 'shared',
      day: asIdea ? null : day, start_time: asIdea ? null : time, end_time: asIdea ? null : end,
      status: asIdea ? 'idea' : item?.status && item.status !== 'idea' ? item.status : 'planned',
    };
    if (needsApproval(t, item || null, row)) {
      propose(t, item ? 'change' : 'add', item || null, row);
      setDone('Sent to the trip admins to approve');
    } else {
      upsert('items', row);
      announce(t, item || null, row);
      setDone(asIdea ? 'Added to the plan as an idea' : `On the plan · ${dayLabel(day)} · ${time}`);
    }
    onDone?.();
  }

  return (
    <div className="col" style={{ gap: 8, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: 12 }}>
      <div className="k mute">{item ? 'An idea on the plan · give it a day' : 'Add to the plan'}</div>
      {days.length > 0 ? (
        <>
          <div className="row" style={{ gap: 6, overflowX: 'auto' }}>
            {days.map((d) => {
              const [w, n] = [new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' }), +d.slice(8)];
              return (
                <button key={d} onClick={() => setDay(d)} aria-pressed={day === d}
                  style={{ flex: '1 0 48px', padding: '7px 0', borderRadius: 12, cursor: 'pointer', font: '500 12px/1.25 var(--sans)', border: '1px solid ' + (day === d ? 'var(--ink)' : 'var(--line)'), background: day === d ? 'var(--ink)' : 'var(--card)', color: day === d ? '#F3EEE6' : 'var(--ink)' }}>
                  {w}<br /><span style={{ fontSize: 15 }}>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {PARTS.map((x) => <button key={x.key} className={'chip' + (part === x.key && !exact ? ' on' : '')} style={{ fontSize: 12.5 }} onClick={() => { setPart(x.key); setExact(''); }}>{x.label}</button>)}
            <label className={'chip' + (exact ? ' on' : '')} style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4, position: 'relative' }}>
              {exact ? exact : 'Pick a time'}
              <input type="time" value={exact} onChange={(e) => setExact(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} aria-label="Pick a time" />
            </label>
          </div>
          {!compact && day && !exact && <div className="s">{dayLabel(day)} {PARTS.find((x) => x.key === part).label.toLowerCase()}: {partSummary(t.items || [], day, part)}{slot && !slot.fits ? ` — that’s full, so the first free time is ${slot.time}` : ''}</div>}
          {rivals.length > 0 && (
            <div className="col" style={{ gap: 6, background: '#F6EAD3', borderRadius: 12, padding: '8px 10px' }}>
              <div className="s" style={{ color: '#6B4510' }}>{slot && !slot.fits ? 'No room for another stop — keep it as a backup instead:' : 'Or keep it as a backup, in case:'}</div>
              {rivals.map((r) => (
                <button key={r.id} className="chip" style={{ textAlign: 'left', justifyContent: 'flex-start', background: '#FAF8F3' }} onClick={() => asBackup(r)}>
                  {rankLabel(altsOf(r).length)} choice for {r.title} · {hm(r.start_time)}
                </button>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn grow" disabled={!day || !time} onClick={() => add(false)}>Add · {day ? `${dayLabel(day, { weekday: 'short' })} ${time || ''}` : ''}</button>
            {!item && <button className="btn ghost" onClick={() => add(true)}>Just an idea</button>}
          </div>
        </>
      ) : (
        <>
          <div className="s">The trip has no dates yet, so it can only go on as an idea.</div>
          {!item && <button className="btn ghost block" onClick={() => add(true)}>Add as an idea</button>}
        </>
      )}
    </div>
  );
}
