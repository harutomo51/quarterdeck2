/**
 * 分割ツリーをフラットな絶対配置で描画するコンテナ（Phase C / ADR-0002）。
 *
 * 再帰 flex（leaf を split のたびに深いツリーへ移す）方式だと、分割時に各 leaf の祖先 DOM
 * チェーンが変わり、React が key を保持できず TerminalView を unmount → 再生成してしまう
 * （= 既存ターミナルが初期化される）。これを避けるため、全 leaf を**同一コンテナの直接の子**
 * として `computeLayout` の矩形で絶対配置する。分割しても各 leaf の親は不変なので、React は
 * インスタンス（xterm + PTY）を保持する。
 *
 * ディバイダも同じ矩形群から絶対配置し、ドラッグ時は split の全体矩形を基準に ratio を算出して
 * onResize(splitId, ratio) を通知する（usePaneTree が clampRatio して反映）。
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { computeLayout, type DividerBox, type PaneNode, type Size } from '../lib/paneTree';

interface PaneContainerProps {
  node: PaneNode;
  renderLeaf: (id: string) => ReactNode;
  onResize: (splitId: string, ratio: number) => void;
}

export function PaneContainer({ node, renderLeaf, onResize }: PaneContainerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  // 自身のサイズを測ってレイアウト計算へ渡す。サイドバー/ディバイダのドラッグでも
  // window resize は飛ばないため、コンテナ自体のサイズ変化を ResizeObserver で拾う。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startDrag = useCallback(
    (e: React.PointerEvent, divider: DividerBox) => {
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const { splitId, direction, splitRect } = divider;
      const isRow = direction === 'row';
      // この split の全体矩形は単一ディバイダのドラッグ中は不変（祖先比率は変わらない）。
      const move = (ev: PointerEvent) => {
        const base = el.getBoundingClientRect();
        const ratio = isRow
          ? (ev.clientX - base.left - splitRect.x) / splitRect.width
          : (ev.clientY - base.top - splitRect.y) / splitRect.height;
        onResize(splitId, ratio);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onResize],
  );

  const { leaves, dividers } = computeLayout(node, size);

  return (
    <div ref={ref} className="pane-area">
      {leaves.map(({ id, rect }) => (
        <div
          key={id}
          className="pane-slot"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {renderLeaf(id)}
        </div>
      ))}
      {dividers.map((d) => (
        <div
          key={d.splitId}
          className={`pane-divider pane-divider-${d.direction}`}
          role="separator"
          aria-orientation={d.direction === 'row' ? 'vertical' : 'horizontal'}
          style={{ left: d.rect.x, top: d.rect.y, width: d.rect.width, height: d.rect.height }}
          onPointerDown={(e) => startDrag(e, d)}
        />
      ))}
    </div>
  );
}
