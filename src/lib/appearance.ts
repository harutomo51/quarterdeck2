/**
 * 外観設定の 純粋ロジック（Phase 3）。UI 状態と分離してテスト可能にする。
 *
 * 設計原則（CLAUDE.md）:
 * - 外観は CSS カスタムプロパティで制御する。
 * - 透明度は **背景レイヤーだけ** に当て、文字色には適用しない。
 *   → toCssVars は背景を rgba(ベース色, alpha) として返し、文字色 (--fg) は不変。
 *
 * 注: ここでの「透明度」はアプリ背景レイヤーの不透明度合成。デスクトップが透ける
 * 真の OS ウィンドウ透過を行う場合は tauri.conf.json の window.transparent と
 * decorations 調整が別途必要（Windows では既知の癖があるため MVP では見送り）。
 */

export interface BackgroundPreset {
  id: string;
  label: string;
  /** 背景ベース色（#rrggbb）。alpha は別管理。 */
  base: string;
}

export interface AppearanceSettings {
  presetId: string;
  /** 背景レイヤーの不透明度（ALPHA_MIN..1）。 */
  bgAlpha: number;
  /**
   * App color（#rrggbb）。ターミナルとサイドパネル**以外**のアプリ面
   * （タイトルバー＋アプリ本体背景）の色。透明度は bgAlpha を合成。
   */
  appColor: string;
  /**
   * Terminal color（#rrggbb）。ターミナル**と**サイドパネルの色。
   * 透明度は bgAlpha を合成。
   */
  terminalColor: string;
}

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  { id: 'midnight', label: 'Midnight', base: '#0f1115' },
  { id: 'charcoal', label: 'Charcoal', base: '#0a0a0b' },
  { id: 'slate', label: 'Slate', base: '#1a1d24' },
  { id: 'ocean', label: 'Ocean', base: '#0d1b2a' },
  { id: 'forest', label: 'Forest', base: '#0f1a14' },
];

/** 背景が見えなくなりすぎない下限（可読性確保）。 */
export const ALPHA_MIN = 0.3;
export const ALPHA_MAX = 1;

export const DEFAULT_SETTINGS: AppearanceSettings = {
  presetId: 'midnight',
  bgAlpha: 1,
  // 既定は midnight プリセットと同色のダーク。従来の見た目を維持する。
  appColor: '#0f1115',
  terminalColor: '#0f1115',
};

const STORAGE_KEY = 'quarterdeck.appearance';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** alpha を [ALPHA_MIN, ALPHA_MAX] にクランプする。NaN はデフォルト不透明にフォールバック。 */
export function clampAlpha(n: number): number {
  if (Number.isNaN(n)) return ALPHA_MAX;
  return Math.min(ALPHA_MAX, Math.max(ALPHA_MIN, n));
}

/** #rrggbb を {r,g,b} に変換。形式不正なら null。 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_RE.test(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** #rrggbb + alpha を CSS の rgba() 文字列にする。不正な hex は黒にフォールバック。 */
export function toRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const a = clampAlpha(alpha);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

export function findPreset(presetId: string): BackgroundPreset {
  return BACKGROUND_PRESETS.find((p) => p.id === presetId) ?? BACKGROUND_PRESETS[0];
}

/** 現在のプリセットの次（末尾なら先頭へ循環）の id を返す。設定 UI の行クリック用。 */
export function nextPresetId(currentId: string): string {
  const idx = BACKGROUND_PRESETS.findIndex((p) => p.id === currentId);
  const next = BACKGROUND_PRESETS[(idx + 1) % BACKGROUND_PRESETS.length];
  return next.id;
}

/** 未知の値・不正値をデフォルトへ寄せて正規化する（外部入力の境界防御）。 */
export function normalizeSettings(raw: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const preset = BACKGROUND_PRESETS.some((p) => p.id === raw.presetId)
    ? (raw.presetId as string)
    : DEFAULT_SETTINGS.presetId;
  const appColor =
    typeof raw.appColor === 'string' && HEX_RE.test(raw.appColor)
      ? raw.appColor
      : DEFAULT_SETTINGS.appColor;
  const terminalColor =
    typeof raw.terminalColor === 'string' && HEX_RE.test(raw.terminalColor)
      ? raw.terminalColor
      : DEFAULT_SETTINGS.terminalColor;
  const bgAlpha = typeof raw.bgAlpha === 'number' ? clampAlpha(raw.bgAlpha) : DEFAULT_SETTINGS.bgAlpha;
  return { presetId: preset, appColor, terminalColor, bgAlpha };
}

/**
 * 設定から適用すべき CSS カスタムプロパティを返す。
 * --bg: 背景レイヤー（rgba、alpha 適用） / --accent: アクセント色。
 * 文字色 --fg は意図的に返さない（透明度を文字に適用しないため）。
 */
export function toCssVars(settings: AppearanceSettings): Record<string, string> {
  return {
    // App color: ターミナル/サイドパネル以外のアプリ面（タイトルバー＋本体背景）。
    '--app-bg': toRgba(settings.appColor, settings.bgAlpha),
    // Terminal color: ターミナル＋サイドパネル。
    '--terminal-bg': terminalBackground(settings),
  };
  // ハイライト用 --accent は :root の定数に委ねる（領域色とは独立させ可読性を確保）。
}

/**
 * xterm に渡すターミナル背景色（rgba 文字列）。ターミナル色に bgAlpha を合成し、
 * 透明度は背景レイヤーのみに当てる原則（CLAUDE.md）を守る。
 */
export function terminalBackground(settings: AppearanceSettings): string {
  return toRgba(settings.terminalColor, settings.bgAlpha);
}

/** localStorage の JSON 文字列を安全にパース（失敗時はデフォルト）。 */
export function parseSettings(json: string | null): AppearanceSettings {
  if (!json) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(json) as Partial<AppearanceSettings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function serializeSettings(settings: AppearanceSettings): string {
  return JSON.stringify(settings);
}

export const APPEARANCE_STORAGE_KEY = STORAGE_KEY;
