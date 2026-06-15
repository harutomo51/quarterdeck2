---
status: accepted
---

# PDF プレビューを pdf:// カスタムプロトコルでストリーム配信する

ファイルプレビューは `read_preview` が `fs::read_to_string` で UTF-8 として読み、`Preview { kind, content: String }` を返す**テキスト専用**の経路だった（md / html / code）。PDF はバイナリで、`read_to_string` は不正 UTF-8 で落ち、`String` にバイト列も載らず、`MAX_PREVIEW_BYTES = 1MB` も日常的に超える。本 ADR は **`pdf://` カスタム URI スキームのハンドラを新設し、その内側で `resolve_within(FsRoot::current(), rel)` を再検証してから `application/pdf` でストリーム配信し、WebView2 内蔵 PDF ビューアに `<iframe>` で描画させる**。`read_preview` は `.pdf` を拡張子で先に判定して `kind="pdf"`（content は空）を返し、`PreviewWindow.tsx` が `<iframe src="http://pdf.localhost/<rel>">` を出す。md / html / code と同じ単一ディスパッチに乗せ、`read_preview` を kind の唯一の権威に保つ。

## Considered Options

- **pdf:// カスタムプロトコル + `resolve_within` 再検証（採用）**: `register_uri_scheme_protocol("pdf")` のハンドラ内で `FsRoot::current()` を基準に `resolve_within` を再実行。**cwd 追従の可動境界（ADR-0001）をそのまま保ち**、メモリにテキストとして載せずストリームできるためサイズ制限も不要。`.pdf` 拡張子のみ許可して境界を最小化する。
- **base64 コマンド + blob URL**: 新 `#[tauri::command]` で PDF を読み base64 で返し、renderer で `blob:` 化して iframe に渡す（pty と同じ base64 方式）。`invoke` 経由でルール遵守だが、ファイル全体をメモリに載せ base64 で膨らみ、大きい PDF で重い。却下。
- **Tauri 標準 `asset:` プロトコル（`convertFileSrc` + `assetScope`）**: 組み込みで楽だが `assetScope` は静的設定で **FsRoot の可動境界に追従しない**。不変条件「常に現在フォルダ配下のみ許可」を破り、ADR-0001 のスコープ強制モデルと正面衝突する。却下。
- **OS 既定アプリで開く**: 実装最小だが「プレビューウィンドウ内で見る」UX から外れ、外部 open を増やす（CLAUDE.md は MVP で外部 URL open を増やさない方針）。却下。

## Consequences

- **第二の信頼境界**: これまで「renderer から OS リソースへ触るのは必ず `invoke`（自前 Rust コマンド）経由」（CLAUDE.md）の一系統だったところに、`pdf://` プロトコルハンドラという**コマンドではない信頼境界**が加わる。スコープ強制は `read_preview` と同じ `resolve_within` を**ハンドラ内側で再実行**して担保する（`..` traversal / 絶対パス / シンボリックリンク / root 外 / 実在しないパスを reject）。`.pdf` 拡張子チェックも併せて境界を最小に絞る。
- **Windows のオリジン**: Tauri 2 は Windows ではカスタムスキームを `http://<scheme>.localhost` で配信する。よって iframe の `src` も CSP の `frame-src` も `http://pdf.localhost` オリジンになる（`pdf://localhost/...` ではない）。ターゲットは Windows 11 のみ（CLAUDE.md）なのでこの形に固定する。
- **CSP 拡張**: `tauri.conf.json` の `app.security.csp` に `frame-src 'self' http://pdf.localhost` を追加する。無いと `default-src 'self'` に落ちて iframe がブロックされる。`default-src` は広げない。
- **サイズ/ハンドラ方式**: `pdf://` は `MAX_PREVIEW_BYTES`（1MB）を適用しない。MVP はまず同期ハンドラで全体を `Vec<u8>` で返す割り切りとし、巨大 PDF で重ければ `register_asynchronous_uri_scheme_protocol` でストリーム化＋Range 対応へ切り替える（YAGNI）。
- **read_preview の分岐順**: `.pdf` 判定を `fs::read_to_string` と 1MB メタデータチェックより**前**に置き、`kind="pdf"` を返してテキスト経路を踏ませない。
- **rel エンコード**: rel は `joinRel` の `/` 区切りで、日本語・空白・サブディレクトリを含みうる。iframe URL のパスは percent-encode する。
- **テスト**: スコープ強制（`.pdf` 限定の許可 / 非 .pdf の reject / `..`・絶対パス・root 外の reject）を純粋ロジックとして `cargo test`。WebView2 ネイティブビューアの実描画・大きい PDF・日本語ファイル名は Windows 11 上で手動検証（スコープ文書 §11 / CLAUDE.md のテスト方針）。
- **CONTEXT.md は変更しない**: PDF は preview の一種別にすぎず、フォルダスコープ語彙（Pane / FsRoot / Active Folder）に新用語を導入しないため glossary は触らない。
