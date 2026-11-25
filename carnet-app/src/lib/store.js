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
  // Jobs saved by an older version have no id.
  state.outbox = (state.outbox || []).map((j) => (j.jid ? j : { ...j, jid: uid() }));
  emit();
}

// Money rows carry a revision: each write says which revision it was based on and an operation
// id, so the server can refuse a stale overwrite and ignore a job it has already applied.
const VERSIONED = new Set(['expenses', 'settlements']);
let inFlight = null; // the job being sent right now

function enqueue(job) {
  const same = (j) => j.table === job.table && (j.row?.id || j.id) === (job.row?.id || job.id) && j.jid !== inFlight;
  // A newer write of the same row replaces one still waiting (it carries the whole row anyway).
  const keep = job.op === 'upsert' ? state.outbox.filter((j) => !(j.op === 'upsert' && same(j))) : state.outbox.filter((j) => !same(j));
  const replaced = state.outbox.find((j) => j.op === 'upsert' && same(j));
  if (replaced && job.op === 'upsert') job.base = replaced.base;
  state.outbox = [...keep, job];
}

export function upsert(table, row) {
  const before = state[table][row.id];
  const full = { ...row, updated_at: new Date().toISOString() };
  state[table] = { ...state[table], [full.id]: { ...(before || {}), ...full } };
  enqueue({ jid: uid(), table, op: 'upsert', row: state[table][full.id], base: VERSIONED.has(table) ? before?.revision ?? null : undefined });
  emit();
  persist();
  flush();
  return state[table][full.id];
}

export function remove(table, id) {
  const next = { ...state[table] };
  delete next[id];
  state[table] = next;
  enqueue({ jid: uid(), table, op: 'delete', id });
  emit();
  persist();
  flush();
}

// A file kept on the phone and still to be uploaded: a job in the same saved outbox, so it
// survives the app closing (it used to live in memory only).
export function queueUpload(path, contentType = 'image/jpeg') {
  enqueue({ jid: uid(), table: 'storage', op: 'upload', id: path, contentType });
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

// One drain at a time. The guard is taken before anything is awaited, so two quick saves
// can't start two drains that send the same job twice or skip one (F9). A call that arrives
// mid-drain asks for another pass instead.
let flushP = null;
let again = false;
export function flush() {
  if (flushP) { again = true; return flushP; }
  flushP = (async () => {
    try {
      do { again = false; await drain(); } while (again && navigator.onLine);
    } finally {
      flushP = null;
    }
  })();
  return flushP;
}

const done = (job) => {
  state.outbox = state.outbox.filter((j) => j.jid !== job.jid);
  emit();
  persist();
};
const isNetwork = (error) => /fetch|network|Failed|Load failed/i.test(error?.message || '') && !error?.code;

async function send(job) {
  if (job.op === 'upload') {
    const blob = await loadBlob(job.id).catch(() => null);
    if (!blob) return { error: null }; // nothing left to send
    return supabase.storage.from('captures').upload(job.id, blob, { contentType: blob.type || job.contentType, upsert: true });
  }
  if (job.op === 'delete') return supabase.from(job.table).delete().eq('id', job.id);
  const row = clean(job.table, job.row);
  if (!VERSIONED.has(job.table)) return supabase.from(job.table).upsert(row);
  delete row.last_op_id;
  const versioned = { ...row, op_id: job.jid, base_revision: job.base ?? null };
  let res = await supabase.from(job.table).upsert(versioned).select('revision');
  // Before the stage 2 database script runs, the server doesn't know these two columns yet.
  if (res.error && /op_id|base_revision/.test(res.error.message || '')) res = await supabase.from(job.table).upsert(row).select('revision');
  return res;
}

async function drain() {
  if (!navigator.onLine) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  while (state.outbox.length) {
    const job = state.outbox[0];
    inFlight = job.jid;
    let res;
    try { res = await send(job); } catch (e) { res = { error: { message: String(e?.message || e) } }; }
    inFlight = null;
    const { error } = res || {};
    if (error) {
      if (isNetwork(error)) return; // try again when signal returns
      // Someone else changed this row since we last saw it: theirs stands, ours is kept aside.
      const conflict = error.code === 'CA409' || /stale_revision/.test(error.message || '');
      state.failed = [...state.failed, { ...job, error: error.message, conflict, at: Date.now() }].slice(-30);
      console.warn('Sync rejected', job, error);
      done(job);
      if (conflict) setTimeout(pull, 0);
      continue;
    }
    // The server's new revision becomes the base for the next write of the same row.
    const revision = res?.data?.[0]?.revision;
    if (revision != null && job.op === 'upsert') {
      const id = job.row.id;
      if (state[job.table][id]) state[job.table] = { ...state[job.table], [id]: { ...state[job.table][id], revision } };
      state.outbox = state.outbox.map((j) => (j.op === 'upsert' && j.table === job.table && j.row.id === id ? { ...j, base: revision } : j));
    }
    done(job);
  }
}

export async function pull() {
  if (!navigator.onLine) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const pending = new Set([...state.outbox, ...state.failed.filter((j) => !j.conflict)].map((j) => j.table + ':' + (j.row?.id || j.id)));
  for (const table of TABLES) {
    const { data: rows, error } = await supabase.from(table).select('*').limit(5000);
    if (error) continue;
    const next = {};
    for (const r of rows) if (!r.deleted_at) next[r.id] = { ...(state[table][r.id] || {}), ...r };
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
// Conflicts aren't retried: the server's newer copy stands.
function requeueFailed() {
  const retry = state.failed.filter((j) => !j.conflict);
  if (!retry.length) return;
  for (const job of retry) {
    if (job.op === 'upsert') state[job.table] = { ...state[job.table], [job.row.id]: job.row };
  }
  state.outbox = [...retry.map(({ error, at, conflict, ...j }) => ({ ...j, jid: uid() })), ...state.outbox];
  state.failed = state.failed.filter((j) => j.conflict);
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
