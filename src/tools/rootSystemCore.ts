import { mulberry32 } from "./specimenTreeCore";
import { sampleLuminance, toneAt, type LumBuffer } from "./flowFieldCore";

// Generative canvas size — portrait, to read as depth/foundation rather than
// the landscape circulation of Vascular.
export const RW = 640;
export const RH = 700;
// Default palette: deep forest linework on a pale ground.
export const INK = "#00280F";
export const BG = "#EBFADC";

/**
 * Root system. A descendant of the Vascular space-colonization engine, inverted
 * to grow DOWNWARD from a fixed bedrock line — the shared foundation everything
 * descends from. Crowns sit on the bedrock datum; each sends a dominant taproot
 * down through the soil, with lateral roots colonizing territory below, and a
 * faint mycelial hair layer threading the negative space. Where Vascular reads
 * as circulation (veins, deltas) flowing across the frame, Root System reads as
 * rootstock anchored to common ground. Optional image input clusters roots in
 * the dark areas of a picture (below the bedrock line).
 */
export interface RootParams {
  seed: number;
  crowns: number; // seed points along the bedrock line
  density: number; // number of attractor points in the soil
  downwardBias: number; // 0..1 gravity pull — deeper taproots vs wider spread
  lateralReach: number; // influence radius — how far a root tip senses attractors
  taprootThickness: number; // stroke width of the main descending taproot
  thickness: number; // base stroke width for lateral roots
  taper: number; // width-vs-subtree exponent (lower = sharper taper)
  coil: number; // 0..1 how much each root end coils into a tendril curl
  endThickness: number; // engineered: ×base width the trace ends fatten to
  stamp: number; // 0..1 organic ink-stamp fatten/smooth pass (0 = off)
  cutout: number; // 0..1 organic cutout break/simplify pass (0 = off)
  hairDensity: number; // 0..1 amount of fine root-hair / mycelial fill
  bedrockOffset: number; // 0..0.4 where the bedrock datum sits from the top
  // image
  threshold: number; // 0..1 ignore areas lighter than this
  contrast: number; // tone curve exponent
}

export const DEFAULT_ROOT: RootParams = {
  seed: 38928,
  crowns: 1,
  density: 1350,
  downwardBias: 0.35,
  lateralReach: 42,
  taprootThickness: 1.5,
  thickness: 0.15,
  // Gentle end shaping and moderate tendril curl.
  taper: 0.14,
  coil: 0.25,
  endThickness: 2.6,
  // Ink treatment values matched against the handoff PSD reference. Locked
  // in (no UI sliders for now) — the treatment always runs at these.
  stamp: 0.34,
  cutout: 0.34,
  // Root Brush's organic mode is clean linework — no mycelial hair layer.
  // (The Health tool keeps its own mycelium via a separate default.)
  hairDensity: 0,
  bedrockOffset: 0,
  threshold: 0.08,
  contrast: 1.2,
};

export const ROOT_RANGES: Record<keyof RootParams, [number, number, number]> = {
  seed: [1, 99999, 1],
  crowns: [1, 8, 1],
  density: [200, 3000, 50],
  downwardBias: [0, 1, 0.01],
  lateralReach: [20, 120, 1],
  taprootThickness: [0.1, 3, 0.01],
  thickness: [0.1, 0.25, 0.01],
  taper: [-0.5, 0.5, 0.01],
  coil: [0, 1, 0.01],
  endThickness: [0.5, 8, 0.1],
  stamp: [0, 0.45, 0.01],
  cutout: [0, 1, 0.01],
  hairDensity: [0, 1, 0.01],
  bedrockOffset: [0, 0.4, 0.01],
  threshold: [0, 0.6, 0.01],
  contrast: [0.3, 3, 0.05],
};

export const ROOT_LABELS: Record<keyof RootParams, string> = {
  seed: "Seed",
  crowns: "Crowns",
  density: "Density",
  downwardBias: "Downward Bias",
  lateralReach: "Lateral Reach",
  taprootThickness: "Main Root",
  thickness: "Line Weight",
  taper: "Taper",
  coil: "Coil",
  endThickness: "End Thickness",
  stamp: "Stamp",
  cutout: "Line Breaks",
  hairDensity: "Mycelium",
  bedrockOffset: "Bedrock",
  threshold: "Threshold",
  contrast: "Contrast",
};

export const ROOT_HINTS: Record<keyof RootParams, string> = {
  seed: "Random starting value. Same seed always grows the same root system.",
  crowns:
    "Number of seed points spaced along the bedrock line, each sending a taproot down. Keep at 1 for a single dominant rootstock.",
  density:
    "How many attractor points the roots grow toward in the soil. More points = finer, busier systems.",
  downwardBias:
    "Gravity pull. High values drive deep, vertical taproots; low values let roots spread sideways into a shallow mat.",
  lateralReach:
    "How far a root tip senses attractors. Larger reach makes longer, straighter runs.",
  taprootThickness:
    "Stroke width of the central descending taproot. Independent of lateral root thickness.",
  thickness:
    "Base stroke width for lateral roots. Branches scale up from here by how much subtree feeds them.",
  taper:
    "Shapes the ends of the roots. Negative wisps them to a fine point; zero keeps a uniform weight; positive swells them into rounded, balled tips.",
  coil:
    "How much each root end coils into a tendril curl. Zero leaves the ends straight; higher winds a tighter, longer spiral.",
  endThickness:
    "Engineered brush: absolute width of the terminal pad at each trace end, independent of the connecting trace — so thin and thick traces get the same-size end.",
  stamp:
    "Organic brush: ink-stamp fatten pass (à la Photoshop's Stamp filter). Spreads and smooths the linework into solid calligraphic ink, fusing fine clusters. Zero switches it off.",
  cutout:
    "Organic brush: cutout pass (à la Photoshop's Cutout filter). Simplifies the stroke contours and pinches thin spots into organic breaks and dashes — never thickens the line. Zero switches it off.",
  hairDensity:
    "Amount of fine root-hair / mycelial threads filling the negative space — the hidden web beneath the structural roots.",
  bedrockOffset:
    "Where the bedrock line sits, measured from the top. Everything grows down from this shared datum.",
  threshold:
    "Brightness cutoff. Raise it to keep roots out of the lightest areas of an image.",
  contrast:
    "Tone curve. Above 1 concentrates roots in the shadows of an image.",
};

// The only sliders exposed in the UI. Every other param stays at its default.
// "line weight" is the base lateral stroke width (`thickness`).
export const SLIDER_KEYS_SIMPLE: (keyof RootParams)[] = [
  "seed",
  "density",
  "thickness",
];

export const SLIDER_KEYS_GROW: (keyof RootParams)[] = [
  "seed",
  "crowns",
  "density",
  "downwardBias",
  "lateralReach",
];

export const SLIDER_KEYS_ROOT: (keyof RootParams)[] = [
  "taprootThickness",
  "thickness",
  "taper",
  "coil",
  "endThickness",
  "hairDensity",
  "bedrockOffset",
];

export const SLIDER_KEYS_IMAGE: (keyof RootParams)[] = [
  "threshold",
  "contrast",
];

export type RootTier = "taproot" | "lateral" | "hair";

// A brush is two coupled decisions: how a growing tip TURNS, and how the
// finished roots are DRAWN.
//   organic    — free turning (the original Root System): roots curve smoothly
//                along the noise field and render as tapered round-capped strokes.
//   engineered — turns snap to a 45° lattice (PCB routing) and roots render as
//                uniform-width traces — technical, almost circuitry rather than
//                rootstock.
export type RootBrush = "organic" | "engineered";

// Lattice each brush snaps growth headings to. `q` is the angular quantum;
// `offset` rotates the lattice so straight-down (+y, π/2) stays on it — that
// keeps the dominant taproot vertical and only the breaks land on the grid.
const BRUSH_SNAP: Record<RootBrush, { q: number; offset: number } | null> = {
  organic: null,
  engineered: { q: Math.PI / 4, offset: 0 },
};

function snapAngle(a: number, s: { q: number; offset: number }) {
  return Math.round((a - s.offset) / s.q) * s.q + s.offset;
}

