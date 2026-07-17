import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import snapshotUrl from "../data/sf-bay-roads.json?url";
import ExportButtons from "../components/ExportButtons";
import ParamValueInput from "../components/ParamValueInput";
import RecordButton from "../components/RecordButton";
import { useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { EXPORT_WIDTH, setCanvasAspectVars } from "./aspectRatio";
import { renderPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  REVEAL_ORDER,
  buildShapeMask,
  isArterialHighway,
  loadSnapshot,
  makeProjector,
  maxPan,
  type Designation,
  type RoadData,
  type RoadWay,
  type View,
} from "./roadColorsCore";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Fixed fill-in animation duration (seconds). */
const FILL_IN_SEC = 3;

// Stable per-road key from its first coordinate, so the fade thins the same
// roads whether drawn to canvas (ordered by reveal) or SVG (grouped by type).
const wayKey = (w: RoadWay) =>
  w.pts.length
    ? (Math.round(w.pts[0].lat * 1e5) ^ Math.round(w.pts[0].lon * 1e5)) >>> 0
    : 0;

// Square render size. Road network is projected into this frame.
const SIZE = 1000;
const DEFAULT_ZOOM = 2.2;
const DEFAULT_VIEW: View = { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
const BG = "#F8FFEE";

// Pre-fetched SF / Bay Area roads, loaded by default so no Overpass call is
// needed for the usual view. Generated into public/ as a static asset.
const SNAPSHOT_URL = snapshotUrl;

// Black linework, collapsed into three clean weight tiers (major / collector /
// minor) so the network reads as an organised hierarchy rather than a finely
// graded heat-map of widths.
const WEIGHT: Record<Designation, number> = {
  "I-": 2,
  "US Hwy": 2,
  "State Hwy": 2,
  Hwy: 2,
  Blvd: 1.1,
  Ave: 1.1,
  Dr: 1.1,
  St: 0.55,
  Rd: 0.55,
  Other: 0.55,
};

const INK = "#00280F";

// Designations dropped when "hide highways" is on, plus OSM arterials (see core).
const HIGHWAY_TIER: Designation[] = ["I-", "US Hwy", "State Hwy", "Hwy"];

/** Order ways for drawing: by reveal order. `keep` filters individual ways. */
function orderWays(data: RoadData, keep: (w: RoadWay) => boolean): RoadWay[] {
  const out: RoadWay[] = [];
  for (const d of REVEAL_ORDER) {
    for (const w of data.ways) {
      if (w.designation === d && keep(w)) out.push(w);
    }
  }
  return out;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ready" }
  | { kind: "error"; msg: string };

export default function RoadColors({
  controlsTarget = null,
}: {
  controlsTarget?: HTMLElement | null;
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<RoadData | null>(null);
  const roadsLayerRef = useRef<HTMLCanvasElement | null>(null);
  const maskLayerRef = useRef<HTMLCanvasElement | null>(null);
  const roadsDrawnRef = useRef(0);
  const [animating, setAnimating] = useState(false);

  const [weight, setWeight] = useState(1.1);
  const [bg, setBg] = useState(BG);
  const [ink, setInk] = useState(INK);
  const [fade, setFade] = useState(true);

  // View transform — zoom about the centre + pan in px. Decoupled from the
  // fetch radius, so zooming never re-downloads.
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Optional silhouette — roads are clipped to the shape (PNG/SVG alpha or dark fill).
  const [shapeImage, setShapeImage] = useState<HTMLImageElement | null>(null);
  const [shapeImageUrl, setShapeImageUrl] = useState("");
  const [shapeImageName, setShapeImageName] = useState("");

  const shapeMask = useMemo(
    () => (shapeImage ? buildShapeMask(shapeImage, SIZE) : null),
    [shapeImage],
  );

  const [data, setData] = useState<RoadData | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const colorFor = useCallback(() => safeColor(ink, INK), [ink]);

  const strokeFor = useCallback(
    (d: Designation, scale = 1) => weight * WEIGHT[d] * scale,
    [weight],
  );

  const keepWay = useCallback((w: RoadWay) => {
    if (HIGHWAY_TIER.includes(w.designation)) return false;
    if (isArterialHighway(w.highway)) return false;
    return true;
  }, []);

  // Draw one already-projected way.
  const drawWay = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      proj: (p: { lat: number; lon: number }) => { x: number; y: number },
      w: RoadWay,
      strokeScale = 1,
      fadeOpts: {
        keep?: ((x: number, y: number) => boolean) | null;
        alpha?: ((x: number, y: number) => number) | null;
        width?: ((x: number, y: number) => number) | null;
      } | null = null,
    ) => {
      ctx.strokeStyle = colorFor();
      const base = strokeFor(w.designation, strokeScale);
      const pts: number[] = [];
      for (const p of w.pts) {
        const q = proj(p);
        pts.push(q.x, q.y);
      }
      strokeFaded(ctx, pts, base, fadeOpts);
    },
    [colorFor, strokeFor],
  );

  // Paint the square background. Roads draw on a separate layer when masked.
  const prepare = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      dpr: number,
      background: string,
      mapSize = SIZE,
    ) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (background !== "transparent") {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, mapSize, mapSize);
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    },
    [],
  );

  const getRoadsLayer = useCallback((dpr: number) => {
    let layer = roadsLayerRef.current;
    if (!layer) {
      layer = document.createElement("canvas");
      roadsLayerRef.current = layer;
    }
    layer.width = SIZE * dpr;
    layer.height = SIZE * dpr;
    const lctx = layer.getContext("2d")!;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { layer, lctx };
  }, []);

  const compositeRoads = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      roadsCanvas: HTMLCanvasElement,
      dpr: number,
      mask: HTMLCanvasElement,
      mapSize = SIZE,
    ) => {
      let masked = maskLayerRef.current;
      if (!masked) {
        masked = document.createElement("canvas");
        maskLayerRef.current = masked;
      }
      const pw = mapSize * dpr;
      masked.width = pw;
      masked.height = pw;
      const mctx = masked.getContext("2d")!;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, pw, pw);
      mctx.drawImage(roadsCanvas, 0, 0);
      mctx.globalCompositeOperation = "destination-in";
      mctx.drawImage(mask, 0, 0, pw, pw);
      mctx.globalCompositeOperation = "source-over";
      ctx.drawImage(masked, 0, 0, mapSize, mapSize);
    },
    [],
  );

  const drawRoadsFrame = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      dpr: number,
      d: RoadData,
      roadCount: number,
      transparent: boolean,
      pixelWidth?: number,
    ) => {
      const strokeScale = pixelWidth ? pixelWidth / SIZE : 1;
      const mapSize = pixelWidth ?? SIZE;
      const background = transparent ? "transparent" : safeColor(bg, BG);
      prepare(ctx, dpr, background, mapSize);
      const proj = makeProjector(d.center, d.radius, mapSize, view);
      const ordered = orderWays(d, keepWay);
      const n = Math.min(roadCount, ordered.length);
      const fieldFade = fade ? makeFade(mapSize, mapSize, { seed: 7 }) : null;
      const fadeFor = (w: RoadWay) =>
        fieldFade
          ? {
              keep: (x: number, y: number) => fieldFade.keep(wayKey(w), x, y),
              alpha: (x: number, y: number) =>
                fieldFade.alpha(wayKey(w), x, y),
              width: (x: number, y: number) =>
                fieldFade.width(wayKey(w), x, y),
            }
          : null;
      if (shapeMask) {
        const layer = document.createElement("canvas");
        layer.width = mapSize * dpr;
        layer.height = mapSize * dpr;
        const lctx = layer.getContext("2d")!;
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lctx.clearRect(0, 0, mapSize, mapSize);
        for (let ri = 0; ri < n; ri++) drawWay(lctx, proj, ordered[ri], strokeScale, fadeFor(ordered[ri]));
        compositeRoads(ctx, layer, dpr, shapeMask, mapSize);
      } else {
        for (let ri = 0; ri < n; ri++) drawWay(ctx, proj, ordered[ri], strokeScale, fadeFor(ordered[ri]));
      }
    },
    [bg, prepare, drawWay, view, keepWay, shapeMask, compositeRoads, fade],
  );

  // Animate the network filling in. Cancels any prior run.
  const animate = useCallback(
    (d: RoadData) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setAnimating(true);

      const dpr = window.devicePixelRatio || 1;
      canvas.width = SIZE * dpr;
      canvas.height = SIZE * dpr;
      setCanvasAspectVars(canvas, SIZE, SIZE);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const background = safeColor(bg, BG);
      prepare(ctx, dpr, background);
      const proj = makeProjector(d.center, d.radius, SIZE, view);
      const ordered = orderWays(d, keepWay);
      roadsDrawnRef.current = 0;
      const useMask = !!shapeMask;
      const { lctx: roadsCtx, layer: roadsLayer } = useMask
        ? getRoadsLayer(dpr)
        : { lctx: ctx, layer: null as HTMLCanvasElement | null };
      if (useMask) roadsCtx.clearRect(0, 0, SIZE, SIZE);

      const fieldFade = fade ? makeFade(SIZE, SIZE, { seed: 7 }) : null;
      const frames = Math.max(1, Math.round(FILL_IN_SEC * 60));
      const perFrame = Math.max(1, Math.ceil(ordered.length / frames));
      let i = 0;
      const step = () => {
        const end = Math.min(ordered.length, i + perFrame);
        for (; i < end; i++) {
          const way = ordered[i];
          drawWay(
            roadsCtx,
            proj,
            way,
            1,
            fieldFade
              ? {
                  keep: (x, y) => fieldFade.keep(wayKey(way), x, y),
                  alpha: (x, y) => fieldFade.alpha(wayKey(way), x, y),
                  width: (x, y) => fieldFade.width(wayKey(way), x, y),
                }
              : null,
          );
        }
        roadsDrawnRef.current = i;
        if (useMask && shapeMask && roadsLayer) {
          prepare(ctx, dpr, background);
          compositeRoads(ctx, roadsLayer, dpr, shapeMask);
        }
        if (i < ordered.length) rafRef.current = requestAnimationFrame(step);
        else {
          rafRef.current = null;
          roadsDrawnRef.current = ordered.length;
          setAnimating(false);
        }
      };
      step();
    },
    [
      bg,
      prepare,
      drawWay,
      view,
      keepWay,
      shapeMask,
      getRoadsLayer,
      compositeRoads,
      fade,
    ],
  );

  // Instant, un-animated redraw — used for color / weight / background tweaks
  // so dragging a picker doesn't replay the whole fill-in.
  const renderStatic = useCallback(
    (d: RoadData) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setAnimating(false);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = SIZE * dpr;
      canvas.height = SIZE * dpr;
      setCanvasAspectVars(canvas, SIZE, SIZE);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      prepare(ctx, dpr, safeColor(bg, BG));
      const proj = makeProjector(d.center, d.radius, SIZE, view);
      const fieldFade = fade ? makeFade(SIZE, SIZE, { seed: 7 }) : null;
      const fadeFor = (w: RoadWay) =>
        fieldFade
          ? {
              keep: (x: number, y: number) => fieldFade.keep(wayKey(w), x, y),
              alpha: (x: number, y: number) =>
                fieldFade.alpha(wayKey(w), x, y),
              width: (x: number, y: number) =>
                fieldFade.width(wayKey(w), x, y),
            }
          : null;
      if (shapeMask) {
        const { lctx, layer } = getRoadsLayer(dpr);
        lctx.clearRect(0, 0, SIZE, SIZE);
        for (const w of orderWays(d, keepWay)) drawWay(lctx, proj, w, 1, fadeFor(w));
        compositeRoads(ctx, layer, dpr, shapeMask);
      } else {
        for (const w of orderWays(d, keepWay)) drawWay(ctx, proj, w, 1, fadeFor(w));
      }
      roadsDrawnRef.current = orderWays(d, keepWay).length;
    },
    [
      bg,
      prepare,
      drawWay,
      view,
      keepWay,
      shapeMask,
      getRoadsLayer,
      compositeRoads,
      fade,
    ],
  );

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // New data → play the fill-in animation. Only fires on a fresh fetch.
  useEffect(() => {
    if (data) animate(data);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setAnimating(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Style / view change (color, weight, background, image, zoom, pan, filter) →
  // instant redraw, no animation. Skip while a fill-in is in flight so the
  // animation triggered by a fresh fetch (which also moves the view) isn't
  // cancelled the moment it starts.
  useEffect(() => {
    if (rafRef.current) return;
    const d = dataRef.current;
    if (d) renderStatic(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weight, bg, view, shapeMask, ink, fade]);

  // New shape → replay fill-in so roads grow into the silhouette.
  const didMountShape = useRef(false);
  useEffect(() => {
    if (!didMountShape.current) {
      didMountShape.current = true;
      return;
    }
    if (dataRef.current) animate(dataRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeMask]);

  // Load the saved Bay Area snapshot (no network round-trip to Overpass).
  const loadSaved = useCallback(async () => {
    abortRef.current?.abort();
    setStatus({ kind: "loading", msg: "Loading saved Bay Area roads…" });
    try {
      const d = await loadSnapshot(SNAPSHOT_URL);
      setView(DEFAULT_VIEW);
      setData(d);
      setStatus({ kind: "ready" });
    } catch (e) {
      setStatus({
        kind: "error",
        msg: (e as Error).message || "Couldn't load saved roads.",
      });
    }
  }, []);

  // Show the saved roads on first open.
  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Replay the fill-in animation on the current data.
  const grow = useCallback(() => {
    if (dataRef.current) animate(dataRef.current);
  }, [animate]);

  const recordName = (data?.place || "map")
    .split(",")[0]
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  const getExportRender = useCallback(() => {
    const d = dataRef.current;
    if (!d) return null;
    return {
      width: EXPORT_WIDTH,
      height: EXPORT_WIDTH,
      render: (ctx: CanvasRenderingContext2D, dpr: number) => {
        drawRoadsFrame(ctx, dpr, d, roadsDrawnRef.current, false, EXPORT_WIDTH);
      },
    };
  }, [drawRoadsFrame]);

  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `map-${recordName}`,
    getExportRender,
  );

  const startRecord = () => {
    if (dataRef.current) animate(dataRef.current);
    recorder.start();
  };
  const stopRecord = () => recorder.stop();

  useStopRecordWhenAnimatingEnds(recorder.recording, animating, recorder.stop);

  useEffect(() => {
    if (recorder.recording) return;
    const d = dataRef.current;
    if (d) renderStatic(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.recording]);

  // ----- zoom / pan -----
  const MAX_ZOOM = 16;

  // Zoom about a point given in SIZE-space (defaults to canvas centre).
  const zoomAt = useCallback((factor: number, mx = SIZE / 2, my = SIZE / 2) => {
    setView((v) => {
      const nz = clamp(v.zoom * factor, 1, MAX_ZOOM);
      const k = nz / v.zoom;
      const cx = SIZE / 2;
      const cy = SIZE / 2;
      const m = maxPan(SIZE, nz);
      return {
        zoom: nz,
        panX: clamp(mx - cx - (mx - cx - v.panX) * k, -m, m),
        panY: clamp(my - cy - (my - cy - v.panY) * k, -m, m),
      };
    });
  }, []);

  const resetView = useCallback(() => setView(DEFAULT_VIEW), []);

  // Mouse-wheel zoom toward the cursor. Native, non-passive so we can prevent
  // the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * SIZE;
      const my = ((e.clientY - rect.top) / rect.height) * SIZE;
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, mx, my);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (view.zoom <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = SIZE / rect.width;
    const dx = (e.clientX - d.x) * s;
    const dy = (e.clientY - d.y) * s;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => {
      const m = maxPan(SIZE, v.zoom);
      return {
        ...v,
        panX: clamp(v.panX + dx, -m, m),
        panY: clamp(v.panY + dy, -m, m),
      };
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // ----- shape mask image -----
  const onPickShape = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setShapeImage(img);
        setShapeImageUrl(url);
        setShapeImageName(file.name);
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const clearShape = () => {
    setShapeImage(null);
    setShapeImageUrl("");
    setShapeImageName("");
  };

  // ----- exports -----
  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `road-colors-${(data?.place || "map").split(",")[0].trim().replace(/\s+/g, "-").toLowerCase()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = (transparent: boolean) => {
    if (!data) return;
    void renderPngBlob(EXPORT_WIDTH, EXPORT_WIDTH, (ctx, dpr) => {
      drawRoadsFrame(ctx, dpr, data, orderWays(data, keepWay).length, transparent, EXPORT_WIDTH);
    }).then((b) => b && download(b, "png"));
  };

  const downloadSVG = () => {
    if (!data) return;
    const proj = makeProjector(data.center, data.radius, SIZE, view);
    const fieldFade = fade ? makeFade(SIZE, SIZE, { seed: 7 }) : null;
    const f = (n: number) => Math.round(n * 10) / 10;
    let body = "";
    for (const d of REVEAL_ORDER) {
      const group = data.ways.filter((w) => w.designation === d && keepWay(w));
      if (!group.length) continue;
      const paths = group
        .map((w) => {
          const pts: number[] = [];
          for (const p of w.pts) {
            const q = proj(p);
            pts.push(q.x, q.y);
          }
          const fadeOpts = fieldFade
            ? {
                keep: (x: number, y: number) =>
                  fieldFade.keep(wayKey(w), x, y),
                alpha: (x: number, y: number) =>
                  fieldFade.alpha(wayKey(w), x, y),
                width: (x: number, y: number) =>
                  fieldFade.width(wayKey(w), x, y),
              }
            : null;
          return svgFadedPaths(pts, strokeFor(d), fadeOpts, f);
        })
        .join("");
      if (paths)
        body += `<g stroke="${colorFor()}" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
    }
    const clipHref = shapeMask
      ? shapeMask.toDataURL("image/png")
      : shapeImageUrl;
    const clipDef = clipHref
      ? `<clipPath id="shape"><image href="${clipHref}" x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid meet"/></clipPath>`
      : `<clipPath id="shape"><rect width="${SIZE}" height="${SIZE}"/></clipPath>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${EXPORT_WIDTH}" height="${EXPORT_WIDTH}" viewBox="0 0 ${SIZE} ${SIZE}"><defs>${clipDef}</defs><rect width="${SIZE}" height="${SIZE}" fill="${safeColor(bg, BG)}"/><g clip-path="url(#shape)">${body}</g></svg>`;
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    stepv: number,
    onChange: (v: number) => void,
    suffix = "",
  ) => (
    <label className="tool-param-row">
      <span className="tool-param-row__header">
        <span className="tool-param-row__label">{label}</span>
        <ParamValueInput
          value={value}
          min={min}
          max={max}
          step={stepv}
          suffix={suffix}
          aria-label={label}
          onChange={onChange}
        />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={stepv}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );

  const loading = status.kind === "loading";

  const controls = (
    <>
      <div className="specimen-tree__group">
        <label
          className="tool-param-row has-tip"
          data-tip="Thin the roads from dense to sparse toward the bottom"
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
              onChange={(e) => setFade(e.target.checked)}
              disabled={!data}
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
        <div className="specimen-tree__sliders">
          {slider("Line Weight", weight, 0.3, 3, 0.1, setWeight)}
        </div>
        <label className="tool-param-row tool-color-row">
          <span className="tool-param-row__label">Stroke Color</span>
          <span className="tool-color-row__inputs">
            <input
              type="color"
              className="tool-color-row__swatch"
              value={safeColor(ink, INK)}
              onChange={(e) => setInk(e.target.value)}
            />
            <input
              type="text"
              className="tool-color-row__hex"
              value={ink}
              spellCheck={false}
              maxLength={7}
              onChange={(e) =>
                setInk(
                  e.target.value.startsWith("#")
                    ? e.target.value
                    : `#${e.target.value}`,
                )
              }
            />
          </span>
        </label>
      </div>

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Background</span>
        <label className="tool-param-row tool-color-row">
          <span className="tool-param-row__label">Color</span>
          <span className="tool-color-row__inputs">
            <input
              type="color"
              className="tool-color-row__swatch"
              value={safeColor(bg, BG)}
              onChange={(e) => setBg(e.target.value)}
            />
            <input
              type="text"
              className="tool-color-row__hex"
              value={bg}
              spellCheck={false}
              maxLength={7}
              onChange={(e) =>
                setBg(
                  e.target.value.startsWith("#")
                    ? e.target.value
                    : `#${e.target.value}`,
                )
              }
            />
          </span>
        </label>
        <div
          className="specimen-tree__actions"
          style={{ flexWrap: "wrap" }}
        >
          <label className="btn" style={{ cursor: "pointer" }}>
            {shapeImage ? "Replace image" : "Add image"}
            <input
              type="file"
              accept="image/*,.svg"
              onChange={onPickShape}
              style={{ display: "none" }}
            />
          </label>
          {shapeImage && (
            <button type="button" className="btn" onClick={clearShape}>
              Remove
            </button>
          )}
        </div>
        {shapeImage && (
          <span className="specimen-tree__upload-name">
            {shapeImageName}
          </span>
        )}
        <p
          className="specimen-tree__upload-name"
          style={{ margin: "8px 0 0" }}
        >
          PNG or SVG silhouette — the road map fills inside the shape.
        </p>
      </div>

      {data && (
        <div className="specimen-tree__group">
          <span className="specimen-tree__group-title">
            {data.ways.filter(keepWay).length} of {data.ways.length} roads
          </span>
        </div>
      )}

      <div className="specimen-tree__actions specimen-tree__actions--export rail-section">
        <ExportButtons
          onPNG={downloadPNG}
          onSVG={downloadSVG}
          disabled={!data}
        />
        <RecordButton
          recording={recorder.recording}
          supported={recorder.supported}
          disabled={!data || animating}
          onStart={startRecord}
          onStop={stopRecord}
        />
      </div>

      <div className="specimen-tree__actions rail-section">
        <button
          type="button"
          className={`btn${animating ? " is-active" : ""}`}
          onClick={grow}
          disabled={!data || animating}
        >
          {animating ? (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {animating ? "Drawing…" : "Play"}
        </button>
      </div>

      {status.kind === "error" && (
        <p style={{ color: "#fe4d64", fontSize: 13, margin: 0 }}>
          {status.msg}
        </p>
      )}
      {loading && (
        <p style={{ fontSize: 13, margin: 0, opacity: 0.7 }}>
          {status.msg}
        </p>
      )}
    </>
  );

  return (
    <>
      {controlsTarget ? createPortal(controls, controlsTarget) : null}

      <section
        className={`specimen-tree specimen-tree--viewport${controlsTarget ? "" : " specimen-tree--wide-controls"}`}
        aria-label="Map canvas"
      >
        {!controlsTarget && (
          <aside className="specimen-tree__controls">{controls}</aside>
        )}

        <div
          className="specimen-tree__canvas-wrap"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{
              maxHeight: "100%",
              maxWidth: "100%",
              aspectRatio: "1 / 1",
              boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
              cursor:
                view.zoom > 1
                  ? dragRef.current
                    ? "grabbing"
                    : "grab"
                  : "default",
              touchAction: "none",
            }}
          />

          <div
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 5,
              borderRadius: 10,
              background: "rgba(255,255,255,0.92)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.14)",
            }}
          >
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px", lineHeight: 1 }}
              onClick={() => zoomAt(1.3)}
              aria-label="Zoom in"
            >
              +
            </button>
            <span style={{ textAlign: "center", fontSize: 11, opacity: 0.65 }}>
              {view.zoom.toFixed(1)}×
            </span>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px", lineHeight: 1 }}
              onClick={() => zoomAt(1 / 1.3)}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 8px", fontSize: 11 }}
              onClick={resetView}
              disabled={
                view.zoom === DEFAULT_ZOOM && view.panX === 0 && view.panY === 0
              }
            >
              Fit
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
