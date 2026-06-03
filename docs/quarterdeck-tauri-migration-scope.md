# Quarterdeck — Electron → Tauri 移行スコープ(たたき台)

前提: 配布対象は全員 Windows 11(WebView2 プリインストール済み)。エンジニアは利用者であり保守はしない(= Rust 単独保守を許容)。目的は「軽快さで社内定着」。

このドキュメントは「移行」ではなく **フロント流用 + Rust バックエンド新規実装** のスコープを示す。React + xterm.js + Vite はほぼそのまま運び、`node-pty`(Node ネイティブ)に依存していた箇所だけ Rust の `portable-pty` に置き換える。

---

## 1. プロジェクト構成

```
quarterdeck/
├─ src/                       # 既存の React + xterm.js をほぼ流用
│  ├─ main.tsx
│  ├─ Terminal.tsx            # invoke('pty_create') / listen('pty://data')
│  ├─ FileTree.tsx            # invoke('list_dir')
│  └─ preview/PreviewWindow.tsx
├─ index.html
├─ vite.config.ts             # 既存流用(electron-vite は不要に)
├─ package.json               # electron系を削除、@tauri-apps/* を追加
└─ src-tauri/                 # 新規(Rust バックエンド)
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/
   │  ├─ default.json         # main ウィンドウの権限
   │  └─ preview.json         # preview-* ウィンドウの権限(最小)
   ├─ icons/                  # icon.ico ほか
   └─ src/
      ├─ main.rs
      ├─ lib.rs               # Builder / invoke_handler / manage(state)
      ├─ pty.rs               # PTY コマンド + 出力読み取りスレッド
      └─ fs_scope.rs          # list_dir / read_preview(スコープ強制)
```

`electron/` ディレクトリ、`electron.vite.config.ts`、`node-pty` は廃止。`src/` 配下の renderer ロジック(xterm 描画、背景/透明度UI、プレビュー外側UI)はそのまま移植できる。

---

## 2. package.json の差分(方針)

- 削除: `electron`, `electron-builder`, `electron-vite`, `node-pty`
- 追加: `@tauri-apps/api`, `@tauri-apps/cli`(devDep), `@tauri-apps/plugin-updater`
- 維持: `react`, `@xterm/xterm`, `@xterm/addon-fit`(必要なら `@xterm/addon-webgl`), `vite`, `typescript`

scripts 例:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri",
    "app:dev": "tauri dev",
    "app:build": "tauri build"
  }
}
```
`tauri dev` は `beforeDevCommand`(= `npm run dev`)を内部で起動するので、起動は `npm run app:dev` 一本でよい。

---

## 3. src-tauri/Cargo.toml

```toml
[package]
name = "quarterdeck"
version = "0.1.0"
edition = "2021"

[lib]
name = "quarterdeck_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-updater = "2"
portable-pty = "0.9"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
base64 = "0.22"
which = "6"
```

※ バージョンはたたき台。実際は `cargo add tauri@2 portable-pty …` で導入し、ロック時点の最新互換に合わせる。

---

## 4. src-tauri/tauri.conf.json

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Quarterdeck",
  "version": "0.1.0",
  "identifier": "<既存 electron-builder で確定済みの appId を流用>",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      { "label": "main", "title": "Quarterdeck", "width": 1100, "height": 720 }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/icon.ico"]
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://<社内配布先>/quarterdeck/{{target}}/{{arch}}/{{current_version}}"],
      "pubkey": "<tauri signer generate で作成した公開鍵>"
    }
  }
}
```

- `identifier` は前に electron-builder で固めた appId をそのまま使い回す(逆DNS形式)。
- `csp` の `style-src 'unsafe-inline'` は xterm がスタイルを動的注入するため当面必要。後で締める。
- WebGL レンダラ(`@xterm/addon-webgl`)を使う場合は WebView2 で表示崩れがないか要確認(通常は問題なし)。

---

## 5. capabilities(権限)

Tauri 2 の重要点: **自前の `#[tauri::command]`(`pty_*`, `list_dir`, `read_preview`)は ACL の対象外で、既定で全ウィンドウから呼べる**。したがって capability に列挙する必要はなく、スコープ強制は Rust コマンドの内側で行う(= コマンドが信頼境界)。capability で許可するのは core とプラグインのみ。

`src-tauri/capabilities/default.json`
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window: core + event + プレビューウィンドウ生成 + updater",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:webview:allow-create-webview-window",
    "core:window:allow-set-title",
    "updater:default"
  ]
}
```

`src-tauri/capabilities/preview.json`(プレビューウィンドウは最小権限)
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "preview",
  "description": "Preview windows: 読み取り表示のみ",
  "windows": ["preview-*"],
  "permissions": ["core:event:default"]
}
```

