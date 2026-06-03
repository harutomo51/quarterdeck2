/**
 * Phase 0 プレースホルダ。
 * ここでは「Tauri 足場が起動すること」だけを確認する。
 * Phase 1 で元 Electron 版の TerminalView を移植し、
 * preload bridge を @tauri-apps/api の invoke / listen に差し替える。
 */
export default function App() {
  return (
    <main className="phase0">
      <h1>Quarterdeck</h1>
      <p className="lead">Phase 0 — Tauri 足場が起動しました。</p>
      <p className="hint">次は Phase 1（PTY コア）でターミナルを移植します。</p>
    </main>
  );
}