export interface RootEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  order: number; // 0..1 when this segment starts growing
  orderEnd: number; // 0..1 when this segment finishes
  tier: RootTier;
  soft?: boolean; // render with round cap/join (engineered terminal swell) so the
  // overlapping sub-segments merge seamlessly across corners and width steps
}

export interface RootResult {
  edges: RootEdge[]; // structural roots (taproot + lateral)
  hairs: RootEdge[]; // fine mycelial threads
  bedrockY: number;
}

// ---- coherent noise --------------------------------------------------------
// Smooth value-noise used to (a) steer growth so roots curve along a continuous
// field instead of kinking, and (b) cluster attractors so density varies.

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

function fbm(x: number, y: number, seed: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 911);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---- attractor seeding -----------------------------------------------------

interface Attractors {
  x: number[];
  y: number[];
}

// Soil attractors live BELOW the bedrock line. A vertical weight biases points
// deeper as downwardBias rises, so the system reaches down rather than spreads.
function soilAttractors(
  w: number,
  h: number,
  bedrockY: number,
  count: number,
  rng: () => number,
  p: RootParams,
): Attractors {
  const m = 24;
  const x: number[] = [];
  const y: number[] = [];
  const scale = 0.012;
  const top = bedrockY + 6;
  const span = Math.max(1, h - m - top);
  let tries = 0;
  const maxTries = count * 50;
  while (x.length < count && tries < maxTries) {
    tries++;
    const sx = m + rng() * (w - 2 * m);
    // Vertical placement: a power curve pushes points deeper as bias rises.
    const t = rng();
    const depthPow = 1 + p.downwardBias * 1.6; // >1 skews toward the bottom
    const sy = top + Math.pow(t, 1 / depthPow) * span;
    const d = fbm(sx * scale, sy * scale, p.seed);
    if (rng() < 0.15 + 0.85 * d * d) {
      x.push(sx);
      y.push(sy);
    }
  }
  return { x, y };
}

function imageAttractors(
  buf: LumBuffer,
  bedrockY: number,
  p: RootParams,
  count: number,
  rng: () => number,
): Attractors {
  const x: number[] = [];
  const y: number[] = [];
  let tries = 0;
  const maxTries = count * 80;
  while (x.length < count && tries < maxTries) {
    tries++;
    const sx = rng() * buf.width;
    const sy = rng() * buf.height;
    if (sy < bedrockY) continue; // only the soil below the bedrock line
    const d = toneAt(buf, sx, sy, p);
    if (d < p.threshold) continue;
    if (rng() < d) {
      x.push(sx);
      y.push(sy);
    }
  }
  return { x, y };
}

// ---- growth ----------------------------------------------------------------

