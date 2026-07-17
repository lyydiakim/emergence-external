import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  BG,
  DEFAULT_FLOW,
  FH,
  FLOW_HINTS,
  FLOW_LABELS,
  FLOW_RANGES,
  FW,
  INK,
  type Field,
  type FlowLine,
  type FlowParams,
} from "./flowFieldCore";

// Jagged Fingerprint — parallel ridge lines through a warped scalar field, with
// headings snapped to a facet lattice. Reads like engraved fingerprint ridges
// and PCB trace bundles rather than a centre-spiral whorl.
export const JW = FW;
export const JH = FH;
export { INK, BG };

export interface JaggedParams extends FlowParams {
  jag: number; // heading snap in degrees
  spiral: number; // 0..1 subtle whorl blended in near the centre only
}

export const DEFAULT_JAGGED: JaggedParams = {
  ...DEFAULT_FLOW,
  seed: 48218,
  fieldScale: 4,
  swirl: 0,
  turbulence: 2,
  drift: 0,
  spacing: 9,
  stepLen: 4.5,
  maxLen: 40,
  lineWidth: 1,
  widthVar: 0,
  jitter: 0.34,
  jag: 66,
  spiral: 0.04,
};

export const JAGGED_RANGES: Record<
  keyof JaggedParams,
  [number, number, number]
> = {
  ...FLOW_RANGES,
  jag: [15, 72, 1],
  spiral: [0, 1, 0.02],
};

export const JAGGED_LABELS: Record<keyof JaggedParams, string> = {
  ...FLOW_LABELS,
  jag: "Jag",
  spiral: "Spiral",
};

export const JAGGED_HINTS: Record<keyof JaggedParams, string> = {
  ...FLOW_HINTS,
  jag: "Angular snap for each facet. Higher values produce harsher, chunkier corners.",
  spiral:
    "Fingerprint whorl near the centre only. The rest of the field stays parallel ridges.",
  swirl: "Domain warp — bends the ridge lanes into organic, meandering curves.",
  fieldScale:
    "Size of the ridge pattern. Lower values make broad sweeping lanes; higher packs them tighter.",
};

// The only sliders exposed in the UI. Every other param stays at its default.
export const SLIDER_KEYS_SIMPLE_JAGGED: (keyof JaggedParams)[] = [
  "seed",
  "spacing",
  "lineWidth",
];

export const SLIDER_KEYS_FIELD_JAGGED: (keyof JaggedParams)[] = [
  "seed",
  "fieldScale",
  "swirl",
  "turbulence",
  "spiral",
];

export const SLIDER_KEYS_LINE_JAGGED: (keyof JaggedParams)[] = [
  "spacing",
  "stepLen",
  "maxLen",
  "lineWidth",
  "widthVar",
  "jitter",
  "jag",
];

// ---- scalar field for contour-parallel ridges ------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 2654435761);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Ridge direction follows iso-lines of a domain-warped scalar field — locally
 * parallel lanes like fingerprint ridges. A small central whorl can be blended
 * in without spiralling the whole canvas.
 */
export function buildRidgeField(w: number, h: number, p: JaggedParams): Field {
  const cell = Math.max(w, h) / p.fieldScale;
  const octaves = Math.max(1, Math.round(p.turbulence));
  const warp = p.swirl * cell * 0.95;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const spiralK = (p.spiral * Math.PI * 1.2) / Math.max(w, h);
  const eps = Math.max(1.2, cell * 0.07);
  const drift = (p.drift * Math.PI) / 180;

  const sample = (x: number, y: number) => {
    const wx =
      x +
      warp *
        (fbm(x / (cell * 0.85), y / (cell * 0.85), p.seed ^ 0xa341, octaves) -
          0.5);
    const wy =
      y +
      warp *
        (fbm(
          x / (cell * 0.85) + 41,
          y / (cell * 0.85) + 17,
          p.seed ^ 0xc801,
          octaves,
        ) -
          0.5);
    return fbm(wx / cell, wy / cell, p.seed, octaves);
  };

  return (x, y) => {
    const dx = sample(x + eps, y) - sample(x - eps, y);
    const dy = sample(x, y + eps) - sample(x, y - eps);
    let ridge = Math.atan2(dx, -dy) + drift;

    if (p.spiral > 0.01) {
      const ox = x - cx;
      const oy = y - cy;
      const r = Math.hypot(ox, oy);
      const core = Math.exp(-Math.pow(r / (Math.min(w, h) * 0.34), 2));
      const whorl = Math.atan2(oy, ox) + Math.PI / 2 + spiralK * r;
      const blend = p.spiral * core;
      const vx = Math.cos(ridge) * (1 - blend) + Math.cos(whorl) * blend;
      const vy = Math.sin(ridge) * (1 - blend) + Math.sin(whorl) * blend;
      ridge = Math.atan2(vy, vx);
    }
    return ridge;
  };
}

