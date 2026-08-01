/* The sync document — imported verbatim by both the browser and the server.

   Shape:
     { v: 1, keys: { "<planner key>": entry, ... } }
     entry = { value: "<raw JSON string>", updatedAt: <ms> }   // live
            | { deletedAt: <ms> }                              // tombstone

   Rhythm already stores its planner as independent localStorage keys —
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

   Deletes are tombstones. Rhythm prunes weeks older than about a month; without
   a tombstone the server would hand every pruned week straight back on the next
   pull, and the device would prune and re-download it forever. */

export const DOC_VERSION = 1;
export const MAX_DOC_BYTES = 4 * 1024 * 1024;

/* Keys worth syncing. Excludes the storage probe and the cached prayer-time
   tables, which are derived and device-local. */
export const isSyncable = (k) =>
  typeof k === "string" && k.startsWith("planner:") && k !== "planner:__probe" && !k.startsWith("planner:prayers:");

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
    if (tt > tm) out.keys[k] = theirs;
    // Equal timestamps: prefer the tombstone, so a delete is never silently
    // undone by a same-millisecond write from the other side.
    else if (tt === tm && isTomb(theirs) && !isTomb(mine)) out.keys[k] = theirs;
  }
  return out;
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