export function growRoots(
  w: number,
  h: number,
  p: RootParams,
  buf?: LumBuffer | null,
  brush: RootBrush = "organic",
): RootResult {
  const rng = mulberry32(p.seed);
  const snap = BRUSH_SNAP[brush];
  const hasImage = !!buf;
  const bedrockY = Math.round((hasImage ? buf!.height : h) * p.bedrockOffset);
  const count = Math.max(50, Math.round(p.density));
  const attr = buf
    ? imageAttractors(buf, bedrockY, p, count, rng)
    : soilAttractors(w, h, bedrockY, count, rng, p);
  if (attr.x.length === 0) return { edges: [], hairs: [], bedrockY };

  const di = p.lateralReach;
  const dk = Math.min(9, di * 0.9);
  const D = 6; // growth step length
  const maxIter = 1400;
  const maxNodes = 26000;

  const TAU = Math.PI * 2;
  // Downward flow bias — the gravity lean of colonized laterals. Tracing an
  // image keeps a softer lean so the picture still reads.
  const flowBias = hasImage ? 0.1 : 0.15 + p.downwardBias * 0.5;
  const noiseScale = 0.006;
  const noiseW = hasImage ? 0 : 0.22;
  const maxTurn = hasImage ? 0.6 : 0.18;

  const px: number[] = [];
  const py: number[] = [];
  const parent: number[] = [];
  const isMain: boolean[] = [];
  const heading: number[] = [];

  const cell = Math.max(8, di);
  const cols = Math.ceil(w / cell) + 2;
  const nodeGrid = new Map<number, number[]>();
  const keyOf = (x: number, y: number) =>
    (Math.floor(y / cell) + 1) * cols + (Math.floor(x / cell) + 1);

  const addNode = (x: number, y: number, par: number, main = false) => {
    const idx = px.length;
    px.push(x);
    py.push(y);
    parent.push(par);
    isMain.push(main);
    // Initial heading points straight down (+y) for crown nodes.
    heading.push(par >= 0 ? Math.atan2(y - py[par], x - px[par]) : Math.PI / 2);
    const k = keyOf(x, y);
    const bucket = nodeGrid.get(k);
    if (bucket) bucket.push(idx);
    else nodeGrid.set(k, [idx]);
    return idx;
  };

  // Crown seeding + forking taproot pre-grow. Crowns sit on the bedrock line.
  // Rather than a single straight column (which reads as one central spine
  // with side branches), each crown descends and periodically SPLITS into two
  // diverging mains — a dichotomous fork — so the skeleton itself bifurcates
  // and laterals attach across several descending roots instead of one line.
  // Low downwardBias forks more freely (a spreading root mass); high bias
  // keeps deeper, taproot-like runs before splitting.
  const crownCount = Math.max(1, Math.min(p.crowns, 8));
  const fieldW = hasImage ? buf!.width : w;
  const fieldH = hasImage ? buf!.height : h;
  const marginB = 28;
  // Deeper taproots as downwardBias rises; always descend a meaningful depth.
  const taprootDepth =
    bedrockY + (fieldH - marginB - bedrockY) * (0.45 + 0.5 * p.downwardBias);
  const steps = Math.max(1, Math.floor((taprootDepth - bedrockY) / D));

  const MAX_MAIN_DEPTH = 3; // generations of forking
  const MAX_MAIN_TIPS = 6; // total descending mains per crown
  const splitChance = 0.06 + (1 - p.downwardBias) * 0.12;
  let mainTips = 0;
  // Spread cone: how far a main may lean off vertical. High downwardBias keeps
  // mains steep; low bias lets the fan splay wide. A fork's divergence becomes
  // each child's PERSISTENT heading — it holds its angle and keeps descending
  // diagonally rather than curling back to straight down.
  const maxDev = 0.5 + (1 - p.downwardBias) * 0.85;
  const devLo = Math.PI / 2 - maxDev;
  const devHi = Math.PI / 2 + maxDev;

  // Grow one main along a persistent heading `dir`; `dv` is a smoothed angular
  // velocity for gentle meander. On a fork the run ends and spawns two children
  // whose headings diverge from this one and stick.
  const growMain = (
    sx: number,
    sy: number,
    sprev: number,
    dir0: number,
    budget: number,
    depth: number,
  ) => {
    let x = sx;
    let y = sy;
    let prev = sprev;
    let dir = dir0;
    let dv = 0;
    let since = 0;
    const minSeg = 5; // segments between forks (and before the first)
    for (let s = 0; s < budget; s++) {
      since++;
      dv = dv * 0.9 + (rng() - 0.5) * 0.08; // smooth heading drift
      dir += dv;
      // Keep the heading inside the descending spread cone (sin stays > 0).
      if (dir < devLo) {
        dir = devLo;
        dv = Math.abs(dv);
      } else if (dir > devHi) {
        dir = devHi;
        dv = -Math.abs(dv);
      }
      // Snapped brushes quantise the heading to the lattice (with wobble) so
      // mains descend in hard diagonal jogs; organic follows it smoothly.
      const a = snap ? snapAngle(dir + (rng() - 0.5) * 0.6, snap) : dir;
      x += Math.cos(a) * D;
      y += Math.sin(a) * D;
      if (x < marginB) {
        x = marginB;
        dir = Math.PI - dir; // reflect horizontally, keep descending
        dv = 0;
      } else if (x > fieldW - marginB) {
        x = fieldW - marginB;
        dir = Math.PI - dir;
        dv = 0;
      }
      prev = addNode(x, y, prev, true);
      if (
        depth < MAX_MAIN_DEPTH &&
        mainTips < MAX_MAIN_TIPS &&
        since >= minSeg &&
        s < budget - minSeg &&
        rng() < splitChance
      ) {
        mainTips++; // this run ends and two begin: net +1 descending tip
        const remain = budget - s - 1;
        const childBudget = Math.max(8, Math.floor(remain * (0.7 + rng() * 0.25)));
        const div = 0.4 + rng() * 0.5; // persistent divergence per child
        growMain(x, y, prev, dir - div, childBudget, depth + 1);
        growMain(x, y, prev, dir + div, childBudget, depth + 1);
        return;
      }
    }
  };

  for (let c = 0; c < crownCount; c++) {
    const fx = crownCount === 1 ? 0.5 : (c + 0.5) / crownCount;
    const cx = fieldW * fx + (rng() - 0.5) * fieldW * 0.04;
    const crown = addNode(cx, bedrockY, -1, true);
    mainTips = 1;
    growMain(cx, bedrockY, crown, Math.PI / 2, steps, 0);
  }

  // Companion attractors strung along every main root so laterals sprout from
  // the taproot skeleton at regular intervals. Without them a main that dives
  // through soil whose attractors were already consumed runs bald and ends in a
  // bare point (with the odd lone stray offshoot). Each is placed downward-and-
  // outward on alternating sides, and far enough out (as a near+far pair) that
  // the lateral it grows clears the whisker-prune length instead of being cut.
  {
    const mainNodes: number[] = [];
    for (let i = 0; i < px.length; i++) {
      if (isMain[i] && parent[i] >= 0) mainNodes.push(i);
    }
    let side = 1;
    for (let m = 0; m < mainNodes.length; m += 3) {
      const i = mainNodes[m];
      // Outward from the main's local heading, then leaned downward like a real
      // lateral angling into the soil.
      const base = heading[i] + side * (Math.PI / 2);
      let dx = Math.cos(base);
      let dy = Math.sin(base) + 0.8;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      side = -side;
      for (const r of [20 + rng() * 8, 36 + rng() * 12]) {
        const ax = px[i] + dx * r + (rng() - 0.5) * 6;
        const ay = py[i] + dy * r + (rng() - 0.5) * 6;
        if (ay <= bedrockY + 4 || ax < 4 || ax > fieldW - 4 || ay > fieldH - 4)
          continue;
        attr.x.push(ax);
        attr.y.push(ay);
      }
    }
  }

  const A = attr.x.length;
  const alive = new Uint8Array(A).fill(1);
  let remaining = A;
  const reach2 = di * di;
  const kill2 = dk * dk;

  const nearestNode = (ax: number, ay: number): number => {
    const cx = Math.floor(ax / cell) + 1;
    const cy = Math.floor(ay / cell) + 1;
    let best = -1;
    let bestD = reach2;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = nodeGrid.get((cy + oy) * cols + (cx + ox));
        if (!bucket) continue;
        for (const n of bucket) {
          const dx = ax - px[n];
          const dy = ay - py[n];
          const dd = dx * dx + dy * dy;
          if (dd < bestD) {
            bestD = dd;
            best = n;
          }
        }
      }
    }
    return best;
  };

  for (
    let iter = 0;
    iter < maxIter && remaining > 0 && px.length < maxNodes;
    iter++
  ) {
    const dirX = new Map<number, number>();
    const dirY = new Map<number, number>();

    for (let a = 0; a < A; a++) {
      if (!alive[a]) continue;
      const best = nearestNode(attr.x[a], attr.y[a]);
      if (best < 0) continue;
      let vx = attr.x[a] - px[best];
      let vy = attr.y[a] - py[best];
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      dirX.set(best, (dirX.get(best) ?? 0) + vx);
      dirY.set(best, (dirY.get(best) ?? 0) + vy);
    }

    if (dirX.size === 0) break;

    const newFrom = px.length;
    dirX.forEach((sx, nodeIdx) => {
      if (px.length >= maxNodes) return;
      const sy = dirY.get(nodeIdx) ?? 0;
      const nx = px[nodeIdx];
      const ny = py[nodeIdx];

      const pl = Math.hypot(sx, sy) || 1;
      let dx = sx / pl;
      let dy = sy / pl;
      const na =
        (fbm(nx * noiseScale, ny * noiseScale, p.seed + 7) - 0.5) * TAU;
      dx += Math.cos(na) * noiseW;
      dy += Math.sin(na) * noiseW;
      dy += flowBias; // gravity: bias growth downward (+y)
      const desired = Math.atan2(dy, dx);

      let a: number;
      if (snap) {
        // Snap to the lattice, but wobble the angle by up to half a lattice
        // cell first — the same trick that gives the taproot its jogged
        // descent. Without it, every lateral branching off the vertical trunk
        // is pulled sideways into the same horizontal cell, reading as uniform
        // perpendicular spurs with no randomized growth. The wobble tips
        // near-boundary directions into either neighbouring cell, staggering
        // the laterals into varied diagonal jogs instead.
        a = snapAngle(desired + (rng() - 0.5) * snap.q, snap);
      } else {
        const cur = heading[nodeIdx];
        let diff = desired - cur;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        if (diff > maxTurn) diff = maxTurn;
        else if (diff < -maxTurn) diff = -maxTurn;
        a = cur + diff;
      }
      // Clamp to the soil: roots never rise above the bedrock datum.
      const ny2 = Math.max(bedrockY, ny + Math.sin(a) * D);
      addNode(nx + Math.cos(a) * D, ny2, nodeIdx);
    });

    for (let a = 0; a < A; a++) {
      if (!alive[a]) continue;
      for (let n = newFrom; n < px.length; n++) {
        const dx = attr.x[a] - px[n];
        const dy = attr.y[a] - py[n];
        if (dx * dx + dy * dy < kill2) {
          alive[a] = 0;
          remaining--;
          break;
        }
      }
    }
  }

  // Root thickening: subtree size feeds each root's width. Parents are created
  // before children, so a single high→low pass accumulates sizes — the crown
  // node carries the whole system and is thickest at the bedrock.
  const N = px.length;
  const size = new Float64Array(N).fill(1);
  for (let i = N - 1; i > 0; i--) {
    const par = parent[i];
    if (par >= 0) size[par] += size[i];
  }

  // Reveal order: each segment starts when its parent finishes, so the taproot
  // extends step-by-step and laterals sprout from joints as growth reaches them.
  const children: number[][] = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par >= 0) children[par].push(i);
  }

  const edgeStart = new Float64Array(N);
  const edgeEnd = new Float64Array(N);
  const schedRng = mulberry32((p.seed ^ 0x6d2b79f5) >>> 0);

  const pathLen = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par >= 0) {
      const dx = px[i] - px[par];
      const dy = py[i] - py[par];
      pathLen[i] = pathLen[par] + Math.hypot(dx, dy);
    }
  }
  const maxPath = pathLen.reduce((m, v) => (v > m ? v : m), 0);
  const invMax = maxPath > 0 ? 1 / maxPath : 0;
  const shallowCut = maxPath * 0.22;

  const segmentDuration = (child: number, len: number) => {
    const jitter = 0.68 + schedRng() * 0.72;
    const tier = isMain[child]
      ? 0.88 + schedRng() * 0.22
      : 0.55 + schedRng() * 0.95;
    return len * jitter * tier;
  };

  const shuffle = (arr: number[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(schedRng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  const segmentAngle = (from: number, to: number) =>
    Math.atan2(py[to] - py[from], px[to] - px[from]);

  const scheduleLaterals = (
    node: number,
    reachTime: number,
    shallow: boolean,
  ) => {
    const latKids = children[node].filter((k) => !isMain[k]);
    shuffle(latKids);
    latKids.sort((a, b) => {
      const aa = segmentAngle(node, a);
      const ab = segmentAngle(node, b);
      const ja = hash2(Math.round(px[a]), Math.round(py[a]), p.seed) * 0.4;
      const jb = hash2(Math.round(px[b]), Math.round(py[b]), p.seed) * 0.4;
      return aa + ja - (ab + jb);
    });

    let latBase = reachTime;
    for (const k of latKids) {
      const len = Math.hypot(px[k] - px[node], py[k] - py[node]);
      const dur = segmentDuration(k, len);
      const horiz = Math.abs(Math.cos(segmentAngle(node, k)));
      const wait = shallow
        ? schedRng() * len * (0.05 + schedRng() * 0.9)
        : schedRng() * len * (0.25 + schedRng() * 2.75) +
          horiz * len * schedRng() * 1.1;
      const siblingGap =
        schedRng() *
        len *
        (shallow ? 0.08 + schedRng() * 0.4 : 0.12 + schedRng() * 0.55);
      latBase += siblingGap;
      edgeStart[k] = latBase + wait;
      edgeEnd[k] = edgeStart[k] + dur;
      scheduleFrom(k, edgeEnd[k]);
    }
  };

  const scheduleMainKids = (
    node: number,
    reachTime: number,
    shallow: boolean,
  ) => {
    const mainKids = children[node].filter((k) => isMain[k]);
    for (const k of mainKids) {
      const len = Math.hypot(px[k] - px[node], py[k] - py[node]);
      const dur = segmentDuration(k, len);
      const gap = shallow
        ? schedRng() * len * (0.2 + schedRng() * 1.0)
        : schedRng() * len * (0.08 + schedRng() * 0.62);
      const lead = schedRng() * dur * 0.12;
      edgeStart[k] = reachTime + lead + gap;
      edgeEnd[k] = edgeStart[k] + dur;
      scheduleFrom(k, edgeEnd[k]);
    }
  };

  const scheduleFrom = (node: number, reachTime: number) => {
    if (children[node].length === 0) return;

    const shallow = pathLen[node] < shallowCut;

    // Near the crown: branch sideways before descending again so the
    // opening is less uniform, but every segment still waits for its parent.
    if (shallow) {
      scheduleLaterals(node, reachTime, true);
      scheduleMainKids(node, reachTime, true);
    } else {
      scheduleMainKids(node, reachTime, false);
      scheduleLaterals(node, reachTime, false);
    }
  };

  const enforcePathOrder = () => {
    for (let i = 0; i < N; i++) {
      for (const k of children[i]) {
        if (edgeStart[k] < edgeEnd[i]) {
          const dur = Math.max(1e-6, edgeEnd[k] - edgeStart[k]);
          edgeStart[k] = edgeEnd[i];
          edgeEnd[k] = edgeEnd[i] + dur;
        }
      }
    }
  };

  const crownNodes: number[] = [];
  for (let i = 0; i < N; i++) {
    if (parent[i] < 0) crownNodes.push(i);
  }
  shuffle(crownNodes);
  const crownSpread = steps * D * (2.5 + schedRng() * 2.0);
  for (let ci = 0; ci < crownNodes.length; ci++) {
    const startAt =
      crownNodes.length <= 1
        ? 0
        : (ci / Math.max(1, crownNodes.length - 1)) * crownSpread +
          schedRng() * crownSpread * 0.25;
    scheduleFrom(crownNodes[ci], startAt);
  }

  enforcePathOrder();

  let maxT = 0;
  for (let i = 0; i < N; i++) {
    if (parent[i] >= 0 && edgeEnd[i] > maxT) maxT = edgeEnd[i];
  }

  // ---- prune whiskers ------------------------------------------------------
  // Space colonization leaves short dead-end twigs: a tip chased one nearby
  // attractor, consumed it in a step or two, then stalled with nothing left to
  // reach. Drawn as little round-capped strokes they read as barbs and spurs
  // off the clean roots. Iteratively drop terminal lateral twigs shorter than a
  // few growth steps so only continuous strokes survive. The taproot skeleton
  // (isMain) is never cut.
  const keep = new Uint8Array(N).fill(1);
  const segLen = (i: number) => {
    const par = parent[i];
    return par < 0 ? 0 : Math.hypot(px[i] - px[par], py[i] - py[par]);
  };
  const MIN_TWIG = D * 6;
  for (let pass = 0; pass < 6; pass++) {
    const live = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const par = parent[i];
      if (keep[i] && par >= 0 && keep[par]) live[par]++;
    }
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (!keep[i] || isMain[i] || live[i] > 0) continue; // live lateral leaves
      // Walk up the single-child chain to its fork (or the trunk), summing the
      // twig length; if it stays under MIN_TWIG the whole chain is a whisker.
      let len = 0;
      let node = i;
      const chain: number[] = [i];
      while (true) {
        const par = parent[node];
        if (par < 0) break;
        len += segLen(node);
        if (isMain[par] || live[par] > 1) break; // fork/trunk — keep it
        chain.push(par);
        node = par;
      }
      if (len < MIN_TWIG) {
        for (const c of chain) keep[c] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Distance from each node down to the far end of its branch (longest kept
  // descendant chain). Leaves are 0; it climbs as you move back toward the
  // trunk. Organic uses this to taper only the last stretch before a tip.
  const tipDist = new Float64Array(N);
  for (let i = N - 1; i > 0; i--) {
    if (!keep[i]) continue;
    const par = parent[i];
    if (par < 0 || !keep[par]) continue;
    const d = tipDist[i] + segLen(i);
    if (d > tipDist[par]) tipDist[par] = d;
  }

  // Organic reads as even hand-drawn linework with a uniform body weight
  // (set by `thickness`); the `taper` slider is BIPOLAR and reshapes only the
  // last stretch before each tip. Negative wisps the ends to a fine point;
  // zero keeps them uniform; positive swells them into rounded, balled tips —
  // the round line cap turns the thicker final segment into a knob. The
  // taproot keeps its own slider and doesn't reshape.
  const taperAmt = p.taper;
  const organicBodyW = p.thickness * 3.2;
  // Width at the very tip, relative to the body. <1 wisps, >1 balls up.
  const organicTipScale =
    taperAmt >= 0 ? 1 + taperAmt * 4 : Math.max(0.05, 1 + taperAmt * 1.9);
  // Length of the wispy taper (negative side only) — a long, gradual point.
  const organicWispLen = 22 + Math.abs(taperAmt) * 90;
  // Balling stays at body weight then swells over just this short end stretch,
  // so a positive taper reads as a rounded knob rather than a long wedge.
  const organicBallLen = 12 + taperAmt * 30;

  // "Line weight" is the single width control exposed in the UI (`thickness`).
  // Laterals track it directly; this factor propagates the same relative change
  // to the otherwise-fixed widths (main taproot, engineered terminal pad) so the
  // slider scales EVERY line evenly rather than just the laterals. The 0.4
  // reference is fixed (not DEFAULT_ROOT.thickness) so retuning the default
  // slider position never changes what a given slider value renders.
  const lineScale = p.thickness / 0.4;

  // Engineered trace base width per tier. The main taproot tracks the `main root`
  // slider (scaled by line weight); laterals track `line weight` directly (×4
  // keeps the default ≈ 0.8).
  const engineeredBaseW = (main: boolean) =>
    main ? p.taprootThickness * lineScale : p.thickness * 4;

  const edges: RootEdge[] = [];
  const nodeW = new Float64Array(N); // final stroke width per node, for curls
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par < 0 || !keep[i]) continue;
    const main = isMain[i];
    const pathFrac = pathLen[i] * invMax;
    let w: number;
    if (brush === "engineered") {
      // Uniform trace width per tier. Lateral traces scale with the `thickness`
      // (lateral thickness) slider so branches other than the main root can be
      // fattened; the main taproot keeps its own constant. Terminals swell via
      // the separate pass below.
      w = engineeredBaseW(main);
    } else if (main) {
      // Taproot stem: slender width scaled by line weight — don't balloon with
      // subtree size.
      w = p.taprootThickness * lineScale * (1.05 - pathFrac * 0.2);
    } else {
      // Organic: even body weight, with the bipolar `taper` reshaping the tip.
      if (taperAmt > 0) {
        // Hold body weight, then swell to a knob concentrated at the very tip.
        // Smoothstep gives a gentle neck where the swell begins and a rounded
        // (not spiked) peak, so the end reads as a smooth ball.
        const u = 1 - Math.min(1, tipDist[i] / organicBallLen); // 0 body → 1 tip
        const e = u * u * (3 - 2 * u);
        w = organicBodyW * (1 + (organicTipScale - 1) * e);
      } else {
        // Wisp: gradual taper to a fine point over a longer stretch.
        const s = Math.min(1, tipDist[i] / organicWispLen);
        w = organicBodyW * (organicTipScale + (1 - organicTipScale) * s);
      }
    }
    nodeW[i] = w;
    edges.push({
      x1: px[par],
      y1: py[par],
      x2: px[i],
      y2: py[i],
      w,
      order: edgeStart[i],
      orderEnd: edgeEnd[i],
      tier: main ? "taproot" : "lateral",
    });
  }

  // ---- terminal curls ------------------------------------------------------
  // Each root end coils into a tendril / calligraphic-flourish spiral that
  // tapers to a fine point, instead of just stopping. The coil continues from
  // the tip's heading, tightens its turn each step (a log-spiral), and shrinks
  // its width from the tip weight down to nothing. Direction and tightness vary
  // per tip (hashed) so they don't all coil identically. Organic brush only.
  // `coil` scales how many segments each end winds through — 0 leaves the ends
  // straight, 1 winds the fullest spiral.
  const baseSegs = Math.round(p.coil * 16);
  if (brush === "organic" && baseSegs >= 2) {
    // Sample the coil at RES× finer resolution than the base segment count, so
    // the tapering point is built from many small width steps (a smooth spindle)
    // instead of a few coarse ones — the same coil shape, just finely subdivided.
    const RES = 4;
    const segs = baseSegs * RES;
    const turnMult = Math.pow(1.12, 1 / RES);
    const keptKids = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const par = parent[i];
      if (keep[i] && par >= 0 && keep[par]) keptKids[par]++;
    }
    for (let i = 0; i < N; i++) {
      if (!keep[i] || parent[i] < 0 || keptKids[i] > 0) continue; // kept tips
      const hsh = hash2(Math.round(px[i]), Math.round(py[i]), (p.seed ^ 0x9e37) >>> 0);
      const dir = hsh < 0.5 ? 1 : -1;
      let x = px[i];
      let y = py[i];
      let ang = heading[i];
      let t = edgeEnd[i];
      let turn = (0.34 + hsh * 0.12) / RES; // per-fine-step turn
      const startW = nodeW[i] || organicBodyW;
      for (let s = 0; s < segs; s++) {
        const frac = s / (segs - 1);
        ang += dir * turn;
        turn *= turnMult; // tighten into a small coil
        const len = (2.4 / RES) * (1 - 0.45 * frac);
        const nx = x + Math.cos(ang) * len;
        const ny = y + Math.sin(ang) * len;
        // Hold full weight through the body, then ease to a point over the last
        // stretch (smoothstep) — a smooth pointed tendril tip, not a stepped one.
        const TIP_POINT = 0.72; // frac after which the coil tapers to a point
        let wf = 1;
        if (frac > TIP_POINT) {
          const u = (frac - TIP_POINT) / (1 - TIP_POINT); // 0 → 1 toward the tip
          wf = 1 - u * u * (3 - 2 * u); // smoothstep down to 0
        }
        const w = Math.max(0.02, startW * wf);
        edges.push({
          x1: x,
          y1: y,
          x2: nx,
          y2: ny,
          w,
          order: t,
          orderEnd: t + len,
          tier: "lateral",
        });
        x = nx;
        y = ny;
        t += len;
      }
    }
  }

  // ---- engineered terminal swell -------------------------------------------
  // Engineered traces fatten toward each end into a thicker terminal — the
  // counterpart of the organic ball. Rather than widening the (few, ~6px) trace
  // segments — which steps coarsely and notches under the butt caps — we
  // overlay a finely-resampled run along the last stretch of the trace whose
  // width ramps up in small increments, so the swell reads as a smooth (but
  // still stepped, in the engineered idiom) taper into a fat tip.
  if (brush === "engineered") {
    const keptKids = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const par = parent[i];
      if (keep[i] && par >= 0 && keep[par]) keptKids[par]++;
    }
    const BALL_LEN = 20; // px of trace that fattens toward the tip
    // Terminal width is ABSOLUTE (px), independent of the connecting trace, so
    // thin and thick traces get the same-size end. Scaled by line weight so it
    // grows in step with every other stroke.
    const END_W = p.endThickness * lineScale;
    const STEP = 2; // fine sub-segment length → many small width steps
    for (let i = 0; i < N; i++) {
      if (!keep[i] || parent[i] < 0 || keptKids[i] > 0) continue; // kept ends
      const base = engineeredBaseW(isMain[i]);
      const ord = edgeEnd[i];
      // Collect the trace points from the tip backward, up to BALL_LEN.
      const poly: number[] = [px[i], py[i]];
      let node = i;
      let back = 0;
      while (parent[node] >= 0 && keep[parent[node]] && back < BALL_LEN) {
        const par = parent[node];
        back += segLen(node);
        poly.push(px[par], py[par]);
        node = par;
      }
      const tier = isMain[i] ? "taproot" : "lateral";
      // Ramp from the trace width (back) to the absolute end width (tip).
      const swellAt = (d: number) => {
        const u = 1 - Math.min(1, d / BALL_LEN); // 0 back → 1 tip
        const e = u * u * (3 - 2 * u);
        return base + (END_W - base) * e;
      };
      // Walk the polyline from the tip. Straight runs are widened with square
      // (butt) sub-segments so the ends and steps stay crisp/engineered; the
      // trace's corner vertices get a small round fill so the turns don't gap.
      let distFromTip = 0;
      for (let pi = 2; pi < poly.length; pi += 2) {
        const x1 = poly[pi - 2];
        const y1 = poly[pi - 1];
        const x2 = poly[pi];
        const y2 = poly[pi + 1];
        const segL = Math.hypot(x2 - x1, y2 - y1) || 1;
        const parts = Math.max(1, Math.ceil(segL / STEP));
        for (let k = 0; k < parts; k++) {
          const t0 = k / parts;
          const t1 = (k + 1) / parts;
          const dMid = distFromTip + segL * ((t0 + t1) / 2);
          const ww = swellAt(dMid);
          if (ww <= base + 0.02) continue; // nothing to add out here
          edges.push({
            x1: x1 + (x2 - x1) * t0,
            y1: y1 + (y2 - y1) * t0,
            x2: x1 + (x2 - x1) * t1,
            y2: y1 + (y2 - y1) * t1,
            w: ww,
            order: ord,
            orderEnd: ord,
            tier,
          });
        }
        distFromTip += segL;
        // Round fill at this corner vertex so the butt sub-segments on either
        // side of the turn meet seamlessly (only the turns are rounded, not the
        // ends). A zero-length round-capped edge renders as a filled dot.
        const ww = swellAt(distFromTip);
        if (ww > base + 0.02 && pi + 2 < poly.length) {
          edges.push({
            x1: x2,
            y1: y2,
            x2: x2,
            y2: y2,
            w: ww,
            order: ord,
            orderEnd: ord,
            tier,
            soft: true,
          });
        }
      }
    }
  }

  // ---- mycelial hair layer -------------------------------------------------
  // Fine filaments that SPROUT FROM the structural roots — fine root hairs and
  // mycelium clinging to the rootstock, not free-floating debris. Each hair
  // starts at a real root node and threads a short, faint, downward-leaning
  // walk, so the layer reads as texture on the roots rather than stragglers.
  const hairs: RootEdge[] = [];
  const soilTop = bedrockY + 6;
  // Candidate origins: skip the first node of each crown (the heavy taproot
  // head) so hairs emanate from the finer roots, where real root hairs live.
  // Mycelium is an organic-brush concept only; engineered grows no hairs.
  const hairCount = brush === "organic" ? Math.round(p.hairDensity * 360) : 0;
  if (N > crownCount + 2) {
    let placed = 0;
    let hairTries = 0;
    const maxHairTries = hairCount * 8 + 50;
    while (placed < hairCount && hairTries < maxHairTries) {
      hairTries++;
      const j = crownCount + Math.floor(rng() * (N - crownCount));
      if (!keep[j]) continue; // don't sprout hairs off pruned whiskers
      // Favor thinner roots (small subtree) as origins — that's where fine
      // hairs grow; thick trunks stay clean.
      if (size[j] > 40 && rng() > 0.25) continue;
      let hx = px[j];
      let hy = py[j];
      placed++;
      let hairT = edgeEnd[j];
      // Lean off the root's own heading, mostly downward/outward.
      let ang = heading[j] + (rng() - 0.5) * 2.0;
      if (Math.sin(ang) < 0) ang = -ang; // bias the walk downward
      const segs = 3 + Math.floor(rng() * 6);
      const slen = 3 + rng() * 4;
      for (let s = 0; s < segs; s++) {
        ang += (rng() - 0.5) * 0.7;
        const nxp = hx + Math.cos(ang) * slen;
        const nyp = hy + Math.sin(ang) * slen;
        if (nyp > fieldH - 4 || nyp < soilTop || nxp < 4 || nxp > fieldW - 4)
          break;
        const hStart = hairT + schedRng() * slen * 0.35;
        hairT = hStart + slen * (0.35 + schedRng() * 0.55);
        hairs.push({
          x1: hx,
          y1: hy,
          x2: nxp,
          y2: nyp,
          w: 0.35 * lineScale,
          order: hStart,
          orderEnd: hairT,
          tier: "hair",
        });
        hx = nxp;
        hy = nyp;
      }
    }
  }

  for (const e of edges) {
    if (e.orderEnd > maxT) maxT = e.orderEnd; // include terminal curls
  }
  for (const e of hairs) {
    if (e.orderEnd > maxT) maxT = e.orderEnd;
  }

  const invMaxT = maxT > 0 ? 1 / maxT : 1;
  for (const e of edges) {
    e.order *= invMaxT;
    e.orderEnd *= invMaxT;
  }
  for (const e of hairs) {
    e.order *= invMaxT;
    e.orderEnd *= invMaxT;
  }
  return { edges, hairs, bedrockY };
}

