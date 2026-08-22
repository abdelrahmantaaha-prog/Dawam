/* Relaying one calendar feed, and nothing else.

   A browser cannot read a Google .ics feed directly: the response carries no
   CORS header, so the fetch is blocked before the app ever sees the text. The
   desktop shell has no such problem and never comes here; this exists for the
   deployed site and the phone.

   The danger in a relay is that it fetches whatever it is told to — a way to
   reach a cloud metadata endpoint or something inside a private network from
   the outside. So this is not a proxy. It is a calendar reader:

     · https only, and only the hosts that actually serve calendar feeds;
     · redirects followed by hand, with every hop re-checked against the same
       list — an allowlisted host that 302s to 169.254.169.254 is the whole
       attack, and "follow" would have walked straight into it;
     · a size cap, so a hostile URL cannot stream until the function dies;
     · a timeout, and no request headers carried through from the caller.

   The URL itself is a secret — a Google feed address is the credential for
   reading that calendar — so nothing here logs it. */

const ALLOW = [
  /^calendar\.google\.com$/i,
  /^www\.google\.com$/i,                 // the /calendar/ical/... form
  /^p\d{2}-caldav\.icloud\.com$/i,
  /^p\d{2}-calendars\.icloud\.com$/i,
  /^outlook\.(?:office365|office|live)\.com$/i,
  /^outlook\.office365\.com$/i,
  /^([a-z0-9-]+\.)*calendar\.yahoo\.com$/i,
  /^([a-z0-9-]+\.)*zoho\.com$/i,
  /^([a-z0-9-]+\.)*fastmail\.com$/i,
];

const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_HOPS = 4;

export const hostAllowed = (host) => ALLOW.some((re) => re.test(String(host || '')));

export function checkUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').replace(/^webcal:\/\//i, 'https://'));
  } catch {
    return { error: 'bad-url' };
  }
  if (u.protocol !== 'https:') return { error: 'https-only' };
  if (!hostAllowed(u.hostname)) return { error: 'host-not-allowed' };
  return { url: u };
}

/* Follows redirects one at a time so each hop can be checked. */
export async function readFeed(rawUrl, { fetchImpl = fetch } = {}) {
  let target = checkUrl(rawUrl);
  if (target.error) return { status: 400, error: target.error };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let url = target.url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const r = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: ac.signal,
        headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1', 'User-Agent': 'Rhythm/1.0 (calendar reader)' },
      });

      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) return { status: 502, error: 'redirect-without-location' };
        const next = checkUrl(new URL(loc, url).toString());
        if (next.error) return { status: 400, error: `redirect-${next.error}` };
        url = next.url;
        continue;
      }

      if (!r.ok) return { status: r.status === 404 ? 404 : 502, error: `upstream-${r.status}` };

      const len = Number(r.headers.get('content-length') || 0);
      if (len && len > MAX_BYTES) return { status: 413, error: 'too-large' };

      const text = await r.text();
      if (text.length > MAX_BYTES) return { status: 413, error: 'too-large' };
      // A sign-in page is a 200 too. Saying "that link is not a feed" beats
      // handing the app some HTML to fail on later.
      if (!/BEGIN:VCALENDAR/i.test(text)) return { status: 422, error: 'not-a-calendar' };
      return { status: 200, text };
    }
    return { status: 502, error: 'too-many-redirects' };
  } catch (e) {
    return { status: 504, error: e && e.name === 'AbortError' ? 'timeout' : 'fetch-failed' };
  } finally {
    clearTimeout(timer);
  }
}
