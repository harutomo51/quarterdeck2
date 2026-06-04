import { describe, expect, test } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  normalizeChord,
  chordFromEvent,
  matchAction,
  normalizeKeybindings,
  parseKeybindings,
  serializeKeybindings,
  type KeyChordEvent,
} from '@/lib/keybindings';

const ev = (e: Partial<KeyChordEvent> & { key: string }): KeyChordEvent => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...e,
});

describe('normalizeChord', () => {
  test('orders modifiers canonically (Ctrl, Alt, Shift)', () => {
    expect(normalizeChord('Shift+Alt+Ctrl+W')).toBe('Ctrl+Alt+Shift+W');
  });

  test('uppercases a single letter key', () => {
    expect(normalizeChord('Ctrl+Shift+w')).toBe('Ctrl+Shift+W');
  });

  test('keeps symbol and arrow keys as-is', () => {
    expect(normalizeChord('Alt+Shift+=')).toBe('Alt+Shift+=');
    expect(normalizeChord('Alt+ArrowUp')).toBe('Alt+ArrowUp');
  });
});

describe('chordFromEvent', () => {
  test('builds a canonical chord from modifiers and key', () => {
    expect(chordFromEvent(ev({ ctrlKey: true, shiftKey: true, key: 'w' }))).toBe('Ctrl+Shift+W');
  });

  test('builds an Alt+arrow chord', () => {
    expect(chordFromEvent(ev({ altKey: true, key: 'ArrowLeft' }))).toBe('Alt+ArrowLeft');
  });
});

describe('default split chords', () => {
  // JIS では `=` は Minus キーの Shift（`-` と同一物理キー）。記号キーに依存した
  // 既定だと垂直 / 水平分割が同じキーになり区別できない。記号キーを避ける。
  const keyOf = (chord: string) => chord.split('+').pop();

  test('vertical and horizontal split use distinct, non-symbol keys', () => {
    const v = DEFAULT_KEYBINDINGS['split-vertical'];
    const h = DEFAULT_KEYBINDINGS['split-horizontal'];
    expect(v).not.toBe(h);
    const symbolKeys = ['=', '-', '+', '_'];
    expect(symbolKeys).not.toContain(keyOf(v));
    expect(symbolKeys).not.toContain(keyOf(h));
  });
});

describe('matchAction', () => {
  test('maps the default close-pane chord to its action', () => {
    const action = matchAction(DEFAULT_KEYBINDINGS, ev({ ctrlKey: true, shiftKey: true, key: 'W' }));
    expect(action).toBe('close-pane');
  });

  test('maps the default focus-right chord to its action', () => {
    const action = matchAction(DEFAULT_KEYBINDINGS, ev({ altKey: true, key: 'ArrowRight' }));
    expect(action).toBe('focus-right');
  });

  test('returns null for an unbound chord', () => {
    expect(matchAction(DEFAULT_KEYBINDINGS, ev({ key: 'a' }))).toBeNull();
  });
});

describe('normalizeKeybindings', () => {
  test('fills missing actions from the defaults', () => {
    expect(normalizeKeybindings({})).toEqual(DEFAULT_KEYBINDINGS);
  });

  test('keeps a valid override and normalizes its chord', () => {
    const next = normalizeKeybindings({ 'close-pane': 'ctrl+shift+q' });
    expect(next['close-pane']).toBe('Ctrl+Shift+Q');
    expect(next['focus-up']).toBe(DEFAULT_KEYBINDINGS['focus-up']);
  });

  test('ignores unknown keys', () => {
    const next = normalizeKeybindings({ bogus: 'Ctrl+X' } as never);
    expect(next).toEqual(DEFAULT_KEYBINDINGS);
  });
});

describe('parse/serialize round-trip', () => {
  test('parses serialized bindings back', () => {
    const json = serializeKeybindings(DEFAULT_KEYBINDINGS);
    expect(parseKeybindings(json)).toEqual(DEFAULT_KEYBINDINGS);
  });

  test('falls back to defaults on invalid json', () => {
    expect(parseKeybindings('not json')).toEqual(DEFAULT_KEYBINDINGS);
    expect(parseKeybindings(null)).toEqual(DEFAULT_KEYBINDINGS);
  });
});