※ 権限識別子は版で増減し得るので、`cargo tauri` のスキーマ(`gen/schemas/desktop-schema.json`)で実際の候補を確認すること。

---

## 6. PTY コマンド骨組み(src-tauri/src/pty.rs)

`node-pty` 相当を `portable-pty` で実装。reader はブロッキングなので別スレッドで回し、出力は base64 にして Tauri イベントで renderer へ送る(マルチバイト境界の分割に強い)。

```rust
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child:  Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Mutex<HashMap<String, PtySession>>,
}

#[derive(Clone, Serialize)]
struct PtyOutput { id: String, data: String } // data は base64
#[derive(Clone, Serialize)]
struct PtyExit   { id: String }

fn resolve_shell() -> CommandBuilder {
    // PowerShell 7 があれば pwsh、なければ powershell にフォールバック
    let prog = if which::which("pwsh").is_ok() { "pwsh.exe" } else { "powershell.exe" };
    let mut cmd = CommandBuilder::new(prog);
    if let Ok(cwd) = std::env::current_dir() { cmd.cwd(cwd); }
    cmd
}

#[tauri::command]
pub fn pty_create(
    id: String, cols: u16, rows: u16,
    app: AppHandle, state: State<PtyState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let child = pair.slave.spawn_command(resolve_shell()).map_err(|e| e.to_string())?;
    drop(pair.slave); // master が EOF を受け取れるよう slave は破棄

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer     = pair.master.take_writer().map_err(|e| e.to_string())?;

    // 出力読み取り(ブロッキング read を別スレッドで)
    let app_t = app.clone();
    let id_t  = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app_t.emit("pty://exit", PtyExit { id: id_t.clone() });
                    break;
                }
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_t.emit("pty://data", PtyOutput { id: id_t.clone(), data });
                }
            }
        }
    });

    state.sessions.lock().unwrap()
        .insert(id, PtySession { master: pair.master, writer, child });
    Ok(())
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<PtyState>) -> Result<(), String> {
    let mut s = state.sessions.lock().unwrap();
    let sess = s.get_mut(&id).ok_or("session not found")?;
    sess.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    sess.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(id: String, cols: u16, rows: u16, state: State<PtyState>) -> Result<(), String> {
    let s = state.sessions.lock().unwrap();
    let sess = s.get(&id).ok_or("session not found")?;
    sess.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(id: String, state: State<PtyState>) -> Result<(), String> {
    if let Some(mut sess) = state.sessions.lock().unwrap().remove(&id) {
        let _ = sess.child.kill(); // 注意: 孫プロセスまで殺すとは限らない(下記リスク参照)
    }
    Ok(())
}
```

セッションを `id` キーの `HashMap` にしてあるので、将来の「タブごとの PTY 管理」(README の拡張案)にそのまま伸ばせる。

---

## 7. ファイル一覧 / プレビュー(src-tauri/src/fs_scope.rs)

preload 経由の限定APIを、スコープ強制つきの Rust コマンドに置換。`canonicalize` でシンボリックリンクや `..` を解決した上で、ルート配下から外れたら拒否する。

```rust
use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::State;

pub struct FsRoot { pub root: PathBuf }
impl FsRoot {
    pub fn new(root: PathBuf) -> Self { Self { root: root.canonicalize().unwrap_or(root) } }
}

#[derive(Serialize)]
pub struct Entry { name: String, is_dir: bool }

const EXCLUDE: &[&str] = &["node_modules", ".git", "out", "dist", "target"];
const MAX_PREVIEW_BYTES: u64 = 1024 * 1024; // README の 1MB 制限

fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let canon = root.join(rel).canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(root) { return Err("path is outside the allowed root".into()); }
    Ok(canon)
}

#[tauri::command]
pub fn list_dir(rel: Option<String>, state: State<FsRoot>) -> Result<Vec<Entry>, String> {
    let dir = match rel {
        Some(r) if !r.is_empty() => resolve_within(&state.root, &r)?,
        _ => state.root.clone(),
    };
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        if EXCLUDE.contains(&name.as_str()) { continue; }
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(Entry { name, is_dir });
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct Preview { kind: String, content: String }

#[tauri::command]
pub fn read_preview(rel: String, state: State<FsRoot>) -> Result<Preview, String> {
    let path = resolve_within(&state.root, &rel)?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_PREVIEW_BYTES {
        return Err("file exceeds 1MB preview limit".into());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let kind = match path.extension().and_then(|e| e.to_str()) {
        Some("md") => "markdown",
        Some("html") | Some("htm") => "html",
        _ => "code",
    }.to_string();
    Ok(Preview { kind, content })
}
```

