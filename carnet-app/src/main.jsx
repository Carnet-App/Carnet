import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

// New versions: checked at start, whenever you come back to the app (iPhones resume it rather than
// reopening it, so it would otherwise keep an old version for days), and every 20 minutes while open.
// With autoUpdate the new version takes over and the page reloads by itself.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    let last = Date.now();
    const check = () => { if (navigator.onLine && Date.now() - last > 60000) { last = Date.now(); reg.update().catch(() => {}); } };
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    setInterval(check, 20 * 60000);
  },
});
// Ask iOS to keep our offline data (trips, guides, unsynced costs).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')).render(<App />);

// The old map cache could hold an out-of-date tile index (blank map); it's replaced by map-index/map-tiles.
try { globalThis.caches?.delete('map'); } catch {}