function strokeRootSegment(
  ctx: CanvasRenderingContext2D,
  e: RootEdge,
  progress: number,
  widthOverride?: number,
) {
  if (progress <= e.order) return;
  let x2 = e.x2;
  let y2 = e.y2;
  const span = e.orderEnd - e.order;
  if (span > 1e-6 && progress < e.orderEnd) {
    const raw = (progress - e.order) / span;
    const t = 1 - (1 - raw) * (1 - raw);
    x2 = e.x1 + (e.x2 - e.x1) * t;
    y2 = e.y1 + (e.y2 - e.y1) * t;
  }
  ctx.lineWidth = widthOverride ?? e.w;
  ctx.beginPath();
  ctx.moveTo(e.x1, e.y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// ---- rendering -------------------------------------------------------------

// The organic ink-stamp treatment, reverse-engineered from the handoff PSD
// (a Root Brush export run through Photoshop's Filter Gallery: Cutout, then
// Stamp with a black foreground). Both filters are emulated as blur + hard
// threshold passes:
//   1. Stamp — blur + LOW threshold: the blurred skirt reads as solid ink,
//      fattening every line toward a uniform bold weight and fusing fine
//      hair clusters.
//   2. Cutout — blur + 50% threshold on the result: the edge stays at the
//      midline (no net growth), so this pass only SIMPLIFIES the contours —
//      smoothing wiggles, rounding junctions, and pinching thin spots into
//      the organic breaks the reference shows.
export interface StampOpts {
  amount: number; // 0..1 — stamp fatten/smooth pass. 0 skips the pass.
  cutout: number; // 0..1 — cutout break/simplify pass. 0 skips the pass.
  // Line weight (`thickness`) the treatment runs against. Both pass radii
  // scale with it, so the treatment CHARACTER — how smoothed the ink is and
  // how often it breaks — stays the same at every weight, and the Line
  // Weight slider changes only the scale of the ink. Without this, thicker
  // lines resist the same cutout radius and the breaks vanish.
  lineWeight?: number;
  // Internal resolution the treatment runs at, 0..1 of full (default 1).
  // The pipeline needs several blur + pixel-readback rounds per frame, so
  // slider scrubbing drops this for responsiveness and settles at 1.
  quality?: number;
}

// Line weight the treatment radii were tuned at; `lineWeight` is normalized
// against this, so the tuned defaults render identically.
const TREATMENT_WEIGHT_REF = 0.13;

// Blur radii in preview-space px at each slider's max, and the alpha cut
// levels. Both sliders map linearly onto their radius, independently:
//   stamp  — blur + LOW threshold: the blurred skirt reads as solid ink, so
//            the pass fattens and smooths.
//   cutout — a morphological OPENING built from two blur+threshold steps:
//            erode (high cut — pinches thin spots into breaks and shaves
//            nubs), then dilate by the same radius (low cut — restores the
//            surviving ink to its original weight). Breaks without thinning:
//            a single 50% cut would instead pull both edges of a thin stroke
//            inward, visibly reducing the line weight.
const STAMP_BLUR_MAX = 5;
const STAMP_THRESHOLD = 0.08;
const CUTOUT_BLUR_MAX = 3;
// Erode by ~0.55σ (Φ(0.55) of the blurred edge profile): a full sigma erodes
// the entire half-width of these thin strokes and wipes the drawing; 0.55σ
// pinches only genuinely thin spots. Dilate back slightly MORE (~0.75σ) —
// the surplus pre-compensates the final smoothing pass below.
const CUTOUT_ERODE_CUT = 0.709;
const CUTOUT_DILATE_CUT = 0.227;
// Final pass, echoing Photoshop's order (Stamp smooths AFTER Cutout breaks):
// a gentle blur + 50% cut that cleans the ragged nicks the erode leaves and
// rounds the ends of the broken fragments. Runs at a fraction of the cutout
// radius; the 50% cut's slight thinning is absorbed by the over-dilation.
const CUTOUT_SMOOTH_SCALE = 0.7;
const CUTOUT_SMOOTH_CUT = 0.5;

// The treatment always runs at this fixed resolution multiplier over the
// PREVIEW-space dimensions, regardless of the output canvas resolution.
// Blur + threshold is not scale-invariant (sub-pixel anti-aliased strokes
// fatten and break differently at different raster scales), so rendering
// the treatment once at a reference scale and stretching the result is what
// makes preview, PNG, MP4, and the traced SVG all show the SAME ink — same
// weights, same breaks.
const TREATMENT_DPR = 4;

/** The blur+threshold steps for a given treatment, radii in preview px. */
function stampSteps(stamp: StampOpts): { blur: number; cut: number }[] {
  const tScale =
    (stamp.lineWeight ?? TREATMENT_WEIGHT_REF) / TREATMENT_WEIGHT_REF;
  const steps = [
    { blur: stamp.amount * STAMP_BLUR_MAX * tScale, cut: STAMP_THRESHOLD },
  ];
  if (stamp.cutout > 0) {
    const r = stamp.cutout * CUTOUT_BLUR_MAX * tScale;
    steps.push(
      { blur: r, cut: CUTOUT_ERODE_CUT },
      { blur: r, cut: CUTOUT_DILATE_CUT },
      { blur: r * CUTOUT_SMOOTH_SCALE, cut: CUTOUT_SMOOTH_CUT },
    );
  }
  return steps;
}

// Ping-pong offscreens reused across frames so the growth animation doesn't
// allocate full canvases per tick.
let stampSrc: HTMLCanvasElement | null = null;
let stampOut: HTMLCanvasElement | null = null;
// Scratch canvases for stepped downscaling of the treated bitmap.
let stepA: HTMLCanvasElement | null = null;
let stepB: HTMLCanvasElement | null = null;

// Composite `src` onto `dctx` at dw×dh, halving in steps while the shrink
// exceeds 2×. A single drawImage beyond 2× undersamples (bilinear reads only
// a 2×2 tap), which renders the thin treated strokes with target-dependent
// raggedness — the preview and the PNG export would each alias differently.
function blitSteppedDown(
  src: HTMLCanvasElement,
  sw: number,
  sh: number,
  dctx: CanvasRenderingContext2D,
  dw: number,
  dh: number,
) {
  let cur: HTMLCanvasElement = src;
  let cw = sw;
  let ch = sh;
  let flip = true;
  while (cw > dw * 2 || ch > dh * 2) {
    // floor, not round: round(1/2)=1 would stop cw shrinking and spin forever.
    const nw = Math.max(dw, 1, Math.floor(cw / 2));
    const nh = Math.max(dh, 1, Math.floor(ch / 2));
    if (nw === cw && nh === ch) break;
    const buf = flip ? (stepA ??= document.createElement("canvas")) : (stepB ??= document.createElement("canvas"));
    flip = !flip;
    if (buf.width !== nw || buf.height !== nh) {
      buf.width = nw;
      buf.height = nh;
    }
    const bctx = buf.getContext("2d")!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.clearRect(0, 0, nw, nh);
    bctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = buf;
    cw = nw;
    ch = nh;
  }
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(cur, 0, 0, cw, ch, 0, 0, dw, dh);
}

const inkCache = new Map<string, [number, number, number]>();
function parseInk(ink: string): [number, number, number] {
  const hit = inkCache.get(ink);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const x = c.getContext("2d")!;
  x.fillStyle = ink;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  const rgb: [number, number, number] = [d[0], d[1], d[2]];
  inkCache.set(ink, rgb);
  return rgb;
}

/** Stroke every root segment onto `ctx` (transform must already be set). */
function paintRootStrokes(
  ctx: CanvasRenderingContext2D,
  result: RootResult,
  ink: string,
  progress: number,
  brush: RootBrush,
) {
  const engineered = brush === "engineered";
  // Round caps on organic: they overlap to hide the seams between the many
  // little segments. The ends don't read as rounded nubs because the coil
  // tapers to ~0 width at the tip, so the cap there is effectively a point.
  // Engineered keeps butt caps for clean trace ends.
  ctx.lineCap = engineered ? "butt" : "round";
  ctx.lineJoin = "round";

  // Mycelial hairs — faint, drawn first so structural roots sit on top.
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.42;
  for (const e of result.hairs) {
    strokeRootSegment(ctx, e, progress);
  }

  // Structural roots — taproot + laterals. Widths (including the engineered
  // terminal swell) are baked into each edge in growRoots.
  ctx.globalAlpha = 1;
  for (const e of result.edges) {
    if (!e.soft) strokeRootSegment(ctx, e, progress);
  }
  // Soft edges (engineered terminal swell) get round cap/join so the overlapping
  // sub-segments merge seamlessly across corners and width steps.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const e of result.edges) {
    if (e.soft) strokeRootSegment(ctx, e, progress);
  }
  ctx.globalAlpha = 1;
}

export function drawRoots(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  result: RootResult,
  ink: string,
  background: string,
  progress = 1,
  _showBedrock = true,
  brush: RootBrush = "organic",
  stamp?: StampOpts,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }

  const useStamp =
    brush === "organic" && !!stamp && (stamp.amount > 0 || stamp.cutout > 0);
  if (!useStamp) {
    paintRootStrokes(ctx, result, ink, progress, brush);
    return;
  }

  // Treatment runs at the fixed reference resolution (see TREATMENT_DPR) and
  // is stretched onto the output canvas — preview, PNG, and MP4 all composite
  // the SAME treated ink.
  const treated = runStampPipeline(w, h, result, ink, progress, brush, stamp);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  blitSteppedDown(
    treated.canvas,
    treated.pw,
    treated.ph,
    ctx,
    ctx.canvas.width,
    ctx.canvas.height,
  );
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

interface StampRender {
  canvas: HTMLCanvasElement;
  pw: number;
  ph: number;
  tDpr: number;
  /** With `captureField`: the last blur's alpha (pre-cut) and its iso level. */
  field?: Uint8ClampedArray;
  iso?: number;
}

/**
 * Execute the stamp/cutout blur+threshold chain over the painted strokes at
 * TREATMENT_DPR × preview resolution (× `quality` while scrubbing).
 * With `captureField`, the FINAL threshold is skipped and the smooth blurred
 * alpha is returned instead — its iso contour is the exact treated outline,
 * which the SVG export traces into real vector paths.
 */
function runStampPipeline(
  w: number,
  h: number,
  result: RootResult,
  ink: string,
  progress: number,
  brush: RootBrush,
  stamp: StampOpts,
  captureField = false,
): StampRender {
  const q = Math.min(1, Math.max(0.3, stamp.quality ?? 1));
  const tDpr = TREATMENT_DPR * q;
  const pw = Math.max(1, Math.round(w * tDpr));
  const ph = Math.max(1, Math.round(h * tDpr));
  const a = (stampSrc ??= document.createElement("canvas"));
  const b = (stampOut ??= document.createElement("canvas"));
  if (a.width !== pw || a.height !== ph) {
    a.width = pw;
    a.height = ph;
    b.width = pw;
    b.height = ph;
  }

  const [ir, ig, ib] = parseInk(ink);
  const thresholdAlpha = (tctx: CanvasRenderingContext2D, cut: number) => {
    const img = tctx.getImageData(0, 0, pw, ph);
    const data = img.data;
    const T = Math.max(8, Math.round(255 * cut));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= T) {
        data[i] = ir;
        data[i + 1] = ig;
        data[i + 2] = ib;
        data[i + 3] = 255;
      } else {
        data[i + 3] = 0;
      }
    }
    tctx.putImageData(img, 0, 0);
  };

  const actx = a.getContext("2d")!;
  actx.setTransform(1, 0, 0, 1, 0, 0);
  actx.clearRect(0, 0, pw, ph);
  actx.setTransform(tDpr, 0, 0, tDpr, 0, 0);
  paintRootStrokes(actx, result, ink, progress, brush);

  const steps = stampSteps(stamp);
  let cur = a;
  for (let i = 0; i < steps.length; i++) {
    const dst = cur === a ? b : a;
    const dctx = dst.getContext("2d")!;
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.clearRect(0, 0, pw, ph);
    dctx.filter = `blur(${steps[i].blur * tDpr}px)`;
    dctx.drawImage(cur, 0, 0);
    dctx.filter = "none";
    cur = dst;
    if (captureField && i === steps.length - 1) {
      const img = dctx.getImageData(0, 0, pw, ph);
      const field = new Uint8ClampedArray(pw * ph);
      for (let p = 0; p < field.length; p++) field[p] = img.data[p * 4 + 3];
      return {
        canvas: cur,
        pw,
        ph,
        tDpr,
        field,
        iso: Math.max(8, 255 * steps[i].cut),
      };
    }
    thresholdAlpha(dctx, steps[i].cut);
  }
  return { canvas: cur, pw, ph, tDpr };
}

