import type { ReactNode } from "react";
import AspectRatioControl from "./AspectRatioControl";
import ExportButtons from "./ExportButtons";
import RecordButton from "./RecordButton";
import type { CanvasSizeConfig } from "../tools/aspectRatio";
import { safeColor } from "../tools/specimenTreeCore";

const ResetIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
);

interface ToolRailControlsProps {
  /** Optional block above Canvas (e.g. in-panel brush toggle). */
  header?: ReactNode;
  config: CanvasSizeConfig;
  onConfigChange: (config: CanvasSizeConfig) => void;
  /** When set, shows the Fade switch above the param sliders. */
  fade?: boolean;
  onFadeChange?: (value: boolean) => void;
  fadeTip?: string;
  /** Seed / Density / Line Weight (or tool-specific) slider rows. */
  sliders: ReactNode;
  ink: string;
  background: string;
  inkFallback: string;
  bgFallback: string;
  onInkChange: (value: string) => void;
  onBackgroundChange: (value: string) => void;
  strokeTip?: string;
  backgroundTip?: string;
  onPNG: (transparent: boolean) => void;
  onSVG: () => void;
  exportDisabled?: boolean;
  recording: boolean;
  recordSupported?: boolean;
  onStartRecord: () => void;
  onStopRecord: () => void;
  playing: boolean;
  onTogglePlay: () => void;
  playDisabled?: boolean;
  playLabel?: string;
  playingLabel?: string;
  onReset: () => void;
}

/**
 * Shared left-rail controls used by Branch and Field tools: canvas size,
 * optional fade, param sliders, colors, export, and play/reset.
 */
export default function ToolRailControls({
  header,
  config,
  onConfigChange,
  fade,
  onFadeChange,
  fadeTip = "End vectors short of the bottom with tapered tips",
  sliders,
  ink,
  background,
  inkFallback,
  bgFallback,
  onInkChange,
  onBackgroundChange,
  strokeTip = "Color of the stroke.",
  backgroundTip = "Canvas background color.",
  onPNG,
  onSVG,
  exportDisabled,
  recording,
  recordSupported = true,
  onStartRecord,
  onStopRecord,
  playing,
  onTogglePlay,
  playDisabled,
  playLabel = "Play",
  playingLabel = "Drawing…",
  onReset,
}: ToolRailControlsProps) {
  const showFade = typeof fade === "boolean" && onFadeChange;

  const colorRow = (
    label: string,
    tip: string,
    value: string,
    fallback: string,
    onChange: (v: string) => void,
  ) => (
    <label className="tool-param-row has-tip tool-color-row" data-tip={tip}>
      <span className="tool-param-row__label">{label}</span>
      <span className="tool-color-row__inputs">
        <input
          type="color"
          className="tool-color-row__swatch"
          value={safeColor(value, fallback)}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} swatch`}
        />
        <input
          type="text"
          className="tool-color-row__hex"
          value={value}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v.startsWith("#") ? v : `#${v}`);
          }}
          aria-label={`${label} hex code`}
        />
      </span>
    </label>
  );

  return (
    <>
      {header}

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Canvas</span>
        <AspectRatioControl value={config} onChange={onConfigChange} />
      </div>

      <div className="specimen-tree__group rail-section">
        {showFade && (
          <label
            className="tool-param-row has-tip"
            data-tip={fadeTip}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span className="tool-param-row__label">Fade</span>
            <span className={`toggle-switch${fade ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={fade}
                onChange={(e) => onFadeChange(e.target.checked)}
                style={{
                  position: "absolute",
                  opacity: 0,
                  inset: 0,
                  cursor: "pointer",
                }}
                aria-label="Toggle fade"
              />
              <span className="toggle-switch__track" />
              <span className="toggle-switch__thumb" />
            </span>
          </label>
        )}
        <div className="specimen-tree__sliders">{sliders}</div>
      </div>

      <div className="specimen-tree__group">
        {colorRow("Stroke Color", strokeTip, ink, inkFallback, onInkChange)}
        {colorRow(
          "Background",
          backgroundTip,
          background,
          bgFallback,
          onBackgroundChange,
        )}
      </div>

      <div className="specimen-tree__actions specimen-tree__actions--export rail-section">
        <ExportButtons
          onPNG={onPNG}
          onSVG={onSVG}
          disabled={exportDisabled}
        />
        <RecordButton
          recording={recording}
          supported={recordSupported}
          onStart={onStartRecord}
          onStop={onStopRecord}
        />
      </div>

      <div className="specimen-tree__actions rail-section">
        <button
          type="button"
          className={`btn${playing ? " is-active" : ""}`}
          onClick={onTogglePlay}
          disabled={playDisabled}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {playing ? playingLabel : playLabel}
        </button>
        <button type="button" className="btn" onClick={onReset}>
          <ResetIcon />
          Reset
        </button>
      </div>
    </>
  );
}
