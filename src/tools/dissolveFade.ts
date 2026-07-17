// Field fade: each vector ends at a staggered depth (nothing touches the
// bottom), then tapers on its own tip — width + slight opacity along the
// stroke. Cutoffs are monotonic along the polyline so zigzag paths don't
// leave orphan segments lower down.

function hash2(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 2654435761);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

export interface FadeOptions {
  /** Earliest depth (0..1) where short-lived lines may end. */
  start?: number;
  /** Hard floor — no ink past this fraction of height (keeps bottom clear). */
  floor?: number;
  /** Fraction of each line's depth used as the tip taper zone. */
  tipFrac?: number;
  /** Opacity at the tip (0 = vanish). */
  endAlpha?: number;
  /** Width at the tip (0 = point). */
  endWidth?: number;
  /** Tip curve (>1 stays fuller longer). */
  power?: number;
  /** Skip truncated strokes shorter than this (CSS px). */
  minLength?: number;
  seed?: number;
}

export interface FadeFns {
  /** Absolute Y cutoff for this line (CSS px). */
  cutoffY: (lineId: number) => number;
  /** True while this point is still before the line's cutoff. */
  keep: (lineId: number, x: number, y: number) => boolean;
  /** Tip opacity 0..1 from proximity to this line's own end. */
  alpha: (lineId: number, x: number, y: number) => number;
  /** Tip width scale 0..1 from proximity to this line's own end. */
  width: (lineId: number, x: number, y: number) => number;
}

/**
 * Build per-line cutoff + tip taper helpers.
 * Softening is relative to each vector's end — not a canvas-wide wash.
 */
export function makeFade(w: number, h: number, opts: FadeOptions = {}): FadeFns {
  const start = opts.start ?? 0.58; // keep density longer; thin only in the lower band
  const floor = opts.floor ?? 0.94; // small clear margin at the bottom
  const tipFrac = opts.tipFrac ?? 0.42;
  const endAlpha = opts.endAlpha ?? 0.08;
  const endWidth = opts.endWidth ?? 0.02;
  const power = opts.power ?? 1.35;
  const seed = (opts.seed ?? 1) >>> 0;
  const range = Math.max(1e-6, floor - start);

  const cutoffY = (lineId: number) => {
    const rank = hash2(lineId | 0, 0x51ed, seed);
    const bias = (hash2(lineId | 0, 0xabc1, seed) - 0.5) * 0.04;
    // Skew toward the floor so most vectors survive deep; only a few end early.
    const depth = Math.min(
      floor,
      Math.max(start, start + Math.pow(rank, 0.45) * range + bias),
    );
    return depth * h;
  };

  const tipScale = (lineId: number, y: number) => {
    const cut = cutoffY(lineId);
    const tipStart = cut * (1 - tipFrac);
    if (y <= tipStart) return 1;
    if (y >= cut) return 0;
    const t = (y - tipStart) / Math.max(1e-6, cut - tipStart);
    return 1 - Math.pow(t, power);
  };

  return {
    cutoffY,
    keep(lineId, _x, y) {
      return y < cutoffY(lineId);
    },
    alpha(lineId, _x, y) {
      const s = tipScale(lineId, y);
      return endAlpha + s * (1 - endAlpha);
    },
    width(lineId, _x, y) {
      const s = tipScale(lineId, y);
      return endWidth + s * (1 - endWidth);
    },
  };
}

/** @deprecated Prefer makeFade. */
export function makeTaper(
  w: number,
  h: number,
  opts: FadeOptions = {},
): (lineId: number, x: number, y: number) => number {
  const fade = makeFade(w, h, opts);
  return (lineId, x, y) => fade.width(lineId, x, y);
}

export interface StrokeFadeOpts {
  keep?: ((x: number, y: number) => boolean) | null;
  alpha?: ((x: number, y: number) => number) | null;
  width?: ((x: number, y: number) => number) | null;
  /** Drop the stroke if shorter than this after truncation. */
  minLength?: number;
}

/** Truncate a polyline at the first failing keep (prefix only — no orphans). */
function truncatePrefix(
  pts: number[] | Float64Array,
  keep: ((x: number, y: number) => boolean) | null | undefined,
): number[] {
  if (!keep || pts.length < 4) {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i++) out.push(pts[i]);
    return out;
  }
  const out: number[] = [pts[0], pts[1]];
  if (!keep(pts[0], pts[1])) return [];
  const n = pts.length / 2;
  for (let i = 1; i < n; i++) {
    const x0 = pts[(i - 1) * 2];
    const y0 = pts[(i - 1) * 2 + 1];
    const x1 = pts[i * 2];
    const y1 = pts[i * 2 + 1];
    if (keep(x1, y1)) {
      out.push(x1, y1);
      continue;
    }
    // Clip the last segment to the keep boundary (binary search on t).
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) * 0.5;
      const mx = x0 + (x1 - x0) * mid;
      const my = y0 + (y1 - y0) * mid;
      if (keep(mx, my)) lo = mid;
      else hi = mid;
    }
    if (lo > 0.02) {
      out.push(x0 + (x1 - x0) * lo, y0 + (y1 - y0) * lo);
    }
    break;
  }
  return out;
}

function pathLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - pts[i - 2];
    const dy = pts[i + 1] - pts[i - 1];
    len += Math.hypot(dx, dy);
  }
  return len;
}

/**
 * Stroke a polyline: truncate to a clean prefix, then taper each vector's tip.
 */
export function strokeFaded(
  ctx: CanvasRenderingContext2D,
  pts: number[] | Float64Array,
  baseWidth: number,
  fade: StrokeFadeOpts | null,
) {
  if (pts.length < 4) return;
  if (!fade || (!fade.keep && !fade.alpha && !fade.width)) {
    ctx.lineWidth = baseWidth;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
    return;
  }

  const trimmed = truncatePrefix(pts, fade.keep);
  const minLen = fade.minLength ?? Math.max(10, baseWidth * 6);
  if (trimmed.length < 4 || pathLength(trimmed) < minLen) return;

  const { alpha, width } = fade;
  const segs = trimmed.length / 2 - 1;
  const prevAlpha = ctx.globalAlpha;
  // Round caps so tapered tips read as vector ends, not chopped dashes.
  const prevCap = ctx.lineCap;
  ctx.lineCap = "round";

  for (let i = 0; i < segs; i++) {
    const x0 = trimmed[i * 2];
    const y0 = trimmed[i * 2 + 1];
    const x1 = trimmed[(i + 1) * 2];
    const y1 = trimmed[(i + 1) * 2 + 1];
    const a = alpha ? (alpha(x0, y0) + alpha(x1, y1)) * 0.5 : 1;
    const s = width ? (width(x0, y0) + width(x1, y1)) * 0.5 : 1;
    const lw = baseWidth * s;
    if (lw < 0.1 || a < 0.05) continue;
    ctx.globalAlpha = prevAlpha * a;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.globalAlpha = prevAlpha;
  ctx.lineCap = prevCap;
}

/** @deprecated Prefer strokeFaded. */
export function strokeTapered(
  ctx: CanvasRenderingContext2D,
  pts: number[] | Float64Array,
  baseWidth: number,
  widthAt: ((x: number, y: number) => number) | null,
  minVisible = 0.12,
) {
  strokeFaded(ctx, pts, baseWidth, {
    width: widthAt
      ? (x, y) => {
          const s = widthAt(x, y);
          return s * baseWidth < minVisible ? 0 : s;
        }
      : null,
  });
}

/**
 * SVG counterpart: truncated prefix with per-segment tip width/opacity.
 */
export function svgFadedPaths(
  pts: number[] | Float64Array,
  baseWidth: number,
  fade: StrokeFadeOpts | null,
  f: (n: number) => number,
): string {
  if (pts.length < 4) return "";
  if (!fade || (!fade.keep && !fade.alpha && !fade.width)) {
    let d = "";
    for (let i = 0; i < pts.length; i += 2)
      d += `${i === 0 ? "M" : "L"}${f(pts[i])} ${f(pts[i + 1])}`;
    return `<path d="${d}" stroke-width="${f(baseWidth)}"/>`;
  }

  const trimmed = truncatePrefix(pts, fade.keep);
  const minLen = fade.minLength ?? Math.max(10, baseWidth * 6);
  if (trimmed.length < 4 || pathLength(trimmed) < minLen) return "";

  const { alpha, width } = fade;
  const parts: string[] = [];
  const segs = trimmed.length / 2 - 1;
  let runD = "";
  let runW = -1;
  let runA = -1;

  const flush = () => {
    if (!runD) return;
    const op =
      runA >= 0.995 ? "" : ` opacity="${Math.round(runA * 100) / 100}"`;
    parts.push(`<path d="${runD}" stroke-width="${f(runW)}"${op}/>`);
    runD = "";
    runW = -1;
    runA = -1;
  };

  for (let i = 0; i < segs; i++) {
    const x0 = trimmed[i * 2];
    const y0 = trimmed[i * 2 + 1];
    const x1 = trimmed[(i + 1) * 2];
    const y1 = trimmed[(i + 1) * 2 + 1];
    const a = alpha ? (alpha(x0, y0) + alpha(x1, y1)) * 0.5 : 1;
    const s = width ? (width(x0, y0) + width(x1, y1)) * 0.5 : 1;
    const lw = baseWidth * s;
    if (lw < 0.1 || a < 0.05) {
      flush();
      continue;
    }
    const qw = Math.round(lw * 20) / 20;
    const qa = Math.round(a * 40) / 40;
    if (runW < 0 || Math.abs(qw - runW) > 0.06 || Math.abs(qa - runA) > 0.04) {
      flush();
      runW = qw;
      runA = qa;
      runD = `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
    } else {
      runD += `L${f(x1)} ${f(y1)}`;
    }
  }
  flush();
  return parts.join("");
}

/** @deprecated Prefer svgFadedPaths. */
export function svgTaperedPaths(
  pts: number[] | Float64Array,
  baseWidth: number,
  widthAt: ((x: number, y: number) => number) | null,
  f: (n: number) => number,
): string {
  return svgFadedPaths(pts, baseWidth, { width: widthAt }, f);
}
