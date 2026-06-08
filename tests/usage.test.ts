import { describe, expect, test } from 'vitest';
import {
  clampPercent,
  fiveHourPercent,
  freshness,
  isFresh,
  sevenDayPercent,
  usageLevel,
  USAGE_STALE_MS,
  type UsagePayload,
} from '../src/lib/usage';

describe('clampPercent', () => {
  test('keeps an in-range value', () => {
    expect(clampPercent(42)).toBe(42);
  });

  test('clamps below 0 up to 0', () => {
    expect(clampPercent(-5)).toBe(0);
  });

  test('clamps above 100 down to 100', () => {
    expect(clampPercent(150)).toBe(100);
  });

  test('returns null for undefined', () => {
    expect(clampPercent(undefined)).toBeNull();
  });

  test('returns null for NaN', () => {
    expect(clampPercent(Number.NaN)).toBeNull();
  });
});

describe('fiveHourPercent', () => {
  test('extracts the 5h used percentage', () => {
    const payload: UsagePayload = {
      rate_limits: { five_hour: { used_percentage: 73 } },
      ts: 1700000000,
    };
    expect(fiveHourPercent(payload)).toBe(73);
  });

  test('returns null when payload is null', () => {
    expect(fiveHourPercent(null)).toBeNull();
  });

  test('returns null when five_hour is missing', () => {
    const payload: UsagePayload = { rate_limits: {}, ts: 1700000000 };
    expect(fiveHourPercent(payload)).toBeNull();
  });

  test('clamps an out-of-range percentage', () => {
    const payload: UsagePayload = {
      rate_limits: { five_hour: { used_percentage: 120 } },
      ts: 1700000000,
    };
    expect(fiveHourPercent(payload)).toBe(100);
  });
});

describe('sevenDayPercent', () => {
  test('extracts the 7d used percentage', () => {
    const payload: UsagePayload = {
      rate_limits: { seven_day: { used_percentage: 9 } },
      ts: 1700000000,
    };
    expect(sevenDayPercent(payload)).toBe(9);
  });

  test('returns null when seven_day is missing', () => {
    const payload: UsagePayload = {
      rate_limits: { five_hour: { used_percentage: 50 } },
      ts: 1700000000,
    };
    expect(sevenDayPercent(payload)).toBeNull();
  });
});

describe('usageLevel', () => {
  test('green below the orange threshold', () => {
    expect(usageLevel(0)).toBe('green');
    expect(usageLevel(69)).toBe('green');
    expect(usageLevel(69.9)).toBe('green');
  });

  test('orange at the 70% boundary up to (not including) 90%', () => {
    expect(usageLevel(70)).toBe('orange');
    expect(usageLevel(89)).toBe('orange');
    expect(usageLevel(89.9)).toBe('orange');
  });

  test('red at the 90% boundary and above', () => {
    expect(usageLevel(90)).toBe('red');
    expect(usageLevel(100)).toBe('red');
  });
});

describe('freshness', () => {
  // ts は epoch 秒。now は ms。NOW_MS は便宜上の固定基準。
  const NOW_MS = 1_700_000_000_000;
  const TS = NOW_MS / 1000; // 同時刻（age 0）

  test('fresh when just written', () => {
    expect(freshness(TS, NOW_MS)).toBe('fresh');
  });

  test('fresh just under the 30s threshold', () => {
    const ts = (NOW_MS - (USAGE_STALE_MS - 1000)) / 1000; // age 29s
    expect(freshness(ts, NOW_MS)).toBe('fresh');
  });

  test('stale exactly at the 30s threshold', () => {
    const ts = (NOW_MS - USAGE_STALE_MS) / 1000; // age 30s
    expect(freshness(ts, NOW_MS)).toBe('stale');
  });

  test('stale well past the threshold', () => {
    const ts = (NOW_MS - 60_000) / 1000; // age 60s
    expect(freshness(ts, NOW_MS)).toBe('stale');
  });

  test('treats future ts (clock skew) as fresh', () => {
    const ts = (NOW_MS + 10_000) / 1000;
    expect(freshness(ts, NOW_MS)).toBe('fresh');
  });

  test('treats non-finite ts as stale', () => {
    expect(freshness(Number.NaN, NOW_MS)).toBe('stale');
    expect(freshness(Number.POSITIVE_INFINITY, NOW_MS)).toBe('stale');
  });

  test('honors a custom stale window', () => {
    const ts = (NOW_MS - 5_000) / 1000; // age 5s
    expect(freshness(ts, NOW_MS, 3_000)).toBe('stale');
    expect(freshness(ts, NOW_MS, 10_000)).toBe('fresh');
  });
});

describe('isFresh', () => {
  const NOW_MS = 1_700_000_000_000;

  test('false for null payload', () => {
    expect(isFresh(null, NOW_MS)).toBe(false);
  });

  test('true for a freshly written payload', () => {
    const payload: UsagePayload = {
      rate_limits: { five_hour: { used_percentage: 10 } },
      ts: NOW_MS / 1000,
    };
    expect(isFresh(payload, NOW_MS)).toBe(true);
  });

  test('false for a stale payload', () => {
    const payload: UsagePayload = {
      rate_limits: { five_hour: { used_percentage: 10 } },
      ts: (NOW_MS - 60_000) / 1000,
    };
    expect(isFresh(payload, NOW_MS)).toBe(false);
  });
});
