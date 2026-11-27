// Carnet's Cloudflare Worker: serves the app, a few small API helpers, and a daily keep-alive.
// Secrets/vars (Cloudflare → Worker → Settings → Variables and Secrets):
//   SUPABASE_URL, SUPABASE_KEY (publishable)  — already in wrangler.jsonc
//   PRIM_TOKEN   (secret, optional)  Paris Métro/RER journey times
//   GOOGLE_KEY   (secret, optional)  last-resort venue search + photos
//   RESEND_KEY   (secret)            "join my trip" emails
//   VAPID_PRIVATE (secret)           push notifications (JSON key)

import { buildPushHTTPRequest } from '@pushforge/builder';

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
        name: x.name || null,
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
      name: pr.name || null, // a house or a street has no name of its own: don't invent one
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

// The address at a spot on the map (a pin dropped by hand). Photon's reverse lookup, free.
async function reverse(url) {
  const lat = +url.searchParams.get('lat'), lng = +url.searchParams.get('lng');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: 'lat and lng' }, 400);
  const p = new URL('https://photon.komoot.io/reverse');
  p.searchParams.set('lat', String(lat));
  p.searchParams.set('lon', String(lng));
  p.searchParams.set('lang', 'en');
  try {
    const r = await fetch(p, { headers: { 'user-agent': UA } });
    const pr = r.ok ? (await r.json()).features?.[0]?.properties : null;
    if (!pr) return json({ address: null });
    const address = [pr.housenumber, pr.street, pr.postcode, pr.city].filter(Boolean).join(' ') || pr.name || null;
    return json({ address, name: pr.name || null }, 200, { 'cache-control': 'public, max-age=86400' });
  } catch {
    return json({ address: null });
  }
}

// Places to eat, drink or get a coffee near a spot, from OpenStreetMap (free, no ratings):
// named venues only, chains left out, ranked by how well they're described and how close.
const NEARBY_KINDS = { eat: ['restaurant'], drink: ['bar', 'pub', 'biergarten'], coffee: ['cafe'] };
const NEARBY_HOSTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function nearby(url) {
  const lat = +url.searchParams.get('lat'), lng = +url.searchParams.get('lng');
  const kind = url.searchParams.get('kind') || 'eat';
  const r = Math.min(1500, Math.max(150, +url.searchParams.get('r') || 600));
  const am = NEARBY_KINDS[kind];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !am) return json({ error: 'lat, lng and kind (eat, drink, coffee)' }, 400);
  const q = `[out:json][timeout:12];nwr(around:${r},${lat.toFixed(5)},${lng.toFixed(5)})["amenity"~"^(${am.join('|')})$"]["name"];out center tags 120;`;
  let data = null;
  for (const host of NEARBY_HOSTS) {
    try {
      const res = await fetch(host, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: 'data=' + encodeURIComponent(q) });
      if (res.ok) { data = await res.json(); break; }
    } catch {}
  }
  if (!data) return json({ places: [], error: 'map data unavailable' }, 200);
  const toRad = (d) => (d * Math.PI) / 180;
  const dist = (a, b) => { const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2)), y = toRad(b.lat - a.lat); return Math.round(Math.sqrt(x * x + y * y) * 6371000); };
  const seen = new Set();
  const places = (data.elements || []).map((e) => {
    const t = e.tags || {};
    const at = e.center || { lat: e.lat, lon: e.lon };
    if (!t.name || at.lat == null || t.brand || t['brand:wikidata'] || t.disused || t['disused:amenity']) return null;
    const key = t.name.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    const p = { name: t.name, lat: at.lat, lng: at.lon };
    p.d = dist({ lat, lng }, p);
    p.address = [t['addr:housenumber'], t['addr:street'], t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ') || null;
    p.cuisine = t.cuisine ? t.cuisine.split(';').slice(0, 2).map((c) => c.replace(/_/g, ' ')).join(', ') : null;
    p.website = t.website || t['contact:website'] || null;
    p.hours = t.opening_hours || null;
    p.amenity = t.amenity;
    p.osm = `${e.type}/${e.id}`;
    // Better-described places first (someone cared to map them well), then nearer.
    p.score = (p.website ? 2 : 0) + (p.hours ? 1 : 0) + (p.cuisine ? 1 : 0) + (t.wikidata ? 1 : 0) + (t.outdoor_seating === 'yes' ? 0.5 : 0) - p.d / 250;
    return p;
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12);
  return json({ places }, 200, { 'cache-control': 'public, max-age=86400' });
}

// What the map says about the named places right at a spot: cuisine and opening hours, for
// filling in places already saved (the app matches the name). Free.
async function osmFacts(url) {
  const lat = +url.searchParams.get('lat'), lng = +url.searchParams.get('lng');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: 'lat and lng' }, 400);
  const q = `[out:json][timeout:10];nwr(around:80,${lat.toFixed(5)},${lng.toFixed(5)})["name"]["amenity"];out center tags 40;nwr(around:80,${lat.toFixed(5)},${lng.toFixed(5)})["name"]["tourism"];out center tags 20;`;
  for (const host of NEARBY_HOSTS) {
    try {
      const res = await fetch(host, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: 'data=' + encodeURIComponent(q) });
      if (!res.ok) continue;
      const data = await res.json();
      const places = (data.elements || []).map((e) => {
        const t = e.tags || {};
        return { name: t.name, cuisine: t.cuisine || null, hours: t.opening_hours || null, website: t.website || t['contact:website'] || null, amenity: t.amenity || t.tourism || null };
      }).filter((p) => p.name && (p.cuisine || p.hours));
      return json({ places }, 200, { 'cache-control': 'public, max-age=604800' });
    } catch {}
  }
  return json({ places: [], error: 'map data unavailable' }, 200);
}