// ---- stamp outline tracing (SVG export) ------------------------------------
// Marching squares over the pipeline's final blurred alpha field, walked at
// its threshold iso-level with linear interpolation, yields smooth sub-pixel
// contours of the treated ink — the exact vector shape of blur + hard cut.
// Traced into real <path> fills so the SVG needs no filters and survives
// design tools (Figma, Illustrator) that ignore SVG filter effects.
function traceStampField(
  field: Uint8ClampedArray,
  pw: number,
  ph: number,
  iso: number,
  scale: number,
): string {
  // Grid nodes are pixel centers, padded with a zero border so ink touching
  // the canvas edge still closes into loops.
  const V = (gx: number, gy: number) =>
    gx >= 1 && gx <= pw && gy >= 1 && gy <= ph
      ? field[(gy - 1) * pw + (gx - 1)]
      : 0;

  const segs: number[] = []; // x1,y1,x2,y2 per segment, grid coords
  const lerp = (a: number, b: number) => (iso - a) / (b - a);

  for (let cy = 0; cy <= ph; cy++) {
    for (let cx = 0; cx <= pw; cx++) {
      const tl = V(cx, cy);
      const tr = V(cx + 1, cy);
      const br = V(cx + 1, cy + 1);
      const bl = V(cx, cy + 1);
      let code = 0;
      if (tl >= iso) code |= 1;
      if (tr >= iso) code |= 2;
      if (br >= iso) code |= 4;
      if (bl >= iso) code |= 8;
      if (code === 0 || code === 15) continue;

      const t = () => [cx + lerp(tl, tr), cy];
      const r = () => [cx + 1, cy + lerp(tr, br)];
      const b = () => [cx + lerp(bl, br), cy + 1];
      const l = () => [cx, cy + lerp(tl, bl)];
      const add = (p: number[], q2: number[]) =>
        segs.push(p[0], p[1], q2[0], q2[1]);

      switch (code) {
        case 1:
          add(l(), t());
          break;
        case 2:
          add(t(), r());
          break;
        case 3:
          add(l(), r());
          break;
        case 4:
          add(r(), b());
          break;
        case 5: {
          const center = (tl + tr + br + bl) / 4;
          if (center >= iso) {
            add(l(), b());
            add(t(), r());
          } else {
            add(l(), t());
            add(r(), b());
          }
          break;
        }
        case 6:
          add(t(), b());
          break;
        case 7:
          add(l(), b());
          break;
        case 8:
          add(l(), b());
          break;
        case 9:
          add(t(), b());
          break;
        case 10: {
          const center = (tl + tr + br + bl) / 4;
          if (center >= iso) {
            add(l(), t());
            add(r(), b());
          } else {
            add(t(), r());
            add(l(), b());
          }
          break;
        }
        case 11:
          add(r(), b());
          break;
        case 12:
          add(l(), r());
          break;
        case 13:
          add(t(), r());
          break;
        case 14:
          add(l(), t());
          break;
      }
    }
  }

  // Chain segments into closed loops. Shared endpoints are computed from the
  // same corner values by both adjacent cells, so their float coords match
  // exactly and a string key joins them.
  const n = segs.length / 4;
  const key = (x: number, y: number) => `${x},${y}`;
  const atPoint = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const end of [0, 1] as const) {
      const k = key(segs[i * 4 + end * 2], segs[i * 4 + end * 2 + 1]);
      const list = atPoint.get(k);
      if (list) list.push(i);
      else atPoint.set(k, [i]);
    }
  }

  const used = new Uint8Array(n);
  const loops: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const pts: number[] = [segs[s * 4], segs[s * 4 + 1]];
    let cx = segs[s * 4 + 2];
    let cy = segs[s * 4 + 3];
    // Follow matching endpoints until the loop closes (or dead-ends).
    for (;;) {
      pts.push(cx, cy);
      const candidates = atPoint.get(key(cx, cy));
      let next = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!used[c]) {
            next = c;
            break;
          }
        }
      }
      if (next < 0) break;
      used[next] = 1;
      if (segs[next * 4] === cx && segs[next * 4 + 1] === cy) {
        cx = segs[next * 4 + 2];
        cy = segs[next * 4 + 3];
      } else {
        cx = segs[next * 4];
        cy = segs[next * 4 + 1];
      }
    }
    if (pts.length >= 6) loops.push(pts);
  }

  // Decimate near-collinear runs (tolerance in treatment-buffer px) so the
  // path stays a reasonable size without visibly changing the contour.
  const EPS = 0.35;
  const f = (v: number) => Math.round((v - 0.5) * scale * 100) / 100;
  const parts: string[] = [];
  for (const pts of loops) {
    const m = pts.length / 2;
    const kept: number[] = [0];
    let anchor = 0;
    for (let i = 1; i < m - 1; i++) {
      const ax = pts[anchor * 2];
      const ay = pts[anchor * 2 + 1];
      const bx2 = pts[(i + 1) * 2];
      const by2 = pts[(i + 1) * 2 + 1];
      const px2 = pts[i * 2];
      const py2 = pts[i * 2 + 1];
      const dx = bx2 - ax;
      const dy = by2 - ay;
      const len = Math.hypot(dx, dy) || 1;
      const dist = Math.abs((px2 - ax) * dy - (py2 - ay) * dx) / len;
      if (dist > EPS) {
        kept.push(i);
        anchor = i;
      }
    }
    if (kept.length < 3) continue;
    const d: string[] = [];
    for (let ki = 0; ki < kept.length; ki++) {
      const i = kept[ki];
      d.push(
        `${ki === 0 ? "M" : "L"}${f(pts[i * 2])} ${f(pts[i * 2 + 1])}`,
      );
    }
    d.push("Z");
    parts.push(d.join(""));
  }
  return parts.join("");
}

