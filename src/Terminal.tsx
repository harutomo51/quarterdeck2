/**
 * Phase 1: PTY コアのフロント側グルー。
 *
 * xterm.js を 1 個ぶら下げ、Tauri の invoke / listen で Rust の PTY と接続する。
 * - 出力: `pty://data`（base64）を Uint8Array に戻して term.write（xterm が UTF-8 を
 *   インクリメンタル復号する）。
 * - 入力: term.onData → invoke('pty_write')。
 * - リサイズ: FitAddon で合わせて invoke('pty_resize')。
 * - teardown: listen 解除関数を呼び invoke('pty_close') を発火。
 *
 * PTY ライフサイクル（spawn/write/resize/kill）はここには書かず、Rust 側
 * （src-tauri/src/pty.rs）に集約する。ここは描画と橋渡しだけを担う。
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface TerminalViewProps {
  id: string;
  /** ターミナル背景色（rgba 文字列）。未指定なら透過してアプリ背景を透けさせる。 */
  background?: string;
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

interface PtyData {
  id: string;
  data: string; // base64
}

interface PtyExit {
  id: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function TerminalView({ id, background }: TerminalViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // 初期生成時の背景色を effect 内で参照する（生成 effect は [id] のみ依存させ、
  // 色変更でターミナルを作り直さないため、最新値は ref 経由で読む）。
  const backgroundRef = useRef(background);
  backgroundRef.current = background;

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      fontSize: 14,
      cursorBlink: true,
      // 背景は既定で透過にし、アプリ背景レイヤー（CSS の --bg）を透けさせる。
      // Terminal color が指定されればその rgba を使う。透明度は背景のみに当て、
      // 文字色 (foreground) には適用しない（CLAUDE.md）。
      allowTransparency: true,
      theme: { background: backgroundRef.current ?? TRANSPARENT, foreground: '#e6e6e6' },
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current!);
    fit.fit();

    const unData = listen<PtyData>('pty://data', (e) => {
      if (e.payload.id !== id) return;
      term.write(base64ToBytes(e.payload.data));
    });
    const unExit = listen<PtyExit>('pty://exit', (e) => {
      if (e.payload.id === id) term.writeln('\r\n[process exited]');
    });

    const offData = term.onData((data) => {
      void invoke('pty_write', { id, data });
    });

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let lastCols = term.cols;
    let lastRows = term.rows;

    // 再フィットし、列数・行数が実際に変わった時だけ PTY へ通知する。
    // 同じ cols/rows での無駄な resize 送信（= SIGWINCH 連発）を避ける。
    const applyResize = () => {
      fit.fit();
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols;
        lastRows = term.rows;
        void invoke('pty_resize', { id, cols: term.cols, rows: term.rows });
      }
    };

    // 高速リサイズで pty_resize/SIGWINCH を連発すると TUI（Claude Code 等）の
    // 再描画が追いつかず表示が崩れる。サイズが落ち着いてから一度だけ適用する。
    // リサイズ中の一時的なはみ出しは .terminal-host の overflow:hidden が抑える。
    const onResize = () => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyResize, 100);
    };
    window.addEventListener('resize', onResize);

    // サイドバーの表示/折り畳み/ドラッグでターミナル領域の幅が変わるが、
    // window の resize は飛ばない。host 自体のサイズ変化を監視して再フィットし、
    // 古い列数のまま罫線がサイドパネルへはみ出すのを防ぐ。
    const ro = new ResizeObserver(() => onResize());
    ro.observe(ref.current!);

    void invoke('pty_create', { id, cols: term.cols, rows: term.rows });

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      offData.dispose();
      void unData.then((f) => f());
      void unExit.then((f) => f());
      void invoke('pty_close', { id });
      term.dispose();
      termRef.current = null;
    };
  }, [id]);

  // Terminal color / Opacity の変更を既存ターミナルへ反映（再生成しない）。
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = { ...term.options.theme, background: background ?? TRANSPARENT };
  }, [background]);

  return <div ref={ref} className="terminal-host" />;
}
