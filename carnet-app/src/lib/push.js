// Push notifications. On iPhone these only work once Carnet is added to the Home Screen.
import { supabase, authHeader } from './supabase';
import { uid } from './store';

export const VAPID_PUBLIC = 'BN8gZEKlGAcG3rrhveWJigGp6dDf856YPC0_DGdJsoDlgGFftHcOoY2dL8H1Sn_CS2NeH6z5aatcFE5ZqNy8gCw';

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isStandalone() ? 'unsupported' : 'needs-home-screen';
  }
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

function keyToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Must be called from a tap (iOS only asks for permission in response to one).
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC) });
  const j = sub.toJSON();
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ id: uid(), endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint', ignoreDuplicates: false });
  if (error) throw new Error(error.message);
  return 'granted';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}

// Fire-and-forget: tell the crew. Never blocks or breaks the action that triggered it.
export async function notify(tripId, { title, body, url, adminsOnly = false, onlyEmail = null, tag }) {
  if (!navigator.onLine) return;
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ tripId, title, body, url: url || '/', adminsOnly, onlyEmail, tag }),
    });
  } catch {}
}
