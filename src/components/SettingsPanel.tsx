/**
 * 外観設定パネル（Phase 3）: 背景プリセット・背景透明度・アクセント色。
 * 値の正規化は lib/appearance.ts に委譲し、ここは入力 UI のみ。
 */
import {
  ACCENT_COLORS,
  ALPHA_MAX,
  ALPHA_MIN,
  BACKGROUND_PRESETS,
  type AppearanceSettings,
} from '../lib/appearance';

interface SettingsPanelProps {
  settings: AppearanceSettings;
  onChange: (patch: Partial<AppearanceSettings>) => void;
}

const ALPHA_STEP = 0.05;

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <div className="settings-panel" role="dialog" aria-label="外観設定">
      <section className="settings-section">
        <h2 className="settings-heading">背景プリセット</h2>
        <div className="settings-presets">
          {BACKGROUND_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="preset-swatch"
              aria-pressed={settings.presetId === p.id}
              style={{ background: p.base }}
              title={p.label}
              onClick={() => onChange({ presetId: p.id })}
            >
              {settings.presetId === p.id ? '✓' : ''}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-heading">
          背景の不透明度 <span className="settings-value">{Math.round(settings.bgAlpha * 100)}%</span>
        </h2>
        <input
          type="range"
          min={ALPHA_MIN}
          max={ALPHA_MAX}
          step={ALPHA_STEP}
          value={settings.bgAlpha}
          aria-label="背景の不透明度"
          onChange={(e) => onChange({ bgAlpha: Number(e.target.value) })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-heading">アクセント</h2>
        <div className="settings-accents">
          {ACCENT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="accent-swatch"
              aria-pressed={settings.accent === c.value}
              style={{ background: c.value }}
              title={c.label}
              onClick={() => onChange({ accent: c.value })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
