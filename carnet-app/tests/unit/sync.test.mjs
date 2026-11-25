import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../harness/stubs/supabase.mjs';

test('F9: two quick saves both reach the server exactly once', { todo: 'F9 — flush() sets its guard after an await: two flushes run together, sending a job twice or dropping one (phase 1)' }, async () => {
  const store = await import('../../src/lib/store.js');
  server.rows.length = 0;
  store.upsert('expenses', { id: 'e1', amount: 10 });
  store.upsert('expenses', { id: 'e2', amount: 20 });
  await new Promise((r) => setTimeout(r, 200));
  const sent = server.rows.filter((x) => x.table === 'expenses').map((x) => x.row.id).sort();
  assert.deepEqual(sent, ['e1', 'e2'], `server received ${JSON.stringify(sent)}`);
  assert.equal(store.getState().outbox.length, 0);
});
