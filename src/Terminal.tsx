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
}

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

export function TerminalView({ id }: TerminalViewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      fontSize: 14,
      cursorBlink: true,
      theme: { background: '#0f1115', foreground: '#e6e6e6' },
    });
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

    const onResize = () => {
      fit.fit();
      void invoke('pty_resize', { id, cols: term.cols, rows: term.rows });
    };
    window.addEventListener('resize', onResize);

    void invoke('pty_create', { id, cols: term.cols, rows: term.rows });

    return () => {
      window.removeEventListener('resize', onResize);
      offData.dispose();
      void unData.then((f) => f());
      void unExit.then((f) => f());
      void invoke('pty_close', { id });
      term.dispose();
    };
  }, [id]);

  return <div ref={ref} className="terminal-host" />;
}
