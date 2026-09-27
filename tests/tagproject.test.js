/* A tag fixed to a project files its tasks there — without ever overriding a
   project someone picked by hand. */

import { describe, it, expect } from 'vitest';
import { initialProject, projectOfTask, tagProjectOf, withTagProject } from '../src/tagproject.js';

const projects = [{ id: 'P1', name: 'Mutarjim' }, { id: 'P2', name: 'Rhythm' }, { id: 'P3', name: 'Other' }];
const labels = [
  { id: 'L1', name: 'Mutarjim', project: 'P1' },
  { id: 'L2', name: 'Rhythm', project: 'P2' },
  { id: 'L3', name: 'idea' },                      // not fixed to anything
  { id: 'L4', name: 'stale', project: 'GONE' },    // points at a deleted project
];

describe('tagProjectOf', () => {
  it('reads the project a tag is fixed to', () => {
    expect(tagProjectOf(labels, 'L1', projects)).toBe('P1');
    expect(tagProjectOf(labels, 'L3', projects)).toBeNull();
    expect(tagProjectOf(labels, null, projects)).toBeNull();
    expect(tagProjectOf(labels, 'nope', projects)).toBeNull();
  });
  it('treats a pointer at a deleted project as no pointer', () => {
    expect(tagProjectOf(labels, 'L4', projects)).toBeNull();
    // Without a project list to check against, it is taken at its word.
    expect(tagProjectOf(labels, 'L4')).toBe('GONE');
  });
});

describe('a new task', () => {
  it('takes its tag’s project when it has none', () => {
    expect(initialProject(null, 'L1', labels, projects)).toBe('P1');
  });
  it('keeps a project it was given', () => {
    expect(initialProject('P3', 'L1', labels, projects)).toBe('P3');
  });
  it('stays projectless with an unfixed tag', () => {
    expect(initialProject(null, 'L3', labels, projects)).toBeNull();
  });
});

describe('an edit', () => {
  it('fills the project when a fixed tag is added', () => {
    const next = withTagProject({ projectId: null, projectRef: null }, { projectId: 'L1', projectRef: null }, labels, projects);
    expect(next.projectRef).toBe('P1');
  });
  it('moves the project along when the tag that set it changes', () => {
    const next = withTagProject({ projectId: 'L1', projectRef: 'P1' }, { projectId: 'L2', projectRef: 'P1' }, labels, projects);
    expect(next.projectRef).toBe('P2');
  });
  it('never overrides a project picked by hand', () => {
    const next = withTagProject({ projectId: 'L3', projectRef: 'P3' }, { projectId: 'L1', projectRef: 'P3' }, labels, projects);
    expect(next.projectRef).toBe('P3');
  });
  it('does nothing when the tag did not change — clearing a project stays cleared', () => {
    const next = withTagProject({ projectId: 'L1', projectRef: 'P1' }, { projectId: 'L1', projectRef: null }, labels, projects);
    expect(next.projectRef).toBeNull();
  });
  it('leaves the project alone when the new tag is not fixed', () => {
    const next = withTagProject({ projectId: 'L1', projectRef: 'P1' }, { projectId: 'L3', projectRef: 'P1' }, labels, projects);
    expect(next.projectRef).toBe('P1');
  });
  it('returns the same object when nothing needs to change', () => {
    const t = { projectId: 'L3', projectRef: null };
    expect(withTagProject({ projectId: null }, t, labels, projects)).toBe(t);
  });
});

describe('projectOfTask', () => {
  it('prefers the task’s own project, then its tag’s', () => {
    expect(projectOfTask({ projectRef: 'P3', projectId: 'L1' }, labels, projects)).toBe('P3');
    expect(projectOfTask({ projectRef: null, projectId: 'L1' }, labels, projects)).toBe('P1');
    expect(projectOfTask({ projectId: 'L3' }, labels, projects)).toBeNull();
    expect(projectOfTask(null, labels, projects)).toBeNull();
  });
});
