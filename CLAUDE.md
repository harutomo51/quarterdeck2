# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Windows 11向け PowerShell互換ターミナル UI の技術検証MVP。PowerShellコマンドは再実装しない。**Tauri 2 の Rust バックエンド**から `portable-pty` 経由で `pwsh.exe`（無ければ `powershell.exe`）を起動し、bytes をそのまま xterm.js と PTY の間で渡す。PowerShell互換性が最優先。

このリポジトリは Electron 版（`node-pty` + `contextBridge` IPC）からの **「フロント流用 + Rust バックエンド新規実装」** にあたる。React + xterm.js + Vite はほぼそのまま運び、`node-pty`（Node ネイティブ）に依存していた箇所だけ Rust の `portable-pty` に置き換える。移行スコープの単一の真実は `docs/quarterdeck-tauri-migration-scope.md`。

ターゲットは Windows 11 のみ（WebView2 プリインストール前提）。クロスプラットフォーム対応は MVP のゴールではない。

## Commands

```powershell
npm install           # フロント依存導入（@tauri-apps/api, @tauri-apps/cli ほか）
npm run app:dev       # tauri dev（beforeDevCommand で vite を内部起動 + Rust ビルド + WebView 起動）
npm run dev           # vite のみ（フロント単体プレビュー。通常は app:dev を使う）
npm run build         # tsc && vite build（dist/ にフロント成果物）
npm run app:build     # tauri build（NSIS インストーラーを src-tauri/target に生成）
npm run typecheck     # tsc --noEmit
npm test              # vitest run（純粋ロジックの全テスト）
npx vitest run tests/<name>.test.ts          # 単一テスト実行
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 側テスト
cargo fmt   --manifest-path src-tauri/Cargo.toml   # Rust フォーマット
cargo clippy --manifest-path src-tauri/Cargo.toml  # Rust lint
```

起動は `npm run app:dev` 一本でよい（`tauri dev` が `beforeDevCommand` = `npm run dev` を内部で立ち上げる）。`dist/` は vite のフロント出力、Rust の最終成果物は `src-tauri/target/` で `.gitignore` 対象。

## Architecture

2プロセス構成。境界を越えるのは Tauri の `invoke`（renderer → Rust コマンド）と `emit`/`listen`（Rust → renderer イベント）だけ。Electron の preload `contextBridge` は廃止し、`@tauri-apps/api` の `invoke` / `listen` を直接使う。

### Rust backend (`src-tauri/`)
- `src/main.rs` — `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` のみ。`quarterdeck_lib::run()` を呼ぶ薄いエントリ。
- `src/lib.rs` — `tauri::Builder`。`.manage(PtyState)` / `.manage(FsRoot)` で状態を登録し、`invoke_handler` に全コマンドを列挙、updater プラグインを `.plugin()` する。`generate_context!()` で `tauri.conf.json` を取り込む。
- `src/pty.rs` — `node-pty` 相当を `portable-pty` で実装。`id → PtySession` の `HashMap`（`Mutex`）で複数 PTY を管理。reader はブロッキングなので**別スレッド**で回し、出力は **base64 にして `pty://data` イベント**で renderer へ送る（マルチバイト境界の分割に強い）。コマンドは `pty_create` / `pty_write` / `pty_resize` / `pty_close`。シェル解決は `which::which("pwsh")` → `powershell.exe` フォールバックで、**他のシェルを許可しない**。
- `src/fs_scope.rs` — `list_dir` / `read_preview`。`canonicalize` で `..` とシンボリックリンクを解決し、`FsRoot` 配下から外れたら reject（= コマンド内部がスコープ強制の信頼境界）。`MAX_PREVIEW_BYTES = 1MB`、`EXCLUDE`（`node_modules` / `.git` / `dist` / `target` ほか）でツリーを間引く。拡張子で `md` / `html` / `code` を出し分ける。
- `tauri.conf.json` — `identifier`（Electron 版の appId を流用）、`build.frontendDist = "../dist"` / `devUrl` / `beforeDevCommand` / `beforeBuildCommand`、`app.security.csp`（xterm のスタイル動的注入のため当面 `style-src 'unsafe-inline'`）、`bundle.targets = ["nsis"]`、`plugins.updater`。
- `capabilities/` — `default.json`（main ウィンドウ: core + event + webview 生成 + updater）/ `preview.json`（`preview-*` ウィンドウ: 最小権限）。**自前の `#[tauri::command]` は ACL 対象外で既定で全ウィンドウから呼べる**ため capability に列挙せず、スコープ強制は Rust コマンド内側で行う。capability で許可するのは core とプラグインのみ。

### Frontend (`src/`)
Electron 版の renderer をほぼ流用。`window.<api>`（preload Bridge）への依存だけを `@tauri-apps/api` に差し替える。

- `Terminal.tsx`（旧 `components/TerminalView.tsx`）— xterm.js 1個 + `FitAddon`。`invoke('pty_create' / 'pty_write' / 'pty_resize' / 'pty_close')`、`listen('pty://data' / 'pty://exit')`。`pty://data` の base64 を `Uint8Array` に戻して `term.write` に渡す（xterm が UTF-8 をインクリメンタル復号）。`useEffect` の teardown で `listen` の解除関数を呼び `pty_close` を発火。
- `FileTree.tsx` — `invoke('list_dir')`。プレビューは `invoke('read_preview')`。
- `preview/PreviewWindow.tsx` — `read_preview` の content を `md` / `html` / `code` で描画。HTML は `<iframe sandbox="allow-scripts">`（`allow-same-origin` は付けない）。
- 純粋関数ロジック（レイアウト計算、サイドパネル幅、git グラフ整形など）は **UI 状態と分離してテスト可能にする**のがこのプロジェクトの設計原則。`styles/` の CSS カスタムプロパティ（透明度・背景色）で外観を制御し、透明度は背景レイヤーだけに当てて文字には適用しない。