// ── Google: a safety net on spending ──────────────────────────────────
// Google's free allowance is monthly (resets on the 1st, Pacific time). These caps keep Carnet
// just under it, across everyone's phones, until (and as well as) caps are set in Google Cloud.
// One "photo" is one picture fetched from Google (a details call plus the image); a picture
// already cached at Cloudflare costs nothing and isn't counted.
// "details" is opening hours and price for a place already matched: Google's pricier tier, with a
// smaller free allowance, so it gets its own, lower cap.
export const GOOGLE_CAPS = { search: { day: 160, month: 4800 }, photo: { day: 32, month: 950 }, details: { day: 30, month: 900 } };
const pacific = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// The counter lives in one small Durable Object so every phone and server shares it.
export class Limits {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const u = new URL(req.url);
    const day = u.searchParams.get('day') || pacific();
    const month = day.slice(0, 7);
    const s = this.state.storage;
    if (u.pathname === '/usage') {
      const out = {};
      for (const k of Object.keys(GOOGLE_CAPS)) out[k] = { today: (await s.get(`${k}:${day}`)) || 0, month: (await s.get(`${k}:${month}`)) || 0, caps: GOOGLE_CAPS[k] };
      return Response.json(out);
    }
    const kind = u.searchParams.get('kind');
    const cap = GOOGLE_CAPS[kind];
    if (!cap) return Response.json({ ok: false }, { status: 400 });
    const d = (await s.get(`${kind}:${day}`)) || 0;
    const m = (await s.get(`${kind}:${month}`)) || 0;
    if (d >= cap.day || m >= cap.month) return Response.json({ ok: false, today: d, month: m });
    await s.put({ [`${kind}:${day}`]: d + 1, [`${kind}:${month}`]: m + 1 });
    return Response.json({ ok: true, today: d + 1, month: m + 1 });
  }
}

// Without the counter (an older deploy), fall back to a count kept by this server copy alone.
const local = new Map();
export async function takeGoogle(env, kind) {
  if (env.LIMITS) {
    try {
      const stub = env.LIMITS.get(env.LIMITS.idFromName('google'));
      return (await (await stub.fetch(`https://limits/take?kind=${kind}`, { method: 'POST' })).json()).ok;
    } catch { /* counter unreachable: use the local count below */ }
  }
  const day = pacific(), k = `${kind}:${day}`;
  const n = local.get(k) || 0;
  if (n >= GOOGLE_CAPS[kind].day) return false;
  local.set(k, n + 1);
  return true;
}
async function googleUsage(env) {
  if (!env.LIMITS) return null;
  try { return await (await env.LIMITS.get(env.LIMITS.idFromName('google')).fetch('https://limits/usage')).json(); } catch { return null; }
}

