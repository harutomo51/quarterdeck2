/**
 * Phase 1〜3: タイトルバー（外観設定トグル）+ ファイルツリー + ターミナル。
 * 外観は useAppearance が CSS カスタムプロパティに反映する。
 */
import { useEffect, useState } from 'react';
import { TerminalView } from './Terminal';
import { FileTree } from './FileTree';
import { SettingsPanel } from './components/SettingsPanel';
import { useAppearance } from './hooks/useAppearance';
import { checkForUpdates } from './lib/updater';

export default function App() {
  const { settings, update } = useAppearance();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 起動時に一度だけ更新チェック（失敗してもアプリは継続）。
  useEffect(() => {
    void checkForUpdates();
  }, []);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="titlebar-title">Quarterdeck</span>
        <button
          type="button"
          className="titlebar-button"
          aria-label="外観設定"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          ⚙
        </button>
        {settingsOpen && <SettingsPanel settings={settings} onChange={update} />}
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <FileTree />
        </aside>
        <section className="terminal-pane">
          <TerminalView id="main" />
        </section>
      </div>
    </div>
  );
}
