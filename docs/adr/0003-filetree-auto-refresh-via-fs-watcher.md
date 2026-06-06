---
status: accepted
---

# ファイルツリーを FsRoot に追従する FS watcher で自動更新する

これまでファイルツリーは初回マウントと `fs://cwd`（cwd 変更）でしか更新されず、cwd が動かないままディスク上でファイルが増減しても（`npm install` / `New-Item` / 保存 / 削除）手動で畳んで開き直すまで古いままだった。本 ADR は **Rust 側で `notify` により FsRoot を再帰監視し、変更を `fs://changed` で renderer に伝えて該当ディレクトリだけ再取得する**自動更新を入れる。ADR-0001（FsRoot を可動境界に）→ ADR-0002（Focused Pane 追従）に続き、**watcher も FsRoot に追従させる**ことで「今見ているフォルダの中身が常に最新」を成立させる。

## Considered Options

- **FS 監視（notify, 採用）**: `ReadDirectoryChangesW` でリアルタイムに検出。Windows では再帰監視が 1 ハンドルで済み、監視の決定権が server 側に閉じる（ADR-0001/0002 の信頼境界思想と一致）。
- **ポーリング**: renderer/Rust が定期再取得。実装は単純だが間隔ぶんの遅延と無駄な再取得が常時走り、大きなツリーで非効率。却下（watch 失敗時のフォールバックとしても入れない）。
- **ウィンドウ再フォーカス時のみ再取得**: 同一ウィンドウ内で pwsh がファイルを作る本ケースに反応しない。却下。
- **監視範囲を「展開中ディレクトリのみ動的監視」**: 最も精密だが、監視集合を renderer が add/remove で駆動することになり「境界決定は server に閉じる」原則からずれ、MVP には過剰。却下し **FsRoot 再帰監視**を採る。

## Consequences

- **watcher は FsRoot に追従する可動監視**: `FsRoot.set()` が true を返した直後（pty reader スレッドの OSC cwd 追従と `pty_focus` の 2 箇所）に旧 root を unwatch・新 root を watch し直す。デバウンス窓内に旧 root 由来のイベントが残っても、rel 化時の「現在 root 配下か」判定で落ちる（stale は破棄）。
- **更新粒度は path-targeted**: `notify` の絶対パスから「影響を受けた親ディレクトリの rel」を算出して `fs://changed { dirs: string[] }` を emit。renderer はその rel に一致する**展開中ノードの children だけ** `list_dir` し直す。key を name ベースで安定させる（epoch を混ぜない）ことで、React の reconciliation が**孫ノードの展開状態を温存**する。
- **二経路の振り分け**: cwd 変更は「別ツリーになった」ので従来通り `epoch++` で全 remount（展開リセットは自然）。ファイル変更は epoch を触らず path-targeted 差し替えで展開保持。`epoch` は cwd 経路専用に残る。
- **デバウンス**: `notify-debouncer-mini`（~300ms）でバースト（`npm install` 等）を合体し、親 dir 集合に重複除去して 1 イベントに畳む。
- **EXCLUDE の二重定義**: スコープ間引き（`node_modules` / `.git` / `dist` / `target` / `out`）が `list_dir` と watcher 側フィルタの両方に出る。watcher 側で握りつぶさないと除外ディレクトリの大量イベントが素通りするため。単一の定数を共有して齟齬を防ぐ。
- **degrade**: watcher 初期化・`watch()` 失敗は静かに degrade（stderr にログのみ、UI エラー無し）。ツリーは従来通り cwd 変更＋手動展開で動作継続する（ADR-0001 の degrade 思想を踏襲）。自動更新は best-effort な強化と位置づける。
- **テスト**: 親算出・root 相対化・重複除去・EXCLUDE 除外・root 外 reject・root 直下＝`""` を純粋関数 `affected_dirs(root, paths) -> Vec<rel>` に切り出し `cargo test`。notify の実監視と WebView 反映は Windows 11 上で手動検証（スコープ文書 §11 / CLAUDE.md のテスト方針）。
- **新規依存**: `notify` と `notify-debouncer-mini` を `src-tauri/Cargo.toml` に追加する。
