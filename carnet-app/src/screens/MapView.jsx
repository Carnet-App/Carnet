import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 looks for its worker next to its own module; once bundled, that file isn't there and
// the map never draws its streets. Have Vite ship the worker and point MapLibre at it.
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
maplibregl.setWorkerUrl(new URL(mapWorkerUrl, location.href).href);
import { Icon, CatTag } from '../ui';
import { cat, useLocation, stayFor, todayISO, walkMin, distM, dayLabel } from '../lib/util';
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

// A small white glyph per kind of place, drawn on the pin in that category's colour.
const GLYPH = {
  eat: 'M7 3v7M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17 3c-2.2 2-2.2 6.5 0 8.5V21',
  drink: 'M5 4h14l-7 8zM12 12v8M8 20h8',
  coffee: 'M5 9h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2 2 0 0 1 0 4H16M9 3.5v2.5M12.5 3.5v2.5',
  dance: 'M9 17.5V5.5l10-2v12M9 17.5a2.5 2.5 0 1 1-2.5-2.5 2.5 2.5 0 0 1 2.5 2.5zM19 15.5a2.5 2.5 0 1 1-2.5-2.5 2.5 2.5 0 0 1 2.5 2.5z',
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  culture: 'M3 9.5l9-5.5 9 5.5M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3 20h18',
  other: 'M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z',
};
// A pin: the category glyph in a coloured circle, with the place's name beside it. Names show once
// you're zoomed in enough for them not to pile up (and always for the one you've picked).
function pin(p, { selected, dim }) {
  const c = cat(p.category);
  const el = document.createElement('div');
  el.className = 'pin' + (selected ? ' pin-on' : '');
  const size = selected ? 34 : 26;
  el.style.cssText = `display:flex;align-items:center;gap:5px;cursor:pointer;opacity:${dim && !selected ? 0.55 : 1};z-index:${selected ? 3 : 1}`;
  el.innerHTML = `<span style="flex:none;width:${size}px;height:${size}px;border-radius:50%;background:${c.color};border:2.5px solid #FAF8F3;box-shadow:0 1px 5px rgba(30,26,22,.35);display:flex;align-items:center;justify-content:center"><svg width="${size * 0.55}" height="${size * 0.55}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPH[p.category] || GLYPH.other}"/></svg></span><span class="pin-label" style="font:600 12px/1.15 var(--sans);color:#1E1A16;background:rgba(250,248,243,.92);padding:2px 6px;border-radius:7px;box-shadow:0 1px 3px rgba(30,26,22,.18);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis"></span>`;
  el.querySelector('.pin-label').textContent = p.name;
  return el;
}
const LABEL_ZOOM = 14.2;

