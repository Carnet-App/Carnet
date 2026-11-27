import { useState } from 'react';
import DayView from './DayView';
import Proposals, { ProposalBanner } from './Proposals';
import ItemEditor from './ItemEditor';
import Ideas from './Ideas';
import { PlanCompact, PlanTrip } from './PlanViews';
import { daysBetween, dayLabel, tripNow } from '../lib/util';

export default function Plan({ t, me, open }) {
  const days = daysBetween(t.trip.start_date, t.trip.end_date);
  const [day, setDay] = useState(days.includes(tripNow().day) ? tripNow().day : days[0]);
  const [add, setAdd] = useState(null);
  const [review, setReview] = useState(false);
  // Three ways to see it: Compact (the whole trip, a line each), Day (the timeline), Trip (a grid).
  // During the trip it opens on the day; before it, on the trip.
  const during = days.includes(tripNow().day);
  const [view, setViewS] = useState(() => { try { return localStorage.getItem('carnet.plan.view') || (during ? 'day' : 'trip'); } catch { return during ? 'day' : 'trip'; } });
  const setView = (v) => { setViewS(v); try { localStorage.setItem('carnet.plan.view', v); } catch {} };
  const toDay = (d) => { setDay(d); setView('day'); };
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
      <div role="tablist" aria-label="Plan view" className="seg" style={{ alignSelf: 'stretch' }}>
        {[['compact', 'Compact'], ['day', 'Day'], ['trip', 'Trip']].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} style={{ flex: 1 }} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {view === 'day' && <div className="hscroll">
        {days.map((d) => (
          <button key={d} onClick={() => setDay(d)} style={{ width: 58, borderRadius: 12, padding: '8px 0', textAlign: 'center', font: '500 11px/1.35 var(--sans)', border: '1px solid ' + (d === day ? 'var(--ink)' : 'var(--line)'), background: d === day ? 'var(--ink)' : 'var(--card)', color: d === day ? '#E9E2D6' : 'var(--mute)', cursor: 'pointer' }}>
            {dayLabel(d, { weekday: 'short' })}<br /><b style={{ color: d === day ? '#fff' : 'var(--ink)', fontSize: 15 }}>{dayLabel(d, { day: 'numeric' })}</b>
          </button>
        ))}
      </div>}
      <ProposalBanner t={t} onOpen={() => setReview(true)} />
      {review && <Proposals t={t} onClose={() => setReview(false)} />}
      {view === 'day' && <DayView t={t} me={me} day={day} />}
      {view === 'compact' && <PlanCompact t={t} me={me} days={days} onDay={toDay} />}
      {view === 'trip' && <PlanTrip t={t} days={days} onDay={toDay} />}
      {view === 'day' && unscheduled.length > 0 && <Ideas t={t} ideas={unscheduled} day={day} onOpen={(it, overrides) => setAdd({ item: it, overrides })} />}
      {add && <ItemEditor t={t} me={me} item={add.item} preset={add.preset} overrides={add.overrides} onClose={() => setAdd(null)} />}
    </div>
  );
}
