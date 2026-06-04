# Quarterdeck

PowerShell 互換ターミナル UI（Tauri 2 + React + xterm.js）の技術検証 MVP。
PTY とファイルツリー / プレビューが扱う「どのフォルダを指しているか」の語彙を、
スコープ強制（信頼境界）と取り違えないために定義する。

## Language

**Pane**:
分割されたターミナル領域の 1 枚。各 Pane は独立した xterm + PTY セッション（`id`）を
持ち、それぞれ別の cwd を持ちうる。Pane は再帰的に水平 / 垂直へ二分割できる
（tmux / Windows Terminal 型）。
_Avoid_: タブ（サイドバーの `SidebarTab` と別概念）, ウィンドウ

**Focused Pane**:
今フォーカス（操作対象）が当たっている 1 枚の Pane。複数 Pane のうち Active Folder /
FsRoot の追従元を一意に決める基準。フォーカスを別 Pane へ移すと、ファイルツリーも
その Pane の cwd へ切り替わる。
_Avoid_: Active Pane（Active Folder と "Active" が重複し紛らわしい）, 選択ペイン

**Active Folder**:
ファイルツリーが今ルートとして表示しているフォルダ。**Focused Pane** の live な作業
ディレクトリ（cwd）に動的追従し、フォーカス中ペインで `cd` する／別ペインへ
フォーカスを移すたびに切り替わる。
_Avoid_: ワーキングディレクトリ（PTY 側の cwd と混同するため）, ルートフォルダ

**FsRoot**:
ファイルツリー / プレビューのスコープ強制が基準にする信頼境界。`resolve_within`
が「この配下のみ許可、外は reject」を強制する。固定ではなく **Active Folder に
追従して再設定される可動境界**（不変条件「常に現在フォルダ配下のみ許可」は保つ）。
_Avoid_: ルート, 起動ディレクトリ（起動時の初期値にすぎない）

**PTY cwd**:
ある Pane の pwsh プロセスが今いる live な作業ディレクトリ。`cd` で動く。各 Pane が
個別に持つ。Active Folder が追従するのは **Focused Pane の** PTY cwd であり、
cwd 追跡機構（OSC 等）が renderer に伝える。
_Avoid_: カレントディレクトリ（FsRoot / Active Folder と混同するため文脈を明示する）
