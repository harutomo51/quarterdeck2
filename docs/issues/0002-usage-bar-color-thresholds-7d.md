---
status: ready
type: AFK
labels: [enhancement]
---

# 色閾値 + 7d バー追加

## Parent

[ADR-0004 プラン利用枠バーを statusline 経由のファイル受け渡しで取得する](../adr/0004-plan-quota-usage-bar-via-statusline-file.md)

## What to build

疎通済みのパイプライン（#0001）の上に、色分けと 7d バーを乗せて Usage Bar を ADR-0004 の見た目（5h / 7d の 2 本、使用率で配色）に近づける。

- 使用率から配色を返す純粋関数を追加する: `pct → green (<70%) / orange (70–90%) / red (≥90%)`。UI 状態から切り離し、テスト可能にする（CLAUDE.md のテスト方針）。
- `statusline.py` の書き出しと Rust のパース／emit を `seven_day` も含むよう拡張する（5h と同様に `rate_limits.seven_day` を抜く）。
- renderer のフッターに 7d バーを追加し 2 本構成にする。両バーとも純粋関数の判定に従って緑→オレンジ→赤で描画する。

## Acceptance criteria

- [ ] 配色判定が純粋関数として実装され、境界値（70%, 90%）を含むユニットテストが通る
- [ ] `quarterdeck-usage.json` に `rate_limits.five_hour` と `rate_limits.seven_day` の両方が含まれる
- [ ] フッターに 5h / 7d の 2 本のバーが描画される
- [ ] 各バーが使用率に応じて緑(<70%)→オレンジ(70–90%)→赤(≥90%)で配色される
- [ ] 配色は背景レイヤー側に当て、文字の可読性を損なわない（CLAUDE.md の外観方針）

## Blocked by

- #0001 パイプライン疎通 — 5h 単一バー
