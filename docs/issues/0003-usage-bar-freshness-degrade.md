---
status: ready
type: AFK
labels: [enhancement]
---

# 鮮度判定とフォールバック非表示（degrade）

## Parent

[ADR-0004 プラン利用枠バーを statusline 経由のファイル受け渡しで取得する](../adr/0004-plan-quota-usage-bar-via-statusline-file.md)

## What to build

stale な利用枠値を「今の値」として見せないための鮮度判定と、異常時に静かにバーを消す degrade を追加する。statusline は Claude Code 実行中しか呼ばれず、プラン枠は別ターミナル・別マシンでも消費されてズレうるため。

- 更新時刻から鮮度を返す純粋関数を追加する: `ts → fresh / stale`（例: 30 秒以上更新が無ければ stale）。UI 状態から切り離してテスト可能にする。
- renderer は次のいずれかの場合にバー行ごと静かに非表示にフォールバックする: 値が stale / ファイルが無い / ファイル破損・パース失敗 / 統合失敗。エラーは握り潰さずログに残しつつ、UI は黙って隠す。
- いずれの degrade パスでもターミナル本体（PTY 入出力）の動作には一切影響させない（ADR-0001 以来の degrade 思想）。
- API キー従量課金など `rate_limits` が来ない環境でも、欠落としてバー非表示にフォールバックする。

## Acceptance criteria

- [ ] 鮮度判定が純粋関数として実装され、閾値前後（fresh / stale 境界）のユニットテストが通る
- [ ] stale 値のときバー行が非表示になる
- [ ] `quarterdeck-usage.json` が存在しない／破損している／`rate_limits` を欠くとき、例外を投げずバー行が非表示になる
- [ ] degrade 時もターミナル本体の入出力・描画は正常に継続する
- [ ] 異常はログに記録され、UI 側では静かに隠れる（サイレントに握り潰さない）

## Blocked by

- #0001 パイプライン疎通 — 5h 単一バー
