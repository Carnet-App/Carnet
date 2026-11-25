// Swaps browser-only modules for in-memory stand-ins in the unit suite.
const here = new URL('./', import.meta.url);
export async function resolve(specifier, context, next) {
  const parent = context.parentURL || '';
  if (specifier === 'idb-keyval') return { url: new URL('idb.mjs', here).href, shortCircuit: true };
  if (/\/src\/lib\//.test(parent) && specifier === './supabase') return { url: new URL('supabase.mjs', here).href, shortCircuit: true };
  return next(specifier, context);
}
