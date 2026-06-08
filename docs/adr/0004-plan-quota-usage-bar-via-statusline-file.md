---
status: accepted
---

# プラン利用枠バーを statusline 経由のファイル受け渡しで取得する

quarterdeck 内で動く Claude Code のプラン利用枠（5h / 7d の `rate_limits`）使用率を下部フッターの Usage Bar に表示するため、データ取得を **Claude Code の statusline → ファイル → Rust の `notify` 監視 → renderer** の経路に決める。具体的には既存の `~/.claude/statusline.py` に「stdin の JSON から `rate_limits` を抜き、`~/.claude/quarterdeck-usage.json` にアトミック書き込み（temp→rename）する」数行を追記し、`settings.json` は無改変とする。Rust がそのファイルを監視して `rate_limits` イベントを emit、React が 5h / 7d の 2 本を緑(<70%)→オレンジ(70–90%)→赤(≥90%)で描画する。

## Considered Options

- **OpenTelemetry メトリクス（`CLAUDE_CODE_ENABLE_TELEMETRY`）**: `claude_code.token.usage` / `cost.usage` は出るが、**プラン利用枠（`rate_limits`）のメトリクスが存在しない**。今回バーが表すのは枠の使用率なので不成立。却下。
- **セッション transcript JSONL（`~/.claude/projects/.../*.jsonl`）監視**: 各メッセージの `usage`（input/output/cache トークン）は取れるが、こちらも `rate_limits` を含まない。生トークンから枠使用率は逆算できない。却下。
- **PTY 出力ストリームから statusline 表示をパース**: ADR-0001 の OSC 抽出に似た発想だが、statusline 文字列はプロンプト行に紛れて出るため位置特定が脆い。ファイル経由の方が堅い。却下。
- **quarterdeck 同梱ラッパーに `statusLine` を差し替え**: settings.json の自動改変が必要で、ユーザーの deny 設定（`Edit(.claude/settings*)`）および「設定の自動上書きに慎重」という方針と衝突。既存 `statusline.py` への追記の方が最小侵襲。却下。

## Consequences

- **`rate_limits` の可用性はプランに依存する**。Max / Pro サブスクでは statusline JSON に `rate_limits.five_hour` / `seven_day` が来る（本環境の `statusline.py` が実際に参照していることを確認済み）。API キー従量課金では枠の概念が無く出ないため、その環境ではバーは成立しない（非表示にフォールバック）。
- **Usage Bar はアカウント単位でありプロセス／Pane に紐付かない**。複数 Pane で Claude Code が同時起動しても全員が同じ枠値を同一ファイルに書くため「最後の書き込み勝ち」で齟齬は出ない。Active Folder / Focused Pane（ADR-0002）のような Pane 追従はしない。
- **鮮度は `ts`（更新時刻）で判定する**。statusline は Claude Code 実行中しか呼ばれないため、一定時間（例: 30 秒）更新が無い／ファイルが無い場合はバー行ごと非表示にする。プラン枠は別ターミナル・別マシンでも消費されてズレうるので、stale な値を「今の値」として見せない。
- **監視対象は FsRoot 配下ではない**。`~/.claude/quarterdeck-usage.json` は FsRoot の信頼境界（fs_scope）の外にある専用ファイルで、ファイルツリー用の fs_watch（ADR-0003, FsRoot 再帰監視）とは別系統の watcher を立てる。スコープ強制の対象ではなく、固定パスを 1 つ監視するだけ。
- **degrade**: 追記が無効化／ファイル破損／統合失敗時は静かにバー非表示にフォールバックし、ターミナル本体の動作には影響させない（ADR-0001 以来の degrade 思想を踏襲）。
- **純粋ロジックの切り出し**: 色の閾値判定（pct → green/orange/red）と鮮度判定（ts → fresh/stale）を純粋関数にしてテスト可能にする（CLAUDE.md のテスト方針）。
