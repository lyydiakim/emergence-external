import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";

// Generative canvas size — matches the 2D tree tool so cards feel consistent.
export const FW = 680;
export const FH = 580;
export const INK = "#00280F";
export const BG = "#F8FFEE";

const TAU = Math.PI * 2;

export type FlowMode = "lines" | "arrows";

/**
 * One field of flow. The same parameters drive the generative noise field and
 * the image-derived field; image-only keys (influence/threshold/contrast/invert)
 * are simply ignored when there is no source image.
 */
export interface FlowParams {
  seed: number;
  fieldScale: number; // swirl size — cells across the long edge (fewer = bigger sweeps)
  swirl: number; // how far the field curves away from the drift direction
  turbulence: number; // fbm octaves — layered detail in the field
  drift: number; // base flow direction in degrees
  spacing: number; // separation between neighbouring streamlines, in px
  stepLen: number; // integration step length, in px
  maxLen: number; // max steps per streamline
  lineWidth: number; // base stroke width
  widthVar: number; // 0..1 random variation in each line's stroke width
  jitter: number; // 0..1 scatter of seed points off their grid
  arrowSize: number; // arrowhead size (arrows mode only)
  // emergence mode — a single point the ridges fan out from
  emergeX: number; // 0..1 horizontal position of the emergence point
  emergeY: number; // 0..1 vertical position of the emergence point
  emergeReach: number; // how far the fan spreads before thinning out, ×long edge
  emergeSpread: number; // 0..1 how much the fan is squeezed downward vs full circle
  emergeRoots: number; // number of primary root strokes fanning from the crown
  emergeNest: number; // nested lines filled into each gap between adjacent roots
  emergeFragments: number; // short broken ridge fragments scattered between lines
  // image mode
  imageInfluence: number; // 0..1 how strongly the image steers the field
  threshold: number; // 0..1 skip seeds in areas lighter than this
  contrast: number; // tone curve exponent
}

export const DEFAULT_FLOW: FlowParams = {
  seed: 60132,
  fieldScale: 4,
  swirl: 1,
  turbulence: 2,
  drift: -30,
  spacing: 8,
  stepLen: 6,
  maxLen: 400,
  lineWidth: 1,
  widthVar: 0.1,
  jitter: 1,
  arrowSize: 4,
  emergeX: 0.5,
  emergeY: 0,
  emergeReach: 2,
  emergeSpread: 0.9,
  emergeRoots: 10,
  emergeNest: 2,
  emergeFragments: 24,
  imageInfluence: 0.85,
  threshold: 0.04,
  contrast: 1.1,
};

/**
 * Look params that make Emerge mode read like the hand-drawn root sketch:
 * sparse, distinct strokes radiating from the crown with shorter nested arcs
 * tucked between them, rather than the dense all-over texture Flow mode wants.
 * Applied when the Emerge toggle is switched on; the prior Flow params are
 * restored on switching back. Seed and colours are intentionally left alone.
 */
export const EMERGE_PRESET: Partial<FlowParams> = {
  fieldScale: 4,
  swirl: 0.45,
  turbulence: 2,
  spacing: 30,
  stepLen: 2,
  maxLen: 400,
  lineWidth: 0.5,
  widthVar: 0,
  jitter: 0.12,
  emergeX: 0.5,
  emergeY: 0,
  emergeReach: 2,
  emergeSpread: 0.9,
  emergeRoots: 10,
  emergeNest: 2,
  emergeFragments: 24,
};

export const FLOW_RANGES: Record<
  Exclude<keyof FlowParams, never>,
  [number, number, number]
> = {
  seed: [1, 99999, 1],
  fieldScale: [2, 16, 0.5],
  swirl: [0, 3, 0.05],
  turbulence: [1, 4, 1],
  drift: [-180, 180, 1],
  spacing: [4, 30, 1],
  stepLen: [2, 10, 0.5],
  maxLen: [40, 400, 10],
  lineWidth: [0.3, 3, 0.1],
  widthVar: [0, 1, 0.05],
  jitter: [0, 1, 0.02],
  arrowSize: [2, 10, 0.5],
  emergeX: [0, 1, 0.01],
  emergeY: [-0.3, 1, 0.01],
  emergeReach: [0.3, 2, 0.05],
  emergeSpread: [0, 1, 0.05],
  emergeRoots: [3, 40, 1],
  emergeNest: [0, 8, 1],
  emergeFragments: [0, 80, 1],
  imageInfluence: [0, 1, 0.02],
  threshold: [0, 0.6, 0.01],
  contrast: [0.3, 3, 0.05],
};

