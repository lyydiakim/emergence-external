import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AspectRatioControl from "../components/AspectRatioControl";
import ExportButtons from "../components/ExportButtons";
import ParamValueInput from "../components/ParamValueInput";
import RecordButton from "../components/RecordButton";
import { useAnimProgress, useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import {
  BG,
  buildRootsSVG,
  DEFAULT_ROOT,
  drawRoots,
  growRoots,
  INK,
  randomRootParams,
  RH,
  ROOT_HINTS,
  ROOT_LABELS,
  ROOT_RANGES,
  RW,
  sampleLuminance,
  SLIDER_KEYS_GROW,
  SLIDER_KEYS_IMAGE,
  SLIDER_KEYS_ROOT,
  type RootBrush as Brush,
  type RootParams,
} from "./rootSystemCore";

const GROWTH_MS = 12000;

/** Largest axis-aligned rect with aspect `contentW:contentH` inside a viewport. */
function viewportFitSize(
  contentW: number,
  contentH: number,
  viewportW: number,
  viewportH: number,
): { dw: number; dh: number } {
  const ar = contentW / contentH;
  if (viewportW / viewportH > ar) {
    return { dw: viewportH * ar, dh: viewportH };
  }
  return { dw: viewportW, dh: viewportW / ar };
}

// The same Root System engine, exposed through three "brushes" that change how
// a growing tip turns and how the finished roots are drawn. See rootSystemCore.
const BRUSHES: { id: Brush; label: string }[] = [
  { id: "organic", label: "Organic" },
  { id: "faceted", label: "Faceted" },
  { id: "wire", label: "Wire" },
];

export default function RootBrush() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const { w, h, exportDims, pxScale, config, setConfig } = useCanvasDimensions(RW, RH);
  const [params, setParams] = useState<RootParams>(DEFAULT_ROOT);
  const [brush, setBrush] = useState<Brush>("organic");
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);

  const buf = useMemo(
    () => (image ? sampleLuminance(image, w, h) : null),
    [image, w, h],
  );

  const result = useMemo(
    () => growRoots(w, h, params, buf, brush),
    [w, h, params, buf, brush],
  );

  const hasOutput = result.edges.length > 0 || result.hairs.length > 0;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssDpr = window.devicePixelRatio || 1;

    let drawDpr: number;
    if (isFullscreen) {
      const { dw, dh } = viewportFitSize(w, h, window.innerWidth, window.innerHeight);
      const pixelW = Math.round(dw * cssDpr * zoom);
      const pixelH = Math.round(dh * cssDpr * zoom);
      canvas.width = pixelW;
      canvas.height = pixelH;
      canvas.style.width = `${dw * zoom}px`;
      canvas.style.height = `${dh * zoom}px`;
      drawDpr = pixelW / w;
    } else {
      canvas.width = Math.round(w * cssDpr);
      canvas.height = Math.round(h * cssDpr);
      canvas.style.width = "";
      canvas.style.height = "";
      drawDpr = cssDpr;
    }

    canvas.style.setProperty("--canvas-ar-w", String(w));
    canvas.style.setProperty("--canvas-ar-h", String(h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawRoots(
      ctx,
      drawDpr,
      w,
      h,
      result,
      safeColor(ink, INK),
      safeColor(background, BG),
      growth,
      true,
      brush,
    );
  }, [result, ink, background, w, h, growth, brush, isFullscreen, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (!growing) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / GROWTH_MS);
      setGrowth(1 - (1 - p) * (1 - p));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setGrowing(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [growing]);

  const toggleGrow = () => {
    if (growing) {
      setGrowing(false);
      setGrowth(1);
      return;
    }
    setGrowth(0);
    setGrowing(true);
  };

  const getExportRender = useCallback(
    () => ({
      width: exportDims.w,
      height: exportDims.h,
      // Magnify the preview result: scale = dpr × (export/preview ratio).
      render: (ctx: CanvasRenderingContext2D, dpr: number) => {
        drawRoots(
          ctx,
          dpr * pxScale,
          w,
          h,
          result,
          safeColor(ink, INK),
          safeColor(background, BG),
          growthRef.current,
          true,
          brush,
        );
      },
    }),
    [exportDims, w, h, pxScale, result, ink, background, growthRef, brush],
  );

  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `root-brush-${brush}-${params.seed}`,
    getExportRender,
  );

  const startRecord = () => {
    growthRef.current = 0;
    setGrowth(0);
    setGrowing(true);
    recorder.start();
  };
  const stopRecord = () => {
    setGrowing(false);
    setGrowth(1);
    recorder.stop();
  };

  useStopRecordWhenAnimatingEnds(recorder.recording, growing, recorder.stop);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void canvasWrapRef.current?.requestFullscreen();
    }
  };

  useEffect(() => {
    const onChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) setZoom(1);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isFullscreen, draw]);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 6;
  const zoomBy = (factor: number) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));

  useEffect(() => {
    if (recorder.recording) return;
    draw();
  }, [recorder.recording, draw]);

  const updateParam = useCallback(
    <K extends keyof RootParams>(key: K, value: RootParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const regenerate = () => setParams((prev) => randomRootParams(prev));

  const handleImageUpload = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    setParams(DEFAULT_ROOT);
    setBrush("organic");
    setInk(INK);
    setBackground(BG);
    setImage(null);
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `root-brush-${brush}-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    if (!hasOutput) return;
    // Vector — build from the preview result at preview dims so stroke weights
    // read exactly as on screen; SVG scales to any size losslessly.
    const svg = buildRootsSVG(
      w,
      h,
      result,
      safeColor(ink, INK),
      "transparent",
      true,
      brush,
    );
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    if (!hasOutput) return;
    // Pure magnification of the preview — same result, scaled through the
    // transform, one clean downscale. WYSIWYG, no aliasing from re-growth.
    void renderMagnifiedPngBlob(exportDims.w, exportDims.h, w, h, (ctx, scale) => {
      drawRoots(
        ctx,
        scale,
        w,
        h,
        result,
        safeColor(ink, INK),
        transparent ? "transparent" : safeColor(background, BG),
        1,
        true,
        brush,
      );
    }).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: keyof RootParams) => {
    const [min, max, step] = ROOT_RANGES[key];
    const value = params[key];
    return (
      <label
        key={key}
        className="tool-param-row has-tip"
        data-tip={ROOT_HINTS[key]}
      >
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{ROOT_LABELS[key]}</span>
          <ParamValueInput
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={ROOT_LABELS[key]}
            onChange={(v) => updateParam(key, v as RootParams[typeof key])}
          />
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) =>
            updateParam(key, +e.target.value as RootParams[typeof key])
          }
        />
      </label>
    );
  };

  const colorRow = (
    label: string,
    value: string,
    fallback: string,
    onChange: (v: string) => void,
  ) => (
    <label className="tool-param-row tool-color-row">
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
      <header className="tool-page__header tool-page__header--row">
        <h1 className="tool-page__title">Root Brush</h1>
        <div className="specimen-tree__actions" style={{ marginTop: 0 }}>
          <AspectRatioControl value={config} onChange={setConfig} />
          <ExportButtons
            onPNG={downloadPNG}
            onSVG={downloadSVG}
            disabled={!hasOutput}
          />
          <RecordButton recording={recorder.recording} supported={recorder.supported} onStart={startRecord} onStop={stopRecord} />
        </div>
      </header>

      <section
        className="specimen-tree specimen-tree--viewport specimen-tree--wide-controls"
        aria-label="Root brush canvas"
      >
        <aside className="specimen-tree__controls">
          <div className="specimen-tree__group">
            <span className="specimen-tree__group-title">brush</span>
            <div
              role="group"
              aria-label="Brush"
              style={{ display: "flex", gap: 4 }}
            >
              {BRUSHES.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`btn${brush === b.id ? " is-active" : ""}`}
                  aria-pressed={brush === b.id}
                  onClick={() => setBrush(b.id)}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <label className="specimen-tree__upload">
            <span className="tool-param-row__label">source image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleImageUpload(e.target.files?.[0])}
            />
            {image && (
              <span className="specimen-tree__upload-name">
                {image.naturalWidth}×{image.naturalHeight} loaded
              </span>
            )}
          </label>

          {image && (
            <div className="specimen-tree__group">
              <span className="specimen-tree__group-title">image</span>
              <div className="specimen-tree__sliders">
                {SLIDER_KEYS_IMAGE.map(renderRow)}
              </div>
            </div>
          )}

          <div className="specimen-tree__group">
            <span className="specimen-tree__group-title">growth</span>
            <div className="specimen-tree__sliders">
              {SLIDER_KEYS_GROW.map(renderRow)}
            </div>
          </div>

          <div className="specimen-tree__group">
            <span className="specimen-tree__group-title">roots</span>
            <div className="specimen-tree__sliders">
              {SLIDER_KEYS_ROOT.filter(
                (key) =>
                  key !== "hairDensity" &&
                  // Coil only shapes the terminal curls on the organic brush;
                  // it's a no-op for faceted/wire, so hide it there.
                  (key !== "coil" || brush === "organic") &&
                  // End thickness only fattens wire trace terminals.
                  (key !== "endThickness" || brush === "wire") &&
                  // Taper shapes organic/faceted ends only; wire uses end thickness.
                  (key !== "taper" || brush !== "wire"),
              ).map(renderRow)}
            </div>
          </div>

          <div className="specimen-tree__group">
            {colorRow("stroke color", ink, INK, setInk)}
            {colorRow("background", background, BG, setBackground)}
          </div>

          <div className="specimen-tree__actions">
            <button
              type="button"
              className={`btn${growing ? " is-active" : ""}`}
              onClick={toggleGrow}
              disabled={!hasOutput}
            >
              {growing ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              {growing ? "Growing…" : "Grow"}
            </button>
            <button type="button" className="btn" onClick={regenerate}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              Regenerate
            </button>
            <button type="button" className="btn" onClick={reset}>
              Reset
            </button>
          </div>
        </aside>

        <div
          ref={canvasWrapRef}
          className={`specimen-tree__canvas-wrap${isFullscreen ? " is-fullscreen" : ""}`}
          style={
            isFullscreen
              ? { background: safeColor(background, BG) }
              : undefined
          }
        >
          <canvas ref={canvasRef} className="specimen-tree__canvas" />
          <button
            type="button"
            className={`canvas-fs-btn${isFullscreen ? " is-active" : ""}`}
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit full screen" : "View full screen"}
            aria-label={isFullscreen ? "Exit full screen" : "View full screen"}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 3v3a3 3 0 0 1-3 3H3M21 9h-3a3 3 0 0 1-3-3V3M3 15h3a3 3 0 0 1 3 3v3M15 21v-3a3 3 0 0 1 3-3h3" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
              </svg>
            )}
          </button>
          {isFullscreen && (
            <div className="canvas-zoom" role="group" aria-label="Zoom">
              <button
                type="button"
                className="btn"
                onClick={() => zoomBy(1 / 1.25)}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <output className="canvas-zoom__value">{Math.round(zoom * 100)}%</output>
              <button
                type="button"
                className="btn"
                onClick={() => zoomBy(1.25)}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setZoom(1)}
                disabled={zoom === 1}
                title="Reset zoom"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
