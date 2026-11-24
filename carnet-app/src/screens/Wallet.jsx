import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Sheet, CatTag } from '../ui';
import { fileUrl } from '../lib/files';
import { dayLabel, hm, walkMin, stayFor, todayISO } from '../lib/util';
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
        <div className="k amber">{passes.length} booked · {passes.filter((p) => p.qr_text).length} with QR codes</div>
        <h1 className="h1">Wallet</h1>
      </div>
      {upcoming.map((p) => <Pass key={p.id} p={p} t={t} onOpen={() => setOpen(p)} onEdit={() => setEdit(p)} />)}
      {!passes.length && <div className="empty">Send a ticket screenshot in with + and it lands here, QR code and all. Everything here works without signal.</div>}
      {past.length > 0 && <div className="k mute" style={{ marginTop: 10 }}>Done</div>}
      {past.map((p) => <Pass key={p.id} p={p} t={t} small onOpen={() => setOpen(p)} onEdit={() => setEdit(p)} />)}
      {open && <FullPass p={open} onClose={() => setOpen(null)} />}
      {edit && <ItemEditor t={t} me={me} item={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Pass({ p, t, onOpen, onEdit, small }) {
  const qr = useQR(small ? null : p.qr_text);
  const img = useFile(!small && !p.qr_text ? p.attachment_path : null);
  const home = stayFor(t.stays, p.day || todayISO());
  const w = walkMin(home, p);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button onClick={onEdit} className="between" style={{ width: '100%', background: small ? 'var(--card)' : 'var(--ink)', color: small ? 'var(--ink)' : '#F3EEE6', border: 0, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', alignItems: 'flex-end' }}>
        <div>
          <CatTag c={p.category} extra={dayLabel(p.day)} />
          <div style={{ font: '400 24px/1.1 var(--serif)', marginTop: 6 }}>{p.title}</div>
          <div className="s" style={{ color: small ? undefined : '#B7AC9C' }}>{[p.start_time && hm(p.start_time), p.booking_ref && 'Ref ' + p.booking_ref].filter(Boolean).join(' · ')}</div>
        </div>
        {w != null && <div style={{ textAlign: 'right' }}><div className="s" style={{ color: small ? undefined : '#B7AC9C' }}>From home</div><div style={{ font: '600 14px var(--sans)' }}>{w} min walk</div></div>}
      </button>
      {!small && (qr || img) && (
        <button onClick={onOpen} style={{ width: '100%', background: 'none', border: 0, borderTop: '2px dashed var(--line)', padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          {qr ? <img className="qr" src={qr} alt="Ticket QR code" /> : <img src={img} alt="Ticket" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 10 }} />}
          <div className="s">Tap to show full screen · works offline</div>
        </button>
      )}
    </div>
  );
}

function FullPass({ p, onClose }) {
  const qr = useQR(p.qr_text);
  const img = useFile(p.attachment_path);
  return (
    <Sheet full onClose={onClose}>
      <div className="between"><span className="k amber">{p.title}</span><button className="link" onClick={onClose}>Done</button></div>
      <div style={{ background: '#fff', borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {qr && <img src={qr} alt="Ticket QR code" style={{ width: '100%', maxWidth: 360 }} />}
        {img && <img src={img} alt="Original ticket" style={{ width: '100%', borderRadius: 10 }} />}
      </div>
      <div className="s" style={{ textAlign: 'center' }}>Turn your screen brightness up for the door scanner.</div>
    </Sheet>
  );
}