export const FLOW_LABELS: Record<keyof FlowParams, string> = {
  seed: "Seed",
  fieldScale: "Field Scale",
  swirl: "Swirl",
  turbulence: "Turbulence",
  drift: "Drift",
  spacing: "Density",
  stepLen: "Step",
  maxLen: "Length",
  lineWidth: "Line Weight",
  widthVar: "Width Var",
  jitter: "Scatter",
  arrowSize: "Arrow Size",
  emergeX: "Emerge X",
  emergeY: "Emerge Y",
  emergeReach: "Reach",
  emergeSpread: "Spread",
  emergeRoots: "Roots",
  emergeNest: "Nested",
  emergeFragments: "Fragments",
  imageInfluence: "Image Steer",
  threshold: "Threshold",
  contrast: "Contrast",
};

export const FLOW_HINTS: Record<keyof FlowParams, string> = {
  seed: "Random starting value. Same seed always produces the same field.",
  fieldScale:
    "Size of the swirls. Lower values make big sweeping currents; higher values make tight eddies.",
  swirl: "How far lines curve away from the base drift direction. Zero is nearly straight.",
  turbulence: "Layers of detail folded into the field. More octaves make it churn.",
  drift: "Base direction the whole field flows toward, in degrees.",
  spacing: "Gap kept between neighbouring lines. Smaller packs the field denser.",
  stepLen: "How far each line advances per step. Smaller is smoother but slower.",
  maxLen: "Longest a single line can run before it stops.",
  lineWidth: "Base thickness of the strokes.",
  widthVar: "Random variation in each line's thickness — higher mixes hairlines and bold strokes like an engraving.",
  jitter: "Random scatter of each line's starting point off the grid.",
  arrowSize: "Size of the arrowheads in arrows mode.",
  emergeX: "Horizontal position of the single point the ridges fan out from, left to right.",
  emergeY: "Vertical position of the crown the ridges fan down from. 0 sits it at the top edge; negative pushes it above the frame so only the widening fan shows.",
  emergeReach: "How far down the fan reaches, relative to the crown-to-bottom distance. 1 fades right at the bottom edge; higher stays dense all the way down; lower keeps a shorter clump.",
  emergeSpread: "How wide the fan opens. Low is a narrow downward spray; high spreads the roots out horizontally into a broad umbrella that reaches the side edges.",
  emergeRoots: "Number of primary root strokes fanning out from the crown. These are the bold structural lines the nested fill echoes.",
  emergeNest: "How many nested lines are repeated in each gap between two roots, each echoing the roots' curve. Zero draws roots only.",
  emergeFragments: "Short broken ridge fragments scattered in the gaps between the continuous lines — the fingerprint's disconnected strokes. Zero keeps every line whole.",
  imageInfluence:
    "How strongly the image's edges steer the flow. Zero ignores the image; one follows its contours.",
  threshold: "Brightness cutoff. Raise it to drop lines out of the lightest areas.",
  contrast: "Tone curve. Above 1 concentrates lines in the shadows.",
};

// The only sliders exposed in the UI. Every other param stays at its default.
// "density" is line spacing (lower packs the field denser); "line weight" is
// the stroke width.
export const SLIDER_KEYS_SIMPLE: (keyof FlowParams)[] = [
  "seed",
  "spacing",
  "lineWidth",
];

export const SLIDER_KEYS_FIELD: (keyof FlowParams)[] = [
  "seed",
  "fieldScale",
  "swirl",
  "turbulence",
  "drift",
];

export const SLIDER_KEYS_LINE: (keyof FlowParams)[] = [
  "spacing",
  "stepLen",
  "maxLen",
  "lineWidth",
  "widthVar",
  "jitter",
];

