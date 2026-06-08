/**
 * 一定間隔で現在時刻（ms）を更新して返すフック。
 * イベントが来なくても時間経過で stale 判定し直す（利用枠バーの鮮度フォールバック用）。
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
