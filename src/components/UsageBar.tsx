/**
 * プラン利用枠バー（ADR-0004 / issue 0001・0002・0003）。
 * 下部フッターに 5h / 7d 利用枠を 2 本描画し、使用率に応じて
 * 緑 (<70%) → オレンジ (70–90%) → 赤 (≥90%) で配色する。
 * 配色は背景レイヤー（バーの fill）だけに当て、文字色は不変（CLAUDE.md 外観方針）。
 *
 * degrade（issue 0003）: 値が stale / 未着 / rate_limits 欠落のときはフッター行ごと
 * 静かに非表示にフォールバックする。本コンポーネントは app-body の兄弟であり、
 * 非表示にしてもターミナル本体（PTY）の入出力・描画には影響しない。
 */
import { useUsage } from '../hooks/useUsage';
import { useNow } from '../hooks/useNow';
import { fiveHourPercent, sevenDayPercent, usageLevel, isFresh } from '../lib/usage';

/** 鮮度を時間経過で再判定する間隔（ms）。 */
const USAGE_TICK_MS = 5_000;

interface QuotaBarProps {
  label: string;
  pct: number | null;
}

function QuotaBar({ label, pct }: QuotaBarProps) {
  if (pct === null) return null;

  const rounded = Math.round(pct);
  const level = usageLevel(pct);
  return (
    <div className="usage-bar" role="status" aria-label={`${label} 利用枠 ${rounded}%`}>
      <span className="usage-bar-label">{label}</span>
      <div className="usage-bar-track">
        <div
          className={`usage-bar-fill usage-bar-fill--${level}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="usage-bar-value">{rounded}%</span>
    </div>
  );
}

export function UsageBar() {
  const usage = useUsage();
  const now = useNow(USAGE_TICK_MS);

  const five = fiveHourPercent(usage);
  const seven = sevenDayPercent(usage);

  // stale / 未着 / 両ウィンドウ欠落のいずれかなら、フッター行ごと非表示（degrade）。
  const show = isFresh(usage, now) && (five !== null || seven !== null);
  if (!show) return null;

  return (
    <footer className="statusbar">
      <QuotaBar label="5h" pct={five} />
      <QuotaBar label="7d" pct={seven} />
    </footer>
  );
}
