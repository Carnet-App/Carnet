import test from 'node:test';
import assert from 'node:assert/strict';
import { pickGoogle, googleFill, PER_DAY } from '../../src/lib/googleFill.js';
import worker, { Limits, GOOGLE_CAPS, takeGoogle } from '../../worker/index.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
globalThis.localStorage = mem();
const centre = { lat: 48.8606, lng: 2.3522 };
const g = (name, lat, lng, extra = {}) => ({ name, lat, lng, address: `1 Rue X, 75003 Paris`, osm_value: 'bar', google_id: 'G' + name.length, source: 'google', ...extra });

test('an unpinned place takes Google’s pin, address and photo when the name is a sure match', () => {
  const f = pickGoogle({ name: 'Stolen Moon', lat: null }, [g('Stolen Moon', 48.861, 2.36)], { city: 'Paris', centre });
  assert.equal(f.lat, 48.861); assert.equal(f.needs_check, false); assert.ok(f.address); assert.match(f.photo_url, /^\/api\/gphoto\?id=/);
});
test('a weak name match changes nothing', () => {
  assert.equal(pickGoogle({ name: 'Stolen Moon', lat: null }, [g('Moonlight Kebab', 48.861, 2.36)], { city: 'Paris', centre }), null);
});
test('a namesake in another city is ignored', () => {
  assert.equal(pickGoogle({ name: 'Le Comptoir', lat: null }, [g('Le Comptoir', 45.76, 4.83)], { city: 'Paris', centre }), null);
});
test('a pinned place only takes a photo from a Google place right where the pin is', () => {
  const p = { name: 'Le Syndicat', lat: 48.8712, lng: 2.3553, address: 'x', category: 'drink' };
  assert.equal(pickGoogle(p, [g('Le Syndicat', 48.80, 2.30)], { city: 'Paris', centre }), null);
  const f = pickGoogle(p, [g('Le Syndicat', 48.8713, 2.3554)], { city: 'Paris', centre });
  assert.deepEqual(Object.keys(f), ['photo_url']);
});
test('a place with its own photo keeps it', () => {
  const f = pickGoogle({ name: 'Stolen Moon', lat: null, photo_path: 'a.jpg' }, [g('Stolen Moon', 48.861, 2.36)], { city: 'Paris', centre });
  assert.equal(f.photo_url, undefined);
});

test('the fill pass only touches my places, tries each once, and stops at the server’s limit', async () => {
  globalThis.localStorage = mem();
  const places = [
    { id: 'a', name: 'Stolen Moon', owner: 'me', lat: null },
    { id: 'b', name: 'Someone Else’s', owner: 'them', lat: null },
    { id: 'c', name: 'Done Already', owner: 'me', lat: 48.86, lng: 2.35, address: 'x', photo_url: 'y' },
    { id: 'd', name: 'Bar Nope', owner: 'me', lat: null },
  ];
  const saved = {}; const asked = [];
  const fetchResults = async (q) => { asked.push(q); return q.startsWith('Stolen') ? [g('Stolen Moon', 48.861, 2.36)] : []; };
  const r = await googleFill(places, { myId: 'me', city: 'Paris', centre, save: (id, f) => (saved[id] = f), fetchResults });
  assert.deepEqual(asked, ['Stolen Moon Paris', 'Bar Nope Paris']);
  assert.equal(r.pinned, 1); assert.equal(r.photos, 1); assert.ok(saved.a && !saved.b);
  const again = await googleFill(places.map((p) => (saved[p.id] ? { ...p, ...saved[p.id] } : p)), { myId: 'me', city: 'Paris', centre, save: () => {}, fetchResults });
  assert.equal(again, null, 'nothing left to try');

  globalThis.localStorage = mem();
  const lim = await googleFill(places, { myId: 'me', city: 'Paris', centre, save: () => {}, fetchResults: async () => { throw new Error('limit'); } });
  assert.equal(lim.stopped, 'limit'); assert.equal(lim.tried, 0);
});

test('one phone spends at most PER_DAY searches a day', async () => {
  globalThis.localStorage = mem();
  const many = Array.from({ length: PER_DAY + 5 }, (_, i) => ({ id: 'p' + i, name: 'Place ' + i, owner: 'me', lat: null }));
  const r = await googleFill(many, { myId: 'me', city: 'Paris', centre, save: () => {}, fetchResults: async () => [] });
  assert.equal(r.tried, PER_DAY); assert.equal(r.stopped, 'day');
});

// ── Server-side caps ──
const store = () => { const m = new Map(); return { get: async (k) => m.get(k), put: async (o) => Object.entries(o).forEach(([k, v]) => m.set(k, v)) }; };
const ns = (obj) => ({ idFromName: () => 'id', get: () => ({ fetch: (u, i) => obj.fetch(new Request(u, i)) }) });

test('the shared counter refuses past the daily cap', async () => {
  const lim = new Limits({ storage: store() });
  const env = { LIMITS: ns(lim) };
  for (let i = 0; i < GOOGLE_CAPS.photo.day; i++) assert.equal(await takeGoogle(env, 'photo'), true);
  assert.equal(await takeGoogle(env, 'photo'), false);
  assert.equal(await takeGoogle(env, 'search'), true, 'each kind has its own cap');
});

test('Google search answers 429 without calling Google once the cap is reached', async () => {
  const lim = new Limits({ storage: store() });
  const env = { LIMITS: ns(lim), GOOGLE_KEY: 'k', SUPABASE_URL: 'https://s', SUPABASE_KEY: 'x' };
  for (let i = 0; i < GOOGLE_CAPS.search.day; i++) await takeGoogle(env, 'search');
  let calledGoogle = false;
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => { if (String(u).includes('/auth/v1/user')) return new Response('{}'); calledGoogle = true; return new Response('{}'); };
  try {
    const res = await worker.fetch(new Request('https://x/api/google?q=a', { headers: { authorization: 'Bearer t' } }), env, {});
    assert.equal(res.status, 429); assert.equal(calledGoogle, false);
    const ph = await worker.fetch(new Request('https://x/api/gphoto?id=abc'), { ...env, LIMITS: ns(Object.assign(new Limits({ storage: store() }), {})) }, {});
    assert.notEqual(ph.status, 429);
  } finally { globalThis.fetch = real; }
});