// emergeX is intentionally omitted — the crown is always horizontally centred.
export const SLIDER_KEYS_EMERGE: (keyof FlowParams)[] = [
  "emergeY",
  "emergeReach",
  "emergeSpread",
  "emergeRoots",
  "emergeNest",
  "emergeFragments",
];

export const SLIDER_KEYS_IMAGE: (keyof FlowParams)[] = [
  "imageInfluence",
  "threshold",
  "contrast",
];

export interface FlowLine {
  pts: number[]; // flat [x0,y0,x1,y1,...]
  w: number; // stroke width
  order: number; // 0..1 reveal order for growth animation
  arrow: boolean; // draw an arrowhead at the end
}

// ---- value noise ----------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2654435761);
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

export type Field = (x: number, y: number) => number;

/** A smooth, swirling angle field driven purely by noise. */
export function buildNoiseField(w: number, h: number, p: FlowParams): Field {
  const cell = Math.max(w, h) / p.fieldScale;
  const drift = (p.drift * Math.PI) / 180;
  const octaves = Math.max(1, Math.round(p.turbulence));
  return (x, y) => {
    const n = fbm(x / cell, y / cell, p.seed, octaves);
    return drift + (n - 0.5) * TAU * p.swirl;
  };
}

/**
 * A field shaped like the root brush: a single emergence point at the top, with
 * every ridge spilling DOWNWARD from it into a widening fan. Right at the point
 * the heading is purely radial (straight out from the origin) so all the ridges
 * share one clean crown; as they travel away, a gravity pull ramps in and bends
 * them downward, so the burst folds into a fountain/root silhouette rather than
 * a full circle. `emergeSpread` sets how hard gravity pulls — low is a narrow
 * vertical spray, high is a broad fan. The fbm swirl still rotates each heading
 * so the strands read as fingerprint ridges, not straight rays.
 */
export function buildEmergenceField(w: number, h: number, p: FlowParams): Field {
  const cell = Math.max(w, h) / p.fieldScale;
  const octaves = Math.max(1, Math.round(p.turbulence));
  const ex = p.emergeX * w;
  const ey = p.emergeY * h;
  // Distance over which gravity ramps from 0 (radial crown) to full (downward
  // fan) — a fraction of the fan's reach so the crown stays small and tidy.
  const gravR = Math.max(1, p.emergeReach * Math.max(w, h) * 0.32);
  // Gentle downward lean only. Roots are already seeded within a downward cone,
  // so they don't need to be forced straight down — a light pull keeps them
  // descending while they radiate OUTWARD, so the tips splay apart and the fan
  // is widest at the bottom rather than collapsing back to a point. A narrow
  // spread leans a little harder; a wide spread stays nearly radial.
  const gravity = (1 - p.emergeSpread) * 0.35;
  return (x, y) => {
    const dx = x - ex;
    const dy = y - ey;
    const radial = Math.atan2(dy, dx);
    const vx = Math.cos(radial);
    let vy = Math.sin(radial);
    // Ramp gravity in with distance (smoothstep) so headings are radial at the
    // crown and increasingly downward-biased farther out.
    const d = Math.min(1, Math.hypot(dx, dy) / gravR);
    const ramp = d * d * (3 - 2 * d);
    vy += gravity * ramp;
    const base = Math.atan2(vy, vx);
    // Swirl also ramps in with distance: the crown stays a clean radial burst
    // and the ridges only start meandering once clear of it — no knotted whorl.
    const n = fbm(x / cell, y / cell, p.seed, octaves);
    return base + (n - 0.5) * TAU * p.swirl * ramp;
  };
}

/**
 * Density weight for emergence mode, fed to the streamline tracer as a "tone".
 * It carves the ink into a downward-opening WEDGE rooted at the emergence point
 * — the root-brush silhouette: a tidy crown up top widening into a fan below,
 * with whitespace outside it. The vertical falloff is keyed to the distance
 * from the crown down to the BOTTOM of the canvas, so the fan extends to the
 * bottom of whatever dimensions are set; `reach` scales that (1 = fade right at
 * the bottom edge, higher stays dense all the way down). The cone half-angle
 * fades the sides, and `spread` opens or closes it.
 */
