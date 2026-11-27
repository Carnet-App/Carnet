import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Sheet, CatTag } from '../ui';
import { fileUrl } from '../lib/files';
import { dayLabel, hm, walkMin, stayFor, todayISO, ticketsOf, nameOf } from '../lib/util';
import ItemEditor from './ItemEditor';

function useQR(text) {
  const [src, setSrc] = useState(null);
  useEffect(() => { text ? QRCode.toDataURL(text, { margin: 1, width: 420, color: { dark: '#1E1A16', light: '#FFFFFF' } }).then(setSrc) : setSrc(null); }, [text]);
  return src;
}
function useFile(path) {
  const [src, setSrc] = useState(null);
  useEffect(() => { path ? fileUrl(path).then(setSrc) : setSrc(null); }, [path]);
  return src;
}

export default function Wallet({ t, me }) {
  const passes = t.items
    .filter((i) => i.status === 'booked' && (i.visibility !== 'busy' || i.mine_private))
    .sort((a, b) => (a.day || '9').localeCompare(b.day || '9') || (a.start_time || '').localeCompare(b.start_time || ''));
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  const today = todayISO();
  const upcoming = passes.filter((p) => !p.day || p.day >= today);
  const past = passes.filter((p) => p.day && p.day < today);

  return (
    <div className="page">
      <div>
        <div className="k amber">{passes.length} booked · {passes.reduce((n, p) => n + ticketsOf(p).filter((k) => k.qr).length, 0)} QR codes</div>
        <h1 className="h1">Wallet</h1>
      </div>
      {upcoming.map((p) => <Pass key={p.id} p={p} t={t} me={me} onOpen={(i = 0) => setOpen({ p, i })} onEdit={() => setEdit(p)} />)}
      {!passes.length && <div className="empty">Send a ticket screenshot in with + and it lands here, QR code and all. Everything here works without signal.</div>}
      {past.length > 0 && <div className="k mute" style={{ marginTop: 10 }}>Done</div>}
      {past.map((p) => <Pass key={p.id} p={p} t={t} me={me} small onOpen={(i = 0) => setOpen({ p, i })} onEdit={() => setEdit(p)} />)}
      {open && <FullPass p={open.p} start={open.i} onClose={() => setOpen(null)} />}
      {edit && <ItemEditor t={t} me={me} item={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// One ticket of a plan: its QR code (drawn crisp from the saved text) or, without one, the image.
function TicketFace({ k, full }) {
  const qr = useQR(k?.qr);
  const img = useFile(k && (full || !k.qr) ? k.path : null);
  if (full) return (
    <>
      {qr && <img src={qr} alt="Ticket QR code" style={{ width: '100%', maxWidth: 360 }} />}
      {img && <img src={img} alt="Original ticket" style={{ width: '100%', borderRadius: 10 }} />}
    </>
  );
  return qr ? <img className="qr" src={qr} alt="Ticket QR code" /> : img ? <img src={img} alt="Ticket" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 10 }} /> : null;
}

// Several tickets on one plan: one at a time, with "2 of 3" and arrows (one per person at the door).
function Pager({ n, i, setI, dark, by }) {
  if (n < 2) return by ? <div className="s" style={{ textAlign: 'center' }}>{by}</div> : null;
  const b = { border: '1px solid var(--line)', background: dark ? 'transparent' : 'var(--card)', borderRadius: 999, width: 38, height: 32, cursor: 'pointer', font: '500 16px var(--sans)', color: 'var(--ink)' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
      <button style={{ ...b, opacity: i ? 1 : 0.35 }} disabled={!i} onClick={() => setI(i - 1)} aria-label="Previous ticket">‹</button>
      <span style={{ font: '600 13px var(--sans)', textAlign: 'center' }}>Ticket {i + 1} of {n}{by && <span style={{ display: 'block', font: '400 12px var(--sans)', opacity: 0.7 }}>{by}</span>}</span>
      <button style={{ ...b, opacity: i < n - 1 ? 1 : 0.35 }} disabled={i >= n - 1} onClick={() => setI(i + 1)} aria-label="Next ticket">›</button>
    </div>
  );
}

const byLine = (k, p, t, me) => { const e = k?.by || (k && ticketsOf(p)[0] === k ? p.created_by_email : null); return e ? `Added by ${e === me ? 'you' : nameOf(t.members, e)}` : null; };

function Pass({ p, t, me, onOpen, onEdit, small }) {
  const list = ticketsOf(p);
  const [i, setI] = useState(0);
  const k = list[Math.min(i, list.length - 1)];
  const home = stayFor(t.stays, p.day || todayISO());
  const w = walkMin(home, p);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button onClick={onEdit} className="between" style={{ width: '100%', background: small ? 'var(--card)' : 'var(--ink)', color: small ? 'var(--ink)' : '#F3EEE6', border: 0, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', alignItems: 'flex-end' }}>
        <div>
          <CatTag c={p.category} extra={dayLabel(p.day)} />
          <div style={{ font: '400 24px/1.1 var(--serif)', marginTop: 6 }}>{p.title}</div>
          <div className="s" style={{ color: small ? undefined : '#B7AC9C' }}>{[p.start_time && hm(p.start_time), p.booking_ref && 'Ref ' + p.booking_ref, list.length > 1 && `${list.length} tickets`].filter(Boolean).join(' · ')}</div>
        </div>
        {w != null && <div style={{ textAlign: 'right' }}><div className="s" style={{ color: small ? undefined : '#B7AC9C' }}>From home</div><div style={{ font: '600 14px var(--sans)' }}>{w} min walk</div></div>}
      </button>
      {!small && k && (
        <div style={{ borderTop: '2px dashed var(--line)', padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <button onClick={() => onOpen(Math.min(i, list.length - 1))} style={{ background: 'none', border: 0, padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <TicketFace k={k} />
            <div className="s">Tap to show full screen · works offline</div>
          </button>
          <Pager n={list.length} i={Math.min(i, list.length - 1)} setI={setI} by={byLine(k, p, t, me)} />
        </div>
      )}
    </div>
  );
}

export function FullPass({ p, start = 0, onClose }) {
  const list = ticketsOf(p);
  const [i, setI] = useState(start);
  const k = list[Math.min(i, list.length - 1)];
  return (
    <Sheet full onClose={onClose}>
      <div className="between"><span className="k amber">{p.title}</span><button className="link" onClick={onClose}>Done</button></div>
      <Pager n={list.length} i={Math.min(i, list.length - 1)} setI={setI} />
      <div style={{ background: '#fff', borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <TicketFace key={i} k={k} full />
      </div>
      <div className="s" style={{ textAlign: 'center' }}>Turn your screen brightness up for the door scanner.</div>
    </Sheet>
  );
}