function assignOrder(lines: FlowLine[]) {
  const n = Math.max(1, lines.length - 1);
  lines.forEach((l, i) => (l.order = i / n));
}

function shortAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Bidirectional ridge trace with jag-snapped headings. */
function walkJagged(
  field: Field,
  w: number,
  h: number,
  p: JaggedParams,
  sx: number,
  sy: number,
  dir: number,
  snap: (a: number) => number,
  blocked: (x: number, y: number) => boolean,
  into: number[],
) {
  let x = sx;
  let y = sy;
  const q = (p.jag * Math.PI) / 180;
  let prev = snap(field(x, y));

  for (let i = 0; i < p.maxLen; i++) {
    let a = snap(field(x, y));
    if (Math.abs(shortAngle(a - prev)) < q * 0.35) a = prev;
    prev = a;
    x += Math.cos(a) * p.stepLen * dir;
    y += Math.sin(a) * p.stepLen * dir;
    if (x < 0 || y < 0 || x >= w || y >= h) break;
    if (blocked(x, y)) break;
    into.push(x, y);
  }
}

/** Grid-seeded open ridges — parallel flowing lines across the full canvas. */
export function traceJaggedRidges(
  field: Field,
  w: number,
  h: number,
  p: JaggedParams,
): FlowLine[] {
  const base = Math.max(2, p.spacing);
  const grid = Math.max(1, base * 0.5);
  const cols = Math.ceil(w / grid) + 1;
  const rows = Math.ceil(h / grid) + 1;
  const occ = new Uint8Array(cols * rows);
  const q = (p.jag * Math.PI) / 180;
  const snap = (a: number) => Math.round(a / q) * q;

  const cellAt = (x: number, y: number) => {
    const gx = Math.floor(x / grid);
    const gy = Math.floor(y / grid);
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return -1;
    return gy * cols + gx;
  };
  const blocked = (x: number, y: number) => {
    const c = cellAt(x, y);
    return c < 0 || occ[c] === 1;
  };

  const markPoint = (x: number, y: number, r: number) => {
    const r2 = r * r;
    const gx0 = Math.max(0, Math.floor((x - r) / grid));
    const gx1 = Math.min(cols - 1, Math.floor((x + r) / grid));
    const gy0 = Math.max(0, Math.floor((y - r) / grid));
    const gy1 = Math.min(rows - 1, Math.floor((y + r) / grid));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = (gx + 0.5) * grid;
        const cy = (gy + 0.5) * grid;
        const dx = cx - x;
        const dy = cy - y;
        if (dx * dx + dy * dy <= r2) occ[gy * cols + gx] = 1;
      }
    }
  };

  const rand = mulberry32(p.seed ^ 0x9e3779b9);
  const minPts = 4;
  const lines: FlowLine[] = [];

  for (let gy = base * 0.5; gy < h; gy += base) {
    for (let gx = base * 0.5; gx < w; gx += base) {
      const sx = gx + (rand() - 0.5) * base * p.jitter;
      const sy = gy + (rand() - 0.5) * base * p.jitter;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      if (blocked(sx, sy)) continue;

      const back: number[] = [];
      walkJagged(field, w, h, p, sx, sy, -1, snap, blocked, back);
      const fwd: number[] = [];
      walkJagged(field, w, h, p, sx, sy, +1, snap, blocked, fwd);

      const pts: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2)
        pts.push(back[i], back[i + 1]);
      pts.push(sx, sy);
      for (let i = 0; i < fwd.length; i += 2) pts.push(fwd[i], fwd[i + 1]);

      if (pts.length < minPts * 2) continue;

      const stampR = base * 0.82;
      for (let i = 0; i < pts.length; i += 2) {
        markPoint(pts[i], pts[i + 1], stampR);
      }

      let wdt = p.lineWidth;
      wdt *= 1 + (rand() - 0.5) * 2 * p.widthVar;
      lines.push({ pts, w: Math.max(0.15, wdt), order: 0, arrow: false });
    }
  }

  assignOrder(lines);
  return lines;
}

