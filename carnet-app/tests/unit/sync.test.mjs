import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../harness/stubs/supabase.mjs';

test('F9: two quick saves both reach the server exactly once', async () => {
  const store = await import('../../src/lib/store.js');
  server.rows.length = 0;
  store.upsert('expenses', { id: 'e1', amount: 10 });
  store.upsert('expenses', { id: 'e2', amount: 20 });
  await new Promise((r) => setTimeout(r, 200));
  const sent = server.rows.filter((x) => x.table === 'expenses').map((x) => x.row.id).sort();
  assert.deepEqual(sent, ['e1', 'e2'], `server received ${JSON.stringify(sent)}`);
  assert.equal(store.getState().outbox.length, 0);
});

test('F9: an edit queued behind its own first save carries the new revision as its base', async () => {
  const store = await import('../../src/lib/store.js');
  server.rows.length = 0;
  store.upsert('expenses', { id: 'e3', amount: 10 });
  await new Promise((r) => setTimeout(r, 8)); // the first write is on its way
  store.upsert('expenses', { id: 'e3', amount: 12 });
  await new Promise((r) => setTimeout(r, 200));
  const sent = server.rows.filter((x) => x.row.id === 'e3');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].row.base_revision, null);
  assert.equal(sent[1].row.base_revision, 1, 'second write is based on the revision the first one made');
  assert.notEqual(sent[0].row.op_id, sent[1].row.op_id);
});

test('waiting writes of the same row collapse into one', async () => {
  const store = await import('../../src/lib/store.js');
  server.rows.length = 0;
  server.delayMs = 50;
  store.upsert('expenses', { id: 'a1', amount: 1 });
  await new Promise((r) => setTimeout(r, 15));
  store.upsert('expenses', { id: 'a2', amount: 1 });
  store.upsert('expenses', { id: 'a2', amount: 2 });
  store.upsert('expenses', { id: 'a2', amount: 3 });
  await new Promise((r) => setTimeout(r, 400));
  server.delayMs = 5;
  const a2 = server.rows.filter((x) => x.row.id === 'a2');
  assert.equal(a2.length, 1);
  assert.equal(a2[0].row.amount, 3);
});

test('F10: a photo waiting for signal is a saved job, not a memory-only queue', async () => {
  const store = await import('../../src/lib/store.js');
  const { db } = await import('../harness/stubs/idb.mjs');
  globalThis.navigator ??= {};
  const was = navigator.onLine;
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  await store.saveBlob('trips/t/x.jpg', { type: 'image/jpeg' });
  store.queueUpload('trips/t/x.jpg');
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(db.get('carnet-state').outbox.some((j) => j.op === 'upload' && j.id === 'trips/t/x.jpg'), 'saved to the phone');
  Object.defineProperty(navigator, 'onLine', { value: was ?? true, configurable: true });
  server.uploads.length = 0;
  await store.flush();
  assert.deepEqual(server.uploads, ['trips/t/x.jpg']);
  assert.equal(store.getState().outbox.length, 0);
});
