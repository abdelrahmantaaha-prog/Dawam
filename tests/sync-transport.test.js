/* How sync talks to the deployment — the two things that made the APK say it
   had no sync backend at all, against a deployment that was up and answering.

   1. The base was resolved once at module load from `window.Capacitor`. That
      makes sync depend on the native bridge winning a race against the bundle;
      losing it pins the base to '' forever, i.e. the app asking its own
      WebView for /api.

   2. Every call went out with credentials:'include'. The deployment answers a
      shell origin with Allow-Origin but deliberately no Allow-Credentials —
      that absence is what keeps the cookie session same-origin — and a browser
      fails such a response outright when the request asked for credentials.
      The /api/me probe threw instead of reading its own 200, so capability.sync
      stayed false and Settings reported no backend. Verified in a real browser
      against a fixture mirroring the deployment's headers: 'include' throws
      "Failed to fetch", 'omit' gets the 200. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DEPLOYMENT = 'https://rhythm-ruby.vercel.app';

function stubLocation(origin) {
  globalThis.location = { origin, href: origin + '/' };
}
function stubNative(isNative) {
  globalThis.window = { Capacitor: { isNativePlatform: () => isNative } };
}

beforeEach(() => {
  vi.resetModules();
  globalThis.localStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
    key: () => null, length: 0,
  };
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.location;
});

const load = () => import('../src/sync.js');

describe('where the API lives', () => {
  it('is same-origin in a browser, with no base prefix', async () => {
    stubLocation('https://rhythm-ruby.vercel.app');
    const { apiBase, credentialsMode } = await load();
    expect(apiBase()).toBe('');
    expect(credentialsMode()).toBe('same-origin');
  });

  it('is the deployment inside the app shell', async () => {
    stubNative(true);
    stubLocation('https://localhost');
    const { apiBase } = await load();
    expect(apiBase()).toBe(DEPLOYMENT);
  });

  it('is resolved per call, so a bridge that arrives after the bundle still counts', async () => {
    stubLocation('https://localhost');
    const { apiBase } = await load(); // imported with no Capacitor on window yet
    expect(apiBase()).toBe('');
    stubNative(true);
    expect(apiBase()).toBe(DEPLOYMENT);
  });
});

describe('credentials mode', () => {
  it('never asks for cookies cross-origin — the deployment sends no Allow-Credentials', async () => {
    stubNative(true);
    stubLocation('https://localhost');
    const { credentialsMode } = await load();
    expect(credentialsMode()).toBe('omit');
  });

  it('still carries the session cookie when the API is our own origin', async () => {
    stubNative(true);
    stubLocation(DEPLOYMENT);
    const { credentialsMode } = await load();
    expect(credentialsMode()).toBe('same-origin');
  });

  it('sends the device token as a Bearer header, and no credentials, from the shell', async () => {
    stubNative(true);
    stubLocation('https://localhost');
    globalThis.localStorage.getItem = (k) => (k === 'rhythm:sync:deviceToken' ? 'dt1.abc.def' : null);
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => ({}) }; };

    const { disconnect } = await load();
    await disconnect();

    const [url, init] = calls[0];
    expect(url).toBe(`${DEPLOYMENT}/api/sync`);
    expect(init.credentials).toBe('omit');
    expect(init.headers.Authorization).toBe('Bearer dt1.abc.def');
  });
});