export function buildEmergenceTone(
  w: number,
  h: number,
  p: FlowParams,
): (x: number, y: number) => number {
  const ex = p.emergeX * w;
  const ey = p.emergeY * h;
  // Vertical span from the crown to the bottom edge — the falloff tracks the
  // actual canvas height rather than a fixed radius, so the fan always fills
  // down to the bottom of the defined dimensions.
  const vspan = Math.max(1, (h - ey) * p.emergeReach);
  // Half-angle of the downward fan, measured off straight-down. Widens with
  // spread — a narrow spray at 0, a broad fan near the top of the range.
  const coneHalf = (0.5 + p.emergeSpread * 0.5) * (Math.PI / 2);
  const smooth = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
  // A few low-frequency noise lobes across the fan jitter where the density
  // crosses zero, so the perimeter dissolves into ragged, staggered line-ends
  // — a natural trail-off — rather than terminating along a clean edge.
  const ncell = Math.max(24, vspan * 0.28);
  const EDGE = 0.28; // how far the noise pushes the fade depth up/down
  const ANG_EDGE = 0.28; // same, for the cone's angular edge
  return (x, y) => {
    const dx = x - ex;
    const dy = y - ey;
    if (dy <= 0) return 0; // everything lives below the crown
    const nz = fbm(x / ncell, y / ncell, p.seed + 21, 2) - 0.5; // -0.5..0.5
    // Vertical falloff — dense at the crown, thinning toward the bottom edge,
    // with the fade depth nudged per-area by the noise so it feathers.
    const rd = dy / vspan + nz * EDGE;
    const rf = smooth(1 - rd);
    if (rf <= 0) return 0;
    // Angular falloff — full inside the cone, dissolving toward its edges, the
    // edge angle likewise jittered so the sides feather instead of ruling off.
    const ang = Math.atan2(Math.abs(dx), dy); // 0 straight down → π/2 sideways
    const ar = ang / coneHalf + nz * ANG_EDGE;
    const af = smooth(1 - ar);
    if (af <= 0) return 0;
    return rf * (0.5 + 0.5 * af);
  };
}

// ---- emergence roots + nested fill -----------------------------------------

/** Trace one root stroke through the field from a start point until it leaves
 *  the fan (tone below threshold), the frame, or the length budget. */
function walkRoot(
  field: Field,
  tone: (x: number, y: number) => number,
  sx: number,
  sy: number,
  w: number,
  h: number,
  p: FlowParams,
): number[] {
  const pts: number[] = [sx, sy];
  let x = sx;
  let y = sy;
  for (let i = 0; i < p.maxLen; i++) {
    const a1 = field(x, y);
    const mx = x + Math.cos(a1) * p.stepLen * 0.5;
    const my = y + Math.sin(a1) * p.stepLen * 0.5;
    const a2 = field(mx, my);
    x += Math.cos(a2) * p.stepLen;
    y += Math.sin(a2) * p.stepLen;
    if (x < 0 || y < 0 || x >= w || y >= h) break;
    if (tone(x, y) < p.threshold) break;
    pts.push(x, y);
  }
  return pts;
}

/** Resample a flat polyline to exactly `k` points spread evenly along its arc
 *  length, so two roots of different lengths can be morphed point-for-point. */
function resamplePoly(pts: number[], k: number): number[] {
  const n = pts.length / 2;
  if (n < 2) return pts.slice();
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dx = pts[i * 2] - pts[(i - 1) * 2];
    const dy = pts[i * 2 + 1] - pts[(i - 1) * 2 + 1];
    cum[i] = cum[i - 1] + Math.hypot(dx, dy);
  }
  const total = cum[n - 1];
  const out: number[] = new Array(k * 2);
  let seg = 0;
  for (let j = 0; j < k; j++) {
    const target = (j / (k - 1)) * total;
    while (seg < n - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const t = (target - cum[seg]) / segLen;
    out[j * 2] = pts[seg * 2] + (pts[(seg + 1) * 2] - pts[seg * 2]) * t;
    out[j * 2 + 1] =
      pts[seg * 2 + 1] + (pts[(seg + 1) * 2 + 1] - pts[seg * 2 + 1]) * t;
  }
  return out;
}

