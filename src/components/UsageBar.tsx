/**
 * プラン利用枠バー（ADR-0004 / issue 0001・0002）。
 * 下部フッターに 5h / 7d 利用枠を 2 本描画し、使用率に応じて
 * 緑 (<70%) → オレンジ (70–90%) → 赤 (≥90%) で配色する。
 * 配色は背景レイヤー（バーの fill）だけに当て、文字色は不変（CLAUDE.md 外観方針）。
 * 鮮度判定とフォールバック非表示は issue 0003 で導入。
 */
import { useUsage } from '../hooks/useUsage';
import { fiveHourPercent, sevenDayPercent, usageLevel } from '../lib/usage';

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
  const five = fiveHourPercent(usage);
  const seven = sevenDayPercent(usage);

  // どちらも未着なら何も描かない（本格的な degrade は issue 0003）。
  if (five === null && seven === null) return null;

  return (
    <>
      <QuotaBar label="5h" pct={five} />
      <QuotaBar label="7d" pct={seven} />
    </>
  );
}
