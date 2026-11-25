// A fake Supabase: records every write, with an adjustable delay so races can be reproduced.
export const server = { rows: [], delayMs: 5, sessionDelayMs: 5 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const supabase = {
  auth: { getSession: async () => { await wait(server.sessionDelayMs); return { data: { session: { user: { id: 'u1' } } } }; } },
  from: (table) => ({
    upsert: async (row) => { await wait(server.delayMs); server.rows.push({ table, row }); return { error: null }; },
    delete: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ limit: async () => ({ data: [], error: null }) }),
  }),
  storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null }) }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
};
export const authHeader = async () => ({});
