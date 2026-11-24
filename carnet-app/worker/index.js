// Carnet's Cloudflare Worker: serves the app, a few small API helpers, and a daily keep-alive.
// Secrets/vars (Cloudflare → Worker → Settings → Variables and Secrets):
//   SUPABASE_URL, SUPABASE_KEY (publishable)  — already in wrangler.jsonc
//   PRIM_TOKEN   (secret, optional)  Paris Métro/RER journey times
//   GOOGLE_KEY   (secret, optional)  last-resort venue search + photos
//   RESEND_KEY   (secret)            "join my trip" emails

const UA = 'Carnet/1.0 (personal trip planner; trips.sebwalker.co.uk)';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });

async function signedIn(req, env) {
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { authorization: auth, apikey: env.SUPABASE_KEY },
  });
  return r.ok;
}

async function geo(url) {
  // OpenStreetMap search via Photon (free, no key).
  const q = url.searchParams.get('q') || '';
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const p = new URL('https://photon.komoot.io/api/');
  p.searchParams.set('q', q);
  p.searchParams.set('limit', url.searchParams.get('limit') || '5');
  p.searchParams.set('lang', 'en');
  if (lat && lng) {
    p.searchParams.set('lat', lat);
    p.searchParams.set('lon', lng);
    p.searchParams.set('location_bias_scale', '0.6');
  }
  let d = null;
  try {
    const r = await fetch(p, { headers: { 'user-agent': UA } });
    if (r.ok) d = await r.json();
  } catch {}
  if (!d?.features?.length) {
    // Fallback: OpenStreetMap's own search (Nominatim; light personal use only).
    const n = new URL('https://nominatim.openstreetmap.org/search');
    n.searchParams.set('q', q);
    n.searchParams.set('format', 'jsonv2');
    n.searchParams.set('addressdetails', '1');
    n.searchParams.set('limit', url.searchParams.get('limit') || '5');
    if (lat && lng) n.searchParams.set('viewbox', `${+lng - 0.3},${+lat + 0.2},${+lng + 0.3},${+lat - 0.2}`);
    const r2 = await fetch(n, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
    if (!r2.ok) return json({ results: [], error: 'search ' + r2.status }, 502);
    const rows = await r2.json();
    return json({
      results: rows.map((x) => ({
        name: x.name || x.display_name.split(',')[0],
        lat: +x.lat, lng: +x.lon,
        address: x.display_name.split(',').slice(1, 4).join(',').trim(),
        city: x.address?.city || x.address?.town || x.address?.village || '',
        osm_key: x.category, osm_value: x.type, source: 'osm',
      })),
    }, 200, { 'cache-control': 'public, max-age=86400' });
  }
  const results = (d.features || []).map((f) => {
    const pr = f.properties || {};
    const addr = [pr.housenumber, pr.street, pr.district || pr.locality, pr.postcode, pr.city]
      .filter(Boolean)
      .join(' ');
    return {
      name: pr.name || pr.street || q,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      address: addr,
      city: pr.city || pr.county || '',
      osm_key: pr.osm_key,
      osm_value: pr.osm_value,
      source: 'osm',
    };
  });
  return json({ results }, 200, { 'cache-control': 'public, max-age=86400' });
}

async function google(url, env) {
  if (!env.GOOGLE_KEY) return json({ results: [], error: 'no google key' }, 404);
  const q = url.searchParams.get('q') || '';
  const lat = +url.searchParams.get('lat');
  const lng = +url.searchParams.get('lng');
  const body = { textQuery: q, maxResultCount: 5 };
  if (lat && lng) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 8000 } };
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType',
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  const results = (d.places || []).map((p) => ({
    name: p.displayName?.text,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    address: p.formattedAddress,
    osm_value: p.primaryType,
    google_id: p.id,
    source: 'google',
  }));
  return json({ results });
}

