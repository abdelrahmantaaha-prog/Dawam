/* The calendar relay's guard rails.

   This endpoint fetches a URL a caller supplies, which is the shape of every
   server-side request forgery there has ever been. The tests below are the
   list of things it must refuse — including the one that matters most, an
   allowlisted host that redirects somewhere it should not. */

import { describe, it, expect, vi } from 'vitest';
import { checkUrl, hostAllowed, readFeed } from '../api/_ics.js';

const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const ok = (body, headers = {}) => ({
  ok: true, status: 200,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});
const redirect = (to) => ({
  ok: false, status: 302,
  headers: { get: (k) => (k.toLowerCase() === 'location' ? to : null) },
  text: async () => '',
});

describe('what the relay will fetch at all', () => {
  it('accepts the calendar hosts', () => {
    expect(hostAllowed('calendar.google.com')).toBe(true);
    expect(hostAllowed('outlook.office365.com')).toBe(true);
    expect(hostAllowed('p61-caldav.icloud.com')).toBe(true);
  });

  it('refuses everything else', () => {
    expect(hostAllowed('example.com')).toBe(false);
    expect(hostAllowed('169.254.169.254')).toBe(false);
    expect(hostAllowed('localhost')).toBe(false);
    expect(hostAllowed('calendar.google.com.evil.test')).toBe(false);
  });

  it('refuses plain http even on an allowed host', () => {
    expect(checkUrl('http://calendar.google.com/x.ics').error).toBe('https-only');
  });

  it('refuses a non-http scheme outright', () => {
    expect(checkUrl('file:///etc/passwd').error).toBe('https-only');
    expect(checkUrl('not a url').error).toBe('bad-url');
  });

  it('reads webcal:// as the https URL it really is', () => {
    const r = checkUrl('webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics');
    expect(r.error).toBeUndefined();
    expect(r.url.protocol).toBe('https:');
  });
});

describe('readFeed', () => {
  it('returns the feed text', async () => {
    const r = await readFeed('https://calendar.google.com/calendar/ical/a/private-b/basic.ics', { fetchImpl: async () => ok(FEED) });
    expect(r.status).toBe(200);
    expect(r.text).toContain('BEGIN:VCALENDAR');
  });

  it('re-checks every redirect hop instead of following blindly', async () => {
    // The attack this exists for: an allowed host that bounces you at the
    // cloud metadata service. `redirect: "follow"` would have gone there.
    const fetchImpl = vi.fn(async (url) =>
      url.includes('metadata') ? ok('secrets') : redirect('http://169.254.169.254/latest/meta-data/')
    );
    const r = await readFeed('https://calendar.google.com/x.ics', { fetchImpl });
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/redirect-/);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // it never made the second request
  });

  it('follows a redirect that stays on an allowed host', async () => {
    let hop = 0;
    const fetchImpl = async () => (hop++ === 0 ? redirect('https://www.google.com/calendar/ical/a/basic.ics') : ok(FEED));
    const r = await readFeed('https://calendar.google.com/x.ics', { fetchImpl });
    expect(r.status).toBe(200);
  });

  it('gives up rather than looping on a redirect cycle', async () => {
    const r = await readFeed('https://calendar.google.com/x.ics', { fetchImpl: async () => redirect('https://calendar.google.com/x.ics') });
    expect(r.status).toBe(502);
    expect(r.error).toBe('too-many-redirects');
  });

  it('says a sign-in page is not a calendar', async () => {
    const r = await readFeed('https://calendar.google.com/x.ics', { fetchImpl: async () => ok('<!doctype html><title>Sign in</title>') });
    expect(r.status).toBe(422);
    expect(r.error).toBe('not-a-calendar');
  });

  it('refuses a body that is too large, by header or by length', async () => {
    const byHeader = await readFeed('https://calendar.google.com/x.ics', {
      fetchImpl: async () => ok(FEED, { 'content-length': String(50 * 1024 * 1024) }),
    });
    expect(byHeader.status).toBe(413);

    const byBody = await readFeed('https://calendar.google.com/x.ics', {
      fetchImpl: async () => ok('BEGIN:VCALENDAR' + 'x'.repeat(7 * 1024 * 1024)),
    });
    expect(byBody.status).toBe(413);
  });

  it('passes an upstream failure through as a failure', async () => {
    const r = await readFeed('https://calendar.google.com/x.ics', {
      fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' }),
    });
    expect(r.status).toBe(404);
  });

  it('does not throw when the fetch itself blows up', async () => {
    const r = await readFeed('https://calendar.google.com/x.ics', {
      fetchImpl: async () => { throw new Error('network down'); },
    });
    expect(r.status).toBe(504);
    expect(r.error).toBe('fetch-failed');
  });
});
