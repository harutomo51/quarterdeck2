---
status: accepted
---

# HTML プレビューを既定ブラウザで開くボタンを設ける

HTML プレビューは `<iframe sandbox="allow-scripts" srcDoc={content}>` でアプリ内 WebView に描画する。`srcdoc` の iframe は親（アプリオリジン）の CSP を継承するため、`tauri.conf.json` の `script-src 'self'` / `default-src 'self'` 下では **インライン `<script>`・外部 CDN・Web フォント・外部/相対パスの画像が一律ブロック**され、外部依存のある HTML（例: Google Fonts + `IntersectionObserver` を使うレポート HTML）は崩れる。これを「アプリ内 WebView で完全描画する」方向で解こうとすると、CSP を `'unsafe-inline'` 等へ緩める／sandbox に `allow-same-origin` を足す必要があり、いずれも **アプリ本体の信頼境界（Tauri IPC・XSS 防御）を壊す**。本 ADR は逆方向を採る: **未信頼 HTML をアプリプロセスの外（OS 既定ブラウザのサンドボックス）へ追い出す「ブラウザで開く」ボタンを HTML プレビューに設ける**。新コマンド `open_in_browser(rel)` が `resolve_within(FsRoot::current(), rel)` で `FsRoot` 配下を再検証し、`tauri-plugin-opener` の Rust API で検証済み絶対パスを既定アプリ（`.html` → 既定ブラウザ）に渡す。

## Considered Options

- **既定ブラウザで開くボタン（採用）**: 未信頼 HTML を本物のブラウザのサンドボックスで実行する。アプリの CSP / Tauri IPC から完全に切り離れるため、`allow-same-origin` のような境界破壊が不要。対象はユーザー自身の作業ディレクトリ（`FsRoot`）内ファイルで、エクスプローラからのダブルクリックと同等以下のリスク。
- **プレビュー専用 WebView に別 CSP を分離**: `preview-*` ウィンドウだけ `script-src 'unsafe-inline'` 等を許可。グローバル CSP は守れるが、未信頼 HTML を依然アプリプロセス内で実行し、外部ホスト allowlist や `connect-src` の締め方を誤ると流出経路が開く。実装・運用が重い割に外側で開く案より弱い。却下（将来インライン描画の忠実度が要れば再検討）。
- **グローバル CSP を緩める / `allow-same-origin` 追加**: 最小工数だが、メイン（PTY・ファイル読みを叩ける信頼面）の XSS 防御喪失、または任意プレビュー HTML からの Tauri IPC 到達を招く。CLAUDE.md の信頼境界モデルと正面衝突。却下。
- **Chrome を固定起動（chrome.exe 解決）**: Chrome 未導入環境で表示差が出ないが、実行ファイル解決のフォールバック分岐が増える。MVP では OS 関連付けに委ねる方が堅牢。却下（既定ブラウザを採用）。

## Consequences

- **外部 open 方針の更新**: CLAUDE.md は「外部 URL を open する機能はこの MVP では追加しない」とする。本 ADR は **外部 URL ではなく `FsRoot` 配下のローカルファイルを既定アプリに渡す**もので趣旨は異なるが、ルールに触れる判断のため本 ADR で根拠を残す。ネットワーク上の任意 URL を開く機能は引き続き追加しない。
- **スコープ強制**: `open_in_browser` は `read_preview` / `pdf://` と同じ `resolve_within` を**コマンド内側で再実行**して担保する（`..` traversal / 絶対パス / シンボリックリンク / root 外 / 実在しないパスを reject）。opener へはシェル文字列ではなく検証済みパスを引数で渡し、コマンドインジェクションを避ける。
- **最小権限**: `tauri-plugin-opener` は `.plugin(init())` で登録するが、JS には opener コマンドを公開しない（capability に列挙しない）。renderer からは自前の `open_in_browser` 経由でのみ到達し、その内側でスコープ強制する（CLAUDE.md: 自前コマンドは ACL 対象外で全ウィンドウから呼べる前提）。
- **UI**: HTML プレビューのみツールバーに「ブラウザで開く」を出す（md / code / pdf には出さない）。ツールバーに「外部リソース・スクリプトはアプリ内では制限されます」と注記し、アプリ内描画の制約を明示する。
- **残存リスク（低）**: 開いた HTML は `file://` で動くが、ブラウザがローカル読み取り・fetch を制限する。対象はユーザーの作業ディレクトリ内ファイルに限られる。可用性・プライバシー面（外部フォント取得）はブラウザ側の挙動に委ねる。
- **テスト**: スコープ強制ロジックは `resolve_within`（既存テストで `..`・絶対パス・root 外・シンボリックリンクを網羅）に集約され、`open_in_browser` はその上の薄いラッパ。実ブラウザ起動は単体テストに載せず、Windows 11 上で手動検証（起動・日本語ファイル名・スコープ外 reject）。
- **CONTEXT.md は変更しない**: プレビュー操作の追加で、フォルダスコープ語彙（Pane / FsRoot / Active Folder）に新用語を導入しないため glossary は触らない。