/**
 * Emerge mode geometry, built to read like the hand-drawn root sketch: a set of
 * primary ROOT strokes fan out from the single crown, and the gap between each
 * neighbouring pair is filled with NESTED lines that morph from one root's curve
 * to the next. Because neighbouring roots share the crown and diverge, the
 * in-between lines nest like contour lines — and where one root runs shorter
 * than its neighbour, the nested lines fold into the little nested loops the
 * sketch shows. Roots carry a touch more weight than their nested fill so the
 * structure stays legible.
 */
export function buildEmergenceRoots(
  w: number,
  h: number,
  p: FlowParams,
): FlowLine[] {
  const field = buildEmergenceField(w, h, p);
  const tone = buildEmergenceTone(w, h, p);
  const ex = p.emergeX * w;
  const ey = p.emergeY * h;
  const coneHalf = (0.5 + p.emergeSpread * 0.5) * (Math.PI / 2);
  const R = Math.max(2, Math.round(p.emergeRoots));
  const K = 96; // resample resolution for morphing
  const rand = mulberry32((p.seed ^ 0x27d4eb2f) >>> 0);

  // Trace the primary roots, evenly fanned across the downward cone. Each starts
  // just off the crown so they emanate from one tight point without piling into
  // a blot exactly on it.
  const startR = 7;
  const roots: number[][] = [];
  for (let i = 0; i < R; i++) {
    const frac = R === 1 ? 0.5 : i / (R - 1);
    const off = (frac * 2 - 1) * coneHalf; // -coneHalf..coneHalf off straight-down
    const a0 = Math.PI / 2 + off;
    const sx = ex + Math.cos(a0) * startR;
    const sy = ey + Math.sin(a0) * startR;
    const raw = walkRoot(field, tone, sx, sy, w, h, p);
    if (raw.length >= 6) roots.push(resamplePoly(raw, K));
  }
  if (roots.length === 0) return [];

  const lines: FlowLine[] = [];
  const nest = Math.max(0, Math.round(p.emergeNest));
  const frag = Math.max(0, Math.round(p.emergeFragments));
  // Fragments-per-gap scales UP as the structure thins out: fewer roots (wider
  // gaps) and fewer nested lines (more empty space) both call for more broken
  // bits to keep the fan filled. Normalised so the default (roots 10, nested 2)
  // leaves the slider value untouched; sparser setups multiply it.
  const rootFactor = 10 / Math.max(4, R);
  const nestFactor = 3 / (nest + 1);
  const fragPerGap = Math.min(600, Math.round(frag * rootFactor * nestFactor));
  const jitterW = (base: number) =>
    Math.max(0.15, base * (1 + (rand() - 0.5) * 2 * p.widthVar));

  // A morph curve between two roots, optionally only the arc span [k0, k0+kn).
  // Full spans are the connected nested lines; short spans are broken fragments.
  const morph = (A: number[], B: number[], f: number, k0 = 0, kn = K) => {
    const pts: number[] = new Array(kn * 2);
    for (let s = 0; s < kn; s++) {
      const kk = k0 + s;
      pts[s * 2] = A[kk * 2] * (1 - f) + B[kk * 2] * f;
      pts[s * 2 + 1] = A[kk * 2 + 1] * (1 - f) + B[kk * 2 + 1] * f;
    }
    return pts;
  };

  for (let i = 0; i < roots.length; i++) {
    lines.push({ pts: roots[i], w: jitterW(p.lineWidth * 1.25), order: 0, arrow: false });
    if (i + 1 < roots.length) {
      const A = roots[i];
      const B = roots[i + 1];
      // Connected nested lines echoing the two roots across the gap.
      for (let j = 1; j <= nest; j++) {
        lines.push({
          pts: morph(A, B, j / (nest + 1)),
          w: jitterW(p.lineWidth * 0.85),
          order: 0,
          arrow: false,
        });
      }
      // Fingerprint essence: short, disconnected ridge fragments dropped between
      // the connected lines — a random slice of a morph curve at a random depth,
      // following the same flow so they read as broken ridges, not noise.
      for (let j = 0; j < fragPerGap; j++) {
        const f = rand(); // position across the gap
        const kn = Math.max(6, Math.round(K * (0.1 + rand() * 0.24))); // short arc
        const k0 = Math.floor(rand() * (K - kn));
        lines.push({
          pts: morph(A, B, f, k0, kn),
          w: jitterW(p.lineWidth * 0.7),
          order: 0,
          arrow: false,
        });
      }
    }
  }

  assignOrder(lines);
  return lines;
}

