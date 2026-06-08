/**
 * プラン利用枠バーの純粋ロジック（ADR-0004 / issue 0001）。
 * UI 状態と分離してテスト可能にする。色閾値（issue 0002）・鮮度判定（issue 0003）は後続。
 *
 * ペイロードは Rust の usage_watch が `usage://rate_limits` で emit する形に対応する。
 * statusline.py が stdin の `rate_limits` を抜いて書き出したものが源流。
 */

export interface RateLimitWindow {
  used_percentage?: number;
}

export interface RateLimits {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
}

export interface UsagePayload {
  rate_limits: RateLimits;
  /** 書き出し時刻（epoch 秒）。鮮度判定で使う。 */
  ts: number;
}

/** 使用率を 0..100 にクランプ。非数値・NaN は null。 */
export function clampPercent(value: number | undefined | null): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.min(Math.max(value, 0), 100);
}

/** ペイロードから 5h 利用枠の使用率（0..100）を取り出す。欠落時は null。 */
export function fiveHourPercent(payload: UsagePayload | null): number | null {
  return clampPercent(payload?.rate_limits?.five_hour?.used_percentage);
}
