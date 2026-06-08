---
status: ready
type: AFK
labels: [enhancement]
---

# パイプライン疎通 — 5h 単一バー（トレーサーバレット）

## Parent

[ADR-0004 プラン利用枠バーを statusline 経由のファイル受け渡しで取得する](../adr/0004-plan-quota-usage-bar-via-statusline-file.md)

## What to build

ADR-0004 の経路 **statusline → ファイル → Rust の `notify` 監視 → renderer** を端から端まで 1 本通す最小のトレーサーバレット。

- `~/.claude/statusline.py` に「stdin の JSON から `rate_limits` を抜き、`~/.claude/quarterdeck-usage.json` にアトミック書き込み（temp ファイルに書いてから rename）する」数行を追記する。`settings.json` は無改変。
- Rust に `~/.claude/quarterdeck-usage.json` 専用の watcher を 1 つ立て（FsRoot / fs_scope の信頼境界の外、固定パスを監視するだけ）、変更を検知したら内容をパースして `rate_limits` イベントを emit する。ファイルツリー用の fs_watch（ADR-0003）とは別系統。
- renderer は `rate_limits` イベントを listen し、下部フッターに **5h バーを 1 本だけ単色で**描画する。

この段階では色閾値（緑/オレンジ/赤）と鮮度判定（fresh/stale）は含めない。目的は「statusline からフッターまで実データが流れて 5h バーが動く」ことを Windows 11 上で目視デモできること。

## Acceptance criteria

- [ ] `statusline.py` 追記により、Claude Code 実行のたびに `~/.claude/quarterdeck-usage.json` が temp→rename のアトミック書き込みで更新される
- [ ] `quarterdeck-usage.json` には少なくとも `rate_limits`（5h 分）と更新時刻 `ts` が含まれる
- [ ] Rust 側 watcher がファイル更新を検知し、パース済みペイロードを `rate_limits` イベントで renderer へ emit する
- [ ] 監視は FsRoot 配下ではなく固定パス 1 つに対して行われ、fs_scope のスコープ強制とは独立している
- [ ] renderer がイベントを受けてフッターに 5h バーを描画し、使用率が変われば長さが追従する
- [ ] `settings.json` を改変していない

## Blocked by

None - can start immediately
