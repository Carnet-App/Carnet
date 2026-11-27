import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
maplibregl.setWorkerUrl(new URL(mapWorkerUrl, location.href).href);
import { Sheet } from '../ui';
import { api, cat } from '../lib/util';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';

// Put a place on the map by hand: move the map until the pin in the middle sits on the door,
// then use that spot. The address is looked up for it (and can be typed instead if that fails).
export default function PinPicker({ p, start, onPick, onClose }) {
  const box = useRef(null);
  const map = useRef(null);
  const [busy, setBusy] = useState(false);
  const c = cat(p.category);
  const at = p.lat != null ? p : start;

  useEffect(() => {
    map.current = new maplibregl.Map({
      container: box.current, style: STYLE,
      center: at ? [at.lng, at.lat] : [2.3522, 48.8566], zoom: p.lat != null ? 17 : at ? 14 : 12,
      attributionControl: { compact: true },
    });
    map.current.on('load', () => {
      const m = map.current;
      for (const l of m.getStyle().layers) {
        if (l.type === 'background') m.setPaintProperty(l.id, 'background-color', '#EFE8DC');
        if (/water/.test(l.id) && l.type === 'fill') m.setPaintProperty(l.id, 'fill-color', '#C9D7D4');
      }
    });
    return () => map.current?.remove();
  }, []);

  async function use() {
    if (busy) return;
    setBusy(true);
    const { lat, lng } = map.current.getCenter();
    const spot = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    let address = null;
    try { address = (await api('/api/reverse', spot)).address || null; } catch {}
    onPick({ ...spot, address });
  }

  return (
    <Sheet title={p.lat != null ? 'Move the pin' : 'Pin it on the map'} onClose={onClose}>
      <div className="s">Move the map until the pin sits on {p.name}. Pinch to zoom in close.</div>
      <div style={{ position: 'relative', height: '52vh', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)' }}>
        <div ref={box} style={{ position: 'absolute', inset: 0, zIndex: 0, isolation: 'isolate' }} />
        {/* The pin stays in the middle; the map moves under it. Its tip marks the spot. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -100%)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, background: c.color, border: '3px solid #FAF8F3', boxShadow: '0 2px 6px rgba(30,26,22,.35)' }} />
          <span style={{ width: 3, height: 14, background: c.color, marginTop: -2 }} />
        </div>
      </div>
      <button className="btn block" onClick={use} disabled={busy}>{busy ? 'Finding the address…' : 'Use this spot'}</button>
    </Sheet>
  );
}
