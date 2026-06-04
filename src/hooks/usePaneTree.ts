/**
 * 分割ツリーの state + フォーカス管理フック（Phase C / ADR-0002）。
 * 純粋ロジックは lib/paneTree.ts。ここは React state と id 採番（副作用側）だけを持つ。
 *
 * 永続化はしない（再起動で単一ペイン、ADR-0002）。新ペインの cwd 継承元は
 * `inheritOf(id)` で引けるよう id→継承元 id を保持し、TerminalView へ渡す。
 */
import { useCallback, useRef, useState } from 'react';
import {
  closeLeaf,
  createLeaf,
  directionalFocus,
  setRatio as setRatioPure,
  splitLeaf,
  type FocusDirection,
  type PaneNode,
  type Size,
  type SplitDirection,
} from '../lib/paneTree';

export function usePaneTree(rootId: string) {
  const [tree, setTree] = useState<PaneNode>(() => createLeaf(rootId));
  const [focusedId, setFocusedIdState] = useState<string>(rootId);

  // コールバック内で最新値を参照するための鏡（stale closure 回避）。
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const focusedRef = useRef(focusedId);
  const setFocusedId = useCallback((id: string) => {
    focusedRef.current = id;
    setFocusedIdState(id);
  }, []);

  const counter = useRef(0);
  const inheritRef = useRef<Record<string, string>>({});

  const split = useCallback(
    (direction: SplitDirection) => {
      const source = focusedRef.current;
      counter.current += 1;
      const newId = `pane-${counter.current}`;
      counter.current += 1;
      const splitId = `split-${counter.current}`;
      inheritRef.current[newId] = source;
      setTree(splitLeaf(treeRef.current, source, direction, newId, splitId));
      setFocusedId(newId);
    },
    [setFocusedId],
  );

  const close = useCallback(() => {
    const { tree: next, nextFocusId } = closeLeaf(treeRef.current, focusedRef.current);
    setTree(next);
    setFocusedId(nextFocusId);
  }, [setFocusedId]);

  const resize = useCallback((splitId: string, ratio: number) => {
    setTree(setRatioPure(treeRef.current, splitId, ratio));
  }, []);

  const focusMove = useCallback(
    (dir: FocusDirection, size: Size) => {
      const target = directionalFocus(treeRef.current, size, focusedRef.current, dir);
      if (target) setFocusedId(target);
    },
    [setFocusedId],
  );

  const inheritOf = useCallback((id: string): string | undefined => inheritRef.current[id], []);

  return { tree, focusedId, focus: setFocusedId, split, close, resize, focusMove, inheritOf };
}