HTML プレビューの sandbox iframe(`allow-scripts` あり / `allow-same-origin` なし)は、プレビューウィンドウ側 React の `<iframe sandbox="allow-scripts">` に `read_preview` で得た content を流し込んで再現する。「cwd 配下の相対パスだけ」という制約は `resolve_within` が担保する。

---

## 8. 配線(src-tauri/src/lib.rs / main.rs)

```rust
// lib.rs
mod pty;
mod fs_scope;
use pty::PtyState;
use fs_scope::FsRoot;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PtyState::default())
        .manage(FsRoot::new(std::env::current_dir().expect("cwd")))
        .invoke_handler(tauri::generate_handler![
            pty::pty_create, pty::pty_write, pty::pty_resize, pty::pty_close,
            fs_scope::list_dir, fs_scope::read_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
```rust
// main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { quarterdeck_lib::run() }
```

---

## 9. フロント側グルー(src/Terminal.tsx 抜粋)

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function TerminalView({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = new Terminal();
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current!);
    fit.fit();

    const unData = listen<{ id: string; data: string }>("pty://data", (e) => {
      if (e.payload.id !== id) return;
      const bytes = Uint8Array.from(atob(e.payload.data), (c) => c.charCodeAt(0));
      term.write(bytes); // xterm が UTF-8 を内部でインクリメンタル復号
    });
    const unExit = listen<{ id: string }>("pty://exit", (e) => {
      if (e.payload.id === id) term.writeln("\r\n[process exited]");
    });

    term.onData((data) => { invoke("pty_write", { id, data }); });
    const onResize = () => { fit.fit(); invoke("pty_resize", { id, cols: term.cols, rows: term.rows }); };
    window.addEventListener("resize", onResize);

    invoke("pty_create", { id, cols: term.cols, rows: term.rows });

    return () => {
      window.removeEventListener("resize", onResize);
      unData.then((f) => f()); unExit.then((f) => f());
      invoke("pty_close", { id });
      term.dispose();
    };
  }, [id]);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
```

`xterm` パッケージは旧来の `xterm` ではなく `@xterm/xterm` 系を想定。既存コードが旧パッケージなら合わせて更新する。

---

## 10. 段階計画

- **Phase 0 — 足場**: `src-tauri/` を追加し、main ウィンドウが空で起動するまで。フロントは既存 Vite を流用。
- **Phase 1 — PTY コア**(本丸): `pty.rs` を実装。`docs/verification-checklist.md` の重点項目で検証 — `dir` / `Get-ChildItem` / `git --version` / `npm --version` / 日本語入力 / コピペ / `Ctrl+C` / リサイズ / アプリ終了後のプロセス残存。
- **Phase 2 — ファイルツリー & プレビュー**: `fs_scope.rs` + プレビューウィンドウ。スコープ強制・1MB制限・md/html/code 出し分け・sandbox iframe。
- **Phase 3 — UI 移植**: 背景プリセット/透明度/カラーUI を Electron 固有 API から Tauri へ置換(多くはそのまま動く)。
- **Phase 4 — 配布**: NSIS バンドル + updater。`tauri signer generate` で署名鍵、社内配布エンドポイント、コード署名証明書。

---

## 11. 正直に残すリスク・要検証(過大評価しないため)

- **子プロセスツリーの kill**: `child.kill()` が pwsh の孫プロセスまで確実に終了させるとは限らない。`node-pty` でも悩みどころだった「終了後のプロセス残存」は portable-pty でも要検証で、必要なら Windows の Job Object でツリーごと束ねる対策を入れる。Phase 1 の検証項目に明記すること。
- **IME(日本語入力)**: WebView2 上の xterm での IME 挙動は Electron(Chromium 同梱)と微妙に差が出る可能性。検証チェックリストの重点項目として早めに確認。
- **プレビューのスコープ基準**: README は「ファイルツリー = アプリ起動ディレクトリ配下」「プレビュー = PowerShell の現在 cwd 配下」と書き分けている。上記骨組みは起動ディレクトリ(`FsRoot`)で統一している。ライブの PowerShell cwd に追従させたいなら別途 cwd 追跡(OSC シーケンス監視など)が要る — ここは仕様判断が必要。
- **コード署名**: 未署名 exe は全員の初回起動で SmartScreen 警告。これは Electron でも同じ(フレームワーク非依存)だが、社内配布では避けて通れない。
- **保守言語**: バグ修正はあなたが Rust で対応し続ける前提。チームの属人化は許容済みでも、個人の保守コストはゼロではない。
