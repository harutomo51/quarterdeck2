/**
 * タイトルバー（折り畳み + 外観設定トグル）+ 分割ターミナル + 右サイドバー（タブ）。
 * 外観は useAppearance、サイドバーのレイアウトは useLayout、分割ツリーは usePaneTree、
 * キーバインドは useKeybindings が司る。サイドバーは右配置（ADR/grill 合意）。
 * 分割は ADR-0002（Focused Pane に Active Folder が追従）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalView } from './Terminal';
import { PaneContainer } from './components/PaneContainer';
import { Sidebar } from './components/Sidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { useAppearance } from './hooks/useAppearance';
import { useLayout } from './hooks/useLayout';
import { usePaneTree } from './hooks/usePaneTree';
import { useKeybindings } from './hooks/useKeybindings';
import { checkForUpdates } from './lib/updater';
import { terminalBackground } from './lib/appearance';
import type { PaneAction } from './lib/keybindings';

export default function App() {
  const { settings, update } = useAppearance();
  const { layout, update: updateLayout } = useLayout();
  const { bindings, update: updateBindings, reset: resetBindings } = useKeybindings();
  const panes = usePaneTree('main');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const paneAreaRef = useRef<HTMLDivElement>(null);

  // 起動時に一度だけ更新チェック（失敗してもアプリは継続）。
  useEffect(() => {
    void checkForUpdates();
  }, []);

  const { focus, split, close, focusMove } = panes;
  const onAction = useCallback(
    (action: PaneAction) => {
      const el = paneAreaRef.current;
      const size = el
        ? { width: el.clientWidth, height: el.clientHeight }
        : { width: 0, height: 0 };
      switch (action) {
        case 'split-vertical':
          split('row');
          break;
        case 'split-horizontal':
          split('column');
          break;
        case 'close-pane':
          close();
          break;
        case 'focus-up':
          focusMove('up', size);
          break;
        case 'focus-down':
          focusMove('down', size);
          break;
        case 'focus-left':
          focusMove('left', size);
          break;
        case 'focus-right':
          focusMove('right', size);
          break;
      }
    },
    [split, close, focusMove],
  );

  const background = terminalBackground(settings);
  const collapsed = layout.sidebarCollapsed;

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="titlebar-title">Quarterdeck</span>
        <div className="titlebar-actions">
          {collapsed && (
            <button
              type="button"
              className="titlebar-button"
              aria-label="サイドバーを表示"
              onClick={() => updateLayout({ sidebarCollapsed: false })}
            >
              ⇤
            </button>
          )}
          <button
            type="button"
            className="titlebar-button"
            aria-label="外観設定"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            ⚙
          </button>
        </div>
        {settingsOpen && (
          <SettingsPanel
            settings={settings}
            onChange={update}
            bindings={bindings}
            onBindingsChange={updateBindings}
            onBindingsReset={resetBindings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </header>
      <div className="app-body">
        <section className="terminal-pane" ref={paneAreaRef}>
          <PaneContainer
            node={panes.tree}
            onResize={panes.resize}
            renderLeaf={(leafId) => (
              <TerminalView
                key={leafId}
                id={leafId}
                background={background}
                focused={leafId === panes.focusedId}
                inheritCwdFrom={panes.inheritOf(leafId)}
                bindings={bindings}
                onFocus={() => focus(leafId)}
                onAction={onAction}
              />
            )}
          />
        </section>
        {!collapsed && (
          <aside
            className="sidebar"
            style={{ flex: `0 0 ${layout.sidebarWidth}px`, width: layout.sidebarWidth }}
          >
            <Sidebar layout={layout} onChange={updateLayout} />
          </aside>
        )}
      </div>
    </div>
  );
}
