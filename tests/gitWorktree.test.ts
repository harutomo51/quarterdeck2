import { describe, expect, test } from 'vitest';
import { parseWorktrees } from '../src/lib/gitWorktree';

describe('parseWorktrees', () => {
  test('parses main, linked, detached, and bare worktrees', () => {
    const raw = [
      'worktree /repo/main',
      'HEAD aaaa1111',
      'branch refs/heads/main',
      '',
      'worktree /repo/feature',
      'HEAD bbbb2222',
      'branch refs/heads/feature/x',
      'locked needs review',
      '',
      'worktree /repo/detached',
      'HEAD cccc3333',
      'detached',
      '',
      'worktree /repo/bare',
      'bare',
    ].join('\n');

    const wts = parseWorktrees(raw);
    expect(wts).toEqual([
      { path: '/repo/main', branch: 'main', head: 'aaaa1111', bare: false, detached: false, locked: false },
      { path: '/repo/feature', branch: 'feature/x', head: 'bbbb2222', bare: false, detached: false, locked: true },
      { path: '/repo/detached', branch: undefined, head: 'cccc3333', bare: false, detached: true, locked: false },
      { path: '/repo/bare', branch: undefined, head: undefined, bare: true, detached: false, locked: false },
    ]);
  });

  test('returns an empty array for empty input', () => {
    expect(parseWorktrees('')).toEqual([]);
    expect(parseWorktrees('   \n  ')).toEqual([]);
  });
});
