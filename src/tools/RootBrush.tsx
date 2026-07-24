import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ParamValueInput from "../components/ParamValueInput";
import ToolRailControls from "../components/ToolRailControls";
import { useAnimProgress, useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { setCanvasAspectVars } from "./aspectRatio";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import {
  BG,
  buildRootsSVG,
  DEFAULT_ROOT,
  drawRoots,
  growRoots,
  INK,
  RH,
  ROOT_HINTS,
  ROOT_LABELS,
  ROOT_RANGES,
  RW,
  sampleLuminance,
  SLIDER_KEYS_SIMPLE,
  type RootBrush as Brush,
  type RootParams,
} from "./rootSystemCore";

const GROWTH_MS = 12000;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

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

// The same Root System engine, exposed through "brushes" that change how a
// growing tip turns and how the finished roots are drawn. See rootSystemCore.
const BRUSHES: { id: Brush; label: string }[] = [
  { id: "organic", label: "Organic" },
  { id: "engineered", label: "Engineered" },
];

interface RootBrushProps {
  // When provided, the brush is controlled by the parent (the app nav) rather
  // than a local toggle, so it survives remounts. `hideBrushToggle` then hides
  // the in-panel brush group since the nav already exposes it.
  brush?: Brush;
  onBrushChange?: (b: Brush) => void;
  hideBrushToggle?: boolean;
  /** Portal tool controls into this host (mode-rail panel under the brush seg). */
  controlsTarget?: HTMLElement | null;
}

export default function RootBrush({
  brush: brushProp,
  onBrushChange,
  hideBrushToggle,
  controlsTarget = null,
}: RootBrushProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const { w, h, exportDims, pxScale, config, setConfig } = useCanvasDimensions(RW, RH);
  const [params, setParams] = useState<RootParams>(DEFAULT_ROOT);
  const [brushState, setBrushState] = useState<Brush>("organic");
  // Controlled by the parent when `brushProp` is supplied; otherwise local.
  const brush = brushProp ?? brushState;
  const setBrush = (b: Brush) =>
    onBrushChange ? onBrushChange(b) : setBrushState(b);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  // Treatment render quality: dropped while sliders scrub, 1 at rest.
  const qualityRef = useRef(1);
  const settleTimer = useRef<number | undefined>(undefined);
  const [settleTick, setSettleTick] = useState(0);

  const buf = useMemo(
    () => (image ? sampleLuminance(image, w, h) : null),
    [image, w, h],
  );

  // Stamp/cutout are render-only treatment passes — scrubbing them must not
  // re-run the (expensive) growth engine, so they're excluded from the deps.
  const result = useMemo(
    () => growRoots(w, h, params, buf, brush),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      w,
      h,
      buf,
      brush,
      ...Object.entries(params)
        .filter(([k]) => k !== "stamp" && k !== "cutout")
        .map(([, v]) => v),
    ],
  );

  const hasOutput = result.edges.length > 0 || result.hairs.length > 0;

  // Ink-stamp treatment (organic brush only) — a render-level pass, so it
  // doesn't feed into growRoots.
  const stampOpts = useMemo(
    () =>
      brush === "organic" && (params.stamp > 0 || params.cutout > 0)
        ? {
            amount: params.stamp,
            cutout: params.cutout,
            lineWeight: params.thickness,
          }
        : undefined,
    [brush, params.stamp, params.cutout, params.thickness],
  );

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const { dw, dh } = viewportFitSize(w, h, window.innerWidth, window.innerHeight);
      const maxX = Math.max(0, (dw * z - window.innerWidth) / 2 + 24);
      const maxY = Math.max(0, (dh * z - window.innerHeight) / 2 + 24);
      return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    },
    [w, h],
  );

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
      // Like fullscreen: render at the canvas's DISPLAYED size, so device
      // pixels map 1:1 onto the screen instead of the browser rescaling the
      // backing store — the inline preview shows exactly what fullscreen does.
      const cssW = canvas.getBoundingClientRect().width || w;
      const pixelW = Math.round(cssW * cssDpr);
      const pixelH = Math.round(pixelW * (h / w));
      canvas.width = pixelW;
      canvas.height = pixelH;
      canvas.style.width = "";
      canvas.style.height = "";
      canvas.style.transform = "";
      drawDpr = pixelW / w;
    }

    setCanvasAspectVars(canvas, w, h);
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
      stampOpts && { ...stampOpts, quality: qualityRef.current },
    );
    // settleTick re-runs the draw at full quality after scrubbing stops.
  }, [result, ink, background, w, h, growth, brush, isFullscreen, zoom, stampOpts, settleTick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isFullscreen) return;
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
  }, [pan, isFullscreen]);

  // All draw triggers funnel through one rAF-coalesced scheduler: several
  // state changes landing in the same tick (slider scrub + settle + resize)
  // produce ONE render instead of stacking full treatment pipelines.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });
  const drawRaf = useRef(0);
  const drawFallback = useRef<number | undefined>(undefined);
  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(drawRaf.current);
    window.clearTimeout(drawFallback.current);
    drawRaf.current = requestAnimationFrame(() => {
      window.clearTimeout(drawFallback.current);
      drawRef.current();
    });
    // rAF never fires in a hidden/occluded tab — without this fallback the
    // canvas stays blank until the tab becomes visible.
    drawFallback.current = window.setTimeout(() => {
      cancelAnimationFrame(drawRaf.current);
      drawRef.current();
    }, 150);
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(drawRaf.current);
      window.clearTimeout(drawFallback.current);
    },
    [],
  );

  useEffect(() => {
    scheduleDraw();
  }, [draw, scheduleDraw]);

  // Redraw when the inline preview's layout size changes, since the backing
  // store tracks the displayed size. Ignores sub-pixel jitter so canvas
  // reallocation can't feed back into the observer.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || isFullscreen) return;
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1)
        return;
      lastW = r.width;
      lastH = r.height;
      scheduleDraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [isFullscreen, scheduleDraw]);

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
          stampOpts,
        );
      },
    }),
    [exportDims, w, h, pxScale, result, ink, background, growthRef, brush, stampOpts],
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
      if (!fs) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setPanning(false);
        dragRef.current = null;
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onResize = () => {
      setPan((p) => clampPan(p.x, p.y, zoom));
      draw();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isFullscreen, draw, clampPan, zoom]);

  const zoomBy = (factor: number) => {
    setZoom((z) => {
      const nz = clamp(z * factor, ZOOM_MIN, ZOOM_MAX);
      setPan((p) => clampPan(p.x, p.y, nz));
      return nz;
    });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isFullscreen || zoom === 1) return;
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || !isFullscreen) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setPan((p) => clampPan(p.x + dx, p.y + dy, zoom));
  };

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPanning(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
  };
  useEffect(() => {
    if (recorder.recording) return;
    scheduleDraw();
  }, [recorder.recording, scheduleDraw]);

  const updateParam = useCallback(
    <K extends keyof RootParams>(key: K, value: RootParams[K]) => {
      // Scrub at reduced treatment resolution so slider drags stay fluid;
      // settle back to full quality shortly after the last movement.
      qualityRef.current = 0.5;
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        qualityRef.current = 1;
        setSettleTick((t) => t + 1);
      }, 160);
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

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
      stampOpts,
    );
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    if (!hasOutput) return;
    // Pure magnification of the preview — same result, scaled through the
    // transform, one clean downscale. WYSIWYG, no aliasing from re-growth.
    // With the stamp treatment the ink comes from a fixed-resolution bitmap,
    // so supersampling only adds a resample generation — render 1:1 instead.
    const ss = stampOpts ? 1 : undefined;
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
        stampOpts,
      );
    }, ss).then((blob) => blob && download(blob, "png"));
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

  const brushHeader = !hideBrushToggle ? (
    <div className="specimen-tree__group">
      <span className="specimen-tree__group-title">Brush</span>
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
  ) : null;

  const controls = (
    <ToolRailControls
      header={brushHeader}
      config={config}
      onConfigChange={setConfig}
      sliders={SLIDER_KEYS_SIMPLE.map(renderRow)}
      ink={ink}
      background={background}

      onInkChange={setInk}
      onBackgroundChange={setBackground}
      strokeTip="Color of the root strokes."
      backgroundTip="Canvas background color behind the roots."
      onPNG={downloadPNG}
      onSVG={downloadSVG}
      exportDisabled={!hasOutput}
      recording={recorder.recording}
      recordSupported={recorder.supported}
      onStartRecord={startRecord}
      onStopRecord={stopRecord}
      playing={growing}
      onTogglePlay={toggleGrow}
      playDisabled={!hasOutput}
      playLabel="Grow"
      playingLabel="Growing…"
      onReset={reset}
    />
  );

  return (
    <>
      {controlsTarget ? createPortal(controls, controlsTarget) : null}

      <section
        className={`specimen-tree specimen-tree--viewport${controlsTarget ? "" : " specimen-tree--wide-controls"}`}
        aria-label="Root brush canvas"
      >
        {!controlsTarget && (
          <aside className="specimen-tree__controls">{controls}</aside>
        )}

        <div
          ref={canvasWrapRef}
          className={`specimen-tree__canvas-wrap${isFullscreen ? " is-fullscreen" : ""}`}
          style={
            isFullscreen
              ? { background: safeColor(background, BG) }
              : undefined
          }
        >
          <canvas
            ref={canvasRef}
            className={`specimen-tree__canvas${isFullscreen && zoom !== 1 ? " is-pannable" : ""}${panning ? " is-panning" : ""}`}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
          />
          {isFullscreen && (
            <button
              type="button"
              className="canvas-fs-close"
              onClick={toggleFullscreen}
              title="Exit full screen"
              aria-label="Exit full screen"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
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
                onClick={resetView}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                title="Reset zoom and pan"
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
