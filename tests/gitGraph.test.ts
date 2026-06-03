import { describe, expect, test } from 'vitest';
import {
  computeGraph,
  FIELD_SEP as US,
  laneCount,
  parseGitLog,
  refKind,
  refLabel,
  type Commit,
} from '../src/lib/gitGraph';

describe('parseGitLog', () => {
  test('parses fields, parents, and refs', () => {
    const raw = ['h1', 'p1 p2', 'Alice', '2 hours ago', 'HEAD -> main, origin/main', 'merge work'].join(US);
    expect(parseGitLog(raw)).toEqual<Commit[]>([
      {
        hash: 'h1',
        parents: ['p1', 'p2'],
        author: 'Alice',
        relDate: '2 hours ago',
        refs: ['HEAD -> main', 'origin/main'],
        subject: 'merge work',
      },
    ]);
  });

  test('skips blank lines and keeps a rootless, refless commit', () => {
    const raw = ['root', '', 'Bob', 'now', '', 'init'].join(US) + '\n\n   ';
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].parents).toEqual([]);
    expect(commits[0].refs).toEqual([]);
  });
});

describe('refKind / refLabel', () => {
  test('classifies HEAD, remote, tag, and local branch', () => {
    expect(refKind('HEAD -> main')).toBe('head');
    expect(refKind('origin/main')).toBe('remote');
    expect(refKind('tag: v1.0')).toBe('tag');
    expect(refKind('feature')).toBe('branch');
  });

  test('strips only the tag: prefix for display', () => {
    expect(refLabel('tag: v1.0')).toBe('v1.0');
    expect(refLabel('HEAD -> main')).toBe('HEAD -> main');
  });
});

function commit(hash: string, parents: string[]): Commit {
  return { hash, parents, author: 'a', relDate: 'now', refs: [], subject: hash };
}

describe('computeGraph', () => {
  test('keeps a linear history in column 0', () => {
    const rows = computeGraph([commit('A', ['B']), commit('B', ['C']), commit('C', [])]);
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0]);
    expect(laneCount(rows)).toBe(1);
  });

  test('assigns a second lane for a branch and converges on merge-base', () => {
    // M is a merge of A and B; A and B both descend from base.
    const rows = computeGraph([
      commit('M', ['A', 'B']),
      commit('A', ['base']),
      commit('B', ['base']),
      commit('base', []),
    ]);
    const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r.column]));
    expect(byHash.M).toBe(0);
    expect(byHash.A).toBe(0);
    expect(byHash.B).toBe(1);
    expect(byHash.base).toBe(0);
    expect(laneCount(rows)).toBe(2);
  });
});
