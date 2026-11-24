import { useState } from 'react';
import { Sheet, CatTag } from '../ui';
import { decide, withdraw } from '../lib/proposals';
import { dayLabel, hm, nameOf } from '../lib/util';

const when = (r) => (r ? [r.day ? dayLabel(r.day) : 'no day', r.start_time ? hm(r.start_time) : ''].filter(Boolean).join(' · ') : '');

export function ProposalBanner({ t, onOpen }) {
  const pending = t.proposals.filter((p) => p.status === 'pending');
  if (!pending.length) return null;
  const mine = pending.filter((p) => p.proposed_by_email === t.me).length;
  return (
    <button className="card dashed between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={onOpen}>
      <span>
        <div className="k amber">{t.isAdmin ? `${pending.length} to review` : `${pending.length} waiting for approval`}</div>
        <div className="s">{t.isAdmin ? 'Proposed changes to the schedule' : mine ? `${mine} of them yours` : 'Proposed by the crew'}</div>
      </span>
      <span className="btn sm">{t.isAdmin ? 'Review' : 'See'}</span>
    </button>
  );
}

export default function Proposals({ t, onClose }) {
  const [notes, setNotes] = useState({});
  const pending = t.proposals.filter((p) => p.status === 'pending');
  const recent = t.proposals.filter((p) => p.status !== 'pending').slice(0, 8);
  return (
    <Sheet title="Proposals" onClose={onClose}>
      {!pending.length && <div className="empty">Nothing waiting.</div>}
      {pending.map((p) => {
        const a = { ...(p.before || {}), ...(p.payload || {}) };
        const mine = p.proposed_by_email === t.me;
        return (
          <div key={p.id} className="card col">
            <div className="k amber">{nameOf(t.members, p.proposed_by_email)} proposes {p.kind === 'add' ? 'adding' : p.kind === 'remove' ? 'removing' : 'a change'}</div>
            <CatTag c={a.category} />
            <div className="n">{a.title}</div>
            {p.kind === 'change' ? (
              <div className="s"><s>{when(p.before)}</s> → <b style={{ color: 'var(--ink)' }}>{when(a)}</b>{p.before?.title !== a.title ? ` · was “${p.before?.title}”` : ''}</div>
            ) : (
              <div className="s">{when(p.kind === 'remove' ? p.before : a)}{a.address ? ' · ' + a.address : ''}</div>
            )}
            {t.isAdmin ? (
              <>
                <input className="in" placeholder="Note back (optional)" value={notes[p.id] || ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
                <div className="row">
                  <button className="btn grow" onClick={() => decide(t, p, true, notes[p.id])}>Approve</button>
                  <button className="btn ghost grow" onClick={() => decide(t, p, false, notes[p.id])}>Decline</button>
                </div>
              </>
            ) : mine ? (
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => withdraw(p)}>Withdraw</button>
            ) : (
              <div className="s">Waiting for an admin.</div>
            )}
          </div>
        );
      })}
      {recent.length > 0 && <div className="k mute" style={{ marginTop: 6 }}>Recently decided</div>}
      {recent.map((p) => {
        const a = { ...(p.before || {}), ...(p.payload || {}) };
        return (
          <div key={p.id} className="between s">
            <span>{a.title} · {nameOf(t.members, p.proposed_by_email)}{p.note ? ` — “${p.note}”` : ''}</span>
            <span className="pill" style={{ background: p.status === 'approved' ? '#E1F0E8' : '#EDE9E2', color: p.status === 'approved' ? '#24563F' : '#4F473E' }}>{p.status}</span>
          </div>
        );
      })}
    </Sheet>
  );
}
