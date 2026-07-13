/* ------------------------------------------------------------------ */
/*  Google Calendar — read-only.                                        */
/*                                                                      */
/*  Events flow one way: Google → Rhythm. We never write to the user's  */
/*  calendar. The access token comes from the Supabase Google sign-in   */
/*  (provider_token) when the calendar scope was granted; it is short-  */
/*  lived (~1h) and Supabase does not refresh provider tokens, so when  */
/*  it lapses the UI simply offers to reconnect. Token is kept device-  */
/*  local (never synced).                                               */
/* ------------------------------------------------------------------ */

const TOKEN_KEY = 'rhythm:gcal:token'; // { token, expiresAt }
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export function saveGcalToken(token, expiresInSec = 3600) {
  if (!token) return;
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: Date.now() + (expiresInSec - 120) * 1000 })); } catch { /* ignore */ }
}
export function loadGcalToken() {
  try {
    const o = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (!o || !o.token) return null;
    if (Date.now() >= o.expiresAt) return null; // expired — caller prompts reconnect
    return o.token;
  } catch { return null; }
}
export function clearGcalToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
export function gcalConnected() { return !!loadGcalToken(); }

async function gcalGet(path, token, params = {}) {
  const url = new URL(CAL_BASE + path);
  for (const k in params) if (params[k] != null) url.searchParams.set(k, params[k]);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) { clearGcalToken(); const e = new Error('gcal-auth'); e.code = 'auth'; throw e; }
  if (!res.ok) throw new Error(`Google Calendar error (HTTP ${res.status})`);
  return res.json();
}

export async function listCalendars(token) {
  const data = await gcalGet('/users/me/calendarList', token, { minAccessRole: 'reader', fields: 'items(id,summary,primary,backgroundColor,selected)' });
  return (data.items || []).map((c) => ({ id: c.id, name: c.summary, primary: !!c.primary, color: c.backgroundColor || '#3E8A6C' }));
}

/* Fetch a single local day's events from one calendar. timeMin/timeMax bound the
   local day. singleEvents expands recurrences into individual instances. */
export async function listDayEvents(token, calendarId, dayDate) {
  const start = new Date(dayDate); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const data = await gcalGet(`/calendars/${encodeURIComponent(calendarId)}/events`, token, {
    timeMin: start.toISOString(), timeMax: end.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: 50,
    fields: 'items(id,summary,start,end,status)',
  });
  return (data.items || []).filter((e) => e.status !== 'cancelled').map((e) => normalizeEvent(e, calendarId));
}

/* Raw Google event → Rhythm's shape. All-day events use start.date (no time);
   timed events use start.dateTime. startMin is local minutes-past-midnight. */
export function normalizeEvent(raw, calendarId) {
  const allDay = !!(raw.start && raw.start.date && !raw.start.dateTime);
  const startDT = raw.start && (raw.start.dateTime || raw.start.date);
  const endDT = raw.end && (raw.end.dateTime || raw.end.date);
  const startDate = startDT ? new Date(startDT) : null;
  const endDate = endDT ? new Date(endDT) : null;
  const startMin = (!allDay && startDate) ? startDate.getHours() * 60 + startDate.getMinutes() : null;
  const p2 = (n) => String(n).padStart(2, '0');
  const startHM = startMin == null ? '' : `${p2(Math.floor(startMin / 60))}:${p2(startMin % 60)}`;
  return {
    id: `${calendarId}::${raw.id}`,
    title: raw.summary || '(no title)',
    allDay, start: startDate, end: endDate, startMin, startHM, calendarId,
  };
}

/* Split a day's events into an all-day list (pinned) and a per-block bucket.
   blockOf(min) resolves a minute-past-midnight to a block id (pass core's
   activeBlockAt bound to the day's timings). */
export function bucketDayEvents(events, blockOf) {
  const allDay = [];
  const byBlock = {};
  for (const ev of events) {
    if (ev.allDay || ev.startMin == null) { allDay.push(ev); continue; }
    const b = blockOf(ev.startMin) || 'morning';
    (byBlock[b] = byBlock[b] || []).push(ev);
  }
  for (const b in byBlock) byBlock[b].sort((a, z) => a.startMin - z.startMin);
  allDay.sort((a, z) => (a.title || '').localeCompare(z.title || ''));
  return { allDay, byBlock };
}
