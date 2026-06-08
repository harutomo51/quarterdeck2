import { describe, expect, test } from 'vitest';
import {
  clampPercent,
  fiveHourPercent,
  sevenDayPercent,
  usageLevel,
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
