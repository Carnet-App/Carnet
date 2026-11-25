import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.js';

const photon = (features) => async () => new Response(JSON.stringify({ features }), { headers: { 'content-type': 'application/json' } });

test('defect 7: a nameless map result stays nameless', async () => {
  globalThis.fetch = photon([{ properties: { street: 'Rue de Beauce', housenumber: '8', city: 'Paris', osm_value: 'house' }, geometry: { coordinates: [2.36, 48.86] } }]);
  try {
    const res = await worker.fetch(new Request('https://x/api/geo?q=Rojo%20Paris'), { SUPABASE_URL: 'x', SUPABASE_KEY: 'x' }, {});
    const { results } = await res.json();
    assert.notEqual(results[0].name, 'Rojo Paris');
    assert.notEqual(results[0].name, 'Rue de Beauce');
  } finally {
    globalThis.fetch = async (u) => { throw new Error(`Network call blocked in tests: ${u}`); };
  }
});
