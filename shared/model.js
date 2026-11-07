/* The sync document — imported verbatim by both the browser and the server.

   Shape:
     { v: 1, keys: { "<planner key>": entry, ... } }
     entry = { value: "<raw JSON string>", updatedAt: <ms> }   // live
            | { deletedAt: <ms> }                              // tombstone

   Dawam already stores its planner as independent localStorage keys —
   settings, pool, templates, and one per week. Those keys ARE the records, so
   merging per key gives exactly what Mizan gets by merging per record: two
   devices editing different weeks both keep their work, and only a genuine
   edit to the SAME key resolves last-write-wins. `value` stays an opaque
   string so this file never has to know what a task looks like; the app's
   schema can change without touching sync.

   mergeState is symmetric and idempotent — merge(a,b) and merge(b,a) hold the
   same content, and merging twice changes nothing. That is what lets the
   server merge blindly with no change log, no vector clocks, and no
   reconciliation code on the client.

   Deletes are tombstones. Dawam prunes weeks older than about a month; without
   a tombstone the server would hand every pruned week straight back on the next
   pull, and the device would prune and re-download it forever. */

export const DOC_VERSION = 1;
export const MAX_DOC_BYTES = 4 * 1024 * 1024;

/* Keys worth syncing. Excludes the storage probe, the cached prayer-time
   tables, and the expanded calendar feeds — all three are derived, all three
   are device-local, and the calendar cache in particular is other people's
   meetings by the megabyte. The feed LIST (planner:calendars) does sync: it is
   small, it is the person's own configuration, and a calendar added on the
   laptop should be there on the phone. */
const DERIVED = ["planner:prayers:", "planner:calcache:", "planner:trellocache"];

/* Derived keys are device-local and rebuildable, which is why sync skips them.
   A BACKUP must skip them for the same reason and one more: a backup made on
   the laptop used to carry its calendar cache into the phone, where it was
   worth nothing and cost the same megabytes. Exported so the backup and the
   free-up-space sweep agree with sync about what is disposable. */
export const isDerived = (k) => typeof k === "string" && DERIVED.some((p) => k.startsWith(p));

export const isSyncable = (k) =>
  typeof k === "string" && k.startsWith("planner:") && k !== "planner:__probe" && !isDerived(k);

const ts = (e) => (!e ? 0 : Number(e.deletedAt || e.updatedAt || 0) || 0);
const isTomb = (e) => !!(e && e.deletedAt);

/* Accept anything and return a well-formed document. Runs on both sides: the
   client's own copy on the way out, and whatever arrives on the way in. */
export function migrate(input) {
  const out = { v: DOC_VERSION, keys: {} };
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const src = input.keys && typeof input.keys === "object" ? input.keys : {};
  for (const k of Object.keys(src)) {
    if (!isSyncable(k)) continue;
    const e = src[k];
    if (!e || typeof e !== "object") continue;
    if (e.deletedAt) {
      const t = Number(e.deletedAt) || 0;
      if (t > 0) out.keys[k] = { deletedAt: t };
      continue;
    }
    if (typeof e.value !== "string") continue;
    const t = Number(e.updatedAt) || 0;
    out.keys[k] = { value: e.value, updatedAt: t };
  }
  return out;
}

/* Per-key last-write-wins. A tombstone competes on its own timestamp, so a
   delete beats an older edit and an edit beats an older delete — which is what
   lets a week come back if you genuinely re-create it after pruning. */
export function mergeState(a, b) {
  const A = migrate(a);
  const B = migrate(b);
  const out = { v: DOC_VERSION, keys: { ...A.keys } };
  for (const k of Object.keys(B.keys)) {
    const mine = out.keys[k];
    const theirs = B.keys[k];
    if (!mine) { out.keys[k] = theirs; continue; }
    const tm = ts(mine), tt = ts(theirs);
    const fields = k === SETTINGS_KEY && !isTomb(mine) && !isTomb(theirs) ? mergeSettingsEntries(mine, theirs) : null;
    if (fields) out.keys[k] = fields;
    else if (tt > tm) out.keys[k] = theirs;
    // Equal timestamps: prefer the tombstone, so a delete is never silently
    // undone by a same-millisecond write from the other side.
    else if (tt === tm && isTomb(theirs) && !isTomb(mine)) out.keys[k] = theirs;
  }
  return out;
}

