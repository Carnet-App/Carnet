import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({ immediate: true });
// Ask iOS to keep our offline data (trips, guides, unsynced costs).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')).render(<App />);

// The old map cache could hold an out-of-date tile index (blank map); it's replaced by map-index/map-tiles.
try { globalThis.caches?.delete('map'); } catch {}
