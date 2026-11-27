// Local-first store: the phone's copy is the one the app reads from.
// Every change is written locally at once, queued, and sent to Supabase when there's signal.
import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

export const TABLES = ['trips', 'trip_members', 'stays', 'places', 'items', 'private_notes', 'expenses', 'settlements', 'proposals', 'place_ratings'];

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
// Columns added by later database scripts. Until a script has run, the server refuses a row that
// carries them: send the rest; the full row stays on this phone and goes up once the column exists.
const NEWER = {
  items: ['tickets', 'photos', 'alternatives'],
  places: ['cuisine', 'price_level', 'price_text', 'hours', 'facts_src', 'google_id'],
};
function withoutNewer(table, row, error) {
  // The server names only the first column it doesn't know, so if it names any of them, hold all.
  const msg = error?.message || '';
  if (!NEWER[table].some((k) => msg.includes(k))) return row;
  const rest = { ...row };
  for (const k of NEWER[table]) delete rest[k];
  return rest;
}
let inFlight = null; // the job being sent right now

function enqueue(job) {
  const same = (j) => j.table === job.table && (j.row?.id || j.id) === (job.row?.id || job.id) && j.jid !== inFlight;
  // A newer write of the same row replaces one still waiting (it carries the whole row anyway).
  // A partial update keeps everything before it (it only adds fields); a delete clears all of them.
  const keep = job.op === 'update' ? state.outbox : job.op === 'upsert' ? state.outbox.filter((j) => !(j.op === 'upsert' && same(j))) : state.outbox.filter((j) => !same(j));
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

// Failed changes, and taking some back off the list once they've been dealt with another way.
export const failedJobs = () => state.failed;
export function dropFailed(pred) {
  const n = state.failed.length;
  state.failed = state.failed.filter((j) => !pred(j));
  if (state.failed.length !== n) { persist(); emit(); }
}

// Change some fields of a row that already exists on the server, sent as a plain UPDATE. An upsert
// would be checked against the INSERT rule too, and for proposals that rule only lets the person
// who proposed it insert — so an admin's approve/decline must go this way.
export function patch(table, id, fields) {
  const before = state[table][id];
  const full = { ...fields, updated_at: new Date().toISOString() };
  state[table] = { ...state[table], [id]: { ...(before || { id }), ...full } };
  enqueue({ jid: uid(), table, op: 'update', id, fields: full });
  emit();
  persist();
  flush();
  return state[table][id];
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
  if (job.op === 'update') {
    const res = await supabase.from(job.table).update(job.fields).eq('id', job.id);
    if (res.error && NEWER[job.table]) {
      const rest = withoutNewer(job.table, job.fields, res.error);
      if (Object.keys(rest).length < Object.keys(job.fields).length) return Object.keys(rest).length > 1 ? supabase.from(job.table).update(rest).eq('id', job.id) : { error: null };
    }
    return res;
  }
  const row = clean(job.table, job.row);
  if (!VERSIONED.has(job.table)) {
    const res = await supabase.from(job.table).upsert(row);
    // Newer columns (tickets, photos) the server may not have yet, until its database script runs:
    // send the rest; the full lists stay on this phone and go up once the column exists.
    if (res.error && NEWER[job.table]) {
      const rest = withoutNewer(job.table, row, res.error);
      if (Object.keys(rest).length < Object.keys(row).length) return supabase.from(job.table).upsert(rest);
    }
    return res;
  }
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
// The banner's "Try again": send refused changes now.
export function retryNow() { requeueFailed(); flush(); }

export function requeueFailed() {
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

// Coming back to the app (iOS resumes it rather than reopening): give refused changes another go.
if (typeof document !== 'undefined') {
  let last = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.failed.length && Date.now() - last > 30000) { last = Date.now(); requeueFailed(); flush(); }
  });
}

export function startSync() {
  requeueFailed();
  const goOnline = () => { state.online = true; requeueFailed(); emit(); flush().then(pull); };
  const goOffline = () => { state.online = false; emit(); };
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && goOnline());
  flush().then(pull);
  // Anything the server refused: tried again every 2 minutes while the app is open, so a fix on
  // the server side gets it through without anyone pressing a button.
  setInterval(() => { if (state.failed.some((j) => !j.conflict) && navigator.onLine) { requeueFailed(); flush(); } }, 2 * 60000);
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
