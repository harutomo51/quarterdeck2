---
status: accepted
---

# ターミナル分割時、FsRoot / Active Folder は Focused Pane の cwd に追従する

ターミナルを再帰的二分割（tmux / Windows Terminal 型）できるようにする。複数 Pane は
それぞれ独立した PTY（`id`）と cwd を持つため、ADR-0001 が前提にしていた「ターミナル＝
単一 cwd」が崩れ、ファイルツリーの追従元（`FsRoot` の可動境界）が一意に決まらなくなる。
本 ADR は **「FsRoot / Active Folder は Focused Pane（今フォーカス中の 1 枚）の cwd に
追従する」** と定め、その確定を ADR-0001 同様 server 側に閉じる方式を採る。

## Considered Options

- **Focused Pane に追従（採用）**: 操作中の 1 ペインの cwd がツリーを駆動。フォーカスを
  移すとツリーも切り替わる。「今触っているターミナルのフォルダが出る」直感に最も合う。
- **特定の 1 ペイン（最初の "main"）に固定追従**: 実装は単純だが、別ペインで作業中も
  ツリーが追従元のまま乖離し混乱する。却下。
- **ペインごとにツリーを持つ**: 追従の曖昧さは消えるが、サイドバー / ツリーが複数化し
  MVP には過剰。却下。

## Consequences

- **新しい語彙**: `Pane`（分割された 1 枚 = 独立 xterm + PTY）と `Focused Pane`
  （追従元を一意に決める基準）を CONTEXT.md に追加。`Active Folder` / `PTY cwd` の定義を
  「Focused Pane の cwd に追従」へ改訂した。`Active Pane` は `Active Folder` と "Active" が
  重複するため採らない。
- **信頼境界は server 側に閉じたまま（ADR-0001 の原則を維持）**: Rust の reader が
  **id ごとに**最後の cwd を `HashMap<id, PathBuf>` に蓄積する。renderer は新コマンド
  `pty_focus(id)` で**フォーカス中の id だけ**を伝える（**パスは渡さない**）。Rust はその
  id の保持 cwd を `FsRoot` に採用して `fs://cwd` を emit する。絶対パスは常に信頼できる
  PTY ストリーム由来であり、renderer が渡すのは「どのペインを見ているか」の id のみ。
- **非フォーカス Pane の OSC**: 自分の `HashMap` エントリだけ更新し `FsRoot` は動かさない。
  フォーカス id の PTY から新 OSC が来たときのみ `FsRoot` も追従更新する。
- **新ペインの起動 cwd**: 分割時、renderer は継承元の id を渡し、Rust が `HashMap<id, cwd>`
  からその cwd を引いて `cmd.cwd(...)` に使う（Focused Pane の cwd を継承）。未確定なら
  `initial_dir()` にフォールバック。ここでも renderer はパスでなく id を渡す。
- **フォーカス未確定時の degrade**: Focused Pane の cwd がまだ OSC で取れていない場合は、
  最後に確定した Active Folder を維持する（ADR-0001 の degrade 方針を踏襲）。
- **フォーカス喪失時**: フォーカス中ペインを閉じたら隣接（兄弟→親）へ自動移動し、新フォーカス
  先の cwd へ Active Folder が追従する。プロセス exit したペインは残置（自動では閉じない）。
- **分割レイアウトは永続化しない**（セッション内のみ。再起動時は単一ペイン）。pwsh プロセスを
  丸ごと復元できず「構造だけ復元・中身は空シェル」が中途半端なため。キーバインド設定のみ
  localStorage に永続化する。
