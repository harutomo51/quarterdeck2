/**
 * 外観設定パネル（Phase 3）: 背景プリセット・App color・Terminal color・Opacity。
 * 値の正規化は lib/appearance.ts に委譲し、ここは入力 UI のみ。
 * レイアウトは行ベース（アイコン + ラベル + 値）。
 */
import {
  ALPHA_MAX,
  ALPHA_MIN,
  findPreset,
  nextPresetId,
  type AppearanceSettings,
} from '../lib/appearance';

interface SettingsPanelProps {
  settings: AppearanceSettings;
  onChange: (patch: Partial<AppearanceSettings>) => void;
  onClose: () => void;
}

const ALPHA_STEP = 0.05;

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const preset = findPreset(settings.presetId);

  return (
    <div className="settings-panel" role="dialog" aria-label="Appearance">
      <header className="settings-header">
        <h2 className="settings-title">Appearance</h2>
        <button
          type="button"
          className="settings-close"
          aria-label="閉じる"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>

      {/* 背景プリセット: 行クリックで次のプリセットへ循環し、App color も連動 */}
      <button
        type="button"
        className="settings-row settings-row--preset"
        onClick={() => {
          const id = nextPresetId(settings.presetId);
          onChange({ presetId: id, appColor: findPreset(id).base });
        }}
        title="クリックで背景プリセットを切り替え"
      >
        <span className="settings-row-icon" aria-hidden="true">
          <ImageIcon />
        </span>
        <span className="settings-row-preset-label">{preset.label}</span>
      </button>

      {/* App color = アクセント色 */}
      <label className="settings-row">
        <span className="settings-row-icon" aria-hidden="true">
          <PaletteIcon />
        </span>
        <span className="settings-row-label">App color</span>
        <span className="settings-swatch" style={{ background: settings.appColor }}>
          <input
            type="color"
            className="settings-color-input"
            value={settings.appColor}
            aria-label="App color"
            onChange={(e) => onChange({ appColor: e.target.value })}
          />
        </span>
      </label>

      {/* Terminal color = xterm 背景色 */}
      <label className="settings-row">
        <span className="settings-row-icon" aria-hidden="true">
          <MonitorIcon />
        </span>
        <span className="settings-row-label">Terminal color</span>
        <span className="settings-swatch" style={{ background: settings.terminalColor }}>
          <input
            type="color"
            className="settings-color-input"
            value={settings.terminalColor}
            aria-label="Terminal color"
            onChange={(e) => onChange({ terminalColor: e.target.value })}
          />
        </span>
      </label>

      {/* Opacity = 背景レイヤーの不透明度 */}
      <div className="settings-row">
        <span className="settings-row-icon" aria-hidden="true">
          <SlidersIcon />
        </span>
        <span className="settings-row-label">Opacity</span>
        <input
          type="range"
          className="settings-slider"
          min={ALPHA_MIN}
          max={ALPHA_MAX}
          step={ALPHA_STEP}
          value={settings.bgAlpha}
          aria-label="Opacity"
          onChange={(e) => onChange({ bgAlpha: Number(e.target.value) })}
        />
        <span className="settings-row-value">{Math.round(settings.bgAlpha * 100)}%</span>
      </div>
    </div>
  );
}

/* ===== Inline icons（依存追加を避けて軽量に保つ。stroke=currentColor で配色追従） ===== */

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function ImageIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C21.5 5.722 17.275 2 12 2Z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
