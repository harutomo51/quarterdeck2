import { describe, expect, test } from 'vitest';
import {
  RATIO_MIN,
  RATIO_MAX,
  clampRatio,
  createLeaf,
  splitLeaf,
  closeLeaf,
  collectLeafIds,
  setRatio,
  computeRects,
  directionalFocus,
  type PaneNode,
} from '@/lib/paneTree';

describe('createLeaf', () => {
  test('creates a leaf node with the given id', () => {
    expect(createLeaf('a')).toEqual({ kind: 'leaf', id: 'a' });
  });
});

describe('clampRatio', () => {
  test('clamps below the minimum', () => {
    expect(clampRatio(0)).toBe(RATIO_MIN);
  });

  test('clamps above the maximum', () => {
    expect(clampRatio(1)).toBe(RATIO_MAX);
  });

  test('keeps an in-range value', () => {
    expect(clampRatio(0.5)).toBe(0.5);
  });

  test('falls back to 0.5 on NaN', () => {
    expect(clampRatio(Number.NaN)).toBe(0.5);
  });
});

describe('splitLeaf', () => {
  test('replaces the target leaf with a split of the old and new leaf', () => {
    const tree = createLeaf('a');

    const next = splitLeaf(tree, 'a', 'row', 'b', 's1');

    expect(next).toEqual({
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'a' },
      b: { kind: 'leaf', id: 'b' },
    });
  });

  test('splits a nested leaf without touching siblings', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');

    const next = splitLeaf(tree, 'b', 'column', 'c', 's2') as Extract<
      PaneNode,
      { kind: 'split' }
    >;

    expect(collectLeafIds(next)).toEqual(['a', 'b', 'c']);
    expect(next.a).toEqual({ kind: 'leaf', id: 'a' });
    expect((next.b as Extract<PaneNode, { kind: 'split' }>).direction).toBe('column');
  });

  test('returns the tree unchanged when the target leaf is absent', () => {
    const tree = createLeaf('a');
    expect(splitLeaf(tree, 'zzz', 'row', 'b', 's1')).toEqual(tree);
  });
});

describe('collectLeafIds', () => {
  test('returns the single id for a lone leaf', () => {
    expect(collectLeafIds(createLeaf('a'))).toEqual(['a']);
  });

  test('returns ids left-to-right (a before b)', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');
    expect(collectLeafIds(tree)).toEqual(['a', 'b']);
  });
});

describe('closeLeaf', () => {
  test('collapses the parent split into the surviving sibling', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');

    const { tree: next, nextFocusId } = closeLeaf(tree, 'a');

    expect(next).toEqual({ kind: 'leaf', id: 'b' });
    expect(nextFocusId).toBe('b');
  });

  test('focuses the first leaf of the sibling subtree when closing', () => {
    // a | (b / c)  -> close a -> (b / c), focus b
    let tree: PaneNode = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');
    tree = splitLeaf(tree, 'b', 'column', 'c', 's2');

    const { tree: next, nextFocusId } = closeLeaf(tree, 'a');

    expect(collectLeafIds(next)).toEqual(['b', 'c']);
    expect(nextFocusId).toBe('b');
  });

  test('cannot close the last remaining pane', () => {
    const tree = createLeaf('a');
    const { tree: next, nextFocusId } = closeLeaf(tree, 'a');
    expect(next).toEqual(tree);
    expect(nextFocusId).toBe('a');
  });
});

describe('setRatio', () => {
  test('sets the ratio of the addressed split, clamped', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1') as Extract<
      PaneNode,
      { kind: 'split' }
    >;

    const next = setRatio(tree, 's1', 0.99) as Extract<PaneNode, { kind: 'split' }>;

    expect(next.ratio).toBe(RATIO_MAX);
  });

  test('leaves other splits untouched', () => {
    let tree: PaneNode = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');
    tree = splitLeaf(tree, 'b', 'column', 'c', 's2');

    const next = setRatio(tree, 's2', 0.3) as Extract<PaneNode, { kind: 'split' }>;

    expect(next.ratio).toBe(0.5); // s1 unchanged
    expect((next.b as Extract<PaneNode, { kind: 'split' }>).ratio).toBe(0.3);
  });
});

describe('computeRects', () => {
  test('gives a lone leaf the whole area', () => {
    const rects = computeRects(createLeaf('a'), { width: 100, height: 80 });
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  test('splits a row left/right by ratio', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');
    const rects = computeRects(tree, { width: 100, height: 80 });
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 50, height: 80 });
    expect(rects.get('b')).toEqual({ x: 50, y: 0, width: 50, height: 80 });
  });

  test('splits a column top/bottom by ratio', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'column', 'b', 's1');
    const rects = computeRects(tree, { width: 100, height: 80 });
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    expect(rects.get('b')).toEqual({ x: 0, y: 40, width: 100, height: 40 });
  });
});

describe('directionalFocus', () => {
  const size = { width: 100, height: 80 };

  test('moves focus right to the adjacent pane', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');
    expect(directionalFocus(tree, size, 'a', 'right')).toBe('b');
  });

  test('moves focus left back to the first pane', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');
    expect(directionalFocus(tree, size, 'b', 'left')).toBe('a');
  });

  test('returns null when there is no pane in that direction', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'row', 'b', 's1');
    expect(directionalFocus(tree, size, 'a', 'up')).toBeNull();
  });

  test('moves focus down across a column split', () => {
    const tree = splitLeaf(createLeaf('a'), 'a', 'column', 'b', 's1');
    expect(directionalFocus(tree, size, 'a', 'down')).toBe('b');
  });
});
