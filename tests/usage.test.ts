import { describe, expect, test } from 'vitest';
import { clampPercent, fiveHourPercent, type UsagePayload } from '../src/lib/usage';

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