export default function MapView({ t, places, onClose, focus }) {
  const box = useRef();
  const map = useRef();
  const markers = useRef([]);
  const cardRefs = useRef({});
  const pos = useLocation();
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [cat_, setCat] = useState('all');
  const home = t ? stayFor(t.stays, todayISO()) : null;
  const allPins = [
    ...places.filter((p) => p.lat != null),
    ...(t?.items || []).filter((i) => i.lat != null && !i.place_id && (i.visibility !== 'busy' || i.mine_private)).map((i) => ({ id: i.id, name: i.title, lat: i.lat, lng: i.lng, category: i.category, address: i.address })),
  ];
  const pins = allPins.filter((p) => cat_ === 'all' || p.category === cat_);
  // Where the places actually are: the middle of them (median, so one stray pin can't drag it).
  const mid = (k) => { const v = allPins.map((p) => p[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const hub = allPins.length ? { lat: mid('lat'), lng: mid('lng') } : t?.trip.center_lat ? { lat: t.trip.center_lat, lng: t.trip.center_lng } : null;
  const inTown = (p) => p && (!hub || distM(hub, p) < 30000);
  // You, or where you're staying — but only when that's in the same city as the places. On the way
  // there (or with a stay whose address landed in the wrong town) the map stays on the city.
  const here = inTown(pos) ? pos : null;
  const homeOk = inTown(home) ? home : null;
  const homeAway = home && !homeOk && allPins.length >= 3;
  const ref = here || homeOk;
  const near = pins.map((p) => ({ ...p, walk: walkMin(ref, p), d: distM(ref || hub, p) })).sort((a, b) => (a.d ?? 9e9) - (b.d ?? 9e9));
  const center = here || homeOk || hub || places.find((p) => p.lat != null);

  useEffect(() => {
    map.current = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: center ? [center.lng, center.lat] : [2.3522, 48.8566],
      zoom: center ? 13.5 : 11,
      attributionControl: { compact: true },
    });
    // No one to centre on: frame the places themselves (the ones in town).
    if (!here && !homeOk && allPins.length > 1) {
      const town = allPins.filter(inTown);
      if (town.length > 1) {
        const lngs = town.map((p) => p.lng), lats = town.map((p) => p.lat);
        map.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: { top: 150, bottom: 230, left: 40, right: 40 }, maxZoom: 15, duration: 0 });
      }
    }
    map.current.on('click', () => setSel(null));
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
      const el = pin(p, { selected: p.id === sel, dim: far(p) });
      el.onclick = (e) => { e.stopPropagation(); setSel(p.id); };
      // Anchor the circle (not the whole pill) on the spot.
      const size = p.id === sel ? 34 : 26;
      markers.current.push(new maplibregl.Marker({ element: el, anchor: 'left', offset: [-size / 2, 0] }).setLngLat([p.lng, p.lat]).addTo(m));
    }
    const labels = () => box.current?.classList.toggle('map-labels', m.getZoom() >= LABEL_ZOOM);
    labels();
    m.off('zoom', m._labels); m._labels = labels; m.on('zoom', labels);
    if (homeOk) {
      const h = document.createElement('div');
      h.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F3EEE6" stroke-width="2"><path d="M4 11l8-7 8 7v9H4z"/></svg>';
      h.style.cssText = 'width:26px;height:26px;border-radius:8px;background:#1E1A16;display:flex;align-items:center;justify-content:center';
      markers.current.push(new maplibregl.Marker({ element: h }).setLngLat([homeOk.lng, homeOk.lat]).addTo(m));
    }
    if (here) markers.current.push(new maplibregl.Marker({ element: dot('#1E1A16', 14) }).setLngLat([here.lng, here.lat]).addTo(m));
    const setWalk = () => m.getSource('walk')?.setData({ type: 'FeatureCollection', features: ref ? [circle(ref, WALK15)] : [] });
    m.isStyleLoaded() ? setWalk() : m.once('load', setWalk);
  }, [pins.length, cat_, here?.lat, here?.lng, homeOk?.id, sel]);

  useEffect(() => {
    const p = pins.find((x) => x.id === (sel || focus));
    if (p && map.current) map.current.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.current.getZoom(), 15), offset: [0, -60] });
    if (p) cardRefs.current[p.id]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    if (focus && !sel) setSel(focus);
  }, [sel, focus]);

  const placeById = (id) => places.find((p) => p.id === id);
  const selP = (() => {
    const p = near.find((x) => x.id === sel);
    if (!p) return null;
    const it = (t?.items || []).find((i) => i.place_id === p.id || i.id === p.id);
    return { ...p, status: it?.status, day: it?.day };
  })();

  return (
    <div className="sheet-back" style={{ alignItems: 'stretch' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', background: '#EFE8DC' }}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', left: 14, right: 14, top: 'calc(env(safe-area-inset-top) + 12px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="card between" style={{ boxShadow: '0 4px 14px rgba(30,26,22,.08)' }}>
            <div><div className="k amber">{t?.trip.city || places[0]?.city} · {pins.length} places</div><div className="n" style={{ fontSize: 20 }}>Map</div></div>
            <button className="icon" aria-label="Close map" onClick={onClose}><Icon n="close" size={18} /></button>
          </div>
          {homeAway && <div className="card s" style={{ padding: '8px 12px' }}>Your stay ({home.name}) is pinned {Math.round(distM(hub, home) / 1000)} km from your places, so it’s left off the map. Check its address in the trip settings.</div>}
          <div className="chips">
            {['all', 'eat', 'drink', 'dance', 'coffee', 'explore', 'culture'].map((k) => (
              <button key={k} className={'chip' + (cat_ === k ? ' on' : '')} onClick={() => setCat(k)}>{k === 'all' ? 'All' : cat(k).label}</button>
            ))}
          </div>
        </div>
        {selP ? (
          <div style={{ position: 'absolute', left: 14, right: 14, bottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
            <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: '0 6px 20px rgba(30,26,22,.18)' }}>
              <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center' }}>
                <PlacePhoto p={selP} size={72} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <CatTag c={selP.category} extra={selP.walk != null ? `${selP.walk} min walk` : ''} />
                  <div className="n" style={{ fontSize: 19 }}>{selP.name}</div>
                  <div className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selP.address || ''}</div>
                  {selP.status && <div className="s" style={{ marginTop: 2 }}>On the trip · {selP.status === 'idea' ? 'idea' : selP.status}{selP.day ? ` · ${dayLabel(selP.day)}` : ''}</div>}
                </div>
                <button className="icon" aria-label="Close" onClick={() => setSel(null)} style={{ alignSelf: 'flex-start' }}><Icon n="close" size={16} /></button>
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid var(--line)' }}>
                {placeById(selP.id) && <button className="btn ghost" style={{ flex: 1, border: 0, borderRadius: 0 }} onClick={() => setDetail(placeById(selP.id))}>Details</button>}
                <a className="btn ghost" style={{ flex: 1, border: 0, borderLeft: placeById(selP.id) ? '1px solid var(--line)' : 0, borderRadius: 0, textAlign: 'center', textDecoration: 'none' }}
                  href={/iPhone|iPad|Mac/.test(navigator.userAgent) ? `https://maps.apple.com/?daddr=${selP.lat},${selP.lng}&dirflg=w` : `https://www.google.com/maps/dir/?api=1&destination=${selP.lat},${selP.lng}&travelmode=walking`} target="_blank" rel="noopener">Directions</a>
              </div>
            </div>
          </div>
        ) : (
        <div className="hscroll" style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom) + 16px)', padding: '0 14px' }}>
          {near.slice(0, 25).map((p) => (
            <button key={p.id} ref={(el) => { cardRefs.current[p.id] = el; }} onClick={() => setSel(p.id)}
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
        )}
      </div>
      {detail && <PlaceDetail p={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
