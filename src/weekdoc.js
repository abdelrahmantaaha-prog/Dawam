/* ------------------------------------------------------------------ */
/*  A week document knows which week it is.                            */
/*                                                                     */
/*  Tasks are stored per week with a 0–6 day index, so a document and   */
/*  the key it is filed under are only meaningful together. Nothing     */
/*  enforced that pairing: the app decided where to save by asking      */
/*  "which week is on screen?", and every place that asked could be     */
/*  answering for a moment that had already passed — a render before an */
/*  effect caught up, or an await that outlived the view it started in. */
/*  Get it wrong once and a week is saved under its neighbour's key:    */
/*  the tasks appear to shift a week, and whatever really lived there   */
/*  is gone, with nothing anywhere reporting a problem.                 */
/*                                                                     */
/*  So the document carries its own answer. `ws` is stamped on it the   */
/*  first time it is written, and from then on the STAMP decides where  */
/*  it goes — not the caller. A write aimed at the wrong week lands on  */
/*  the right one instead of destroying it.                            */
/*                                                                     */
/*  Redirecting rather than refusing is deliberate. A refused write     */
/*  silently loses the edit the person just made; a redirected one puts */
/*  it where it actually belongs, which is both non-destructive and     */
/*  what they meant. The caller is told, so the mistake can be seen     */
/*  rather than inferred later from missing tasks.                     */
/* ------------------------------------------------------------------ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isISO = (s) => typeof s === 'string' && ISO.test(s);

/* The week a document says it belongs to, or null if it has never said. */
export const wsOf = (doc) => (doc && isISO(doc.ws) ? doc.ws : null);

/* Where this write should actually go.
 *
 *   { iso, doc, redirected }
 *
 * `doc` always comes back stamped, so a document that had no opinion acquires
 * one and every later write is checked against it. An unusable request with an
 * unstamped document is the one case with no answer at all — the caller gets
 * `iso: null` and must not write. */
export function writeTarget(doc, requestedISO) {
  const own = wsOf(doc);
  const asked = isISO(requestedISO) ? requestedISO : null;
  if (!own) {
    if (!asked) return { iso: null, doc, redirected: false };
    return { iso: asked, doc: { ...doc, ws: asked }, redirected: false };
  }
  if (!asked || asked === own) return { iso: own, doc: { ...doc, ws: own }, redirected: false };
  // The document knows better than the caller. See the note above.
  return { iso: own, doc: { ...doc, ws: own }, redirected: true, asked };
}

/* Stamp a document being adopted for a week, so the next write is checked. */
export const stampWeek = (doc, wsISO) => (isISO(wsISO) ? { ...(doc || { tasks: [] }), ws: wsISO } : (doc || { tasks: [] }));

/* Does this document's content agree with the week it claims?
 *
 * Only a sanity check for the diagnostics readout — a day index is 0–6 and
 * says nothing about which week, so this can catch a malformed document but
 * never a misfiled one. That is exactly why the stamp exists. */
export const looksSane = (doc) => Array.isArray(doc && doc.tasks)
  && doc.tasks.every((t) => t && Number.isInteger(t.day) && t.day >= 0 && t.day <= 6);
