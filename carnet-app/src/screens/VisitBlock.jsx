import { useState } from 'react';
import { Icon, CatTag, Sheet } from '../ui';
import { ticketsOf, dayLabel, hm, tripNow, nameOf, cat } from '../lib/util';
import { costOf } from '../lib/planCost';
import { altsOf, rankLabel } from '../lib/alts';
import { FullPass } from './Wallet';
import ItemEditor from './ItemEditor';

const money = (e) => (e ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: e.currency || 'EUR' }).format(Number(e.amount) || 0) : null);

// The plan itself, at the top of the sheet when it's opened from the Plan: when, the tickets,
// what it cost, the backups, and what's either side of it on the day.
export default function VisitBlock({ t, me, item, onEdit }) {
  const [pass, setPass] = useState(false);
  const tickets = ticketsOf(item);
  const cost = costOf(t.expenses, item.id);
  const alts = altsOf(item);
  const today = tripNow().day;
  const when = item.day ? `${item.day === today ? 'Today' : dayLabel(item.day, { weekday: 'short', day: 'numeric', month: 'short' })}${item.start_time ? ` · ${hm(item.start_time)}` : ''}${item.end_time ? ` – ${hm(item.end_time)}` : ''}` : 'Not on a day yet';
  const sameDay = (t.items || []).filter((i) => i.day === item.day && i.start_time && i.id !== item.id).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const before = item.start_time ? sameDay.filter((i) => i.start_time < item.start_time).pop() : null;
  const after = item.start_time ? sameDay.find((i) => i.start_time > item.start_time) : null;
  const who = (e) => (e?.toLowerCase() === me?.toLowerCase() ? 'you' : nameOf(t.members, e));
  const c = cat(item.category);
  const rows = [
    cost && ['Cost', `${money(cost)} · ${who(cost.payer_email)} paid · in Split`],
    alts.length > 0 && ['Backups', alts.map((a, i) => `${rankLabel(i)}: ${a.title}`).join(' · ')],
    before && ['Before', `${before.title}${before.end_time ? `, until ${hm(before.end_time)}` : `, ${hm(before.start_time)}`}`],
    after && ['After', `${after.title} at ${hm(after.start_time)}`],
    item.created_by_email && ['Added by', who(item.created_by_email)],
  ].filter(Boolean);
  return (
    <div className="card col" style={{ gap: 10, background: c.bg, borderColor: c.bg }}>
      <div className="between"><div className="k" style={{ color: c.color }}>This visit{item.status === 'booked' ? ' · booked' : item.status === 'idea' ? ' · idea' : ''}</div>
        <button className="link" style={{ color: c.color }} onClick={onEdit}>Change</button></div>
      <div className="n" style={{ fontSize: 22 }}>{when}</div>
      {tickets.length > 0 && (
        <button className="btn block" style={{ height: 50 }} onClick={() => setPass(true)}><Icon n="ticket" size={18} color="#F3EEE6" />Show {tickets.length > 1 ? `tickets · ${tickets.length}` : 'ticket'}</button>
      )}
      {rows.length > 0 && (
        <div className="col" style={{ gap: 0 }}>
          {rows.map(([k, v]) => (
            <div key={k} className="between" style={{ minHeight: 40, borderTop: '1px solid rgba(30,26,22,.08)', gap: 12, font: '400 14px var(--sans)' }}>
              <span className="s" style={{ fontSize: 13.5, flex: 'none' }}>{k}</span><span style={{ textAlign: 'right', minWidth: 0 }}>{v}</span>
            </div>
          ))}
        </div>
      )}
      {pass && <FullPass p={item} onClose={() => setPass(false)} />}
    </div>
  );
}

// A plan that isn't a place (a train, "Pack", "Airport → hotel"): just the visit, and the editor.
export function VisitSheet({ t, me, item, onClose }) {
  const [edit, setEdit] = useState(false);
  return (
    <Sheet onClose={onClose}>
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div><CatTag c={item.category} /><h2 className="h2" style={{ marginTop: 4 }}>{item.title}</h2>{item.address && <div className="s">{item.address}</div>}</div>
        <button className="icon" aria-label="Close" onClick={onClose}><Icon n="close" size={16} /></button>
      </div>
      <VisitBlock t={t} me={me} item={item} onEdit={() => setEdit(true)} />
      {item.notes && <div className="s" style={{ whiteSpace: 'pre-line', color: 'var(--ink)', fontSize: 14 }}>{item.notes}</div>}
      {item.lat != null && <a className="btn ghost block" href={`https://maps.apple.com/?daddr=${item.lat},${item.lng}&dirflg=w`} target="_blank" rel="noreferrer">Directions in Maps</a>}
      <button className="link mute" onClick={() => setEdit(true)}>All details (time, tickets, backups, remove)</button>
      {edit && <ItemEditor t={t} me={me} item={item} onClose={() => { setEdit(false); onClose(); }} />}
    </Sheet>
  );
}
