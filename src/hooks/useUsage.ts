/**
 * プラン利用枠ペイロードの購読フック（ADR-0004 / issue 0001）。
 * Rust の usage_watch が emit する `usage://rate_limits` を listen し、最新値を保持する。
 * 副作用（listen）はここ、判定ロジックは lib/usage.ts（他フックと同じ分離方針）。
 */
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { UsagePayload } from '../lib/usage';

export function useUsage(): UsagePayload | null {
  const [usage, setUsage] = useState<UsagePayload | null>(null);

  useEffect(() => {
    const un = listen<UsagePayload>('usage://rate_limits', (e) => {
      setUsage(e.payload);
    });
    return () => {
      void un.then((off) => off());
    };
  }, []);

  return usage;
}
