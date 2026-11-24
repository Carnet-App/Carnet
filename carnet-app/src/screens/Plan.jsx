import { useState } from 'react';
import DayView from './DayView';
import Proposals, { ProposalBanner } from './Proposals';
import ItemEditor from './ItemEditor';
import { CatTag, StatusPill } from '../ui';
import { daysBetween, dayLabel, todayISO } from '../lib/util';

export default function Plan({ t, me, open }) {
  const days = daysBetween(t.trip.start_date, t.trip.end_date);
  const [day, setDay] = useState(days.includes(todayISO()) ? todayISO() : days[0]);
  const [add, setAdd] = useState(null);
  const [review, setReview] = useState(false);
  const unscheduled = t.items.filter((i) => !i.day);

  return (
    <div className="page">
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="k amber">{t.trip.name} · {dayLabel(days[0], { day: 'numeric', month: 'short' })}–{dayLabel(days[days.length - 1], { day: 'numeric', month: 'short' })}</div>
          <h1 className="h1">Plan</h1>
        </div>
        <button className="btn sm" onClick={() => setAdd({ preset: { day } })}>+ Add</button>
      </div>
      <div className="hscroll">
        {days.map((d) => (
          <button key={d} onClick={() => setDay(d)} style={{ width: 58, borderRadius: 12, padding: '8px 0', textAlign: 'center', font: '500 11px/1.35 var(--sans)', border: '1px solid ' + (d === day ? 'var(--ink)' : 'var(--line)'), background: d === day ? 'var(--ink)' : 'var(--card)', color: d === day ? '#E9E2D6' : 'var(--mute)', cursor: 'pointer' }}>
            {dayLabel(d, { weekday: 'short' })}<br /><b style={{ color: d === day ? '#fff' : 'var(--ink)', fontSize: 15 }}>{dayLabel(d, { day: 'numeric' })}</b>
          </button>
        ))}
      </div>
      <ProposalBanner t={t} onOpen={() => setReview(true)} />
      {review && <Proposals t={t} onClose={() => setReview(false)} />}
      <DayView t={t} me={me} day={day} />
      {unscheduled.length > 0 && (
        <>
          <div className="k mute" style={{ marginTop: 10 }}>Ideas with no day yet</div>
          {unscheduled.map((it) => (
            <button key={it.id} className="card between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setAdd({ item: it })}>
              <span><CatTag c={it.category} /><div className="n">{it.title}</div></span><StatusPill s={it.status} />
            </button>
          ))}
        </>
      )}
      {add && <ItemEditor t={t} me={me} item={add.item} preset={add.preset} onClose={() => setAdd(null)} />}
    </div>
  );
}
