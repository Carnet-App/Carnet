// A fake Supabase: records every write, with an adjustable delay so races can be reproduced.
export const server = { rows: [], rev: {}, uploads: [], delayMs: 5, sessionDelayMs: 5 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const supabase = {
  auth: { getSession: async () => { await wait(server.sessionDelayMs); return { data: { session: { user: { id: 'u1' } } } }; } },
  from: (table) => ({
    upsert: (row) => {
      const run = (async () => { await wait(server.delayMs); server.rows.push({ table, row }); server.rev[row.id] = (server.rev[row.id] || 0) + 1; return { data: [{ revision: server.rev[row.id] }], error: null }; })();
      return { then: (a, b) => run.then(a, b), select: () => run };
    },
    delete: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ limit: async () => ({ data: [], error: null }) }),
  }),
  storage: { from: () => ({ upload: async (path) => { await wait(server.delayMs); server.uploads.push(path); return { error: null }; }, createSignedUrl: async () => ({ data: null }) }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
};
export const authHeader = async () => ({});
