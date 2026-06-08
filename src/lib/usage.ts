/**
 * プラン利用枠バーの純粋ロジック（ADR-0004 / issue 0001・0002）。
 * UI 状態と分離してテスト可能にする。鮮度判定（issue 0003）は後続。
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

/** ペイロードから指定ウィンドウの使用率（0..100）を取り出す。欠落時は null。 */
export function windowPercent(
  payload: UsagePayload | null,
  window: keyof RateLimits,
): number | null {
  return clampPercent(payload?.rate_limits?.[window]?.used_percentage);
}

/** ペイロードから 5h 利用枠の使用率（0..100）を取り出す。欠落時は null。 */
export function fiveHourPercent(payload: UsagePayload | null): number | null {
  return windowPercent(payload, 'five_hour');
}

/** ペイロードから 7d 利用枠の使用率（0..100）を取り出す。欠落時は null。 */
export function sevenDayPercent(payload: UsagePayload | null): number | null {
  return windowPercent(payload, 'seven_day');
}

/** 利用枠バーの配色レベル（背景レイヤー側に当てる。文字色には適用しない）。 */
export type UsageLevel = 'green' | 'orange' | 'red';

/** オレンジ域の下限（この値以上で警告）。 */
export const USAGE_ORANGE_THRESHOLD = 70;
/** レッド域の下限（この値以上で逼迫）。 */
export const USAGE_RED_THRESHOLD = 90;

/**
 * 使用率から配色レベルを返す純粋関数。
 * 緑 (<70%) → オレンジ (70–90%) → 赤 (≥90%)。境界は下限を含む（70→orange, 90→red）。
 */
export function usageLevel(pct: number): UsageLevel {
  if (pct >= USAGE_RED_THRESHOLD) return 'red';
  if (pct >= USAGE_ORANGE_THRESHOLD) return 'orange';
  return 'green';
}