export function buildRootsSVG(
  w: number,
  h: number,
  result: RootResult,
  ink: string,
  background: string,
  _showBedrock = true,
  brush: RootBrush = "organic",
  stamp?: StampOpts,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const engineered = brush === "engineered";
  // Match the canvas: round caps hide segment seams; engineered uses butt.
  const cap = engineered ? "butt" : "round";
  const parts: string[] = [];
  // Omit the ground rect for a transparent export, so the roots can drop onto
  // any surface; otherwise paint the canvas background.
  if (background !== "transparent")
    parts.push(`<rect width="${w}" height="${h}" fill="${background}"/>`);

  // Ink-stamp treatment: rather than embedding an SVG filter chain (which
  // design tools like Figma and Illustrator ignore, silently dropping the
  // whole treatment), the treated ink is traced into real vector paths — the
  // export is self-contained plain geometry, identical to the canvas.
  const useStamp =
    brush === "organic" && !!stamp && (stamp.amount > 0 || stamp.cutout > 0);
  if (useStamp) {
    const treated = runStampPipeline(
      w,
      h,
      result,
      ink,
      1,
      brush,
      { ...stamp, quality: 1 },
      true,
    );
    const d = traceStampField(
      treated.field!,
      treated.pw,
      treated.ph,
      treated.iso!,
      1 / treated.tDpr,
    );
    parts.push(`<path d="${d}" fill="${ink}" fill-rule="evenodd"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  }

  // Mycelium group — faint hairs.
  parts.push(
    `<g fill="none" stroke="${ink}" stroke-opacity="0.42" stroke-linecap="${cap}" stroke-linejoin="round">`,
  );
  for (const e of result.hairs) {
    parts.push(
      `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(e.w)}"/>`,
    );
  }
  parts.push(`</g>`);

  // Structural roots group.
  parts.push(
    `<g fill="none" stroke="${ink}" stroke-linecap="${cap}" stroke-linejoin="round">`,
  );
  for (const e of result.edges) {
    if (e.soft) continue;
    parts.push(
      `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(e.w)}"/>`,
    );
  }
  parts.push(`</g>`);

  // Soft edges (engineered terminal swell) — round caps so they merge seamlessly.
  const soft = result.edges.filter((e) => e.soft);
  if (soft.length) {
    parts.push(
      `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const e of soft) {
      parts.push(
        `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(e.w)}"/>`,
      );
    }
    parts.push(`</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

/**
 * Scale a grown result into a larger coordinate space. Used for export: rather
 * than re-growing at the export resolution (which diverges and truncates against
 * the node/iteration caps, dropping lines), we render the EXACT preview result
 * scaled up — so the export is what-you-see, every line included.
 */
export function scaleRootResult(r: RootResult, s: number): RootResult {
  if (s === 1) return r;
  const sc = (e: RootEdge): RootEdge => ({
    ...e,
    x1: e.x1 * s,
    y1: e.y1 * s,
    x2: e.x2 * s,
    y2: e.y2 * s,
    w: e.w * s,
  });
  return {
    edges: r.edges.map(sc),
    hairs: r.hairs.map(sc),
    bedrockY: r.bedrockY * s,
  };
}

export function randomRootParams(prev: RootParams): RootParams {
  const rand = mulberry32((prev.seed * 2654435761) >>> 0);
  const pick = (min: number, max: number, step: number) => {
    const steps = Math.floor((max - min) / step);
    return min + Math.round(rand() * steps) * step;
  };
  return {
    ...prev,
    // Keep crowns / bedrock untouched so regenerating reshapes the same
    // foundation rather than relocating it.
    seed: Math.floor(rand() * 99999) + 1,
    density: pick(1000, 1900, 50),
    downwardBias: pick(0.35, 0.8, 0.01),
    lateralReach: pick(58, 92, 1),
    taper: pick(-0.2, 0.3, 0.01),
  };
}

export { sampleLuminance };
