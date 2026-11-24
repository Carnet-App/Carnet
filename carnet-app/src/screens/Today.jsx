import { useEffect, useState } from 'react';
import { Icon, Avatar } from '../ui';
import DayView from './DayView';
import Proposals, { ProposalBanner } from './Proposals';
import { dayLabel, daysBetween, todayISO, useLocation, stayFor, walkMin, toMin, hm, api, distM } from '../lib/util';

function useTransit(from, to, enabled) {
  const [r, setR] = useState(null);
  const key = from && to ? `${from.lat.toFixed(3)},${from.lng.toFixed(3)}>${to.lat.toFixed(3)},${to.lng.toFixed(3)}` : null;
  useEffect(() => {
    setR(null);
    if (!key || !enabled || !navigator.onLine) return;
    api('/api/transit', { from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` }, true).then(setR).catch(() => {});
  }, [key, enabled]);
  return r;
}

export default function Today({ t, me, open }) {
  const [review, setReview] = useState(false);
  const { trip, members, stays, items } = t;
  const days = daysBetween(trip.start_date, trip.end_date);
  const today = todayISO();
  const day = days.includes(today) ? today : today < days[0] ? days[0] : days[days.length - 1];
  const idx = days.indexOf(day) + 1;
  const pos = useLocation();
  const home = stayFor(stays, day);
  const isParis = /paris/i.test(trip.city);
  const homeWalk = walkMin(pos, home);
  const nearHome = pos && home && distM(pos, home) < 120;
  const homeTransit = useTransit(pos, home, isParis && homeWalk > 15);

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const next = items
    .filter((i) => i.day === today && i.start_time && toMin(i.start_time) > nowMin && i.lat != null && (i.visibility !== 'busy' || i.mine_private))
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  const nextWalk = next && walkMin(pos || home, next);
  const nextTransit = useTransit(pos || home, next, isParis && nextWalk > 15);
  const nextMins = nextTransit?.minutes && nextTransit.minutes < nextWalk ? nextTransit.minutes : nextWalk;
  const leaveBy = next && nextMins != null ? toMin(next.start_time) - nextMins - 3 : null;
  const lb = leaveBy != null ? `${String(Math.floor(leaveBy / 60)).padStart(2, '0')}:${String(leaveBy % 60).padStart(2, '0')}` : null;

  return (
    <div className="page">
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="k amber">{trip.name} · Day {idx} of {days.length} · {dayLabel(day)}</div>
          <h1 className="h1">{day === today ? 'Today' : dayLabel(day, { weekday: 'long' })}</h1>
        </div>
        <button aria-label="Crew and trip settings" onClick={() => open({ name: 'crew' })} style={{ background: 'none', border: 0, display: 'flex', cursor: 'pointer', padding: 6 }}>
          {members.slice(0, 4).map((m, i) => <span key={m.id} style={{ marginLeft: i ? -9 : 0 }}><Avatar name={m.name || m.email} i={i} /></span>)}
          {!members.length && <Icon n="people" />}
        </button>
      </div>

      {home ? (
        <div className="soft between">
          <div>
            <div className="s">{pos ? (nearHome ? 'You’re at' : 'Home base') : 'Home base'}</div>
            <div className="n">{home.name}</div>
          </div>
          {pos && !nearHome && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ font: '600 14px/1.2 var(--sans)' }}>{homeWalk} min walk</div>
              {homeTransit?.minutes && <div className="s">or {homeTransit.minutes} min · {homeTransit.lines?.join(', ')}</div>}
            </div>
          )}
          {!pos && <button className="btn sm ghost" onClick={() => navigator.geolocation?.getCurrentPosition(() => {})}>Use my location</button>}
        </div>
      ) : (
        <button className="card dashed between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => open({ name: 'crew' })}>
          <span><div className="k amber">Where are you staying?</div><div className="s">Add a home base so Carnet can work out travel times.</div></span><Icon n="home" />
        </button>
      )}

      {next && lb && (
        <button className="card dark between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => open({ name: 'map', focus: next.id })}>
          <div>
            <div className="k" style={{ color: 'var(--gold)' }}>Leave by {lb}</div>
            <div className="s" style={{ color: '#E9E2D6', marginTop: 5 }}>
              {nextMins} min {nextTransit?.minutes === nextMins ? 'by ' + (nextTransit.lines?.join(' + ') || 'transit') : 'walk'} to {next.title} · {hm(next.start_time)}
            </div>
          </div>
          <Icon n="arrow" color="#E2B36A" />
        </button>
      )}

      <ProposalBanner t={t} onOpen={() => setReview(true)} />
      {review && <Proposals t={t} onClose={() => setReview(false)} />}
      <div className="between">
        <span className="k mute">The day</span>
        <button className="link" onClick={() => open({ name: 'map' })}>Map</button>
      </div>
      <DayView t={t} me={me} day={day} pos={pos} />
    </div>
  );
}
