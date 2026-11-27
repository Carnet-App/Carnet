import { useEffect, useRef } from 'react';
import { cat } from './lib/util';

const P = {
  up: <><path d="M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 2.6 1.9L13 9h5.4a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.1 20H7" /></>,
  down: <><path d="M7 14V4H4v10zM7 14l4 7a2 2 0 0 0 2.6-1.9L13 15h5.4a2 2 0 0 0 2-2.3l-1.3-7A2 2 0 0 0 17.1 4H7" /></>,
  today: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  plan: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  places: <><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  wallet: <path d="M4 7h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4z" />,
  money: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'chev-down': <path d="M6 9l6 6 6-6" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  map: <><path d="M9 4l-5 2v14l5-2 6 2 5-2V4l-5 2z" /><path d="M9 4v14M15 6v14" /></>,
  walk: <><circle cx="13" cy="4" r="2" /><path d="M9 20l3-7 3 3v4M10 9l-2 4 4 1" /></>,
  metro: <><rect x="5" y="4" width="14" height="13" rx="3" /><path d="M8 21l2-4M16 21l-2-4M5 11h14" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  camera: <><rect x="3" y="6" width="18" height="14" rx="3" /><circle cx="12" cy="13" r="3.5" /><path d="M9 6l1.5-2h3L15 6" /></>,
  link: <path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1" />,
  pen: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 010 6M21 20c0-2-1-4-4-5" /></>,
  home: <path d="M4 11l8-7 8 7v9H4z" />,
  check: <path d="M5 12l5 5 9-10" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  ticket: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M21 14v7h-7" /></>,
  nav: <path d="M3 11 21 3l-8 18-2-8z" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  share: <path d="M12 3v12M7 8l5-5 5 5M5 15v5h14v-5" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />,
};
export function Icon({ n, size = 22, color = 'currentColor', w = 1.7 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[n]}
    </svg>
  );
}

export function Sheet({ onClose, children, full, title, className = '' }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => (document.body.style.overflow = '');
  }, []);
  // Pull the handle (or the top of a sheet scrolled to its top) down to close.
  const box = useRef(null);
  const drag = useRef(null);
  const start = (e) => {
    const el = box.current;
    if (!el) return;
    drag.current = { y: e.touches[0].clientY, dy: 0 };
  };
  const move = (e) => {
    if (!drag.current) return;
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    drag.current.dy = dy;
    if (box.current) { box.current.style.transform = `translateY(${dy}px)`; box.current.style.transition = 'none'; }
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!box.current || !d) return;
    box.current.style.transition = 'transform .18s ease-out';
    if (d.dy > 90) { box.current.style.transform = 'translateY(100%)'; setTimeout(() => onClose?.(), 160); }
    else box.current.style.transform = '';
  };
  return (
    <div className="sheet-back" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={box} className={'sheet' + (full ? ' full' : '') + (className ? ' ' + className : '')} role="dialog" aria-label={title}>
        {!full && <div className="grab-zone" onTouchStart={start} onTouchMove={move} onTouchEnd={end} style={{ margin: '-10px -20px -4px', padding: '10px 20px 12px', display: 'flex', justifyContent: 'center', touchAction: 'none', cursor: 'grab', flex: 'none' }}><div className="grab" /></div>}
        {title && (
          <div className="between">
            <h2 className="h2">{title}</h2>
            <button className="icon" aria-label="Close" onClick={onClose}><Icon n="close" size={18} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function TabBar({ tab, setTab }) {
  const tabs = [['today', 'Today'], ['plan', 'Plan'], ['places', 'Places'], ['wallet', 'Wallet'], ['money', 'Split']];
  return (
    <nav className="tabbar">
      {tabs.map(([k, l]) => (
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
          <Icon n={k} />{l}
        </button>
      ))}
    </nav>
  );
}

export const CatTag = ({ c, extra }) => (
  <span className="k" style={{ color: cat(c).color }}>{cat(c).label}{extra ? ' · ' + extra : ''}</span>
);

export function StatusPill({ s }) {
  const m = { booked: ['#E1F0E8', '#24563F', 'Booked'], planned: ['#F6EAD3', '#7A4E0E', 'Planned'], idea: ['#EDE9E2', '#4F473E', 'Idea'] }[s] || ['#EDE9E2', '#4F473E', s];
  return <span className="pill" style={{ background: m[0], color: m[1] }}>{m[2]}</span>;
}

const AV = ['#1E1A16', '#2F6B57', '#8E3A5C', '#4A3F9C', '#8A5A14', '#2E5C8A'];
export function Avatar({ name = '?', i = 0, size = 30 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: AV[i % AV.length], color: '#fff', font: `600 ${Math.round(size * 0.4)}px/${size}px var(--sans)`, textAlign: 'center', border: '2px solid var(--bg)', flex: 'none', display: 'inline-block' }}>
      {name[0]?.toUpperCase()}
    </span>
  );
}

export function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
