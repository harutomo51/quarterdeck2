/**
 * ターミナル分割の純粋ロジック（ADR-0002）。UI 状態と分離してテスト可能にする。
 *
 * 再帰的二分割（tmux / Windows Terminal 型）のツリーを、不変更新で扱う。
 * `direction`:
 *   - 'row'    = ペインが左右に並ぶ = **垂直分割**（ディバイダは縦線）
 *   - 'column' = ペインが上下に並ぶ = **水平分割**（ディバイダは横線）
 * leaf / split の `id` 採番は呼び出し側（hook）が行い、ここへ引数で渡す
 * （副作用を持たない＝同じ入力で同じ出力）。
 */

export type SplitDirection = 'row' | 'column';
export type FocusDirection = 'up' | 'down' | 'left' | 'right';

export interface LeafNode {
  kind: 'leaf';
  id: string;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  /** a が占める割合（0..1）。b は 1 - ratio。 */
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = LeafNode | SplitNode;

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const RATIO_MIN = 0.1;
export const RATIO_MAX = 0.9;

export function createLeaf(id: string): LeafNode {
  return { kind: 'leaf', id };
}

/** 分割比率を [RATIO_MIN, RATIO_MAX] にクランプ。NaN は中央(0.5)へ。 */
export function clampRatio(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, n));
}

/** target の leaf を「target と new の split」に置き換える。target が無ければ不変。 */
export function splitLeaf(
  tree: PaneNode,
  targetId: string,
  direction: SplitDirection,
  newId: string,
  splitId: string,
): PaneNode {
  if (tree.kind === 'leaf') {
    if (tree.id !== targetId) return tree;
    return {
      kind: 'split',
      id: splitId,
      direction,
      ratio: 0.5,
      a: tree,
      b: createLeaf(newId),
    };
  }
  return {
    ...tree,
    a: splitLeaf(tree.a, targetId, direction, newId, splitId),
    b: splitLeaf(tree.b, targetId, direction, newId, splitId),
  };
}

/** leaf id を左→右（a→b）順に集める。 */
export function collectLeafIds(tree: PaneNode): string[] {
  if (tree.kind === 'leaf') return [tree.id];
  return [...collectLeafIds(tree.a), ...collectLeafIds(tree.b)];
}

function findSibling(node: PaneNode, targetId: string): PaneNode | null {
  if (node.kind !== 'split') return null;
  if (node.a.kind === 'leaf' && node.a.id === targetId) return node.b;
  if (node.b.kind === 'leaf' && node.b.id === targetId) return node.a;
  return findSibling(node.a, targetId) ?? findSibling(node.b, targetId);
}

function dropLeaf(node: PaneNode, targetId: string): PaneNode | null {
  if (node.kind === 'leaf') return node.id === targetId ? null : node;
  const a = dropLeaf(node.a, targetId);
  const b = dropLeaf(node.b, targetId);
  if (a === null) return b;
  if (b === null) return a;
  return { ...node, a, b };
}

/**
 * target の leaf を閉じ、親 split を兄弟へ畳む。
 * 最後の 1 枚は閉じられない（不変）。`nextFocusId` は兄弟サブツリーの先頭 leaf。
 */
export function closeLeaf(
  tree: PaneNode,
  targetId: string,
): { tree: PaneNode; nextFocusId: string } {
  if (tree.kind === 'leaf') {
    return { tree, nextFocusId: tree.id };
  }
  const sibling = findSibling(tree, targetId);
  if (sibling === null) {
    return { tree, nextFocusId: collectLeafIds(tree)[0] };
  }
  const next = dropLeaf(tree, targetId);
  return {
    tree: next ?? tree,
    nextFocusId: collectLeafIds(sibling)[0],
  };
}

/** splitId の split の比率を（クランプして）更新する。他の split は不変。 */
export function setRatio(tree: PaneNode, splitId: string, ratio: number): PaneNode {
  if (tree.kind === 'leaf') return tree;
  if (tree.id === splitId) {
    return { ...tree, ratio: clampRatio(ratio) };
  }
  return {
    ...tree,
    a: setRatio(tree.a, splitId, ratio),
    b: setRatio(tree.b, splitId, ratio),
  };
}

/** 各 leaf の矩形を計算する（ディバイダ厚は無視）。 */
export function computeRects(tree: PaneNode, size: Size): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (node: PaneNode, rect: Rect): void => {
    if (node.kind === 'leaf') {
      out.set(node.id, rect);
      return;
    }
    if (node.direction === 'row') {
      const aw = rect.width * node.ratio;
      walk(node.a, { ...rect, width: aw });
      walk(node.b, { x: rect.x + aw, y: rect.y, width: rect.width - aw, height: rect.height });
    } else {
      const ah = rect.height * node.ratio;
      walk(node.a, { ...rect, height: ah });
      walk(node.b, { x: rect.x, y: rect.y + ah, width: rect.width, height: rect.height - ah });
    }
  };
  walk(tree, { x: 0, y: 0, width: size.width, height: size.height });
  return out;
}

const EPS = 1;

/** fromId から dir 方向の最近傍ペイン id。無ければ null。 */
export function directionalFocus(
  tree: PaneNode,
  size: Size,
  fromId: string,
  dir: FocusDirection,
): string | null {
  const rects = computeRects(tree, size);
  const from = rects.get(fromId);
  if (!from) return null;

  const overlapsY = (r: Rect) => from.y < r.y + r.height && r.y < from.y + from.height;
  const overlapsX = (r: Rect) => from.x < r.x + r.width && r.x < from.x + from.width;

  let best: string | null = null;
  let bestDist = Infinity;
  for (const [id, r] of rects) {
    if (id === fromId) continue;
    let inDir = false;
    if (dir === 'right') inDir = r.x >= from.x + from.width - EPS && overlapsY(r);
    else if (dir === 'left') inDir = r.x + r.width <= from.x + EPS && overlapsY(r);
    else if (dir === 'down') inDir = r.y >= from.y + from.height - EPS && overlapsX(r);
    else inDir = r.y + r.height <= from.y + EPS && overlapsX(r);
    if (!inDir) continue;
    const dx = r.x + r.width / 2 - (from.x + from.width / 2);
    const dy = r.y + r.height / 2 - (from.y + from.height / 2);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  return best;
}