### Build wiring
`vite.config.ts` は素の Vite（electron-vite は不要）。renderer alias `@` → `src/`。`tauri.conf.json` の `beforeDevCommand` / `beforeBuildCommand` がフロントビルドを駆動する。`tsconfig.json` の `include` は `src`, `tests` を覆う。Rust 側は `src-tauri/Cargo.toml`（`crate-type = ["lib","cdylib","staticlib"]`、`portable-pty` / `tauri` / `tauri-plugin-updater` / `which` / `base64` / `serde`）。

## Test Strategy

`tests/` は `vitest run`、Rust は `cargo test` で実行。**UI・PTY・WebView 挙動は手動検証**に委ね、Vitest は純粋ロジック（レイアウト計算、git グラフ整形、外観の正規化、入力のサニタイズなど）、`cargo test` は Rust ロジック（特に `fs_scope` のスコープ強制 = `..` traversal / 絶対パス / シンボリックリンクの拒否、シェル解決のフォールバック）に集中させる。新規ロジックを足すときは同じ方針でテストを1ファイル追加する。

## Change Rules

- PTY ライフサイクル（spawn / write / resize / kill）は React コンポーネントに書かない。`src-tauri/src/pty.rs` に集約し、状態は `PtyState`（`Mutex<HashMap>`）で持つ。
- renderer から OS リソースへ触るのは必ず `invoke`（自前 Rust コマンド）経由。汎用のコマンド実行 API やファイルシステム API を renderer に露出させない。`window.require` 等は存在しない。
- 新しい機能を足すときは Rust 側に `#[tauri::command]` を1つ定義し、`lib.rs` の `invoke_handler` に登録、フロントは `invoke('<name>')` で呼ぶ。スコープ強制が要るものはコマンド内側で必ず検証する。
- file preview と file tree は **`FsRoot` 配下の相対パスのみ** 許可。絶対パスと `..` traversal は `resolve_within` で reject。
- HTML プレビュー iframe は `allow-scripts` のみ。`allow-same-origin` は付けない。
- PTY 出力は base64 でイベント送信する（生バイトを文字列化しない）。マルチバイト境界の破壊を避ける。
- capability には core / プラグイン権限のみ列挙し、最小に保つ。プレビューウィンドウ（`preview-*`）は `core:event` だけに絞る。
- 環境変数、トークン、機密情報をログ出力しない。
- 外部 URL を open する機能はこの MVP では追加しない。

## Manual Verification

PTY 挙動、日本語 IME 入力、コピー/ペースト、リサイズ、`Ctrl+C`、対話的 CLI（`git`, `npm`）、**アプリ終了後のプロセス残存**は **必ず Windows 11 上で目視確認**。特に Tauri 移行で新たに要検証となる点（スコープ文書 §11）:

- **子プロセスツリーの kill**: `child.kill()` が pwsh の孫プロセスまで終了させるとは限らない。残存が出るなら Windows Job Object でツリーごと束ねる対策を検討。
- **IME（日本語入力）**: WebView2 上の xterm は Electron（Chromium 同梱）と挙動差が出る可能性があるため早めに確認。
- **プレビューのスコープ基準**: 現状の骨組みは起動ディレクトリ（`FsRoot`）で統一。ライブの PowerShell cwd へ追従させたい場合は OSC シーケンス監視など別途 cwd 追跡が必要（仕様判断）。

## Migration Phases

`docs/quarterdeck-tauri-migration-scope.md` §10 の段階計画に従う:

- **Phase 0 — 足場**: `src-tauri/` を追加し main ウィンドウが空で起動するまで。フロントは既存 Vite を流用。
- **Phase 1 — PTY コア**（本丸）: `pty.rs`。重点検証 — `dir` / `Get-ChildItem` / `git --version` / `npm --version` / 日本語入力 / コピペ / `Ctrl+C` / リサイズ / プロセス残存。
- **Phase 2 — ファイルツリー & プレビュー**: `fs_scope.rs` + プレビューウィンドウ。スコープ強制・1MB制限・md/html/code 出し分け・sandbox iframe。
- **Phase 3 — UI 移植**: 背景プリセット/透明度/カラー UI を Electron 固有 API から Tauri へ置換。
- **Phase 4 — 配布**: NSIS バンドル + updater。`tauri signer generate` で署名鍵、社内配布エンドポイント、コード署名証明書。

## References

- `docs/quarterdeck-tauri-migration-scope.md` — Electron → Tauri 移行スコープ（このリポジトリの構成・コマンド・コマンド骨組み・段階計画・残存リスクの正典）
- `AGENTS.md` — 元となる開発憲法（変更ルールとセキュリティ方針の出典。Electron 版から流用する場合は Tauri の語彙へ読み替える）
- 元 Electron リポジトリ: https://github.com/harutomo51/quarterdeck （フロント流用元）
