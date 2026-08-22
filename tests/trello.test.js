/* Trello, read-only.

   The network calls are thin wrappers; what is worth testing is the shape
   conversion and the judgement about which cards deserve to be in front of
   someone — plus the two properties that make this safe to leave connected:
   the token is asked for with read scope, and a failing board is reported
   rather than silently becoming an empty list. */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeCards, dueCards, isOverdue, authorizeUrl, trelloReady, refreshTrello } from '../src/trello.js';

const auth = { key: 'K', token: 'T' };
const day = (n, now = Date.now()) => new Date(now + n * 86400000).toISOString();

const lists = [{ id: 'l1', name: 'Doing' }, { id: 'l2', name: 'Done' }];
const board = { id: 'b1', name: 'Client work' };

afterEach(() => { vi.unstubAllGlobals(); });

describe('the authorize URL', () => {
  it('asks for read access that does not expire', () => {
    const u = new URL(authorizeUrl('mykey'));
    const q = u.searchParams;
    expect(q.get('scope')).toBe('read');       // never write to someone's board
    expect(q.get('expiration')).toBe('never'); // never interrupt the day to re-consent
    expect(q.get('key')).toBe('mykey');
    expect(q.get('response_type')).toBe('token');
  });

  it('knows when it has enough to talk to Trello at all', () => {
    expect(trelloReady(null)).toBe(false);
    expect(trelloReady({ key: 'K' })).toBe(false);
    expect(trelloReady(auth)).toBe(true);
  });
});

describe('normalizeCards', () => {
  it('keeps the title, the due date and where it came from', () => {
    const out = normalizeCards([
      { id: 'c1', name: 'Send the invoice', due: '2026-08-24T12:00:00.000Z', dueComplete: false, idList: 'l1', shortUrl: 'https://trl.co/c1' },
    ], lists, board);
    expect(out[0]).toMatchObject({
      id: 'c1', title: 'Send the invoice', list: 'Doing', board: 'Client work', boardId: 'b1', done: false, url: 'https://trl.co/c1',
    });
    expect(out[0].dueMs).toBe(Date.parse('2026-08-24T12:00:00.000Z'));
  });

  it('drops archived cards and cards with no title', () => {
    const out = normalizeCards([
      { id: 'a', name: 'Archived', closed: true, idList: 'l1' },
      { id: 'b', name: '   ', idList: 'l1' },
      { id: 'c', name: 'Real', idList: 'l1' },
    ], lists, board);
    expect(out.map((c) => c.id)).toEqual(['c']);
  });

  it('survives a card in a list it has never heard of', () => {
    const out = normalizeCards([{ id: 'c', name: 'Orphan', idList: 'gone' }], lists, board);
    expect(out[0].list).toBe('');
  });

  it('reads a completed due date as done', () => {
    const out = normalizeCards([{ id: 'c', name: 'Paid', due: day(-1), dueComplete: true, idList: 'l1' }], lists, board);
    expect(out[0].done).toBe(true);
  });
});

describe('dueCards', () => {
  const now = Date.parse('2026-08-24T09:00:00.000Z');
  const cards = normalizeCards([
    { id: 'soon', name: 'Due tomorrow', due: day(1, now), idList: 'l1' },
    { id: 'late', name: 'Was due last week', due: day(-7, now), idList: 'l1' },
    { id: 'far', name: 'Due in two months', due: day(60, now), idList: 'l1' },
    { id: 'none', name: 'No due date', idList: 'l1' },
    { id: 'done', name: 'Already done', due: day(1, now), dueComplete: true, idList: 'l2' },
  ], lists, board);

  it('shows what is due soon, soonest first', () => {
    const out = dueCards(cards, { now });
    expect(out.map((c) => c.id)).toEqual(['late', 'soon']);
  });

  it('leaves undated cards where they are', () => {
    // Somebody else's whole backlog would bury the day rather than help it.
    expect(dueCards(cards, { now }).some((c) => c.id === 'none')).toBe(false);
  });

  it('leaves a card that is already done alone', () => {
    expect(dueCards(cards, { now }).some((c) => c.id === 'done')).toBe(false);
  });

  it('can be told to hide what is already overdue', () => {
    expect(dueCards(cards, { now, includeOverdue: false }).map((c) => c.id)).toEqual(['soon']);
  });

  it('reaches as far ahead as it is asked to', () => {
    expect(dueCards(cards, { now, withinDays: 90 }).map((c) => c.id)).toEqual(['late', 'soon', 'far']);
  });

  it('knows what is overdue', () => {
    expect(isOverdue(cards.find((c) => c.id === 'late'), now)).toBe(true);
    expect(isOverdue(cards.find((c) => c.id === 'soon'), now)).toBe(false);
    expect(isOverdue(cards.find((c) => c.id === 'done'), now)).toBe(false);
  });
});

describe('refreshTrello', () => {
  const json = (body) => ({ ok: true, status: 200, json: async () => body });

  it('says so rather than pretending, when there are no credentials', async () => {
    expect(await refreshTrello({}, ['b1'])).toEqual({ ok: false, error: 'not-connected' });
  });

  it('collects the cards of the boards it was asked for', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/members/me/boards')) return json([{ id: 'b1', name: 'Client work' }, { id: 'b2', name: 'Other' }]);
      if (url.includes('/boards/b1/lists')) return json(lists);
      if (url.includes('/boards/b1/cards')) return json([{ id: 'c1', name: 'Send the invoice', due: day(1), idList: 'l1' }]);
      return json([]);
    }));
    const r = await refreshTrello(auth, ['b1']);
    expect(r.ok).toBe(true);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].board).toBe('Client work');
    expect(r.boards).toEqual([{ id: 'b1', name: 'Client work', count: 1 }]);
  });

  it('reports a board that failed instead of returning it empty', async () => {
    // A board that quietly stopped syncing looks exactly like a board with
    // nothing on it — which is the failure mode worth refusing.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/members/me/boards')) return json([{ id: 'b1', name: 'Good' }, { id: 'b2', name: 'Broken' }]);
      if (url.includes('/boards/b2/')) return { ok: false, status: 500, json: async () => ({}) };
      if (url.includes('/lists')) return json(lists);
      return json([{ id: 'c1', name: 'Fine', due: day(1), idList: 'l1' }]);
    }));
    const r = await refreshTrello(auth, ['b1', 'b2']);
    expect(r.ok).toBe(true);
    expect(r.cards).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ id: 'b2', name: 'Broken' });
  });

  it('names a rejected token as such, so it can be fixed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await refreshTrello(auth, ['b1'])).toEqual({ ok: false, error: 'bad-credentials' });
  });

  it('asks for nothing when no board is chosen', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await refreshTrello(auth, []);
    expect(r).toMatchObject({ ok: true, cards: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
