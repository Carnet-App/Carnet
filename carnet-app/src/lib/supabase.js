import { createClient } from '@supabase/supabase-js';

// The publishable key is designed to be public; row-level security decides what anyone can read.
export const SUPABASE_URL = 'https://mefdtuuvfzpegknhubpn.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Dqs26OK9TGbDdVEAMmkDgg_0bRFSHph';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { authorization: 'Bearer ' + t } : {};
}
