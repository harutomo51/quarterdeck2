import { describe, test, expect } from 'vitest';
import {
  clampAlpha,
  hexToRgb,
  toRgba,
  findPreset,
  nextPresetId,
  normalizeSettings,
  toCssVars,
  parseSettings,
  serializeSettings,
  ALPHA_MIN,
  DEFAULT_SETTINGS,
  type AppearanceSettings,
} from '@/lib/appearance';

describe('clampAlpha', () => {
  test('clamps below the minimum', () => {
    expect(clampAlpha(0)).toBe(ALPHA_MIN);
    expect(clampAlpha(-1)).toBe(ALPHA_MIN);
  });

  test('clamps above the maximum', () => {
    expect(clampAlpha(2)).toBe(1);
  });

  test('passes through values in range', () => {
    expect(clampAlpha(0.5)).toBe(0.5);
  });

  test('falls back to opaque for NaN', () => {
    expect(clampAlpha(Number.NaN)).toBe(1);
  });
});

describe('hexToRgb', () => {
  test('parses a valid hex color', () => {
    expect(hexToRgb('#4cc2ff')).toEqual({ r: 76, g: 194, b: 255 });
  });

  test('returns null for malformed input', () => {
    expect(hexToRgb('4cc2ff')).toBeNull();
    expect(hexToRgb('#abc')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
  });
});

describe('toRgba', () => {
  test('combines hex and alpha', () => {
    expect(toRgba('#0f1115', 1)).toBe('rgba(15, 17, 21, 1)');
  });

  test('clamps the alpha', () => {
    expect(toRgba('#000000', 0)).toBe(`rgba(0, 0, 0, ${ALPHA_MIN})`);
  });

  test('falls back to black for invalid hex', () => {
    expect(toRgba('nope', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
  });
});

describe('findPreset', () => {
  test('finds a known preset', () => {
    expect(findPreset('ocean').base).toBe('#0d1b2a');
  });

  test('falls back to the first preset when unknown', () => {
    expect(findPreset('does-not-exist').id).toBe('midnight');
  });
});

describe('normalizeSettings', () => {
  test('returns defaults for null', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test('keeps valid values', () => {
    const input: AppearanceSettings = {
      presetId: 'ocean',
      bgAlpha: 0.6,
      appColor: '#4ade80',
      terminalColor: '#0d1b2a',
    };
    expect(normalizeSettings(input)).toEqual(input);
  });

  test('coerces unknown preset and invalid appColor to defaults', () => {
    const result = normalizeSettings({ presetId: 'bogus', appColor: 'red', bgAlpha: 0.8 });
    expect(result.presetId).toBe(DEFAULT_SETTINGS.presetId);
    expect(result.appColor).toBe(DEFAULT_SETTINGS.appColor);
    expect(result.bgAlpha).toBe(0.8);
  });

  test('coerces invalid terminalColor to default', () => {
    expect(normalizeSettings({ terminalColor: 'navy' }).terminalColor).toBe(
      DEFAULT_SETTINGS.terminalColor,
    );
  });

  test('clamps out-of-range alpha', () => {
    expect(normalizeSettings({ bgAlpha: 0 }).bgAlpha).toBe(ALPHA_MIN);
  });
});

describe('toCssVars', () => {
  test('emits app-bg and terminal-bg with alpha, but not accent or foreground', () => {
    const vars = toCssVars({
      presetId: 'midnight',
      bgAlpha: 0.5,
      appColor: '#b18cff',
      terminalColor: '#11141c',
    });
    // App color に bgAlpha を合成（ターミナル/サイドパネル以外のアプリ面）。
    expect(vars['--app-bg']).toBe('rgba(177, 140, 255, 0.5)');
    // Terminal color に bgAlpha を合成（ターミナル＋サイドパネル）。
    expect(vars['--terminal-bg']).toBe('rgba(17, 20, 28, 0.5)');
    // ハイライト --accent は :root 定数に委ね、ここでは出力しない。
    expect(vars['--accent']).toBeUndefined();
    expect(vars['--fg']).toBeUndefined();
  });
});

describe('nextPresetId', () => {
  test('cycles to the next preset', () => {
    expect(nextPresetId('midnight')).toBe('charcoal');
  });

  test('wraps around from the last preset to the first', () => {
    expect(nextPresetId('forest')).toBe('midnight');
  });

  test('falls back to the first preset for an unknown id', () => {
    expect(nextPresetId('bogus')).toBe('midnight');
  });
});

describe('parse/serialize round trip', () => {
  test('round trips a valid settings object', () => {
    const settings: AppearanceSettings = {
      presetId: 'slate',
      bgAlpha: 0.7,
      appColor: '#fbbf24',
      terminalColor: '#1a1d24',
    };
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });

  test('returns defaults for null or malformed json', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
  });
});
