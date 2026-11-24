import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Icon, CatTag } from '../ui';
import { cat, useLocation, stayFor, todayISO, walkMin, distM } from '../lib/util';
import { PlacePhoto, PlaceDetail } from './Places';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const WALK15 = (15 * 80) / 1.3; // metres you can walk in 15 minutes

function circle(c, r) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([c.lng + (r / (111320 * Math.cos((c.lat * Math.PI) / 180))) * Math.cos(a), c.lat + (r / 110540) * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}

function dot(color, size = 16, border = '#FAF8F3') {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid ${border};box-shadow:0 1px 4px rgba(30,26,22,.35)`;
  return el;
}

export default function MapView({ t, places, onClose, focus }) {
  const box = useRef();
  const map = useRef();
  const markers = useRef([]);
  const pos = useLocation();
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [cat_, setCat] = useState('all');
  const home = t ? stayFor(t.stays, todayISO()) : null;
  const center = pos || home || (t?.trip.center_lat ? { lat: t.trip.center_lat, lng: t.trip.center_lng } : places.find((p) => p.lat != null));

  const pins = [
    ...places.filter((p) => p.lat != null),
    ...(t?.items || []).filter((i) => i.lat != null && !i.place_id && (i.visibility !== 'busy' || i.mine_private)).map((i) => ({ id: i.id, name: i.title, lat: i.lat, lng: i.lng, category: i.category, address: i.address })),
  ].filter((p) => cat_ === 'all' || p.category === cat_);
  const ref = pos || home;
  const near = pins.map((p) => ({ ...p, walk: walkMin(ref, p), d: distM(ref, p) })).sort((a, b) => (a.d ?? 9e9) - (b.d ?? 9e9));

  useEffect(() => {
    map.current = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: center ? [center.lng, center.lat] : [2.3522, 48.8566],
      zoom: center ? 13.5 : 11,
      attributionControl: { compact: true },
    });
    map.current.on('load', () => {
      const m = map.current;
      // Paper tones to match the app.
      for (const l of m.getStyle().layers) {
        try {
          if (l.type === 'background') m.setPaintProperty(l.id, 'background-color', '#EFE8DC');
          if (/water/.test(l.id) && l.type === 'fill') m.setPaintProperty(l.id, 'fill-color', '#C9D7D4');
          if (/park|landuse_park|wood|grass/.test(l.id) && l.type === 'fill') m.setPaintProperty(l.id, 'fill-color', '#DDE6D3');
        } catch {}
      }
      m.addSource('walk', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'walk-fill', type: 'fill', source: 'walk', paint: { 'fill-color': '#E2B36A', 'fill-opacity': 0.1 } });
      m.addLayer({ id: 'walk-line', type: 'line', source: 'walk', paint: { 'line-color': '#9A6418', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
    });
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((x) => x.remove());
    markers.current = [];
    const far = (p) => ref && distM(ref, p) > WALK15;
    for (const p of pins) {
      const el = dot(cat(p.category).color);
      if (far(p)) el.style.opacity = '.5';
      el.style.cursor = 'pointer';
      el.onclick = () => setSel(p.id);
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m));
    }
    if (home) {
      const h = document.createElement('div');
      h.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F3EEE6" stroke-width="2"><path d="M4 11l8-7 8 7v9H4z"/></svg>';
      h.style.cssText = 'width:26px;height:26px;border-radius:8px;background:#1E1A16;display:flex;align-items:center;justify-content:center';
      markers.current.push(new maplibregl.Marker({ element: h }).setLngLat([home.lng, home.lat]).addTo(m));
    }
    if (pos) markers.current.push(new maplibregl.Marker({ element: dot('#1E1A16', 14) }).setLngLat([pos.lng, pos.lat]).addTo(m));
    const setWalk = () => m.getSource('walk')?.setData({ type: 'FeatureCollection', features: ref ? [circle(ref, WALK15)] : [] });
    m.isStyleLoaded() ? setWalk() : m.once('load', setWalk);
  }, [pins.length, cat_, pos?.lat, pos?.lng, home?.id]);

  useEffect(() => {
    const p = pins.find((x) => x.id === (sel || focus));
    if (p && map.current) map.current.flyTo({ center: [p.lng, p.lat], zoom: 15 });
    if (focus && !sel) setSel(focus);
  }, [sel, focus]);

  const placeById = (id) => places.find((p) => p.id === id);

  return (
    <div className="sheet-back" style={{ alignItems: 'stretch' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', background: '#EFE8DC' }}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', left: 14, right: 14, top: 'calc(env(safe-area-inset-top) + 12px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="card between" style={{ boxShadow: '0 4px 14px rgba(30,26,22,.08)' }}>
            <div><div className="k amber">{t?.trip.city || places[0]?.city} · {pins.length} places</div><div className="n" style={{ fontSize: 20 }}>Map</div></div>
            <button className="icon" aria-label="Close map" onClick={onClose}><Icon n="close" size={18} /></button>
          </div>
          <div className="chips">
            {['all', 'eat', 'drink', 'dance', 'coffee', 'explore', 'culture'].map((k) => (
              <button key={k} className={'chip' + (cat_ === k ? ' on' : '')} onClick={() => setCat(k)}>{k === 'all' ? 'All' : cat(k).label}</button>
            ))}
          </div>
        </div>
        <div className="hscroll" style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom) + 16px)', padding: '0 14px' }}>
          {near.slice(0, 25).map((p) => (
            <button key={p.id} onClick={() => { setSel(p.id); placeById(p.id) && sel === p.id && setDetail(placeById(p.id)); }}
              style={{ width: 230, background: 'var(--card)', border: '1px solid ' + (sel === p.id ? 'var(--ink)' : 'var(--line)'), borderRadius: 16, overflow: 'hidden', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
              <PlacePhoto p={p} style={{ width: '100%', height: 96, borderRadius: 0 }} />
              <div style={{ padding: '9px 12px' }}>
                <CatTag c={p.category} extra={p.walk != null ? `${p.walk} min walk` : ''} />
                <div className="n" style={{ fontSize: 16 }}>{p.name}</div>
                <div className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.address || ''}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {detail && <PlaceDetail p={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
