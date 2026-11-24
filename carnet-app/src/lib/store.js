// Local-first store: the phone's copy is the one the app reads from.
// Every change is written locally at once, queued, and sent to Supabase when there's signal.
import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

export const TABLES = ['trips', 'trip_members', 'stays', 'places', 'items', 'private_notes', 'expenses', 'settlements', 'proposals'];

let state = { ...Object.fromEntries(TABLES.map((t) => [t, {}])), outbox: [], failed: [], online: navigator.onLine, syncedAt: null };
const listeners = new Set();

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { online, ...rest } = state;
    set('carnet-state', rest).catch(() => {});
  }, 150);
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selector(state),
  );
}
export const getState = () => state;

export const uid = () => crypto.randomUUID();

export async function loadLocal() {
  const saved = await get('carnet-state').catch(() => null);
  if (saved) state = { ...state, ...saved, online: navigator.onLine };
  for (const t of TABLES) state[t] = state[t] || {};
  emit();
}

export function upsert(table, row) {
  const full = { ...row, updated_at: new Date().toISOString() };
  state[table] = { ...state[table], [full.id]: { ...(state[table][full.id] || {}), ...full } };
  state.outbox = [...state.outbox, { table, op: 'upsert', row: state[table][full.id] }];
  emit();
  persist();
  flush();
  return state[table][full.id];
}

export function remove(table, id) {
  const next = { ...state[table] };
  delete next[id];
  state[table] = next;
  state.outbox = [...state.outbox, { table, op: 'delete', id }];
  emit();
  persist();
  flush();
}

// Columns that live only on this phone and never go to Supabase.
const LOCAL_ONLY = { places: ['photo_local'], items: ['attachment_local'] };
const clean = (table, row) => {
  const r = { ...row };
  (LOCAL_ONLY[table] || []).forEach((k) => delete r[k]);
  return r;
};

let flushing = false;
export async function flush() {
  if (flushing || !navigator.onLine) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  flushing = true;
  try {
    while (state.outbox.length) {
      const job = state.outbox[0];
      const q =
        job.op === 'upsert'
          ? supabase.from(job.table).upsert(clean(job.table, job.row))
          : supabase.from(job.table).delete().eq('id', job.id);
      const { error } = await q;
      if (error) {
        const network = /fetch|network|Failed/i.test(error.message || '') && !error.code;
        if (network) break; // try again when signal returns
        state.failed = [...state.failed, { ...job, error: error.message, at: Date.now() }].slice(-30);
        console.warn('Sync rejected', job, error);
      }
      state.outbox = state.outbox.slice(1);
      emit();
      persist();
    }
  } finally {
    flushing = false;
  }
}

export async function pull() {
  if (!navigator.onLine) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const pending = new Set([...state.outbox, ...state.failed].map((j) => j.table + ':' + (j.row?.id || j.id)));
  for (const table of TABLES) {
    const { data: rows, error } = await supabase.from(table).select('*').limit(5000);
    if (error) continue;
    const next = {};
    for (const r of rows) next[r.id] = { ...(state[table][r.id] || {}), ...r };
    // keep anything not yet sent, and local-only extras
    for (const [id, r] of Object.entries(state[table])) {
      if (pending.has(table + ':' + id) && !next[id]) next[id] = r;
      else if (pending.has(table + ':' + id)) next[id] = { ...next[id], ...r };
      else if (next[id]) for (const k of LOCAL_ONLY[table] || []) if (r[k]) next[id][k] = r[k];
    }
    state[table] = next;
  }
  state.syncedAt = new Date().toISOString();
  emit();
  persist();
}

let channel;
// Anything the server refused gets another go each time the app opens,
// so a fix on the server side brings it back rather than losing it.
function requeueFailed() {
  if (!state.failed.length) return;
  for (const job of state.failed) {
    if (job.op === 'upsert') state[job.table] = { ...state[job.table], [job.row.id]: job.row };
  }
  state.outbox = [...state.failed.map(({ error, at, ...j }) => j), ...state.outbox];
  state.failed = [];
  emit();
  persist();
}

export function startSync() {
  requeueFailed();
  const goOnline = () => { state.online = true; emit(); flush().then(pull); };
  const goOffline = () => { state.online = false; emit(); };
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && goOnline());
  flush().then(pull);
  let t;
  channel?.unsubscribe();
  channel = supabase
    .channel('carnet')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      clearTimeout(t);
      t = setTimeout(pull, 600);
    })
    .subscribe();
}

export async function resetLocal() {
  state = { ...Object.fromEntries(TABLES.map((t) => [t, {}])), outbox: [], failed: [], online: navigator.onLine, syncedAt: null };
  await set('carnet-state', null);
  emit();
}

// Blobs (screenshots, tickets) kept on the phone for offline viewing.
export const saveBlob = (key, blob) => set('blob:' + key, blob);
export const loadBlob = (key) => get('blob:' + key);