export function computeJagged(
  w: number,
  h: number,
  p: JaggedParams,
): FlowLine[] {
  const field = buildRidgeField(w, h, p);
  return traceJaggedRidges(field, w, h, p);
}

/** Each facet is stroked on its own so corners stay crisp lines, not filled joins. */
export function drawJagged(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  lines: FlowLine[],
  _p: JaggedParams,
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
  ctx.lineCap = fade ? "round" : "butt";
  ctx.lineJoin = fade ? "round" : "miter";

  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;

  const SPREAD = 0.65;
  const denom = 1 - SPREAD;

  let lineId = 0;
  for (const line of lines) {
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
    const local =
      progress >= 1
        ? 1
        : denom <= 0
          ? progress > line.order
            ? 1
            : 0
          : (progress - line.order * SPREAD) / denom;
    if (local <= 0) continue;
    const t = local >= 1 ? 1 : local;

    const pts = line.pts;
    const segs = pts.length / 2 - 1;
    if (segs < 1) continue;
    const grown = segs * t;
    const full = Math.floor(grown);
    const frac = grown - full;

    const draw: number[] = [pts[0], pts[1]];
    const last = Math.min(full, segs);
    for (let i = 1; i <= last; i++) draw.push(pts[i * 2], pts[i * 2 + 1]);
    if (frac > 0 && full < segs) {
      const ax = pts[full * 2];
      const ay = pts[full * 2 + 1];
      const bx = pts[(full + 1) * 2];
      const by = pts[(full + 1) * 2 + 1];
      draw.push(ax + (bx - ax) * frac, ay + (by - ay) * frac);
    }
    strokeFaded(ctx, draw, line.w, fadeOpts);
  }
}

export function buildJaggedSVG(
  w: number,
  h: number,
  lines: FlowLine[],
  _p: JaggedParams,
  ink: string,
  background: string,
  fade = false,
  fadeSeed = 1,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
    `<g fill="none" stroke="${ink}" stroke-linecap="${fade ? "round" : "butt"}" stroke-linejoin="${fade ? "round" : "miter"}" stroke-miterlimit="6">`,
  ];
  let lineId = 0;
  for (const line of lines) {
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
    parts.push(svgFadedPaths(line.pts, line.w, fadeOpts, f));
  }
  parts.push(`</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export function randomJaggedParams(prev: JaggedParams): JaggedParams {
  const rand = mulberry32((prev.seed * 2654435761) >>> 0);
  const pick = (min: number, max: number, step: number) => {
    const steps = Math.floor((max - min) / step);
    return min + Math.round(rand() * steps) * step;
  };
  return {
    ...prev,
    seed: Math.floor(rand() * 99999) + 1,
    fieldScale: pick(3.5, 6.5, 0.5),
    swirl: pick(0.45, 0.85, 0.02),
    turbulence: pick(2, 4, 1),
    spiral: pick(0.06, 0.22, 0.02),
    jag: pick(38, 60, 1),
    stepLen: pick(6, 10, 0.5),
    spacing: pick(4, 7, 1),
  };
}
