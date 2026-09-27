/* The focus mode a task starts with: its own, else its tag's, else its
   project's — and a mode deleted since is no mode at all. */

import { describe, it, expect } from 'vitest';
import { focusModeFor, modeKey } from '../src/focusmode.js';

const modes = [{ id: 111, name: 'Translate' }, { id: 222, name: 'Admin' }, { id: 333, name: 'Deep' }];
const labels = [
  { id: 'L1', name: 'Mutarjim', project: 'P1', focusMode: '222' },
  { id: 'L2', name: 'idea' },
];
const projects = [{ id: 'P1', focusMode: '333' }, { id: 'P2', focusMode: '111' }];

describe('focusModeFor', () => {
  it('prefers the task’s own mode', () => {
    expect(focusModeFor({ focusMode: 111, projectId: 'L1' }, labels, projects, modes)).toEqual({ id: '111', from: 'task' });
  });
  it('falls back to the tag’s', () => {
    expect(focusModeFor({ projectId: 'L1' }, labels, projects, modes)).toEqual({ id: '222', from: 'tag' });
  });
  it('then to the project’s — its own project, or its tag’s', () => {
    expect(focusModeFor({ projectId: 'L2', projectRef: 'P2' }, labels, projects, modes)).toEqual({ id: '111', from: 'project' });
    const noTagMode = [{ ...labels[0], focusMode: null }, labels[1]];
    expect(focusModeFor({ projectId: 'L1' }, noTagMode, projects, modes)).toEqual({ id: '333', from: 'project' });
  });
  it('skips a remembered mode that no longer exists', () => {
    expect(focusModeFor({ focusMode: '999', projectId: 'L1' }, labels, projects, modes)).toEqual({ id: '222', from: 'tag' });
    expect(focusModeFor({ focusMode: '999' }, [], [], modes)).toBeNull();
  });
  it('has nothing for a plain task, or no task', () => {
    expect(focusModeFor({ projectId: 'L2' }, labels, projects, modes)).toBeNull();
    expect(focusModeFor(null, labels, projects, modes)).toBeNull();
  });
  it('compares ids as strings', () => {
    expect(modeKey(111)).toBe('111');
    expect(modeKey('')).toBeNull();
    expect(modeKey(null)).toBeNull();
  });
});
