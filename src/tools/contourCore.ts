import { contours as d3contours } from "d3-contour";
import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "./specimenTreeCore";
import { sampleLuminance, toneAt, type LumBuffer } from "./flowFieldCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";

// Generative canvas size — matches the other tools.
export const CW = 680;
export const CH = 580;
export const INK = "#00280F";
export const BG = "#F8FFEE";

/**
 * Topographic contour lines. A domain-warped simplex field is sampled onto a
 * grid, then d3-contour traces iso-lines at evenly spaced levels — the nested,
 * meandering linework of an antique survey map. With an image, the field is
 * blended toward the picture's tone so the contours band its forms.
 */
export interface ContourParams {
  seed: number;
  fieldScale: number; // feature size — cells across the long edge
  octaves: number; // fbm detail layers
  warp: number; // domain-warp amount — how much the lines meander
  levels: number; // number of contour lines
  lineWidth: number; // stroke width
  // image
  imageInfluence: number; // 0..1 how strongly the image shapes the field
  contrast: number; // tone curve exponent for the image
}

export const DEFAULT_CONTOUR: ContourParams = {
  seed: 79581,
  fieldScale: 2,
  octaves: 3,
  warp: 0.95,
  levels: 11,
  lineWidth: 1,
  imageInfluence: 0.8,
  contrast: 1.1,
};

export const CONTOUR_RANGES: Record<keyof ContourParams, [number, number, number]> = {
  seed: [1, 99999, 1],
  fieldScale: [2, 18, 0.5],
  octaves: [1, 6, 1],
  warp: [0, 2.5, 0.05],
  levels: [3, 20, 1],
  lineWidth: [0.3, 2, 0.1],
  imageInfluence: [0, 1, 0.02],
  contrast: [0.3, 3, 0.05],
};

export const CONTOUR_LABELS: Record<keyof ContourParams, string> = {
  seed: "Seed",
  fieldScale: "Field Scale",
  octaves: "Detail",
  warp: "Meander",
  levels: "Density",
  lineWidth: "Line Weight",
  imageInfluence: "Image Shape",
  contrast: "Contrast",
};

export const CONTOUR_HINTS: Record<keyof ContourParams, string> = {
  seed: "Random starting value. Same seed always produces the same terrain.",
  fieldScale: "Size of the landforms. Lower values make broad basins; higher values pack tighter ridges.",
  octaves: "Layers of detail folded into the field. More layers add fine crinkle to the coastlines.",
  warp: "How much the field is distorted — turns smooth blobs into meandering, river-like contours.",
  levels: "How many contour lines are drawn between the lowest and highest ground.",
  lineWidth: "Thickness of the contour strokes.",
  imageInfluence: "How strongly the image's tone shapes the terrain. Zero is pure noise; one bands the picture.",
  contrast: "Tone curve for the image. Above 1 deepens the shadows into denser contours.",
};

// The only sliders exposed in the UI. Every other param stays at its default.
// "density" is the number of contour lines; "line weight" is the stroke width.
export const SLIDER_KEYS_SIMPLE: (keyof ContourParams)[] = [
  "seed",
  "levels",
  "lineWidth",
];

export const SLIDER_KEYS_FIELD: (keyof ContourParams)[] = [
  "seed",
  "fieldScale",
  "octaves",
  "warp",
];

export const SLIDER_KEYS_DRAW: (keyof ContourParams)[] = ["levels", "lineWidth"];

export const SLIDER_KEYS_IMAGE: (keyof ContourParams)[] = ["imageInfluence", "contrast"];

export interface ContourLine {
  pts: number[]; // flat [x0,y0,x1,y1,...] in canvas px
  w: number;
  order: number; // 0..1 reveal order by elevation
}

export interface ContourResult {
  lines: ContourLine[];
}

// ---- field -----------------------------------------------------------------