async function googlePhoto(url, env) {
  // Fetched each time (Google's terms don't allow storing copies).
  if (!env.GOOGLE_KEY) return new Response('no key', { status: 404 });
  const id = url.searchParams.get('id');
  const d = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    headers: { 'X-Goog-Api-Key': env.GOOGLE_KEY, 'X-Goog-FieldMask': 'photos' },
  }).then((r) => r.json());
  const name = d.photos?.[0]?.name;
  if (!name) return new Response('none', { status: 404 });
  const img = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=640&key=${env.GOOGLE_KEY}`);
  return new Response(img.body, { headers: { 'content-type': img.headers.get('content-type') || 'image/jpeg' } });
}

async function ogImage(url) {
  // The preview image a venue's own website publishes for link sharing.
  const target = url.searchParams.get('url');
  if (!target || !/^https?:\/\//.test(target)) return json({ image: null }, 400);
  try {
    const r = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'follow' });
    const html = (await r.text()).slice(0, 200000);
    const m =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
    const desc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
    return json(
      { image: m ? new URL(m[1], target).href : null, title: title?.[1] || null, description: desc?.[1] || null },
      200,
      { 'cache-control': 'public, max-age=604800' },
    );
  } catch (e) {
    return json({ image: null, error: String(e) }, 502);
  }
}

async function instagram(url) {
  // Meta's public oEmbed (no token since June 2026): gives the caption, not the location tag.
  const target = url.searchParams.get('url');
  const r = await fetch(
    'https://graph.facebook.com/v25.0/instagram_oembed?omitscript=true&url=' + encodeURIComponent(target),
    { headers: { 'user-agent': UA } },
  );
  if (!r.ok) return json({ text: '', error: 'instagram ' + r.status }, 200);
  const d = await r.json();
  const text = (d.html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return json({ text, title: d.title || '' });
}

async function transit(url, env) {
  // Paris only for now: Île-de-France Mobilités journey planner (PRIM).
  if (!env.PRIM_TOKEN) return json({ error: 'no transit token' }, 404);
  const [flat, flng] = (url.searchParams.get('from') || '').split(',');
  const [tlat, tlng] = (url.searchParams.get('to') || '').split(',');
  const p = new URL('https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys');
  p.searchParams.set('from', `${flng};${flat}`);
  p.searchParams.set('to', `${tlng};${tlat}`);
  p.searchParams.set('count', '1');
  const r = await fetch(p, { headers: { apikey: env.PRIM_TOKEN, accept: 'application/json' } });
  if (!r.ok) return json({ error: 'prim ' + r.status }, 502);
  const d = await r.json();
  const j = d.journeys?.[0];
  if (!j) return json({ error: 'no journey' }, 404);
  const lines = (j.sections || [])
    .filter((s) => s.type === 'public_transport')
    .map((s) => s.display_informations?.code && `${s.display_informations.commercial_mode || ''} ${s.display_informations.code}`.trim())
    .filter(Boolean);
  return json({ minutes: Math.round(j.duration / 60), lines });
}

async function invite(req, env) {
  // Emails a "join my trip" invite. Only works for someone already on that trip.
  if (!env.RESEND_KEY) return json({ error: 'Email sending isn’t set up yet (RESEND_KEY).' }, 404);
  const auth = req.headers.get('authorization');
  const { tripId, email, name, from } = await req.json();
  const trip = await fetch(
    `${env.SUPABASE_URL}/rest/v1/trips?id=eq.${encodeURIComponent(tripId)}&select=name,city,start_date,end_date`,
    { headers: { authorization: auth, apikey: env.SUPABASE_KEY } },
  ).then((r) => (r.ok ? r.json() : []));
  if (!trip[0]) return json({ error: 'not on that trip' }, 403);
  const t = trip[0];
  const site = env.SITE_URL || 'https://trips.sebwalker.co.uk';
  const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const html = `<div style="background:#F3EEE6;padding:32px;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1E1A16">
    <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8A5A14;margin:0">Carnet</p>
    <h1 style="font-family:Garamond,Georgia,serif;font-weight:400;font-size:32px;margin:8px 0 16px">${esc(from)} added you to ${esc(t.name)}</h1>
    <p style="font-size:15px;line-height:1.5">Hi ${esc(name || '')} — you're on the trip to ${esc(t.city)} (${esc(t.start_date)} – ${esc(t.end_date)}). The plan, places, tickets and the shared tab are all in one place.</p>
    <p style="font-size:15px;line-height:1.5">Open the link below on your phone, sign in with <b>${esc(email)}</b>, then use Safari's Share → <b>Add to Home Screen</b>.</p>
    <p><a href="${site}" style="display:inline-block;background:#1E1A16;color:#F3EEE6;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600">Open the trip</a></p></div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Carnet <trips@mail.sebwalker.co.uk>',
      to: [email],
      subject: `${from} added you to ${t.name}`,
      html,
    }),
  });
  return r.ok ? json({ ok: true }) : json({ error: 'resend ' + r.status + ' ' + (await r.text()).slice(0, 200) }, 502);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      switch (url.pathname) {
        case '/api/geo':
          return geo(url);
        case '/api/og':
          return ogImage(url);
        case '/api/ig':
          return instagram(url);
        case '/api/google':
          if (!(await signedIn(req, env))) return json({ error: 'sign in' }, 401);
          return google(url, env);
        case '/api/gphoto':
          return googlePhoto(url, env);
        case '/api/transit':
          if (!(await signedIn(req, env))) return json({ error: 'sign in' }, 401);
          return transit(url, env);
        case '/api/invite':
          if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
          return invite(req, env);
        case '/api/health':
          return json({ ok: true, transit: !!env.PRIM_TOKEN, google: !!env.GOOGLE_KEY });
        default:
          return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },

  // Daily: touch the database so Supabase's free plan never pauses it.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      fetch(env.SUPABASE_URL + '/rest/v1/rpc/ping', {
        method: 'POST',
        headers: { apikey: env.SUPABASE_KEY, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
  },
};
