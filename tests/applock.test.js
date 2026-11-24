/* The browser build must never call a Capacitor API, and the lock must never
   throw — a phone that refuses lock task mode should leave the app's own
   overlay doing its job, not break the page that was meant to help. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let calls;
beforeEach(() => { calls = []; vi.resetModules(); delete globalThis.window; });
const load = () => import('../src/applock.js');

/* A Capacitor shim in the shape the real bridge installs: window.Capacitor
   with isNativePlatform() and a Plugins bag. */
function nativeShell(impl = {}) {
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        RhythmLock: {
          start: async () => { calls.push('start'); return impl.start ? impl.start() : { mode: 'pinned', held: true, escapable: true }; },
          stop: async () => { calls.push('stop'); return impl.stop ? impl.stop() : { mode: 'none', held: false, escapable: true }; },
          status: async () => { calls.push('status'); return impl.status ? impl.status() : { mode: 'none', held: false, escapable: true }; },
        },
      },
    },
  };
}

describe('the browser build', () => {
  it('reports no support and calls nothing', async () => {
    globalThis.window = {};                    // a page with no Capacitor at all
    const { lockSupported, holdDevice, releaseDevice, lockStatus } = await load();
    expect(lockSupported()).toBe(false);
    expect(await holdDevice()).toMatchObject({ supported: false, held: false });
    expect(await releaseDevice()).toMatchObject({ supported: false, held: false });
    expect(await lockStatus()).toMatchObject({ supported: false, held: false });
    expect(calls).toEqual([]);
  });
});

describe('on a phone', () => {
  it('holds and releases through the plugin', async () => {
    nativeShell();
    const { lockSupported, holdDevice, releaseDevice } = await load();
    expect(lockSupported()).toBe(true);
    expect(await holdDevice()).toMatchObject({ supported: true, held: true, mode: 'pinned' });
    expect(await releaseDevice()).toMatchObject({ supported: true, held: false, mode: 'none' });
    expect(calls).toEqual(['start', 'stop']);
  });

  it('reports a device-owner lock as the one that cannot be escaped', async () => {
    // The difference is not cosmetic: `pinned` can be left by holding two
    // buttons, and the card says so rather than claiming a cage it lacks.
    nativeShell({ start: () => ({ mode: 'locked', held: true, escapable: false }) });
    const { holdDevice } = await load();
    expect(await holdDevice()).toMatchObject({ mode: 'locked', held: true, escapable: false });
  });

  it('survives an OEM build that refuses outright', async () => {
    globalThis.window = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: { RhythmLock: { start: async () => { throw new Error('unsupported'); }, stop: async () => { throw new Error('nope'); }, status: async () => { throw new Error('nope'); } } },
      },
    };
    const { holdDevice, releaseDevice, lockStatus } = await load();
    expect(await holdDevice()).toMatchObject({ supported: true, held: false });
    expect(await releaseDevice()).toMatchObject({ supported: true, held: false });
    expect(await lockStatus()).toMatchObject({ supported: true, held: false });
  });
});

/* Native is not the same as Android. The iPad shell has a bridge too, and no
   RhythmLock behind it: registerPlugin would hand back a proxy whose every
   method is refused, and the Now page would say the device can be held. */
describe('on an iPad', () => {
  it('reports no support and calls nothing', async () => {
    nativeShell();
    globalThis.window.Capacitor.getPlatform = () => 'ios';
    const { lockSupported, holdDevice, releaseDevice, lockStatus } = await load();
    expect(lockSupported()).toBe(false);
    expect(await holdDevice()).toMatchObject({ supported: false, held: false });
    expect(await releaseDevice()).toMatchObject({ supported: false, held: false });
    expect(await lockStatus()).toMatchObject({ supported: false, held: false });
    expect(calls).toEqual([]);
  });
});
