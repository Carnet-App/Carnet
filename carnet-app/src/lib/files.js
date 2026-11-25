import { supabase } from './supabase';
import { saveBlob, loadBlob, uid, queueUpload } from './store';

// Keeps a copy on the phone (works offline) and uploads one for the crew when there's signal.
export async function storeFile(blob, { tripId } = {}) {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user?.id;
  const path = tripId ? `trips/${tripId}/${uid()}.jpg` : `users/${user}/${uid()}.jpg`;
  await saveBlob(path, blob);
  // Sent by the sync outbox, which is saved on the phone: an upload waiting for signal survives
  // the app being closed (F10).
  queueUpload(path, blob.type || 'image/jpeg');
  return path;
}

export async function fileUrl(path) {
  
  const b = await loadBlob(path).catch(() => null);
  if (b) return URL.createObjectURL(b);
  if (!navigator.onLine) return null;
  const { data } = await supabase.storage.from('captures').createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}
