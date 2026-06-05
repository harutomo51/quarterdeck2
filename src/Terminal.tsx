/**
 * Phase 1: PTY コアのフロント側グルー（Phase C で分割対応 / ADR-0002）。
 *
 * xterm.js を 1 個ぶら下げ、Tauri の invoke / listen で Rust の PTY と接続する。
 * - 出力: `pty://data`（base64）を Uint8Array に戻して term.write（xterm が UTF-8 を
 *   インクリメンタル復号する）。
 * - 入力: term.onData → invoke('pty_write')。
 * - リサイズ: FitAddon で合わせて invoke('pty_resize')。
 * - フォーカス: ペインにフォーカスが当たると invoke('pty_focus', {id})（ADR-0002:
 *   renderer は id だけ渡す）＋ onFocus で React 側の focusedId を更新。
 * - キー横取り: attachCustomKeyEventHandler で PTY へ流す前にショートカットを判定し、
 *   一致すれば onAction を呼んで PTY へは流さない。
 * - 生成: invoke('pty_create', { id, cols, rows, inheritCwdFrom })。inheritCwdFrom は
 *   分割継承元ペインの id（Rust がその cwd で spawn）。
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
import { matchAction, type Keybindings, type PaneAction } from './lib/keybindings';

interface TerminalViewProps {
  id: string;
  /** ターミナル背景色（rgba 文字列）。未指定なら透過してアプリ背景を透けさせる。 */
  background?: string;
  /** このペインがフォーカス中か（枠線ハイライト＋xterm へ実フォーカス）。 */
  focused?: boolean;
  /** 分割継承元ペインの id（新ペインをその cwd で spawn する。ADR-0002）。 */
  inheritCwdFrom?: string;
  /** キーバインド設定（ショートカット判定に使う）。 */
  bindings?: Keybindings;
  /** フォーカスが当たったとき（React 側 focusedId の更新用）。 */
  onFocus?: () => void;
  /** ショートカット一致時に発火する操作。 */
  onAction?: (action: PaneAction) => void;
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

export function TerminalView({
  id,
  background,
  focused,
  inheritCwdFrom,
  bindings,
  onFocus,
  onAction,
}: TerminalViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // 初期生成時の値を effect 内で参照する（生成 effect は [id] のみ依存させ、最新値は
  // ref 経由で読む。色変更・props 変更でターミナルを作り直さないため）。
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const inheritRef = useRef(inheritCwdFrom);
  inheritRef.current = inheritCwdFrom;
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

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

    // ショートカットを PTY へ流す前に横取りする（一致すれば onAction、PTY へは送らない）。
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // Ctrl+V 貼り付け。Aquavoice 等の音声入力や OS レベル SendInput は本文を
      // クリップボードに置き Ctrl+V キーストロークだけを送るため、xterm 既定では
      // ^V(0x16) が PTY へ流れる。pwsh の PSReadLine は ^V を貼り付けに解釈するが、
      // raw モードの TUI（Claude Code 等）は取りこぼす。ここで自前にクリップボードを
      // 読み term.paste() に渡せば、TUI が有効化する bracketed paste にも従って
      // ラップされ、どのアプリでも本文が入力される。
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(() => {
            // 読み取り不可（権限・空）時は何もしない。^V は送らない。
          });
        return false;
      }

      const b = bindingsRef.current;
      if (!b) return true;
      const action = matchAction(b, e);
      if (action) {
        e.preventDefault();
        onActionRef.current?.(action);
        return false;
      }
      return true;
    });

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

    // サイドバー / 分割ディバイダのドラッグでターミナル領域の幅が変わるが、
    // window の resize は飛ばない。host 自体のサイズ変化を監視して再フィットし、
    // 古い列数のまま罫線がはみ出すのを防ぐ。
    const ro = new ResizeObserver(() => onResize());
    ro.observe(ref.current!);

    // 分割継承元（Focused Pane）の id を渡す。Rust がその cwd で spawn する（ADR-0002）。
    void invoke('pty_create', { id, cols: term.cols, rows: term.rows, inheritCwdFrom: inheritRef.current });

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

  // React 側で focusedId になったら実際の xterm にもフォーカスを移す
  // （キーボード移動でタイプ先を合わせる）。
  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  // ペインに触れたらフォーカスを宣言する（クリック移動）。Rust にも id を伝える。
  const declareFocus = () => {
    onFocusRef.current?.();
    void invoke('pty_focus', { id });
  };

  return (
    <div
      ref={ref}
      className={`terminal-host${focused ? ' terminal-host-focused' : ''}`}
      onPointerDownCapture={declareFocus}
      onFocusCapture={declareFocus}
    />
  );
}
