/**
 * サイドバー本体。タブ（Files / Git Graph / Git Worktree）の切替、左端のリサイズ
 * ハンドル、各パネルの描画を担う。サイドバーは右配置なので、ハンドルは左端に置き、
 * 左へドラッグすると広がる。幅・タブ・折りたたみの永続化は useLayout（App 側）。
 *
 * Files は常時マウントして展開状態を保持し、非アクティブ時は CSS で隠す。Git パネルは
 * アクティブ時のみマウント（= マウント時更新）し、離れたら破棄する。
 */
import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { FileTree } from '../FileTree';
import { GitGraph } from './GitGraph';
import { GitWorktree } from './GitWorktree';
import { clampSidebarWidth, type LayoutState, type SidebarTab } from '../lib/layout';

interface SidebarProps {
  layout: LayoutState;
  onChange: (patch: Partial<LayoutState>) => void;
}

const TABS: readonly { id: SidebarTab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'graph', label: 'Graph' },
  { id: 'worktree', label: 'Worktree' },
];

export function Sidebar({ layout, onChange }: SidebarProps) {
  const startResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = layout.sidebarWidth;
      const onMove = (ev: PointerEvent) => {
        // 右配置サイドバー: 左端を左へ動かすほど widthは増える。
        onChange({ sidebarWidth: clampSidebarWidth(startWidth + (startX - ev.clientX)) });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [layout.sidebarWidth, onChange],
  );

  return (
    <>
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="サイドバー幅"
        onPointerDown={startResize}
      />
      <div className="sidebar-inner">
        <div className="sidebar-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={layout.activeTab === t.id}
              className="sidebar-tab"
              onClick={() => onChange({ activeTab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="sidebar-body">
          <div className="sidebar-pane" hidden={layout.activeTab !== 'files'}>
            <FileTree />
          </div>
          {layout.activeTab === 'graph' && <GitGraph />}
          {layout.activeTab === 'worktree' && <GitWorktree />}
        </div>
      </div>
    </>
  );
}