/* ---------- settings, field by field ----------
   Settings are one key, but not one thing: the prayer switch and the language
   sit in the same object as the habit logs, the project progress and the focus
   tallies, which change all day. Merged as one blob, a phone that had not yet
   heard the laptop turn prayer times off would tick a habit, stamp the WHOLE
   object newer, and hand "on" back to everyone — the setting that kept turning
   itself back on.

   So a save records, inside the value, when each top-level field last changed
   (`_at`), and when the object was written (`_w`, equal to the entry's
   updatedAt — the save hook passes the same clock reading to the sync meta).
   Two such copies merge per field: the newer change wins, field by field.

   A copy written by a build that predates this still carries whatever `_at`
   it was handed, but its `_w` no longer matches its updatedAt, because that
   build did not write one. Its stamps cannot be trusted, so a merge with it
   falls back to the old whole-key rule. Mixed builds behave exactly as before;
   the fix arrives as each device updates. */
export const SETTINGS_KEY = "planner:settings";
const META = ["_at", "_w"];

/* The value to store when `next` replaces `prev`: every top-level field that
   differs gets stamped `now`. A copy with no trustworthy stamps (the first
   save after updating, or one adopted from an old build) stamps every field,
   which is precisely the old whole-blob write — no weaker than before. */
export function stampSettings(prev, next, now) {
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;
  const p = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : null;
  const trusted = !!(p && p._at && typeof p._at === "object");
  const at = trusted ? { ...p._at } : {};
  const keys = new Set([...Object.keys(next), ...(p ? Object.keys(p) : [])]);
  for (const f of keys) {
    if (META.includes(f)) continue;
    if (!trusted || stable(p ? p[f] : undefined) !== stable(next[f])) at[f] = now;
  }
  // Fields gone from both sides need no stamp to remember them by.
  for (const f of Object.keys(at)) if (!(f in next) && !(p && f in p)) delete at[f];
  return { ...next, _at: at, _w: now };
}

const parseObj = (s) => { try { const v = JSON.parse(s); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
const fieldAware = (o, e) => !!(o && o._at && typeof o._at === "object" && Number(o._w) === Number(e.updatedAt));

/* Per-field merge of two live settings entries, or null to fall back to
   whole-key last-write-wins. Symmetric: a tie on a field's stamp goes to the
   copy written later, then to the larger serialisation, so merge(a,b) and
   merge(b,a) agree.

   Two rules keep it from echoing. When the result IS one of the inputs, that
   entry comes back byte for byte — the documents are compared as opaque
   strings, and re-serialising unchanged content would read as a change and
   push forever. And a genuinely new combination is stamped one past the
   newer side, so a server still running whole-key last-write-wins takes it
   rather than keeping its own copy on a tie. */
function mergeSettingsEntries(a, b) {
  const A = parseObj(a.value), B = parseObj(b.value);
  if (!fieldAware(A, a) || !fieldAware(B, b)) return null;
  const ua = Number(a.updatedAt) || 0, ub = Number(b.updatedAt) || 0;
  const out = {}, at = {};
  const keys = new Set([...Object.keys(A), ...Object.keys(B)].filter((f) => !META.includes(f)));
  for (const f of [...keys].sort()) {
    const sa = Number(A._at[f]) || 0, sb = Number(B._at[f]) || 0;
    let useB;
    if (sa !== sb) useB = sb > sa;
    else if (ua !== ub) useB = ub > ua;
    else useB = stable(B[f]) > stable(A[f]);
    const src = useB ? B : A;
    if (f in src && src[f] !== undefined) out[f] = src[f];
    const stamp = Math.max(sa, sb);
    if (stamp) at[f] = stamp;
  }
  const same = (o) => { const x = { ...o }; delete x._w; delete x._at; const y = { ...out }; return stable(x) === stable(y); };
  const sameA = same(A) && stable(A._at) === stable(at), sameB = same(B) && stable(B._at) === stable(at);
  if (sameA && sameB) return ub > ua || (ub === ua && b.value > a.value) ? b : a;
  if (sameA) return a;
  if (sameB) return b;
  const updatedAt = Math.max(ua, ub) + 1;
  out._at = at; out._w = updatedAt;
  return { value: JSON.stringify(out), updatedAt };
}

/* ---------- fingerprint ----------
   "Has this document actually changed?" cannot be answered with
   JSON.stringify: key order is an artefact of how an object was built, and the
   server builds the merged document in a different order than migrate() does
   on the way back in. Comparing raw JSON therefore reported a difference on
   every single round trip, and the client pushed forever in a loop — the bug
   that made Mizan re-render and fight the user every few seconds.

   This serialises deterministically: keys sorted, undefined dropped. Two
   documents with the same content always produce the same string. Array order
   is still significant, which is correct — reordering is a real change. */
function stable(v) {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}

export function fingerprint(doc) {
  try { return stable(doc); } catch { return null; }
}

export const sameDoc = (a, b) => fingerprint(a) === fingerprint(b);

export function docSize(doc) {
  try { return JSON.stringify(doc).length; } catch { return Infinity; }
}
