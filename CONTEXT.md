# Quarterdeck

PowerShell 互換ターミナル UI（Tauri 2 + React + xterm.js）の技術検証 MVP。
PTY とファイルツリー / プレビューが扱う「どのフォルダを指しているか」の語彙を、
スコープ強制（信頼境界）と取り違えないために定義する。

## Language

**Active Folder**:
ファイルツリーが今ルートとして表示しているフォルダ。ターミナルの live な作業
ディレクトリ（cwd）に動的追従し、ユーザーが `cd` するたびに切り替わる。
_Avoid_: ワーキングディレクトリ（PTY 側の cwd と混同するため）, ルートフォルダ

**FsRoot**:
ファイルツリー / プレビューのスコープ強制が基準にする信頼境界。`resolve_within`
が「この配下のみ許可、外は reject」を強制する。固定ではなく **Active Folder に
追従して再設定される可動境界**（不変条件「常に現在フォルダ配下のみ許可」は保つ）。
_Avoid_: ルート, 起動ディレクトリ（起動時の初期値にすぎない）

**PTY cwd**:
pwsh プロセスが今いる live な作業ディレクトリ。`cd` で動く。Active Folder の
追従元であり、cwd 追跡機構（OSC 等）が renderer に伝える。
_Avoid_: カレントディレクトリ（FsRoot / Active Folder と混同するため文脈を明示する）