/** Build the scalar elevation grid the contours are traced from. */
function buildField(
  gw: number,
  gh: number,
  w: number,
  h: number,
  p: ContourParams,
  buf: LumBuffer | null | undefined,
): Float64Array {
  const rng = mulberry32(p.seed);
  const noise = createNoise2D(rng);
  const warpNoiseX = createNoise2D(mulberry32(p.seed ^ 0x1234));
  const warpNoiseY = createNoise2D(mulberry32(p.seed ^ 0x9abc));
  const octaves = Math.max(1, Math.round(p.octaves));
  const cell = Math.max(w, h) / p.fieldScale;

  const fbm = (nx: number, ny: number, fn: (x: number, y: number) => number) => {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * fn(nx * freq, ny * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm; // ~ -1..1
  };

  const values = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      // Map grid cell to canvas px, then to noise space.
      const px = (i / (gw - 1)) * w;
      const py = (j / (gh - 1)) * h;
      const nx = px / cell;
      const ny = py / cell;
      // Domain warp: displace the sample point by a second noise field.
      const qx = warpNoiseX(nx, ny);
      const qy = warpNoiseY(nx, ny);
      const n = fbm(nx + p.warp * qx, ny + p.warp * qy, noise);
      let v = (n + 1) / 2; // 0..1

      if (buf) {
        const d = toneAt(buf, px * (buf.width / w), py * (buf.height / h), p);
        v = v * (1 - p.imageInfluence) + d * p.imageInfluence;
      }
      values[j * gw + i] = v;
    }
  }
  return values;
}

export function computeContours(
  w: number,
  h: number,
  p: ContourParams,
  buf?: LumBuffer | null,
): ContourResult {
  // Grid resolution — fine enough for smooth lines, capped for performance.
  const cellPx = 3;
  const gw = Math.max(8, Math.round(w / cellPx));
  const gh = Math.max(8, Math.round(h / cellPx));
  const values = buildField(gw, gh, w, h, p, buf);

  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || hi <= lo) return { lines: [] };

  const levels = Math.max(2, Math.round(p.levels));
  const thresholds: number[] = [];
  for (let l = 1; l <= levels; l++) thresholds.push(lo + ((hi - lo) * l) / (levels + 1));

  const generator = d3contours().size([gw, gh]).thresholds(thresholds);
  const geo = generator(Array.from(values));

  const sx = w / (gw - 1);
  const sy = h / (gh - 1);
  const lines: ContourLine[] = [];

  geo.forEach((multi, idx) => {
    const order = thresholds.length > 1 ? idx / (thresholds.length - 1) : 1;
    for (const polygon of multi.coordinates) {
      for (const ring of polygon) {
        const pts: number[] = [];
        for (const [gx, gy] of ring) pts.push(gx * sx, gy * sy);
        if (pts.length >= 6) lines.push({ pts, w: p.lineWidth, order });
      }
    }
  });

  return { lines };
}

// ---- rendering -------------------------------------------------------------

export function drawContours(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  result: ContourResult,
  ink: string,
  background: string,
  progress = 1,
  fade = false,
  fadeSeed = 1,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
  let lineId = 0;
  for (const line of result.lines) {
    if (line.order > progress) {
      lineId++;
      continue;
    }
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
    const pts = line.pts;
    if (pts.length < 6) continue;
    if (
      pts[0] !== pts[pts.length - 2] ||
      pts[1] !== pts[pts.length - 1]
    ) {
      const closed = pts.slice();
      closed.push(pts[0], pts[1]);
      strokeFaded(ctx, closed, line.w, fadeOpts);
    } else {
      strokeFaded(ctx, pts, line.w, fadeOpts);
    }
  }
}

export function buildContourSVG(
  w: number,
  h: number,
  result: ContourResult,
  ink: string,
  background: string,
  fade = false,
  fadeSeed = 1,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
    `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">`,
  ];
  let lineId = 0;
  for (const line of result.lines) {
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
    const pts = line.pts;
    if (pts.length >= 6) {
      const closed = pts.slice();
      if (
        closed[0] !== closed[closed.length - 2] ||
        closed[1] !== closed[closed.length - 1]
      ) {
        closed.push(closed[0], closed[1]);
      }
      parts.push(svgFadedPaths(closed, line.w, fadeOpts, f));
    }
  }
  parts.push(`</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export function randomContourParams(prev: ContourParams): ContourParams {
  const rand = mulberry32((prev.seed * 2654435761) >>> 0);
  const pick = (min: number, max: number, step: number) => {
    const steps = Math.floor((max - min) / step);
    return min + Math.round(rand() * steps) * step;
  };
  return {
    ...prev,
    seed: Math.floor(rand() * 99999) + 1,
    fieldScale: pick(3, 9, 0.5),
    octaves: pick(2, 5, 1),
    warp: pick(0.3, 1.6, 0.05),
    levels: pick(8, 20, 1),
  };
}

export { sampleLuminance };
