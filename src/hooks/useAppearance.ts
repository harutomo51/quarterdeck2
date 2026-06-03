/**
 * 外観設定の state + 永続化 + DOM 反映フック（Phase 3）。
 * 純粋ロジックは lib/appearance.ts、副作用（localStorage / CSS 変数適用）はここ。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  parseSettings,
  serializeSettings,
  toCssVars,
  type AppearanceSettings,
} from '../lib/appearance';

function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export function useAppearance() {
  const [settings, setSettings] = useState<AppearanceSettings>(() =>
    parseSettings(localStorage.getItem(APPEARANCE_STORAGE_KEY)),
  );

  useEffect(() => {
    applyCssVars(toCssVars(settings));
    localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeSettings(settings));
  }, [settings]);

  const update = useCallback((patch: Partial<AppearanceSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, update };
}
