import { describe, expect, test } from 'vitest';
import {
  clampSidebarWidth,
  DEFAULT_LAYOUT,
  normalizeLayout,
  parseLayout,
  serializeLayout,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../src/lib/layout';

describe('clampSidebarWidth', () => {
  test('clamps below the minimum up to SIDEBAR_MIN', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN);
  });

  test('clamps above the maximum down to SIDEBAR_MAX', () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX);
  });

  test('rounds and keeps an in-range value', () => {
    expect(clampSidebarWidth(300.6)).toBe(301);
  });

  test('falls back to the default width on NaN', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_LAYOUT.sidebarWidth);
  });
});

describe('normalizeLayout', () => {
  test('returns the default layout for null', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  test('coerces an unknown tab to the default', () => {
    expect(normalizeLayout({ activeTab: 'nope' as never }).activeTab).toBe(
      DEFAULT_LAYOUT.activeTab,
    );
  });

  test('keeps a valid partial and clamps the width', () => {
    const result = normalizeLayout({ sidebarWidth: 12, activeTab: 'graph', sidebarCollapsed: true });
    expect(result).toEqual({ sidebarWidth: SIDEBAR_MIN, sidebarCollapsed: true, activeTab: 'graph' });
  });
});

describe('parseLayout / serializeLayout', () => {
  test('round-trips a layout', () => {
    const state = { sidebarWidth: 320, sidebarCollapsed: true, activeTab: 'worktree' as const };
    expect(parseLayout(serializeLayout(state))).toEqual(state);
  });

  test('falls back to default on invalid JSON', () => {
    expect(parseLayout('{ broken')).toEqual(DEFAULT_LAYOUT);
  });
});
