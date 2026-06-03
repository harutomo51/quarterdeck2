/**
 * Phase 1: PTY コア。
 * 単一の PTY セッションをフルウィンドウで表示する。
 * 複数 PTY（タブ）化は将来の拡張（Rust 側は id キーの HashMap で対応済み）。
 */
import { TerminalView } from './Terminal';

export default function App() {
  return (
    <main className="app-shell">
      <TerminalView id="main" />
    </main>
  );
}
