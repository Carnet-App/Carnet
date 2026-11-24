import { useState } from 'react';
import { supabase } from '../lib/supabase';

// A 6-digit code rather than a link: links open in Safari, not the home-screen app.
export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function send(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }
  async function verify(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setErr(error.message);
  }

  return (
    <div className="app">
      <div className="page" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 90px)', gap: 18 }}>
        <div>
          <div className="k amber">Trips, guides and the bill</div>
          <h1 className="h1" style={{ fontSize: 54 }}>Carnet</h1>
        </div>
        {!sent ? (
          <form className="col" onSubmit={send}>
            <label className="f">Your email
              <input className="in" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
            </label>
            <button className="btn block" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
            <div className="s">No password. You’ll get a 6-digit code to type in here.</div>
          </form>
        ) : (
          <form className="col" onSubmit={verify}>
            <label className="f">Code sent to {email}
              <input className="in" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" style={{ letterSpacing: '.3em', fontSize: 22 }} />
            </label>
            <button className="btn block" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
            <button type="button" className="link" onClick={() => setSent(false)}>Use a different email</button>
          </form>
        )}
        {err && <div className="card" style={{ color: '#A8472A' }}>{err}</div>}
      </div>
    </div>
  );
}
