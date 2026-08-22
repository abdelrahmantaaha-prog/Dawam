/* ------------------------------------------------------------------ */
/*  Trello — boards you already keep, read as a place tasks come from.  */
/*                                                                      */
/*  No server needed, and no proxy either: Trello's API answers          */
/*  cross-origin, which is the one thing Google's calendar feed does     */
/*  not. So this is a plain fetch from the page, on every platform,      */
/*  with the person's own API key and a token they grant once.           */
/*                                                                      */
/*  The token is asked for with scope=read and expiration=never. Read    */
/*  because Rhythm has no business editing someone's board; never        */
/*  because the alternative is re-authorising in the middle of a working */
/*  day, which is the thing this whole feature was told not to do.       */
/*                                                                      */
/*  Cards are never copied automatically. A card becomes a Rhythm task   */
/*  when the person says so, and the card itself is left untouched —     */
/*  two systems silently writing to each other is how you end up with    */
/*  four copies of everything.                                          */
/* ------------------------------------------------------------------ */

import { loadKey, saveKey } from './storage.js';

const API = 'https://api.trello.com/1';
const CACHE_KEY = 'planner:trellocache';

/* Where the person gets the two things they need. The key is from their own
   Power-Up admin page; the token is granted by this URL and pasted back. */
export const TRELLO_KEY_URL = 'https://trello.com/power-ups/admin';
export const authorizeUrl = (key) =>
  `https://trello.com/1/authorize?${new URLSearchParams({
    key: String(key || ''),
    name: 'Rhythm',
    scope: 'read',
    expiration: 'never',
    response_type: 'token',
  })}`;

export const trelloReady = (auth) => !!(auth && auth.key && auth.token);

async function get(path, auth, params = {}) {
  if (!trelloReady(auth)) throw new Error('not-connected');
  const qs = new URLSearchParams({ ...params, key: auth.key, token: auth.token });
  const r = await fetch(`${API}${path}?${qs}`, { credentials: 'omit' });
  if (r.status === 401) throw new Error('bad-credentials');
  if (r.status === 429) throw new Error('rate-limited');
  if (!r.ok) throw new Error(`http-${r.status}`);
  return r.json();
}

export const listBoards = (auth) =>
  get('/members/me/boards', auth, { fields: 'name,closed,url', filter: 'open' })
    .then((bs) => (bs || []).filter((b) => !b.closed).map((b) => ({ id: b.id, name: b.name, url: b.url })));

export const listLists = (auth, boardId) =>
  get(`/boards/${boardId}/lists`, auth, { fields: 'name,closed', filter: 'open' })
    .then((ls) => (ls || []).map((l) => ({ id: l.id, name: l.name })));

export const listCards = (auth, boardId) =>
  get(`/boards/${boardId}/cards`, auth, { fields: 'name,due,dueComplete,idList,shortUrl,closed,dateLastActivity' });

/* ---------- the pure part ----------
   Trello's shapes, turned into the only thing Rhythm wants: a title, when it
   is due, and enough context to know where it came from. */
export function normalizeCards(cards, lists = [], board = {}) {
  const listName = new Map(lists.map((l) => [l.id, l.name]));
  return (cards || [])
    .filter((c) => c && !c.closed)
    .map((c) => ({
      id: c.id,
      title: String(c.name || '').trim(),
      due: c.due || null,
      dueMs: c.due ? Date.parse(c.due) : null,
      done: !!c.dueComplete,
      list: listName.get(c.idList) || '',
      board: board.name || '',
      boardId: board.id || '',
      url: c.shortUrl || '',
    }))
    .filter((c) => c.title);
}

/* What belongs in front of the person: cards with a due date, still open,
   soonest first. A board's worth of undated cards is someone else's backlog —
   showing all of it would bury the day rather than help it.

   `withinDays` is generous on purpose (a fortnight): a card due Friday is
   worth seeing on Monday, when there is still time to plan around it. */
export function dueCards(cards, { now = Date.now(), withinDays = 14, includeOverdue = true } = {}) {
  const horizon = now + withinDays * 86400000;
  return cards
    .filter((c) => c.dueMs && !c.done)
    .filter((c) => (includeOverdue ? c.dueMs <= horizon : c.dueMs >= now && c.dueMs <= horizon))
    .sort((a, b) => a.dueMs - b.dueMs);
}

export const isOverdue = (card, now = Date.now()) => !!(card.dueMs && !card.done && card.dueMs < now);

/* ---------- cache ----------
   Device-local, like the calendar's: it is a copy of somebody else's system,
   it is rebuilt on demand, and it has no business travelling through the sync
   document. `shared/model.js` excludes the key. */
export async function readCache() {
  const c = await loadKey(CACHE_KEY);
  return c && Array.isArray(c.cards) ? c : { fetchedAt: 0, cards: [], boards: [] };
}

/* Pull the chosen boards. One broken board does not stop the others, and the
   error is reported rather than swallowed into an empty list — a board that
   quietly stopped syncing looks exactly like a board with nothing on it. */
export async function refreshTrello(auth, boardIds, { now = Date.now() } = {}) {
  if (!trelloReady(auth)) return { ok: false, error: 'not-connected' };
  const ids = (boardIds || []).filter(Boolean);
  if (!ids.length) {
    await saveKey(CACHE_KEY, { fetchedAt: now, cards: [], boards: [] });
    return { ok: true, cards: [], boards: [] };
  }

  const cards = [];
  const boards = [];
  const errors = [];
  let names = [];
  try {
    names = await listBoards(auth);
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'fetch-failed' };
  }

  for (const id of ids) {
    const board = names.find((b) => b.id === id) || { id, name: '' };
    try {
      const [lists, raw] = await Promise.all([listLists(auth, id), listCards(auth, id)]);
      const norm = normalizeCards(raw, lists, board);
      cards.push(...norm);
      boards.push({ id, name: board.name, count: norm.length });
    } catch (e) {
      errors.push({ id, name: board.name, error: (e && e.message) || 'fetch-failed' });
    }
  }

  cards.sort((a, b) => (a.dueMs || Infinity) - (b.dueMs || Infinity));
  await saveKey(CACHE_KEY, { fetchedAt: now, cards, boards });
  return { ok: true, cards, boards, errors, fetchedAt: now };
}
