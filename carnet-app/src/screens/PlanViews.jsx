import { useEffect, useState } from 'react';
import { Icon } from '../ui';
import { cat, dayLabel, hm, fromMin, dur, tripNow, stayFor, areaOf, ticketsOf } from '../lib/util';
import { buildDay } from '../lib/schedule';
import { kindForDay, kindWords, mealsOn } from '../lib/nearby';
import { ItemSheet } from './DayView';

// Free time as a few words: "late lunch?", "dinner?", "drinks?".
const hint = (min, dayItems, prev) => {
  const k = kindForDay(min, dayItems, prev);
  return k ? kindWords(k, min).replace(/^For (a |an )?/, '').toLowerCase() + '?' : null;
};
// What's still open on a day: "dinner open", "lunch & dinner open".
function openMeals(dayItems, isPast) {
  if (isPast) return null;
  const m = mealsOn(dayItems);
  const left = [!m.lunch && 'lunch', !m.dinner && 'dinner'].filter(Boolean);
  return left.length ? `${left.join(' & ')} open` : null;
}

// The whole trip, one line per plan: what's next, at a glance. Days that are done fold away.
export function PlanCompact({ t, me, days, onDay, jump }) {
  const now = tripNow();
  const [showPast, setShowPast] = useState(false);
  // A day picked above: open the past days if it's one of them, and scroll to it.
  useEffect(() => {
    if (!jump) return;
    if (jump.d < now.day) setShowPast(true);
    requestAnimationFrame(() => document.getElementById('compact-' + jump.d)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [jump?.n]);
  const [open, setOpen] = useState(null);
  const past = days.filter((d) => d < now.day);
  const pastCount = t.items.filter((i) => past.includes(i.day)).length;
  const shown = showPast ? days : days.filter((d) => d >= now.day);
  return (
    <div className="col" style={{ gap: 14 }}>
      {past.length > 0 && !showPast && (
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--soft)', border: 0, font: '500 13px var(--sans)', color: '#4F473E' }} onClick={() => setShowPast(true)}>
          {past.map((d) => dayLabel(d, { weekday: 'short' })).join(', ')} · {pastCount} plan{pastCount === 1 ? '' : 's'} done · show ›
        </button>
      )}
      {shown.map((d) => {
        const dayItems = t.items.filter((i) => i.day === d);
        const { rows } = buildDay({ items: t.items, day: d, home: stayFor(t.stays, d), now, places: t.places, minGap: 60 });
        const count = dayItems.filter((i) => i.start_time).length;
        const isToday = d === now.day;
        const meals = openMeals(dayItems, d < now.day);
        let nowShown = !isToday;
        return (
          <div key={d} id={'compact-' + d} className="col" style={{ gap: 0, scrollMarginTop: 12 }}>
            <div className="between" style={{ padding: '4px 0 6px' }}>
              <button className="k" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: isToday ? 'var(--ink)' : 'var(--mute)' }} onClick={() => onDay(d)}>{isToday ? 'Today · ' : ''}{dayLabel(d, { weekday: 'short', day: 'numeric' })} ›</button>
              <span className="s">{count ? `${count} plan${count === 1 ? '' : 's'}` : 'nothing yet'}{meals ? ` · ${meals}` : ''}</span>
            </div>
            {rows.map((r, i) => {
              const at = r.kind === 'item' ? r.start : r.from;
              const nowLine = !nowShown && r.kind !== 'travel' && at >= now.min ? (nowShown = true) : false;
              const line = nowLine && <div key={'now' + i} className="row" style={{ gap: 6, height: 16 }}><span style={{ font: '700 10px var(--sans)', color: '#B3402A' }}>{fromMin(now.min % 1440)}</span><span style={{ flex: 1, height: 2, background: '#B3402A' }} /></div>;
              // Last night's late plans are already shown on the day they started.
              if (r.kind === 'travel' || r.fromYesterday) return null;
              if (r.kind === 'gap') {
                const h = d >= now.day ? hint(r.from, dayItems, r.prev?.category) : null;
                return [line, (
                  <button key={i} onClick={() => onDay(d)} className="row" style={{ minHeight: 36, gap: 10, background: 'none', border: 0, borderBottom: '1px dashed #D9C39A', padding: 0, textAlign: 'left', cursor: 'pointer', font: '600 12.5px var(--sans)', color: '#8A5A14' }}>
                    <span style={{ width: 42, flex: 'none' }} />{r.open ? `Free from ${fromMin(r.from)}` : `Free ${dur(r.minutes)}`}{h ? ` · ${h}` : ''}
                  </button>
                )];
              }
              const it = r.item;
              const c = cat(it.category);
              const done = isToday && r.end <= now.min;
              const n = ticketsOf(it).length;
              const meta = [n ? `▣ ${n}` : null, areaOf(it.address) || (it.place_id && areaOf(t.places.find((p) => p.id === it.place_id)?.address))].filter(Boolean).join(' · ');
              return [line, (
                <button key={it.id + i} onClick={() => setOpen(it)} className="row" style={{ minHeight: 44, gap: 10, background: 'none', border: 0, borderBottom: '1px solid var(--soft)', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', opacity: done ? 0.55 : 1 }}>
                  <span style={{ width: 42, flex: 'none', font: '500 13px var(--sans)', color: 'var(--mute)', fontVariantNumeric: 'tabular-nums' }}>{r.fromYesterday ? '00:00' : hm(it.start_time)}</span>
                  <span style={{ width: 9, height: 9, borderRadius: 5, background: c.color, flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0, font: '400 17px/1.2 var(--serif)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                  {meta && <span className="s" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{meta}</span>}
                </button>
              )];
            })}
            {!rows.some((r) => r.kind === 'item') && <div className="s" style={{ padding: '6px 0' }}>Tap the day to plan it.</div>}
          </div>
        );
      })}
      {open && <ItemSheet t={t} me={me} item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// The trip as a grid: days down the side, parts of the day across. For seeing a heavy Saturday
// next to an empty Sunday, and the gaps worth filling.
// Each column: label, from, to, and the time its empty-cell hint is worked out for.
const COLS = [['Morning', 5 * 60, 12 * 60, 9 * 60], ['Afternoon', 12 * 60, 18 * 60, 13 * 60], ['Evening', 18 * 60, 22 * 60, 19.5 * 60], ['Late', 22 * 60, 29 * 60, 22.5 * 60]];
export function PlanTrip({ t, days, onDay }) {
  const now = tripNow();
  const ideas = t.items.filter((i) => !i.day);
  const unplaced = t.places.filter((p) => !t.items.some((i) => i.place_id === p.id));
  const open = [];
  const grid = days.map((d) => {
    const dayItems = t.items.filter((i) => i.day === d && i.start_time);
    const isPast = d < now.day;
    // The last day ends with its last plan (the train home): no hints after it.
    const endsAt = d === days[days.length - 1] && dayItems.length ? Math.max(...dayItems.map((i) => +((i.end_time || i.start_time).slice(0, 2)) * 60 + +((i.end_time || i.start_time).slice(3, 5)))) : null;
    const cells = COLS.map(([label, a, b, at]) => {
      const inCell = dayItems.filter((i) => { const m = +i.start_time.slice(0, 2) * 60 + +i.start_time.slice(3, 5); const mm = m < 5 * 60 ? m + 1440 : m; return mm >= a && mm < b; });
      const h = !isPast && !inCell.length && !(d === now.day && b <= now.min) && !(endsAt != null && at >= endsAt) ? hint(at, dayItems) : null;
      return { label, items: inCell, hint: h };
    });
    const m = mealsOn(dayItems);
    if (!isPast) {
      if (!m.lunch && !(d === now.day && now.min > 15 * 60) && !(endsAt != null && endsAt <= 12 * 60)) open.push(`${dayLabel(d, { weekday: 'short' })} lunch`);
      if (!m.dinner && !(endsAt != null && endsAt <= 19 * 60)) open.push(`${dayLabel(d, { weekday: 'short' })} dinner`);
    }
    return { d, cells, isPast };
  });
  return (
    <div className="col" style={{ gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '48px repeat(4, minmax(0, 1fr))', gap: 4 }}>
        <span />{COLS.map(([l]) => <span key={l} className="k mute" style={{ fontSize: 9.5 }}>{l}</span>)}
      </div>
      {grid.map(({ d, cells, isPast }) => {
        const today = d === now.day;
        return (
          <button key={d} onClick={() => onDay(d)} style={{ display: 'grid', gridTemplateColumns: '48px repeat(4, minmax(0, 1fr))', gap: 4, background: today ? 'var(--card)' : 'none', border: today ? '1.5px solid var(--ink)' : 0, borderRadius: 12, padding: today ? 4 : 0, margin: today ? '0 -4px' : 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', opacity: isPast ? 0.55 : 1 }}>
            <span style={{ font: '500 12px/1.2 var(--sans)', color: 'var(--mute)', paddingTop: 6 }}>{today ? 'Today' : dayLabel(d, { weekday: 'short' })}<b style={{ display: 'block', font: '700 18px var(--sans)', color: 'var(--ink)' }}>{dayLabel(d, { day: 'numeric' })}</b></span>
            {cells.map((c) => c.items.length ? (
              <span key={c.label} className="col" style={{ gap: 3, minHeight: 56, borderRadius: 8, padding: 5, background: cat(c.items[0].category).bg, overflow: 'hidden' }}>
                {c.items.slice(0, 3).map((i) => <span key={i.id} style={{ font: '500 11px/1.25 var(--sans)', background: 'rgba(250,248,243,.85)', borderRadius: 5, padding: '2px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.title}</span>)}
                {c.items.length > 3 && <span className="s" style={{ fontSize: 10.5 }}>+{c.items.length - 3}</span>}
              </span>
            ) : (
              <span key={c.label} style={{ minHeight: 56, borderRadius: 8, border: c.hint ? '1.5px dashed #D9C39A' : 0, background: c.hint ? 'transparent' : 'var(--soft)', display: 'grid', placeItems: 'center', font: '600 11px var(--sans)', color: '#8A5A14', opacity: c.hint ? 1 : 0.5, textAlign: 'center', padding: 2 }}>{c.hint || ''}</span>
            ))}
          </button>
        );
      })}
      {open.length > 0 && (
        <div className="card col" style={{ gap: 4, marginTop: 8 }}>
          <div className="k">Still open</div>
          <div style={{ font: '400 14px/1.45 var(--sans)' }}>{open.join(' · ')}</div>
          <div className="s">Tap a day to fill it with ideas near what’s either side.</div>
        </div>
      )}
      {(ideas.length > 0 || unplaced.length > 0) && (
        <div className="card col" style={{ gap: 4 }}>
          <div className="k">Not on a day yet</div>
          <div style={{ font: '400 14px/1.45 var(--sans)' }}>{[ideas.length && `${ideas.length} idea${ideas.length === 1 ? '' : 's'} on the plan`, unplaced.length && `${unplaced.length} place${unplaced.length === 1 ? '' : 's'} in your guide`].filter(Boolean).join(' · ')}</div>
        </div>
      )}
    </div>
  );
}
