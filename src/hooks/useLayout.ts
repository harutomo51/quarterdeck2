/**
 * サイドバー レイアウトの state + localStorage 永続化フック。
 * 純粋ロジックは lib/layout.ts、副作用（localStorage）はここ（useAppearance と同じ分離）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  LAYOUT_STORAGE_KEY,
  parseLayout,
  serializeLayout,
  type LayoutState,
} from '../lib/layout';

export function useLayout() {
  const [layout, setLayout] = useState<LayoutState>(() =>
    parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY)),
  );

  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout));
  }, [layout]);

  const update = useCallback((patch: Partial<LayoutState>) => {
    setLayout((prev) => ({ ...prev, ...patch }));
  }, []);

  return { layout, update };
}
