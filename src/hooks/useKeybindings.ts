/**
 * キーバインド設定の state + localStorage 永続化フック（Phase D）。
 * 純粋ロジックは lib/keybindings.ts、副作用（localStorage）はここ
 * （useAppearance / useLayout と同じ分離）。分割レイアウトは揮発だが、
 * キーバインドはユーザー設定なので永続化する（ADR-0002）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDINGS_STORAGE_KEY,
  normalizeKeybindings,
  parseKeybindings,
  serializeKeybindings,
  type Keybindings,
} from '../lib/keybindings';

export function useKeybindings() {
  const [bindings, setBindings] = useState<Keybindings>(() =>
    parseKeybindings(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)),
  );

  useEffect(() => {
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, serializeKeybindings(bindings));
  }, [bindings]);

  const update = useCallback((patch: Partial<Keybindings>) => {
    setBindings((prev) => normalizeKeybindings({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setBindings({ ...DEFAULT_KEYBINDINGS }), []);

  return { bindings, update, reset };
}
