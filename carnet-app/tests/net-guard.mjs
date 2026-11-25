// Any network call in the unit suite is a failure unless a test installs its own fake fetch.
import { register } from 'node:module';
register('./harness/stubs/loader.mjs', import.meta.url);
globalThis.__realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { throw new Error(`Network call blocked in tests: ${url}`); };
globalThis.navigator ??= {};
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, writable: true, configurable: true });
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
globalThis.document ??= { addEventListener() {}, visibilityState: 'visible' };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
