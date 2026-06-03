/**
 * タイトルバー（折り畳み + 外観設定トグル）+ ターミナル + 右サイドバー（タブ）。
 * 外観は useAppearance、サイドバーのレイアウト（幅/折り畳み/タブ）は useLayout が
 * localStorage に永続化する。サイドバーは右配置（ADR/grill 合意）。
 */
import { useEffect, useState } from 'react';
import { TerminalView } from './Terminal';
import { Sidebar } from './components/Sidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { useAppearance } from './hooks/useAppearance';
import { useLayout } from './hooks/useLayout';
import { checkForUpdates } from './lib/updater';

export default function App() {
  const { settings, update } = useAppearance();
  const { layout, update: updateLayout } = useLayout();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 起動時に一度だけ更新チェック（失敗してもアプリは継続）。
  useEffect(() => {
    void checkForUpdates();
  }, []);

  const collapsed = layout.sidebarCollapsed;

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="titlebar-title">Quarterdeck</span>
        <div className="titlebar-actions">
          <button
            type="button"
            className="titlebar-button"
            aria-label={collapsed ? 'サイドバーを表示' : 'サイドバーを隠す'}
            aria-pressed={!collapsed}
            onClick={() => updateLayout({ sidebarCollapsed: !collapsed })}
          >
            {collapsed ? '⟨' : '⟩'}
          </button>
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
        {settingsOpen && <SettingsPanel settings={settings} onChange={update} />}
      </header>
      <div className="app-body">
        <section className="terminal-pane">
          <TerminalView id="main" />
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
