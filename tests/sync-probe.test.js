// @vitest-environment jsdom
/* The capability probe must not give up on one failed lookup. A desktop that
   started before its network was up got net::ERR_NAME_NOT_RESOLVED from the
   boot probe and told the user it had "no sync backend" until restarted. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const DEPLOYMENT = 'https://rhythm-ruby.vercel.app';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host, latest;
async function mount() {
  const { useSync } = await import('../src/sync.js');
  function Probe() { latest = useSync({ localVersion: 0, onApplied: () => {}, loaded: false }); return null; }
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => { root.render(React.createElement(Probe)); });
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function desktopAnswering(answers) {
  const request = vi.fn(async () => answers.length > 1 ? answers.shift() : answers[0]);
  window.rhythmFocus = { sync: { base: async () => DEPLOYMENT, request } };
  return request;
}
const DOWN = { ok: false, status: 0, error: 'net::ERR_NAME_NOT_RESOLVED' };
const UP = { ok: true, status: 200, body: JSON.stringify({ sync: true, auth: true, db: true, user: null }) };

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); });
afterEach(async () => {
  await act(async () => { root.unmount(); });
  delete window.rhythmFocus;
  vi.useRealTimers();
});

describe('the sync capability probe', () => {
  it('reports an unreachable server, then finds it on the next try', async () => {
    const request = desktopAnswering([DOWN, UP]);
    await mount(); await flush();
    expect(latest.capability.sync).toBe(false);
    expect(latest.capability.unreachable).toBe(true);
    expect(latest.capability.probe).toBe(DEPLOYMENT + '/api/me');   // not rhythm://app/api/me
    await act(async () => { vi.advanceTimersByTime(5000); }); await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(latest.capability.sync).toBe(true);
    expect(latest.status).toBe('signed-out');
  });

  it('asks again as soon as the network comes back', async () => {
    const request = desktopAnswering([DOWN, UP]);
    await mount(); await flush();
    await act(async () => { window.dispatchEvent(new Event('online')); }); await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(latest.capability.sync).toBe(true);
  });

  it('stops asking once the deployment has answered, even with no backend', async () => {
    const request = desktopAnswering([{ ok: false, status: 404, body: '' }]);
    await mount(); await flush();
    expect(latest.capability.unreachable).toBe(false);
    await act(async () => { vi.advanceTimersByTime(10 * 60000); window.dispatchEvent(new Event('online')); }); await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('Try again now re-asks without waiting for the backoff', async () => {
    const request = desktopAnswering([DOWN, DOWN, UP]);
    await mount(); await flush();
    await act(async () => { latest.recheck(); }); await flush();
    await act(async () => { latest.recheck(); }); await flush();
    expect(request).toHaveBeenCalledTimes(3);
    expect(latest.capability.sync).toBe(true);
  });
});
