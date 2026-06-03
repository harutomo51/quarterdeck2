/**
 * サイドバー レイアウトの純粋ロジック。UI 状態と分離してテスト可能にする。
 *
 * 保持するのは「サイドバー幅 / 折りたたみ / アクティブタブ」の3点だけ。
 * 副作用（localStorage / DOM）は hooks/useLayout.ts 側に置く（appearance と同じ分離）。
 */

export type SidebarTab = 'files' | 'graph' | 'worktree';

export interface LayoutState {
  /** サイドバー幅（px, SIDEBAR_MIN..SIDEBAR_MAX）。 */
  sidebarWidth: number;
  /** サイドバーを畳んでいるか。 */
  sidebarCollapsed: boolean;
  /** 表示中のタブ。 */
  activeTab: SidebarTab;
}

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 640;

const TABS: readonly SidebarTab[] = ['files', 'graph', 'worktree'];

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarWidth: 260,
  sidebarCollapsed: false,
  activeTab: 'files',
};

const STORAGE_KEY = 'quarterdeck.layout';

/** 幅を [SIDEBAR_MIN, SIDEBAR_MAX] にクランプ。NaN はデフォルト幅へ。 */
export function clampSidebarWidth(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_LAYOUT.sidebarWidth;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
}

function isTab(value: unknown): value is SidebarTab {
  return typeof value === 'string' && (TABS as readonly string[]).includes(value);
}

/** 未知・不正値をデフォルトへ寄せて正規化する（外部入力の境界防御）。 */
export function normalizeLayout(raw: Partial<LayoutState> | null | undefined): LayoutState {
  if (!raw) return { ...DEFAULT_LAYOUT };
  const sidebarWidth =
    typeof raw.sidebarWidth === 'number'
      ? clampSidebarWidth(raw.sidebarWidth)
      : DEFAULT_LAYOUT.sidebarWidth;
  const sidebarCollapsed =
    typeof raw.sidebarCollapsed === 'boolean'
      ? raw.sidebarCollapsed
      : DEFAULT_LAYOUT.sidebarCollapsed;
  const activeTab = isTab(raw.activeTab) ? raw.activeTab : DEFAULT_LAYOUT.activeTab;
  return { sidebarWidth, sidebarCollapsed, activeTab };
}

/** localStorage の JSON 文字列を安全にパース（失敗時はデフォルト）。 */
export function parseLayout(json: string | null): LayoutState {
  if (!json) return { ...DEFAULT_LAYOUT };
  try {
    return normalizeLayout(JSON.parse(json) as Partial<LayoutState>);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function serializeLayout(state: LayoutState): string {
  return JSON.stringify(state);
}

export const LAYOUT_STORAGE_KEY = STORAGE_KEY;
