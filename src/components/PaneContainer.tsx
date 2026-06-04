/**
 * 分割ツリーを再帰描画するコンテナ（Phase C / ADR-0002）。
 * leaf は renderLeaf に委譲し、split は flex(row/column) ＋ ドラッグ可能ディバイダで割る。
 * 比率の更新は onResize(splitId, ratio) を通じて usePaneTree が clampRatio して反映する。
 */
import { useCallback, useRef, type ReactNode } from 'react';
import type { PaneNode, SplitNode } from '../lib/paneTree';

interface PaneContainerProps {
  node: PaneNode;
  renderLeaf: (id: string) => ReactNode;
  onResize: (splitId: string, ratio: number) => void;
}

export function PaneContainer({ node, renderLeaf, onResize }: PaneContainerProps) {
  if (node.kind === 'leaf') return <>{renderLeaf(node.id)}</>;
  return <SplitView node={node} renderLeaf={renderLeaf} onResize={onResize} />;
}

function SplitView({ node, renderLeaf, onResize }: { node: SplitNode } & Omit<PaneContainerProps, 'node'>) {
  const ref = useRef<HTMLDivElement>(null);
  const isRow = node.direction === 'row';

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const move = (ev: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        const ratio = isRow
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
        onResize(node.id, ratio);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [isRow, node.id, onResize],
  );

  return (
    <div ref={ref} className={`pane-split pane-split-${node.direction}`}>
      <div className="pane-slot" style={{ flexBasis: `${node.ratio * 100}%` }}>
        <PaneContainer node={node.a} renderLeaf={renderLeaf} onResize={onResize} />
      </div>
      <div
        className={`pane-divider pane-divider-${node.direction}`}
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
        onPointerDown={startDrag}
      />
      <div className="pane-slot" style={{ flexBasis: `${(1 - node.ratio) * 100}%` }}>
        <PaneContainer node={node.b} renderLeaf={renderLeaf} onResize={onResize} />
      </div>
    </div>
  );
}