// ---- image sampling --------------------------------------------------------

export interface LumBuffer {
  lum: Float32Array;
  width: number;
  height: number;
}

/** Cover-fit the image into a luminance buffer at the target size. */
export function sampleLuminance(
  image: HTMLImageElement,
  width: number,
  height: number,
): LumBuffer | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);

  const { data } = ctx.getImageData(0, 0, width, height);
  const n = width * height;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
  }
  return { lum, width, height };
}

function lumAt(buf: LumBuffer, x: number, y: number): number {
  const cx = Math.min(buf.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(buf.height - 1, Math.max(0, Math.round(y)));
  return buf.lum[cy * buf.width + cx];
}

/** Darkness 0..1 after the contrast curve — the subject weight at a point. */
export function toneAt(
  buf: LumBuffer,
  x: number,
  y: number,
  p: { contrast: number },
): number {
  const d = Math.pow(1 - lumAt(buf, x, y), p.contrast);
  return d;
}

/**
 * Field that follows the image's structure: lines run along iso-tone contours
 * (perpendicular to the brightness gradient), blended with the noise field in
 * flat areas so empty regions still flow rather than freeze.
 */
export function buildImageField(buf: LumBuffer, p: FlowParams): Field {
  const noise = buildNoiseField(buf.width, buf.height, p);
  const drift = (p.drift * Math.PI) / 180;
  return (x, y) => {
    // Sobel gradient over a 3x3 neighbourhood — far cleaner contours than a
    // single-pixel difference, so edges track the photo's real structure
    // instead of pixel noise.
    const tl = lumAt(buf, x - 1.5, y - 1.5);
    const tc = lumAt(buf, x, y - 1.5);
    const tr = lumAt(buf, x + 1.5, y - 1.5);
    const ml = lumAt(buf, x - 1.5, y);
    const mr = lumAt(buf, x + 1.5, y);
    const bl = lumAt(buf, x - 1.5, y + 1.5);
    const bc = lumAt(buf, x, y + 1.5);
    const br = lumAt(buf, x + 1.5, y + 1.5);
    const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
    const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
    const mag = Math.hypot(gx, gy);
    const contour = Math.atan2(gy, gx) + Math.PI / 2;
    // Steer toward the contour as soon as there's any real edge; the ramp is
    // sharp so even soft tonal transitions get followed.
    const wgt = Math.min(1, mag * 3.5) * p.imageInfluence;
    // In flat areas hatch along the drift direction (with a little swirl) rather
    // than swirling noise — shadow planes then read as shading, not abstract flow.
    const flat = drift + (noise(x, y) - 0.5) * Math.PI * p.swirl * 0.5;
    // Interpolate as vectors so the blend never snaps across the angle wrap.
    const vx = Math.cos(contour) * wgt + Math.cos(flat) * (1 - wgt);
    const vy = Math.sin(contour) * wgt + Math.sin(flat) * (1 - wgt);
    return Math.atan2(vy, vx);
  };
}

// ---- streamline tracing ----------------------------------------------------

/**
 * Trace evenly-spaced streamlines through the field. An occupancy grid keeps
 * neighbouring lines roughly `spacing` apart, so the field reads as clean,
 * non-crossing linework rather than a tangle.
 */
export function traceStreamlines(
  field: Field,
  w: number,
  h: number,
  p: FlowParams,
  tone?: (x: number, y: number) => number,
): FlowLine[] {
  const base = Math.max(2, p.spacing);
  // With an image, tone compresses the spacing: dark areas pack dense linework
  // while light areas stay open, so the photo's value structure — and therefore
  // the subject — becomes legible. Without an image the spacing is uniform.
  const minSep = tone ? Math.max(1.6, base * 0.3) : base;
  const grid = Math.max(1, minSep * 0.5);
  const cols = Math.ceil(w / grid) + 1;
  const rows = Math.ceil(h / grid) + 1;
  const occ = new Uint8Array(cols * rows);

  // Desired centre-to-centre gap at a point: minSep in the darkest areas,
  // widening to `base` in the lightest.
  const localSep = (x: number, y: number) => {
    if (!tone) return base;
    const t = tone(x, y);
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return base - (base - minSep) * c;
  };

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

  // Stamp the exclusion disk around an accepted line point. Marking the full
  // local spacing keeps the neighbouring line roughly `localSep` away.
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

  const rand = mulberry32(p.seed ^ 0x5f3759df);
  const minPts = 4;

  // Walk against the occupancy of *prior* lines only (this line is stamped after
  // it completes), so a line never blocks itself mid-trace.
  const walk = (sx: number, sy: number, dir: number, into: number[]) => {
    let x = sx;
    let y = sy;
    for (let i = 0; i < p.maxLen; i++) {
      const a1 = field(x, y);
      const mx = x + Math.cos(a1) * p.stepLen * 0.5 * dir;
      const my = y + Math.sin(a1) * p.stepLen * 0.5 * dir;
      const a2 = field(mx, my);
      x += Math.cos(a2) * p.stepLen * dir;
      y += Math.sin(a2) * p.stepLen * dir;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (blocked(x, y)) break;
      // Stop at the subject's edge so lines don't trail off into light areas —
      // this keeps the silhouette crisp instead of streaming into the background.
      if (tone && tone(x, y) < p.threshold) break;
      into.push(x, y);
    }
  };

  const lines: FlowLine[] = [];
  // Seed finely enough to fill the densest (darkest) regions; light-area and
  // already-occupied candidates are rejected cheaply below.
  const seedStep = tone ? Math.max(2, minSep) : base;

  for (let gy = seedStep * 0.5; gy < h; gy += seedStep) {
    for (let gx = seedStep * 0.5; gx < w; gx += seedStep) {
      const sx = gx + (rand() - 0.5) * seedStep * p.jitter;
      const sy = gy + (rand() - 0.5) * seedStep * p.jitter;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      if (blocked(sx, sy)) continue;
      if (tone && tone(sx, sy) < p.threshold) continue;

      const back: number[] = [];
      walk(sx, sy, -1, back);
      const fwd: number[] = [];
      walk(sx, sy, +1, fwd);

      // Stitch backward (reversed) + seed + forward into one polyline.
      const pts: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2) pts.push(back[i], back[i + 1]);
      pts.push(sx, sy);
      for (let i = 0; i < fwd.length; i += 2) pts.push(fwd[i], fwd[i + 1]);

      if (pts.length < minPts * 2) continue;

      for (let i = 0; i < pts.length; i += 2) {
        markPoint(pts[i], pts[i + 1], localSep(pts[i], pts[i + 1]) * 0.9);
      }

      let wdt = tone ? p.lineWidth * (0.5 + tone(sx, sy) * 0.9) : p.lineWidth;
      // Per-line thickness jitter — mixes hairlines and bold strokes.
      wdt *= 1 + (rand() - 0.5) * 2 * p.widthVar;
      lines.push({ pts, w: Math.max(0.15, wdt), order: 0, arrow: false });
    }
  }

  assignOrder(lines);
  return lines;
}

