import { useEffect, useState, lazy, Suspense } from 'react';
import { supabase } from './lib/supabase';
import { loadLocal, startSync, useStore, retryNow, getState, patch } from './lib/store';
import { googleFill } from './lib/googleFill';
import { stayFor, todayISO } from './lib/util';
import { TabBar, Icon } from './ui';
import Login from './screens/Login';
import Home from './screens/Home';
import Today from './screens/Today';
import Plan from './screens/Plan';
import Places from './screens/Places';
import Wallet from './screens/Wallet';
import Money from './screens/Money';
import Capture from './screens/Capture';
import Crew from './screens/Crew';
const MapView = lazy(() => import('./screens/MapView'));
import { useTrip } from './lib/hooks';
import { recoverOwnProposals } from './lib/proposals';
import { setMe } from './lib/me';

const saved = (() => { try { return JSON.parse(localStorage.getItem('carnet-route')) || {}; } catch { return {}; } })();

export default function App() {
  const [session, setSession] = useState(undefined);
  const [route, setRoute] = useState({ view: 'home', tab: 'today', ...saved, overlay: null });
  const online = useStore((s) => s.online);
  const pending = useStore((s) => s.outbox.length);
  const failed = useStore((s) => s.failed);

  useEffect(() => {
    loadLocal();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) startSync(); }, [session?.user?.id]);
  useEffect(() => {
    const { overlay, ...keep } = route;
    localStorage.setItem('carnet-route', JSON.stringify(keep));
  }, [route]);

  const go = (r) => setRoute((x) => ({ ...x, overlay: null, ...r }));
  setMe(session);
  const me = session?.user?.email?.toLowerCase();

  if (session === undefined) return <div className="app" />;
  if (!session) return <Login />;

  const status = failed.length
    ? `${failed.length} change${failed.length > 1 ? 's' : ''} not saved to the server — kept on this phone`
    : !online ? `Offline${pending ? ` · ${pending} waiting to sync` : ''}` : pending ? `Syncing ${pending}…` : null;

  return (
    <div className="app">
      {status && <div className="status" title={failed[0]?.error} onClick={() => { if (!failed.length) return; if (confirm(`Server said: ${failed[failed.length - 1].error}\n\nTry sending ${failed.length > 1 ? 'them' : 'it'} again now?`)) retryNow(); }}>{status}</div>}
      {route.view === 'home' && <Home me={me} go={go} />}
      {route.view === 'guide' && <Places city={route.city} me={me} go={go} onBack={() => go({ view: 'home' })} />}
      {route.view === 'trip' && <TripShell myId={session?.user?.id} route={route} go={go} me={me} setRoute={setRoute} />}
    </div>
  );
}

function TripShell({ route, go, me, myId, setRoute }) {
  const t = useTrip(route.tripId, me, myId);
  // Changes refused as proposals while the app wrongly thought you needed approval: apply them now.
  useEffect(() => { recoverOwnProposals(t); }, [t.canEdit, t.trip?.id]);
  // Once the trip has synced, let Google finish your unfinished places and add missing photos.
  const placeCount = t.places?.length || 0;
  useEffect(() => {
    if (!t.trip || t.trip.kind === 'tab' || !myId || !placeCount || !navigator.onLine) return;
    const timer = setTimeout(() => {
      const city = t.trip.city;
      const places = Object.values(getState().places).filter((p) => p.city?.toLowerCase() === city?.toLowerCase());
      const pins = places.filter((p) => p.lat != null && !p.needs_check);
      const mid = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
      const stay = stayFor(t.stays || [], todayISO());
      const centre = pins.length >= 3 ? { lat: mid(pins.map((p) => p.lat)), lng: mid(pins.map((p) => p.lng)) } : stay ? { lat: stay.lat, lng: stay.lng } : pins[0] || null;
      googleFill(places, { myId, city, centre, save: (id, f) => patch('places', id, f) }).catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [t.trip?.id, myId, placeCount]);
  if (!t.trip) return (
    <div className="page"><div className="empty">This trip isn’t on this phone yet.<br /><button className="btn" style={{ marginTop: 14 }} onClick={() => go({ view: 'home' })}>Back to trips</button></div></div>
  );
  const open = (overlay) => setRoute((x) => ({ ...x, overlay }));
  const close = () => setRoute((x) => ({ ...x, overlay: null }));
  const props = { t, me, go, open, route };
  if (t.trip.kind === 'tab') {
    // A one-off tab: just the money, no schedule.
    return (
      <>
        <button className="link" style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 2px)', left: 20, textDecoration: 'none', zIndex: 5 }} onClick={() => go({ view: 'home' })}>‹ Carnet</button>
        <div style={{ paddingTop: 20 }}><Money {...props} /></div>
        <button className="btn sm ghost" style={{ position: 'fixed', right: 'max(20px, calc(50% - 260px))', bottom: 'calc(24px + env(safe-area-inset-bottom))', background: 'var(--card)' }} onClick={() => open({ name: 'crew' })}>People</button>
        {route.overlay?.name === 'crew' && <Crew t={t} me={me} onClose={close} go={go} />}
      </>
    );
  }
  const Tab = { today: Today, plan: Plan, places: Places, wallet: Wallet, money: Money }[route.tab] || Today;
  return (
    <>
      <Tab {...props} city={t.trip.city} />
      {route.overlay !== 'capture' && (
        <button className="fab" aria-label="Add or capture" onClick={() => open({ name: 'capture' })}>
          <Icon n="plus" color="#F3EEE6" size={24} w={2} />
        </button>
      )}
      <TabBar tab={route.tab} setTab={(tab) => go({ tab })} />
      {route.overlay?.name === 'capture' && <Capture t={t} me={me} onClose={close} go={go} />}
      {route.overlay?.name === 'crew' && <Crew t={t} me={me} onClose={close} go={go} />}
      {route.overlay?.name === 'map' && <Suspense fallback={null}><MapView t={t} places={t.places} onClose={close} focus={route.overlay.focus} /></Suspense>}
    </>
  );
}
