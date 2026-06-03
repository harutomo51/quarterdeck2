---
status: accepted
---

# FsRoot をターミナル cwd に追従する可動境界にする

ファイルツリーをターミナルの live な作業ディレクトリへ追従させるため、これまで起動時 `current_dir()` で固定していた `FsRoot`（`fs_scope.rs` のスコープ強制の信頼境界）を、`cd` のたびに現在 cwd へ再設定する**可動境界**に変更する。不変条件「常に現在フォルダ配下のみ許可（`..` traversal・root 外を `resolve_within` で reject）」はそのまま保ち、基準点だけを動かす。

## Considered Options

- **起動 FsRoot で clamp**（cwd が外に出たら追従停止）: 信頼境界は不動で最も安全だが、`cd ..` や別プロジェクトへ移動した瞬間にツリーが乖離し、要望（live 追従）を満たせない。
- **スコープ強制そのものを廃止**（任意の絶対パスを許可）: 最も柔軟だが、CLAUDE.md のセキュリティ方針（FsRoot 配下のみ・renderer を信頼しない）と正面衝突。却下。
- **cwd 検出を renderer(xterm OSC handler) で行い `set_cwd(絶対パス)` を invoke**: 実装は最も簡単だが、新しい信頼境界の決定権が renderer に移る。却下。

## Consequences

- **cwd 検出は OSC 9;9**。spawn 時 `-NoExit -Command` で既存 `prompt` をラップし `$PWD` を OSC で emit、Rust の reader スレッドが**信頼できる PTY ストリーム**から抽出して `FsRoot`（`Mutex<PathBuf>` 化）を更新し refresh イベントを emit する。新境界の確定が server 側に閉じる。
- **OSC はシェル制御の出力**である点は threat model 上許容する。`FsRoot` が守るのは「自前コードのパストラバーサルバグ」と「renderer」であって、シェルユーザーではない。シェルユーザーは元々フル FS アクセスを持つため、悪意ある OSC で `FsRoot` が System32 等へ動いても、ユーザーが既に `cat` できる範囲を超えない。
- `powershell.exe` 5.1 フォールバックでは `` `e `` が使えないため、OSC 組み立ては両対応の `[char]27` を使う。
- OSC が来ない（prompt 破壊等）場合は最後に確定した cwd／起動ディレクトリを維持して degrade する。