/** A grid of short arrows sampling the field — the wind / current-map look. */
export function buildArrows(
  field: Field,
  w: number,
  h: number,
  p: FlowParams,
  tone?: (x: number, y: number) => number,
): FlowLine[] {
  const step = Math.max(8, p.spacing * 1.8);
  const len = step * 0.62;
  const lines: FlowLine[] = [];
  for (let y = step * 0.5; y < h; y += step) {
    for (let x = step * 0.5; x < w; x += step) {
      if (tone && tone(x, y) < p.threshold) continue;
      const a = field(x, y);
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      const wdt = tone ? p.lineWidth * (0.5 + tone(x, y)) : p.lineWidth;
      lines.push({ pts: [x, y, ex, ey], w: wdt, order: 0, arrow: true });
    }
  }
  assignOrder(lines);
  return lines;
}

function assignOrder(lines: FlowLine[]) {
  const n = Math.max(1, lines.length - 1);
  lines.forEach((l, i) => (l.order = i / n));
}

// ---- rendering -------------------------------------------------------------

function arrowHead(
  pts: number[],
  size: number,
): [number, number, number, number] | null {
  const n = pts.length;
  if (n < 4) return null;
  const x2 = pts[n - 2];
  const y2 = pts[n - 1];
  const x1 = pts[n - 4];
  const y1 = pts[n - 3];
  const a = Math.atan2(y2 - y1, x2 - x1);
  return [
    x2 - Math.cos(a - 0.4) * size,
    y2 - Math.sin(a - 0.4) * size,
    x2 - Math.cos(a + 0.4) * size,
    y2 - Math.sin(a + 0.4) * size,
  ];
}

