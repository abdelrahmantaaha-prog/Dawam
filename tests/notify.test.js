/* Regression net for the Capacitor thenable-assimilation hang.

   Capacitor's registerPlugin proxy answers EVERY property access with a
   native-method invoker — including `then`. So if the plugin proxy ever
   passes through promise machinery (returned from an async function,
   awaited, Promise.resolve'd), the engine probes `.then`, gets a function,
   treats the plugin as a thenable, and calls proxy.then(resolve, reject).
   The invoker fires a native call named "then" (rejected as not implemented)
   and never invokes resolve/reject — so the awaiting promise NEVER settles.
   On device this hung every notification path forever, upstream of every
   timeout guard.

   These tests run notify.js against a proxy with exactly that behaviour.
   If anyone reintroduces an `await` on the plugin object, the first test
   stops resolving and fails on vitest's timeout. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));

import { permissionState, pendingCount, isNative } from '../src/notify.js';

/* Mimics registerPlugin: known methods work; every OTHER property — `then`
   included — returns an invoker that never calls the callbacks it was given. */
function capacitorishProxy(impl) {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop in impl) return impl[prop];
      return () => undefined; // a bogus `then`: swallows resolve/reject, settles nothing
    },
  });
}

const nativeWindow = (impl) => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { LocalNotifications: capacitorishProxy(impl) },
  },
});

beforeEach(() => { delete globalThis.window; });
afterEach(() => { delete globalThis.window; vi.useRealTimers(); });

describe('notify — plugin proxy never passes through promise machinery', () => {
  it('permissionState resolves against a then-trapping proxy (hang regression)', async () => {
    globalThis.window = nativeWindow({
      checkPermissions: () => Promise.resolve({ display: 'granted' }),
    });
    // If the proxy is ever awaited again, this never resolves and vitest
    // times the test out — that timeout IS the regression signal.
    await expect(permissionState()).resolves.toBe('granted');
  });

  it('pendingCount resolves and filters to reminder ids', async () => {
    globalThis.window = nativeWindow({
      checkPermissions: () => Promise.resolve({ display: 'granted' }),
      getPending: () => Promise.resolve({ notifications: [{ id: 1 }, { id: 1001 }, { id: 4242 }] }),
    });
    await expect(pendingCount()).resolves.toBe(2); // ongoing id 1 excluded
  });

  it('a checkPermissions that never settles resolves to "timeout", not a hang', async () => {
    vi.useFakeTimers();
    globalThis.window = nativeWindow({
      checkPermissions: () => new Promise(() => {}),
    });
    const p = permissionState();
    await vi.advanceTimersByTimeAsync(4100);
    await expect(p).resolves.toBe('timeout');
  });

  it('a rejecting native call surfaces as an error string, never a throw', async () => {
    globalThis.window = nativeWindow({
      checkPermissions: () => Promise.reject(new Error('boom')),
    });
    await expect(permissionState()).resolves.toBe('error: boom');
  });

  it('browser (no native bridge) stays unsupported and inert', async () => {
    await expect(isNative()).resolves.toBe(false);
    await expect(permissionState()).resolves.toBe('unsupported');
    await expect(pendingCount()).resolves.toBe(null);
  });
});
