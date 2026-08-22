/* Calendar, from the one place in Rhythm that can actually reach the network
   without asking anyone's permission.

   Two ways in, and the difference is the whole reason the desktop app was
   worth building:

   · A feed URL. No CORS in the main process, so the secret .ics address works
     directly — the same path the phone has to relay through the server.

   · Google, properly. A browser can only hold an access token that dies in an
     hour, which means re-consenting in the middle of the day; that was ruled
     out. A desktop app gets a REFRESH token: authorise once, and it keeps
     working. The loopback redirect flow is what makes that possible, and it
     needs a process that can open a socket — which is exactly what a browser
     tab is not.

   Read-only throughout: the scope asked for is calendar.readonly, and nothing
   here has a code path that writes. */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, shell, safeStorage } = require('electron');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_HOPS = 5;

/* ---------- feed URLs ----------
   The person types this themselves, so this is hygiene rather than a security
   boundary: no plain http (the URL is a credential and would go out in the
   clear), and nothing pointed back at their own machine, where "fetch this
   calendar" would really mean "read whatever is listening on that port". */
function checkFeedUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').replace(/^webcal:\/\//i, 'https://'));
  } catch {
    return { error: 'bad-url' };
  }
  if (u.protocol !== 'https:') return { error: 'https-only' };
  const h = u.hostname.toLowerCase();
  const local =
    h === 'localhost' || h === '::1' || h.endsWith('.local') ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (local) return { error: 'local-address' };
  return { url: u };
}

async function fetchIcs(rawUrl) {
  const checked = checkFeedUrl(rawUrl);
  if (checked.error) return { ok: false, error: checked.error };
  let url = checked.url;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const r = await fetch(url.toString(), {
        redirect: 'manual',
        headers: { Accept: 'text/calendar, text/plain;q=0.9', 'User-Agent': 'Rhythm/1.0 (calendar reader)' },
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) return { ok: false, error: 'redirect-without-location' };
        const next = checkFeedUrl(new URL(loc, url).toString());
        if (next.error) return { ok: false, error: `redirect-${next.error}` };
        url = next.url;
        continue;
      }
      if (!r.ok) return { ok: false, error: `upstream-${r.status}` };
      const text = await r.text();
      if (text.length > MAX_BYTES) return { ok: false, error: 'too-large' };
      if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: 'not-a-calendar' };
      return { ok: true, text };
    }
    return { ok: false, error: 'too-many-redirects' };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'fetch-failed' };
  }
}

/* ---------- token storage ----------
   A refresh token is a standing key to someone's calendar. Electron's
   safeStorage puts it behind the OS keychain (DPAPI on Windows); when that is
   unavailable the token is still written, because a feature that silently
   stops working is worse — but the file says plainly that it is not
   protected, so nobody is misled later. */
const tokenFile = () => path.join(app.getPath('userData'), 'calendar-tokens.json');

function saveTokens(data) {
  try {
    const json = JSON.stringify(data);
    let body;
    if (safeStorage.isEncryptionAvailable()) {
      body = { protected: true, blob: safeStorage.encryptString(json).toString('base64') };
    } else {
      body = { protected: false, note: 'The OS keychain was unavailable; this token is stored as plain text.', plain: data };
    }
    const tmp = tokenFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
    fs.renameSync(tmp, tokenFile());
  } catch (e) {
    console.error('[calendar] token save failed:', e.message);
  }
}

function loadTokens() {
  try {
    const body = JSON.parse(fs.readFileSync(tokenFile(), 'utf8'));
    if (body.protected) return JSON.parse(safeStorage.decryptString(Buffer.from(body.blob, 'base64')));
    return body.plain || null;
  } catch {
    return null;
  }
}

function clearTokens() {
  try { fs.unlinkSync(tokenFile()); } catch { /* already gone */ }
}