export function drawFlow(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  lines: FlowLine[],
  p: FlowParams,
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

  // Fraction of the timeline spent staggering when lines *start* growing, so
  // the field reads as branches extending across the canvas rather than whole
  // lines popping in. The remainder is each line's own draw-out time.
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
    // Local 0..1 progress for this line: starts at line.order * SPREAD, then
    // extends point-by-point until fully drawn.
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

    // Collect the points grown so far, then stroke with dropout + soft fade.
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

    // Cap the arrowhead once the line has fully grown — only if the tip remains.
    if (line.arrow && t >= 1) {
      const ex = pts[pts.length - 2];
      const ey = pts[pts.length - 1];
      if (!fieldFade || fieldFade.keep(id, ex, ey)) {
        const tipW = fieldFade ? fieldFade.width(id, ex, ey) : 1;
        const tipA = fieldFade ? fieldFade.alpha(id, ex, ey) : 1;
        const head = arrowHead(pts, p.arrowSize * tipW);
        if (head) {
          const prev = ctx.globalAlpha;
          ctx.globalAlpha = prev * tipA;
          ctx.lineWidth = line.w * tipW;
          ctx.beginPath();
          ctx.moveTo(head[0], head[1]);
          ctx.lineTo(ex, ey);
          ctx.lineTo(head[2], head[3]);
          ctx.stroke();
          ctx.globalAlpha = prev;
        }
      }
    }
  }
}

export function buildFlowSVG(
  w: number,
  h: number,
  lines: FlowLine[],
  p: FlowParams,
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
    if (line.arrow) {
      const ex = line.pts[line.pts.length - 2];
      const ey = line.pts[line.pts.length - 1];
      if (!fieldFade || fieldFade.keep(id, ex, ey)) {
        const tipW = fieldFade ? fieldFade.width(id, ex, ey) : 1;
        const tipA = fieldFade ? fieldFade.alpha(id, ex, ey) : 1;
        const head = arrowHead(line.pts, p.arrowSize * tipW);
        if (head) {
          const d = `M${f(head[0])} ${f(head[1])}L${f(ex)} ${f(ey)}L${f(head[2])} ${f(head[3])}`;
          const op =
            tipA >= 0.995 ? "" : ` opacity="${Math.round(tipA * 100) / 100}"`;
          parts.push(
            `<path d="${d}" stroke-width="${f(line.w * tipW)}"${op}/>`,
          );
        }
      }
    }
  }
  parts.push(`</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export function randomFlowParams(prev: FlowParams): FlowParams {
  const rand = mulberry32((prev.seed * 2654435761) >>> 0);
  const pick = (min: number, max: number, step: number) => {
    const steps = Math.floor((max - min) / step);
    return min + Math.round(rand() * steps) * step;
  };
  return {
    ...prev,
    seed: Math.floor(rand() * 99999) + 1,
    fieldScale: pick(2.5, 9, 0.5),
    swirl: pick(0.6, 2.2, 0.05),
    turbulence: pick(1, 4, 1),
    drift: pick(-180, 180, 1),
  };
}
