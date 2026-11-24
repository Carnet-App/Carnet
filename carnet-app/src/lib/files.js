import { supabase } from './supabase';
import { saveBlob, loadBlob, uid } from './store';

// Keeps a copy on the phone (works offline) and uploads one for the crew when there's signal.
export async function storeFile(blob, { tripId } = {}) {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user?.id;
  const path = tripId ? `trips/${tripId}/${uid()}.jpg` : `users/${user}/${uid()}.jpg`;
  await saveBlob(path, blob);
  if (navigator.onLine) {
    supabase.storage.from('captures').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true }).catch(() => {});
  } else {
    pendingUploads.push(path);
  }
  return path;
}

const pendingUploads = [];
window.addEventListener('online', async () => {
  
  while (pendingUploads.length) {
    const p = pendingUploads.shift();
    const b = await loadBlob(p);
    if (b) await supabase.storage.from('captures').upload(p, b, { upsert: true }).catch(() => {});
  }
});

export async function fileUrl(path) {
  
  const b = await loadBlob(path).catch(() => null);
  if (b) return URL.createObjectURL(b);
  if (!navigator.onLine) return null;
  const { data } = await supabase.storage.from('captures').createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}
