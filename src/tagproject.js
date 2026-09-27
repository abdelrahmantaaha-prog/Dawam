/* ------------------------------------------------------------------ */
/*  A tag can stand for a project.                                     */
/*                                                                     */
/*  Tags (labels, task.projectId) and projects (task.projectRef) are    */
/*  two separate questions, and most of the time they are asked         */
/*  together: everything tagged #Mutarjim belongs to the Mutarjim        */
/*  project, and picking both every time is a chore that gets skipped —  */
/*  which leaves the project's board and its focus tally short.          */
/*                                                                     */
/*  So a label can name a project (`label.project`). Tagging a task      */
/*  files it under that project unless it already belongs to another.    */
/*  Retagging moves it only if its project came from the old tag — a     */
/*  project picked by hand is a decision, and a tag never overrides one. */
/* ------------------------------------------------------------------ */

/* The project a label is fixed to, or null. A label pointing at a project
   that no longer exists points at nothing. */
export function tagProjectOf(labels, labelId, projects) {
  if (!labelId) return null;
  const l = (labels || []).find((x) => x && x.id === labelId);
  const pid = (l && l.project) || null;
  if (!pid) return null;
  if (projects && !projects.some((p) => p && p.id === pid)) return null;
  return pid;
}

/* The projectRef a NEW task should carry: the one it was given, else the one
   its tag stands for. */
export const initialProject = (projectRef, labelId, labels, projects) =>
  projectRef || tagProjectOf(labels, labelId, projects) || null;

/* Apply the rule to an edit. `prev` is the task before, `next` after; returns
   `next`, possibly with its project filled in. Only a CHANGED tag acts, so
   clearing a project by hand does not have it re-filled by the tag that was
   already there. */
export function withTagProject(prev, next, labels, projects) {
  if (!next) return next;
  const was = prev ? prev.projectId || null : null;
  const now = next.projectId || null;
  if (was === now) return next;
  const fromNew = tagProjectOf(labels, now, projects);
  if (!fromNew) return next;
  const fromOld = tagProjectOf(labels, was, projects);
  const current = next.projectRef || null;
  // A project the old tag put there follows the tag; one chosen by hand stays.
  if (!current || current === fromOld) return next.projectRef === fromNew ? next : { ...next, projectRef: fromNew };
  return next;
}

/* Which project a piece of work counts towards — its own, or its tag's.
   Read-time, so tasks tagged before the tag was fixed to a project still
   count, without anything having to be rewritten. */
export const projectOfTask = (task, labels, projects) =>
  (task && (task.projectRef || tagProjectOf(labels, task.projectId, projects))) || null;