async function google(url, env) {
  if (!env.GOOGLE_KEY) return json({ results: [], error: 'no google key' }, 404);
  if (!(await takeGoogle(env, 'search'))) return json({ results: [], error: 'limit' }, 429);
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

async function googlePhoto(url, env, ctx) {
  if (!env.GOOGLE_KEY) return new Response('no key', { status: 404 });
  const id = url.searchParams.get('id');
  if (!id) return new Response('no id', { status: 400 });
  // Each picture is fetched from Google once and then served from Cloudflare's cache for a
  // while, so looking at the list again doesn't cost another call.
  const edge = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://${url.host}/api/gphoto?id=${encodeURIComponent(id)}`);
  const hit = edge && (await edge.match(key));
  if (hit) return hit;
  if (!(await takeGoogle(env, 'photo'))) return new Response('limit', { status: 429, headers: { 'cache-control': 'no-store' } });
  const d = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    headers: { 'X-Goog-Api-Key': env.GOOGLE_KEY, 'X-Goog-FieldMask': 'photos' },
  }).then((r) => r.json());
  const name = d.photos?.[0]?.name;
  if (!name) return new Response('none', { status: 404, headers: { 'cache-control': 'max-age=86400' } });
  const img = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=640&key=${env.GOOGLE_KEY}`);
  if (!img.ok) return new Response('none', { status: 404, headers: { 'cache-control': 'no-store' } });
  const res = new Response(img.body, { headers: { 'content-type': img.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=604800' } });
  if (edge) { const put = edge.put(key, res.clone()); ctx?.waitUntil ? ctx.waitUntil(put) : await put; }
  return res;
}

// Opening hours and price level for a place Google has already matched. Asked once per place by
// the app; kept at Cloudflare for a month so a second phone asking costs nothing.
async function googleFacts(url, env, ctx) {
  if (!env.GOOGLE_KEY) return json({ error: 'no google key' }, 404);
  const id = url.searchParams.get('id');
  if (!id || !/^[\w-]{10,300}$/.test(id)) return json({ error: 'id' }, 400);
  const edge = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://${url.host}/api/gfacts?id=${encodeURIComponent(id)}`);
  const hit = edge && (await edge.match(key));
  if (hit) return hit;
  if (!(await takeGoogle(env, 'details'))) return json({ error: 'limit' }, 429);
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    headers: { 'X-Goog-Api-Key': env.GOOGLE_KEY, 'X-Goog-FieldMask': 'regularOpeningHours,priceLevel' },
  });
  if (!r.ok) return json({ error: 'google ' + r.status }, 502);
  const d = await r.json();
  const LEVEL = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
  const res = json({ hours: d.regularOpeningHours || null, price_level: LEVEL[d.priceLevel] || null }, 200, { 'cache-control': 'public, max-age=2592000' });
  if (edge) { const put = edge.put(key, res.clone()); ctx?.waitUntil ? ctx.waitUntil(put) : await put; }
  return res;
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

async function mapLink(url) {
  // Google Maps / Apple Maps share links → exact name and coordinates, free.
  let target = url.searchParams.get('url') || '';
  try {
    for (let i = 0; i < 6 && /goo\.gl|g\.co\//.test(new URL(target).hostname + new URL(target).pathname); i++) {
      const r = await fetch(target, { redirect: 'manual', headers: { 'user-agent': UA } });
      const loc = r.headers.get('location');
      if (!loc) break;
      target = new URL(loc, target).href;
    }
    const u = new URL(target);
    let name = null, lat = null, lng = null, address = null;
    if (/apple\.com$/.test(u.hostname)) {
      name = u.searchParams.get('q') || u.searchParams.get('name');
      const ll = (u.searchParams.get('ll') || u.searchParams.get('coordinate') || u.searchParams.get('sll') || '').split(',');
      if (ll.length === 2) { lat = +ll[0]; lng = +ll[1]; }
      address = u.searchParams.get('address');
    } else {
      const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
      if (place) name = decodeURIComponent(place[1].replace(/\+/g, ' '));
      const d = target.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || target.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (d) { lat = +d[1]; lng = +d[2]; }
      if (!name) name = u.searchParams.get('q')?.replace(/\+/g, ' ') || null;
      if (name && name.includes(',')) { address = name.split(',').slice(1).join(',').trim(); name = name.split(',')[0].trim(); }
    }
    return json({ name, lat, lng, address, resolved: target });
  } catch (e) {
    return json({ name: null, error: String(e) });
  }
}

