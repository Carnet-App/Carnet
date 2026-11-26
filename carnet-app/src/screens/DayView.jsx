import { useState } from 'react';
import { altsOf, rankLabel } from '../lib/alts';
import { Icon, CatTag } from '../ui';
import { buildDay } from '../lib/schedule';
import { cat, hm, fromMin, dur, stayFor, tripNow, nameOf, dayLabel } from '../lib/util';
import { span } from '../lib/schedule';
import ItemEditor from './ItemEditor';

export default function DayView({ t, me, day, pos }) {
  const [edit, setEdit] = useState(null);
  const home = stayFor(t.stays, day);
  const now = tripNow();
  const { rows, loose } = buildDay({ items: t.items, day, home: (day === now.day && pos) || home, now, places: t.places });

  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map((r, i) => {
        if (r.kind === 'travel')
          return (
            <div key={i} className="tr"><Icon n="walk" size={12} w={2} />{r.minutes} min walk</div>
          );
        if (r.kind === 'gap')
          return (
            <div key={i} className="tl">
              <div className="tm">{fromMin(r.from)}</div>
              <div className="it" style={{ background: 'transparent', border: '1.5px dashed #C9A96E', cursor: 'default' }}>
                <div className="k amber">{r.open ? 'Free from here' : `Free · ${dur(r.minutes)}`}</div>
                {r.ideas.length ? (
                  <div className="col" style={{ gap: 6, marginTop: 4 }}>
                    {r.ideas.map((p) => (
                      <button key={p.id} className="between" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => setEdit({ preset: { title: p.name, place_id: p.id, lat: p.lat, lng: p.lng, address: p.address, category: p.category, day, start_time: fromMin(r.from + (p.walk || 0)) } })}>
                        <span><span className="n" style={{ fontSize: 15 }}>{p.name}</span> <span className="s">· {p.walk != null ? `${p.walk} min` : ''}</span></span>
                        <Icon n="plus" size={16} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="s">Nothing from your guide nearby yet.</div>
                )}
              </div>
            </div>
          );
        const it = r.item;
        const busyOther = it.visibility === 'busy' && !it.mine_private;
        const c = cat(it.category);
        const st = busyOther ? { background: '#EDE9E2', borderColor: '#DCD5CA' } : it.visibility !== 'shared' ? { background: '#EDE9E2', borderColor: '#DCD5CA' } : { background: c.bg, borderColor: c.bg };
        return (
          <div key={(r.fromYesterday ? 'y' : '') + it.id} className="tl">
            <div className="tm">{r.fromYesterday ? '00:00' : hm(it.start_time)}</div>
            <button className="it" style={st} onClick={() => !busyOther && setEdit({ item: it })} disabled={busyOther}>
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
        );
      })}
      {t.proposals.filter((p) => p.status === 'pending' && p.kind !== 'remove' && (p.payload?.day || p.before?.day) === day).map((p) => {
        const a = { ...(p.before || {}), ...(p.payload || {}) };
        return (
          <div key={p.id} className="tl">
            <div className="tm">{hm(a.start_time)}</div>
            <div className="it" style={{ background: 'transparent', border: '1.5px dashed #C9A96E', cursor: 'default' }}>
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
            <button key={it.id} className="card between" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setEdit({ item: it })}>
              <span><CatTag c={it.category} /><div className="n">{it.title}</div></span><Icon n="pen" size={16} />
            </button>
          ))}
        </>
      )}
      {!rows.some((r) => r.kind === 'item') && !loose.length && <div className="empty">Nothing planned yet — tap + to add something.</div>}
      {edit && <ItemEditor t={t} me={me} item={edit.item} preset={edit.preset} onClose={() => setEdit(null)} />}
    </div>
  );
}
