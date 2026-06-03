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

  test('every entering and leaving lane has a connected edge (no gaps)', () => {
    // 同じ親(base)を2レーンが待つ分岐は重複レーンを作らず、全レーンが接続される。
    const rows = computeGraph([
      commit('M', ['A', 'B']),
      commit('A', ['base']),
      commit('B', ['base']),
      commit('base', []),
    ]);
    for (const row of rows) {
      // 出ていく各レーンには下端(y2=1)へ到達するエッジがある。
      row.lanesAfter.forEach((hash, col) => {
        if (hash === null) return;
        expect(row.edges.some((e) => e.y2 === 1 && e.toCol === col)).toBe(true);
      });
      // 入ってくる各レーンには上端(y1=0)から出るエッジがある。
      row.lanesBefore.forEach((hash, col) => {
        if (hash === null) return;
        expect(row.edges.some((e) => e.y1 === 0 && e.fromCol === col)).toBe(true);
      });
    }
    // 重複ハッシュのレーンが生成されていないこと。
    for (const row of rows) {
      const present = row.lanesAfter.filter((h): h is string => h !== null);
      expect(new Set(present).size).toBe(present.length);
    }
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
