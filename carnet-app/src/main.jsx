import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({ immediate: true });
// Ask iOS to keep our offline data (trips, guides, unsynced costs).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')).render(<App />);
