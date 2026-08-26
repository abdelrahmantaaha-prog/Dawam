/* The phone-link tokens. What matters: a minted token comes back to the same
   user, and nothing tampered, truncated, or foreign ever verifies. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { process.env.AUTH_SECRET = 'test-secret-of-decent-length'; vi.resetModules(); });
const load = () => import('../api/_auth.js');

describe('device tokens', () => {
  it('round-trips the user id', async () => {
    const { mintDeviceToken, verifyDeviceToken } = await load();
    const t = mintDeviceToken('google:12345');
    expect(t).toMatch(/^dt1\./);
    expect(verifyDeviceToken(t)).toBe('google:12345');
  });

  it('rejects a tampered payload', async () => {
    const { mintDeviceToken, verifyDeviceToken } = await load();
    const t = mintDeviceToken('google:12345');
    const [v, payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'google:9999', iat: Date.now() })).toString('base64url');
    expect(verifyDeviceToken(`${v}.${forged}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature, junk, and the empty string', async () => {
    const { mintDeviceToken, verifyDeviceToken } = await load();
    const t = mintDeviceToken('google:12345');
    expect(verifyDeviceToken(t.slice(0, -2) + 'xx')).toBeNull();
    expect(verifyDeviceToken('dt1.zzz')).toBeNull();
    expect(verifyDeviceToken('')).toBeNull();
    expect(verifyDeviceToken(null)).toBeNull();
  });

  it('a token minted under one secret dies with a rotated secret', async () => {
    const { mintDeviceToken } = await load();
    const t = mintDeviceToken('google:12345');
    process.env.AUTH_SECRET = 'a-brand-new-secret';
    vi.resetModules();
    const { verifyDeviceToken } = await load();
    expect(verifyDeviceToken(t)).toBeNull();
  });
});
