# Quarterdeck

Windows 11 向けの **PowerShell 互換ターミナル UI**（技術検証 MVP）。

PowerShell コマンド自体は再実装しません。**Tauri 2 の Rust バックエンド**から `portable-pty` 経由で `pwsh.exe`（無ければ `powershell.exe`）を起動し、バイト列をそのまま [xterm.js](https://xtermjs.org/) と PTY の間で受け渡します。**PowerShell 互換性を最優先**に設計しています。

このリポジトリは Electron 版（`node-pty` + `contextBridge` IPC）からの **「フロント流用 + Rust バックエンド新規実装」** にあたります。React + xterm.js + Vite はほぼそのまま運び、`node-pty`（Node ネイティブ）に依存していた箇所だけ Rust の `portable-pty` に置き換えています。

> **対象は Windows 11 のみ**（WebView2 プリインストール前提）。クロスプラットフォーム対応は本 MVP のゴールではありません。

## 特徴

- **PTY 直結ターミナル** — `pwsh.exe` / `powershell.exe` を `portable-pty` で起動。出力は base64 イベントで渡し、マルチバイト境界の分割に強い。
- **ファイルツリー & プレビュー** — 起動ディレクトリ配下を遅延ロード。拡張子別アイコン表示。Markdown / HTML / コードをプレビューウィンドウで表示。
- **スコープ強制** — ファイル操作は `..` traversal・絶対パス・シンボリックリンクを Rust 側で拒否し、ルート配下のみ許可。
- **軽量配布** — NSIS インストーラー + アップデーター対応。

## 技術スタック

| レイヤー | 採用技術 |
|---|---|
| フロントエンド | React 18 / TypeScript / Vite 5 / xterm.js |
| バックエンド | Rust / Tauri 2 / `portable-pty` |
| プレビュー | markdown-it / highlight.js |
| テスト | Vitest（純粋ロジック）/ `cargo test`（Rust ロジック） |

## アーキテクチャ

2 プロセス構成です。プロセス境界を越えるのは Tauri の `invoke`（renderer → Rust コマンド）と `emit` / `listen`（Rust → renderer イベント）だけです。

```
quarterdeck/
├── src/                      # フロントエンド（React + xterm.js）
│   ├── Terminal.tsx          # xterm.js + PTY 橋渡し（pty_create / pty_write / ...）
│   ├── FileTree.tsx          # list_dir でツリー表示
│   ├── lib/                  # UI 状態と分離した純粋ロジック（テスト対象）
│   └── preview/              # プレビューウィンドウ
├── src-tauri/                # Rust バックエンド
│   └── src/
│       ├── pty.rs            # PTY ライフサイクル（spawn / write / resize / kill）
│       └── fs_scope.rs       # list_dir / read_preview（スコープ強制）
├── tests/                    # Vitest（純粋ロジック）
└── docs/                     # 設計・移行スコープ・ADR
```

設計原則として、レイアウト計算・git グラフ整形・外観の正規化などの **純粋関数ロジックは UI 状態と分離してテスト可能**にしています。UI・PTY・WebView の挙動は手動検証に委ねます。

## 必要環境

- Windows 11（WebView2 プリインストール済み）
- [Node.js](https://nodejs.org/) 18+
- [Rust ツールチェイン](https://www.rust-lang.org/tools/install)（`cargo`）
- Visual Studio C++ Build Tools（Tauri のビルドに必要）

## セットアップ

```powershell
npm install        # フロント依存を導入
npm run app:dev    # 開発起動（Vite + Rust ビルド + WebView 起動）
```

起動は `npm run app:dev` 一本で完結します（`tauri dev` が内部で `npm run dev` を立ち上げます）。

## コマンド

```powershell
npm run app:dev      # tauri dev（開発起動）
npm run app:build    # tauri build（NSIS インストーラーを生成）
npm run dev          # vite のみ（フロント単体プレビュー）
npm run build        # tsc && vite build（dist/ にフロント成果物）
npm run typecheck    # tsc --noEmit
npm test             # vitest run（純粋ロジックの全テスト）

# Rust 側
cargo test   --manifest-path src-tauri/Cargo.toml   # Rust テスト
cargo fmt    --manifest-path src-tauri/Cargo.toml   # フォーマット
cargo clippy --manifest-path src-tauri/Cargo.toml   # lint
```

`dist/` は Vite のフロント出力、Rust の最終成果物は `src-tauri/target/`（いずれも `.gitignore` 対象）です。

## テスト方針

- `tests/` は `vitest run`、Rust は `cargo test` で実行します。
- Vitest は純粋ロジック（レイアウト計算、git グラフ整形、外観の正規化、入力のサニタイズなど）に集中。
- `cargo test` は Rust ロジック（特に `fs_scope` のスコープ強制、シェル解決のフォールバック）に集中。
- **UI・PTY・WebView 挙動は Windows 11 上で目視検証**します（IME 入力、コピー/ペースト、リサイズ、`Ctrl+C`、対話的 CLI、アプリ終了後のプロセス残存など）。

## セキュリティ方針

- renderer から OS リソースへ触るのは必ず自前の `#[tauri::command]`（`invoke`）経由。汎用のコマンド実行 API やファイルシステム API は renderer に露出させません。
- ファイルプレビュー / ツリーは **ルート配下の相対パスのみ**許可。絶対パスと `..` traversal は拒否します。
- HTML プレビューの iframe は `allow-scripts` のみ（`allow-same-origin` は付けません）。
- 他のシェルの起動は許可しません（`pwsh` → `powershell.exe` フォールバックのみ）。

## ドキュメント

- [`docs/quarterdeck-tauri-migration-scope.md`](docs/quarterdeck-tauri-migration-scope.md) — Electron → Tauri 移行スコープ（構成・コマンド骨組み・段階計画・残存リスクの正典）
- [`docs/DESIGN.md`](docs/DESIGN.md) — デザインシステム（Markdown プレビューの意匠の基準）
- [`docs/adr/`](docs/adr/) — アーキテクチャ決定記録
- [`CLAUDE.md`](CLAUDE.md) — リポジトリ内での開発ガイダンス
