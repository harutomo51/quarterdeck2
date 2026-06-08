/**
 * プラン利用枠バー（ADR-0004 / issue 0001）。
 * 下部フッターに 5h 利用枠を 1 本だけ単色で描画するトレーサーバレット。
 * 色閾値（緑/オレンジ/赤, issue 0002）・鮮度判定とフォールバック非表示（issue 0003）は後続。
 */
import { useUsage } from '../hooks/useUsage';
import { fiveHourPercent } from '../lib/usage';

export function UsageBar() {
  const usage = useUsage();
  const five = fiveHourPercent(usage);

  // データ未着なら何も描かない（本格的な degrade は issue 0003）。
  if (five === null) return null;

  const pct = Math.round(five);
  return (
    <div className="usage-bar" role="status" aria-label={`5h 利用枠 ${pct}%`}>
      <span className="usage-bar-label">5h</span>
      <div className="usage-bar-track">
        <div className="usage-bar-fill" style={{ width: `${five}%` }} />
      </div>
      <span className="usage-bar-value">{pct}%</span>
    </div>
  );
}