/* ---------- the loopback OAuth dance ----------
   Google's desktop flow: send the person to their browser (never an embedded
   window — Google refuses those, and rightly), listen on a loopback port for
   the redirect, swap the code for tokens. PKCE throughout, so the code is
   useless to anything that did not start the flow. */
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function authorize(clientId, clientSecret) {
  return new Promise((resolve) => {
    if (!clientId) return resolve({ ok: false, error: 'no-client-id' });

    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let settled = false;
    const finish = (out) => { if (settled) return; settled = true; try { server.close(); } catch {} clearTimeout(timer); resolve(out); };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const reply = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Rhythm</title>
          <body style="font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0;background:#F4FAF6;color:#1E332C">
          <div style="text-align:center"><h1 style="font-weight:600">${msg}</h1>
          <p style="color:#6B8577">You can close this tab and go back to Rhythm.</p></div>`);
      };
      if (url.searchParams.get('state') !== state) { reply('Something went wrong.'); return finish({ ok: false, error: 'state-mismatch' }); }
      const err = url.searchParams.get('error');
      if (err) { reply('Rhythm was not given access.'); return finish({ ok: false, error: err }); }
      const code = url.searchParams.get('code');
      if (!code) { reply('Something went wrong.'); return finish({ ok: false, error: 'no-code' }); }
      reply('Rhythm can read your calendar.');

      const port = server.address().port;
      const body = new URLSearchParams({
        code, client_id: clientId, code_verifier: verifier,
        redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code',
      });
      // A "Desktop app" client has a secret that is not really secret — it
      // ships with the app — but Google still wants it on this call.
      if (clientSecret) body.set('client_secret', clientSecret);
      try {
        const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const j = await r.json();
        if (!r.ok || !j.refresh_token) {
          return finish({ ok: false, error: j.error_description || j.error || 'no-refresh-token' });
        }
        saveTokens({
          clientId, clientSecret: clientSecret || '',
          refreshToken: j.refresh_token,
          accessToken: j.access_token,
          expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
        });
        finish({ ok: true });
      } catch (e) {
        finish({ ok: false, error: (e && e.message) || 'token-exchange-failed' });
      }
    });

    const timer = setTimeout(() => finish({ ok: false, error: 'timed-out' }), 5 * 60 * 1000);

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        // Both are needed to be *given* a refresh token rather than just an
        // access token — which is the entire point of doing this here.
        access_type: 'offline',
        prompt: 'consent',
      });
      shell.openExternal(`${AUTH_URL}?${params}`);
    });
    server.on('error', (e) => finish({ ok: false, error: e.message }));
  });
}

async function accessToken() {
  const t = loadTokens();
  if (!t || !t.refreshToken) return null;
  if (t.accessToken && Date.now() < t.expiresAt - 60_000) return t.accessToken;
  const body = new URLSearchParams({
    client_id: t.clientId, refresh_token: t.refreshToken, grant_type: 'refresh_token',
  });
  if (t.clientSecret) body.set('client_secret', t.clientSecret);
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    // A revoked or expired grant is not a transient error — the person has to
    // authorise again, and pretending otherwise just retries forever.
    if (j.error === 'invalid_grant') clearTokens();
    throw new Error(j.error_description || j.error || 'refresh-failed');
  }
  saveTokens({ ...t, accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

async function apiGet(pathname, params) {
  const token = await accessToken();
  if (!token) return { ok: false, error: 'not-connected' };
  const r = await fetch(`${API}${pathname}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: (j.error && j.error.message) || `http-${r.status}` };
  return { ok: true, body: j };
}

async function listCalendars() {
  const r = await apiGet('/users/me/calendarList', { minAccessRole: 'reader', maxResults: '250' });
  if (!r.ok) return r;
  return {
    ok: true,
    calendars: (r.body.items || []).map((c) => ({
      id: c.id, name: c.summaryOverride || c.summary || c.id,
      primary: !!c.primary, color: c.backgroundColor || '', selected: !!c.selected,
    })),
  };
}

/* Instances, in the same shape calendar.js produces from a feed, so the
   planner above cannot tell which route the day came in by.

   singleEvents=true asks Google to expand the recurrence itself — including
   every exception and moved instance, which its own data model knows better
   than any client re-deriving them from an RRULE. */
async function listEvents(calendarId, fromMs, toMs) {
  const out = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const params = {
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      timeMin: new Date(fromMs).toISOString(),
      timeMax: new Date(toMs).toISOString(),
    };
    if (pageToken) params.pageToken = pageToken;
    const r = await apiGet(`/calendars/${encodeURIComponent(calendarId)}/events`, params);
    if (!r.ok) return r;
    for (const e of r.body.items || []) {
      if (e.status === 'cancelled') continue;
      // "transparent" is the person saying it does not hold their time.
      if (e.transparency === 'transparent') continue;
      const allDay = !!(e.start && e.start.date);
      const startMs = allDay ? localMidnight(e.start.date) : Date.parse(e.start.dateTime);
      const endMs = allDay ? localMidnight(e.end.date) : Date.parse(e.end.dateTime);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      out.push({ uid: e.id, summary: e.summary || '(busy)', location: e.location || '', allDay, startMs, endMs });
    }
    pageToken = r.body.nextPageToken || '';
    if (!pageToken) break;
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return { ok: true, instances: out };
}

// An all-day date is a calendar square, not an instant: it means that day
// wherever it is read, so it becomes local midnight rather than UTC midnight.
function localMidnight(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

const status = () => {
  const t = loadTokens();
  return { connected: !!(t && t.refreshToken), protectedStore: safeStorage.isEncryptionAvailable() };
};

const disconnect = () => { clearTokens(); return { ok: true }; };

module.exports = { fetchIcs, authorize, listCalendars, listEvents, status, disconnect, checkFeedUrl };
