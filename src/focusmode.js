/* ------------------------------------------------------------------ */
/*  Which focus mode a task starts with.                               */
/*                                                                     */
/*  A focus mode (the desktop's "template": a named allow list, a       */
/*  length, learned filters) used to be picked by hand every round.     */
/*  Most work always wants the same one — translating wants the         */
/*  dictionary cleared, admin wants the inbox — so a mode can be        */
/*  remembered for a task, for a tag, or for a project, and picking     */
/*  the task on the focus page loads it. It is only a default: choosing */
/*  another mode or lifting it for this round is always one tap.        */
/*                                                                     */
/*  The most specific wins: the task's own, then its tag's, then its    */
/*  project's (its own project, or the one its tag is fixed to).        */
/*  Mode ids live in the desktop's store and are numbers there, so      */
/*  everything here compares them as strings.                           */
/* ------------------------------------------------------------------ */
import { projectOfTask } from './tagproject.js';

export const modeKey = (id) => (id == null || id === '' ? null : String(id));

/* { id, from: 'task' | 'tag' | 'project' } or null. `modes`, when given, is
   the list of modes that exist — a remembered mode that was deleted since is
   treated as no mode rather than loading nothing under a name. */
export function focusModeFor(task, labels, projects, modes) {
  if (!task) return null;
  const exists = (id) => !modes || modes.some((m) => modeKey(m && m.id) === id);
  const own = modeKey(task.focusMode);
  if (own && exists(own)) return { id: own, from: 'task' };
  const label = (labels || []).find((l) => l && l.id === task.projectId);
  const byTag = modeKey(label && label.focusMode);
  if (byTag && exists(byTag)) return { id: byTag, from: 'tag' };
  const pid = projectOfTask(task, labels, projects);
  const project = (projects || []).find((p) => p && p.id === pid);
  const byProject = modeKey(project && project.focusMode);
  if (byProject && exists(byProject)) return { id: byProject, from: 'project' };
  return null;
}
