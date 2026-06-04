/**
 * キーバインドの純粋ロジック（Phase D）。UI 状態と分離してテスト可能にする。
 *
 * chord は `Ctrl+Alt+Shift+<Key>` の正規形で表す（修飾キーはこの順に固定）。
 * `<Key>` は `KeyboardEvent.key` 由来：単一英字は大文字化、記号 / 矢印（`=`,`-`,
 * `ArrowUp` 等）はそのまま。マッチは正規化した chord 同士の文字列一致で行う。
 * 副作用（localStorage / DOM listener）は hooks/useKeybindings.ts 側に置く。
 */

export type PaneAction =
  | 'split-vertical'
  | 'split-horizontal'
  | 'close-pane'
  | 'focus-up'
  | 'focus-down'
  | 'focus-left'
  | 'focus-right';

export type Keybindings = Record<PaneAction, string>;

export interface KeyChordEvent {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  key: string;
}

const ACTIONS: readonly PaneAction[] = [
  'split-vertical',
  'split-horizontal',
  'close-pane',
  'focus-up',
  'focus-down',
  'focus-left',
  'focus-right',
];

export const DEFAULT_KEYBINDINGS: Keybindings = {
  // 記号キー（=,-）は JIS で同一物理キー（Shift 違い）になり区別できないため避ける。
  'split-vertical': 'Alt+Shift+V',
  'split-horizontal': 'Alt+Shift+H',
  'close-pane': 'Ctrl+Shift+W',
  'focus-up': 'Alt+ArrowUp',
  'focus-down': 'Alt+ArrowDown',
  'focus-left': 'Alt+ArrowLeft',
  'focus-right': 'Alt+ArrowRight',
};

const STORAGE_KEY = 'quarterdeck.keybindings';
export const KEYBINDINGS_STORAGE_KEY = STORAGE_KEY;

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

function buildChord(
  parts: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string },
): string {
  const mods: string[] = [];
  if (parts.ctrl) mods.push('Ctrl');
  if (parts.alt) mods.push('Alt');
  if (parts.shift) mods.push('Shift');
  if (parts.meta) mods.push('Meta');
  return [...mods, normalizeKey(parts.key)].join('+');
}

/** 任意表記の chord 文字列を `Ctrl+Alt+Shift+<Key>` 正規形へ。 */
export function normalizeChord(chord: string): string {
  const tokens = chord.split('+').map((t) => t.trim());
  const key = tokens[tokens.length - 1] ?? '';
  const lower = tokens.slice(0, -1).map((t) => t.toLowerCase());
  return buildChord({
    ctrl: lower.includes('ctrl') || lower.includes('control'),
    alt: lower.includes('alt'),
    shift: lower.includes('shift'),
    meta: lower.includes('meta') || lower.includes('cmd') || lower.includes('win'),
    key,
  });
}

/** KeyboardEvent 風オブジェクトから正規形 chord を組む。 */
export function chordFromEvent(e: KeyChordEvent): string {
  return buildChord({
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    key: e.key,
  });
}

/** イベントに対応する操作。無ければ null。 */
export function matchAction(bindings: Keybindings, e: KeyChordEvent): PaneAction | null {
  const chord = chordFromEvent(e);
  for (const action of ACTIONS) {
    if (normalizeChord(bindings[action]) === chord) return action;
  }
  return null;
}

/** 未知・欠落値をデフォルトへ寄せて正規化する（外部入力の境界防御）。 */
export function normalizeKeybindings(raw: Partial<Keybindings> | null | undefined): Keybindings {
  const out = { ...DEFAULT_KEYBINDINGS };
  if (!raw) return out;
  for (const action of ACTIONS) {
    const value = raw[action];
    if (typeof value === 'string' && value.trim() !== '') {
      out[action] = normalizeChord(value);
    }
  }
  return out;
}

/** localStorage の JSON 文字列を安全にパース（失敗時はデフォルト）。 */
export function parseKeybindings(json: string | null): Keybindings {
  if (!json) return { ...DEFAULT_KEYBINDINGS };
  try {
    return normalizeKeybindings(JSON.parse(json) as Partial<Keybindings>);
  } catch {
    return { ...DEFAULT_KEYBINDINGS };
  }
}

export function serializeKeybindings(bindings: Keybindings): string {
  return JSON.stringify(bindings);
}