async function transit(url, env, ctx) {
  // Paris only for now: Île-de-France Mobilités journey planner (PRIM). Optional `at` (YYYYMMDDTHHMM)
  // with arrive=1 plans to arrive by then (a plan's start); without it, leaving now.
  if (!env.PRIM_TOKEN) return json({ error: 'no transit token' }, 404);
  const [flat, flng] = (url.searchParams.get('from') || '').split(',').map(Number);
  const [tlat, tlng] = (url.searchParams.get('to') || '').split(',').map(Number);
  if (![flat, flng, tlat, tlng].every(Number.isFinite)) return json({ error: 'from and to as lat,lng' }, 400);
  const at = /^\d{8}T\d{4}$/.test(url.searchParams.get('at') || '') ? url.searchParams.get('at') : null;
  const arrive = !!at && url.searchParams.get('arrive') === '1';
  // Kept at Cloudflare for a few hours: the same hop at the same hour is asked once.
  const edge = typeof caches !== 'undefined' ? caches.default : null;
  const r3 = (n) => n.toFixed(3);
  const key = new Request(`https://${url.host}/api/transit?k=${r3(flat)},${r3(flng)},${r3(tlat)},${r3(tlng)},${at ? at.slice(0, 11) : 'now'},${arrive ? 'a' : 'd'}`);
  const hit = at && edge && (await edge.match(key));
  if (hit) return hit;
  const p = new URL('https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys');
  p.searchParams.set('from', `${flng};${flat}`);
  p.searchParams.set('to', `${tlng};${tlat}`);
  p.searchParams.set('count', '1');
  if (at) { p.searchParams.set('datetime', at + '00'); p.searchParams.set('datetime_represents', arrive ? 'arrival' : 'departure'); }
  const r = await fetch(p, { headers: { apikey: env.PRIM_TOKEN, accept: 'application/json' } });
  if (!r.ok) return json({ error: 'prim ' + r.status }, 502);
  const d = await r.json();
  const j = d.journeys?.[0];
  if (!j) return json({ error: 'no journey' }, 404);
  const secs = j.sections || [];
  const lines = secs
    .filter((s) => s.type === 'public_transport')
    .map((s) => s.display_informations?.code && `${s.display_informations.commercial_mode || ''} ${s.display_informations.code}`.trim())
    .filter(Boolean);
  const walking = secs.filter((s) => s.type === 'street_network' || s.type === 'transfer').reduce((n, s) => n + (s.duration || 0), 0);
  const hhmm = (t) => (t && t.length >= 13 ? `${t.slice(9, 11)}:${t.slice(11, 13)}` : null);
  const res = json({ minutes: Math.round(j.duration / 60), lines, walking: Math.round(walking / 60), depart: hhmm(j.departure_date_time), arrive: hhmm(j.arrival_date_time) },
    200, at ? { 'cache-control': 'public, max-age=21600' } : {});
  if (at && edge) { const put = edge.put(key, res.clone()); ctx?.waitUntil ? ctx.waitUntil(put) : await put; }
  return res;
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

async function notify(req, env) {
  // Sends a push to people on a trip. The database decides who: the caller must be on the trip,
  // and the caller's own phones are never included.
  if (!env.VAPID_PRIVATE) return json({ error: 'Push isn’t set up yet (VAPID_PRIVATE).' }, 404);
  const auth = req.headers.get('authorization');
  const { tripId, title, body, url, adminsOnly, onlyEmail, tag } = await req.json();
  const targets = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/trip_push_targets`, {
    method: 'POST',
    headers: { authorization: auth, apikey: env.SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ t: tripId, admins_only: !!adminsOnly, only_email: onlyEmail || null }),
  }).then((r) => (r.ok ? r.json() : []));
  const privateJWK = JSON.parse(env.VAPID_PRIVATE);
  let sent = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        const r = await buildPushHTTPRequest({
          privateJWK,
          subscription: { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          message: { payload: { title, body, url, tag }, adminContact: 'mailto:trips@mail.sebwalker.co.uk', options: { ttl: 60 * 60 * 12, urgency: 'high' } },
        });
        const res = await fetch(r.endpoint, { method: 'POST', headers: r.headers, body: r.body });
        if (res.status === 404 || res.status === 410) {
          await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/forget_push_endpoint`, {
            method: 'POST',
            headers: { authorization: auth, apikey: env.SUPABASE_KEY, 'content-type': 'application/json' },
            body: JSON.stringify({ e: t.endpoint }),
          });
        } else if (res.ok) sent++;
      } catch {}
    }),
  );
  return json({ ok: true, sent, targets: targets.length });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      switch (url.pathname) {
        case '/api/geo':
          return geo(url);
        case '/api/nearby':
          return nearby(url);
        case '/api/reverse':
          return reverse(url);
        case '/api/maplink':
          return mapLink(url);
        case '/api/og':
          return ogImage(url);
        case '/api/ig':
          return instagram(url);
        case '/api/google':
          if (!(await signedIn(req, env))) return json({ error: 'sign in' }, 401);
          return google(url, env);
        case '/api/osmfacts':
          return osmFacts(url);
        case '/api/gfacts':
          if (!(await signedIn(req, env))) return json({ error: 'sign in' }, 401);
          return googleFacts(url, env, ctx);
        case '/api/gphoto':
          return googlePhoto(url, env, ctx);
        case '/api/transit':
          if (!(await signedIn(req, env))) return json({ error: 'sign in' }, 401);
          return transit(url, env, ctx);
        case '/api/invite':
          if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
          return invite(req, env);
        case '/api/notify':
          if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
          return notify(req, env);
        case '/api/health':
          return json({ ok: true, transit: !!env.PRIM_TOKEN, google: !!env.GOOGLE_KEY, google_limits: !!env.LIMITS, google_usage: await googleUsage(env), email: !!env.RESEND_KEY, push: !!env.VAPID_PRIVATE });
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
