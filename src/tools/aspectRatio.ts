// Canvas size presets for generative tools. Preview matches export aspect ratio
// (WYSIWYG); export uses the preset or custom pixel dimensions.

export interface SizePreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: "1920x1080", label: "16:9", w: 1920, h: 1080 },
  { id: "1440x1080", label: "4:3", w: 1440, h: 1080 },
  { id: "1080x1080", label: "1:1", w: 1080, h: 1080 },
  { id: "1080x1920", label: "9:16", w: 1080, h: 1920 },
];

export const DEFAULT_PRESET_ID = "1080x1080";

export type CanvasSizeConfig =
  | { mode: "preset"; presetId: string }
  | { mode: "custom"; w: number; h: number };

export const DEFAULT_SIZE_CONFIG: CanvasSizeConfig = {
  mode: "preset",
  presetId: DEFAULT_PRESET_ID,
};

/** Publish preview aspect ratio for CSS (panel + canvas share --tool-stage-h). */
export function setCanvasAspectVars(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
) {
  const ww = String(w);
  const hh = String(h);
  canvas.style.setProperty("--canvas-ar-w", ww);
  canvas.style.setProperty("--canvas-ar-h", hh);
  const body = canvas.closest(".app-body") as HTMLElement | null;
  if (body) {
    body.style.setProperty("--canvas-ar-w", ww);
    body.style.setProperty("--canvas-ar-h", hh);
  }
}

export const MIN_EXPORT_DIM = 320;
export const MAX_EXPORT_DIM = 4096;

/** Legacy export width — still used by RoadColors until it joins the size picker. */
export const EXPORT_WIDTH = 2560;

/** H.264 requires even width/height. */
export function evenDim(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

export function clampExportDim(n: number): number {
  return Math.max(MIN_EXPORT_DIM, Math.min(MAX_EXPORT_DIM, Math.round(n)));
}

export function clampCustomDims(w: number, h: number): { w: number; h: number } {
  // Any integer size is allowed; the MP4 recorder evens dimensions itself at
  // encode time (H.264 needs even), so we don't force it on the user's input.
  return { w: clampExportDim(w), h: clampExportDim(h) };
}

export function resolveExportDims(config: CanvasSizeConfig): { w: number; h: number } {
  if (config.mode === "custom") {
    return clampCustomDims(config.w, config.h);
  }
  const preset = SIZE_PRESETS.find((p) => p.id === config.presetId) ?? SIZE_PRESETS[0];
  return { w: preset.w, h: preset.h };
}

export function labelForConfig(config: CanvasSizeConfig): string {
  if (config.mode === "custom") {
    const { w, h } = clampCustomDims(config.w, config.h);
    return `${w}×${h}`;
  }
  const preset = SIZE_PRESETS.find((p) => p.id === config.presetId) ?? SIZE_PRESETS[0];
  return preset.label;
}

/**
 * Preview dimensions: same pixel area as the tool's native size, shaped to match
 * the export aspect ratio so the live canvas is WYSIWYG with exports.
 */
export function dimsForPreview(
  baseW: number,
  baseH: number,
  exportW: number,
  exportH: number,
): { w: number; h: number } {
  if (exportW <= 0 || exportH <= 0) return { w: baseW, h: baseH };
  const ratio = exportW / exportH;
  const area = baseW * baseH;
  return {
    w: Math.round(Math.sqrt(area * ratio)),
    h: Math.round(Math.sqrt(area / ratio)),
  };
}

/** Preview → export width ratio for stroke scaling on export. */
export function exportScale(previewW: number, exportW: number): number {
  if (previewW <= 0) return 1;
  return exportW / previewW;
}

// ---- Legacy ratio API (kept for thumbnails / gradual migration) ----

export interface AspectRatioOption {
  id: string;
  label: string;
  ratio: number;
}

export const ASPECT_RATIOS: AspectRatioOption[] = [
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "2:3", label: "2:3", ratio: 2 / 3 },
];

export const DEFAULT_RATIO_ID = "16:9";

export function dimsForRatio(
  ratioId: string,
  baseW: number,
  baseH: number,
): { w: number; h: number } {
  const opt = ASPECT_RATIOS.find((r) => r.id === ratioId) ?? ASPECT_RATIOS[0];
  const area = baseW * baseH;
  return {
    w: Math.round(Math.sqrt(area * opt.ratio)),
    h: Math.round(Math.sqrt(area / opt.ratio)),
  };
}

export function dimsForExport(
  ratioId: string,
  exportWidth = EXPORT_WIDTH,
): { w: number; h: number } {
  const opt = ASPECT_RATIOS.find((r) => r.id === ratioId) ?? ASPECT_RATIOS[0];
  return {
    w: exportWidth,
    h: Math.round(exportWidth / opt.ratio),
  };
}

export function dimsFromSize(
  previewW: number,
  previewH: number,
  exportWidth = EXPORT_WIDTH,
): { w: number; h: number } {
  if (previewW <= 0 || previewH <= 0) {
    return dimsForExport(DEFAULT_RATIO_ID, exportWidth);
  }
  return {
    w: exportWidth,
    h: Math.round((exportWidth * previewH) / previewW),
  };
}
