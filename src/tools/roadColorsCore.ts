// Road Colors engine — fetches the drivable road network around a point from
// OpenStreetMap (Overpass), classifies each road by its designation
// (Street / Avenue / Boulevard / Drive / Highway / Interstate ...) and projects
// it to a square canvas clipped to a circle. Palette + idea after
// erdavis1/RoadColors, but driven by live OSM data instead of Census shapefiles.

export type Designation =
  | "I-"
  | "US Hwy"
  | "State Hwy"
  | "Hwy"
  | "Ave"
  | "Blvd"
  | "Dr"
  | "St"
  | "Rd"
  | "Other";

// The RoadColors palette, mapped onto designations.
export const ROAD_PALETTE: Record<Designation, string> = {
  "I-": "#fe4d64",
  "US Hwy": "#ff9223",
  "State Hwy": "#ff9223",
  Hwy: "#ff9223",
  Ave: "#59c8e5",
  Blvd: "#2e968c",
  Dr: "#0a7abf",
  St: "#fed032",
  Rd: "#4cb580",
  Other: "#cccccc",
};

export interface PalettePreset {
  name: string;
  bg: string;
  colors: Record<Designation, string>;
}

// Ready-made colorways. Colors are listed in legend order
// (Other → Road → Street → Drive → Avenue → Boulevard → US Hwy → State Hwy →
// Highway → Interstate); all use a white ground.
export const PALETTE_PRESETS: PalettePreset[] = [
  {
    name: "Green",
    bg: "#ffffff",
    colors: {
      Other: "#555559",
      Rd: "#426651",
      St: "#0F3315",
      Dr: "#4C998C",
      Ave: "#A1E5B8",
      Blvd: "#303033",
      "US Hwy": "#2A330F",
      "State Hwy": "#666642",
      Hwy: "#72994C",
      "I-": "#CEE5A1",
    },
  },
  {
    name: "Blue",
    bg: "#ffffff",
    colors: {
      Other: "#E6E2DA",
      Rd: "#A1E5DA",
      St: "#0F2D33",
      Dr: "#425466",
      Ave: "#4C7399",
      Blvd: "#CCC9C2",
      "US Hwy": "#99994C",
      "State Hwy": "#331B0F",
      Hwy: "#664B42",
      "I-": "#E5E0A1",
    },
  },
  { name: "Default", bg: "#ffffff", colors: { ...ROAD_PALETTE } },
];

// The colorway applied on first open.
export const DEFAULT_PRESET = PALETTE_PRESETS[0];

// Order roads reveal during the "fill-in" animation. "Other" is the faint base
// laid down first; named roads build up on top, majors last.
export const REVEAL_ORDER: Designation[] = [
  "Other",
  "Rd",
  "St",
  "Dr",
  "Ave",
  "Blvd",
  "US Hwy",
  "State Hwy",
  "Hwy",
  "I-",
];

// Human label for the legend.
export const DESIGNATION_LABEL: Record<Designation, string> = {
  "I-": "Interstate",
  "US Hwy": "US Highway",
  "State Hwy": "State Highway",
  Hwy: "Highway",
  Ave: "Avenue",
  Blvd: "Boulevard",
  Dr: "Drive",
  St: "Street",
  Rd: "Road",
  Other: "Other",
};

const SUFFIX_MAP: Record<string, Designation> = {
  street: "St",
  st: "St",
  avenue: "Ave",
  ave: "Ave",
  av: "Ave",
  boulevard: "Blvd",
  blvd: "Blvd",
  blv: "Blvd",
  drive: "Dr",
  dr: "Dr",
  road: "Rd",
  rd: "Rd",
  highway: "Hwy",
  hwy: "Hwy",
};

/** Derive a designation from OSM tags: ref (interstates/US/state) first, then
 *  the last word of the road name, then a fallback for big roads. */
export function classify(tags: Record<string, string>): Designation {
  const ref = (tags.ref || "").toUpperCase().trim();
  if (ref) {
    if (/^I[\s-]?\d/.test(ref) || /;\s*I[\s-]?\d/.test(ref)) return "I-";
    if (/^US[\s-]?\d/.test(ref) || ref.startsWith("US ")) return "US Hwy";
    if (/^(SR|STATE|[A-Z]{2})[\s-]?\d/.test(ref)) return "State Hwy";
  }

  const name = (tags.name || "").trim();
  if (name) {
    const words = name.split(/\s+/);
    const last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, "");
    if (SUFFIX_MAP[last]) return SUFFIX_MAP[last];
    // some names lead with the type: "Avenue of the Americas"
    const first = words[0].toLowerCase().replace(/[^a-z]/g, "");
    if (SUFFIX_MAP[first]) return SUFFIX_MAP[first];
  }

  const hw = tags.highway || "";
  if (hw === "motorway" || hw === "motorway_link" || hw === "trunk") return "Hwy";
  return "Other";
}

export interface LatLng {
  lat: number;
  lon: number;
}

export interface RoadWay {
  designation: Designation;
  /** OSM `highway=*` tag — used to drop arterials when hiding highways. */
  highway: string;
  pts: LatLng[];
  /** approximate length in metres, used to order draw within a designation */
  length: number;
}

export interface RoadData {
  center: LatLng;
  radius: number; // metres
  ways: RoadWay[];
  place: string;
}

export interface GeoResult {
  lat: number;
  lon: number;
  label: string;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

/** Geocode a free-text place ("Portland, Oregon") to a lat/lon. */
export async function geocode(query: string): Promise<GeoResult> {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoder error ${res.status}`);
  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  if (!data.length) throw new Error(`No place found for "${query}"`);
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    label: data[0].display_name,
  };
}

function haversineLen(pts: LatLng[]): number {
  let len = 0;
  const R = 6371000;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const la1 = (a.lat * Math.PI) / 180;
    const la2 = (b.lat * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    len += 2 * R * Math.asin(Math.sqrt(h));
  }
  return len;
}

const HIGHWAY_FILTER =
  "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road";

/** Freeways + major arterials in OSM — hidden when "hide highways" is on. */
const ARTERIAL_HIGHWAY = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
]);

export function isArterialHighway(highway: string): boolean {
  return ARTERIAL_HIGHWAY.has(highway);
}

interface OverpassWay {
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/** Fetch the drivable road network within `radius` metres of (lat, lon). */
export async function fetchRoads(
  lat: number,
  lon: number,
  radius: number,
  place: string,
  signal?: AbortSignal,
): Promise<RoadData> {
  const q = `[out:json][timeout:60];
way["highway"~"^(${HIGHWAY_FILTER})$"](around:${Math.round(radius)},${lat},${lon});
out geom;`;
  const res = await fetch(OVERPASS, {
    method: "POST",
    body: "data=" + encodeURIComponent(q),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
  });
  if (!res.ok) {
    if (res.status === 429 || res.status === 504)
      throw new Error("Overpass is busy — try a smaller radius or wait a moment.");
    throw new Error(`Overpass error ${res.status}`);
  }
  const json = (await res.json()) as { elements?: OverpassWay[] };
  const ways: RoadWay[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const pts = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
    ways.push({
      designation: classify(el.tags ?? {}),
      highway: el.tags?.highway ?? "",
      pts,
      length: haversineLen(pts),
    });
  }
  // longest first inside each designation looks best drawing in
  ways.sort((a, b) => b.length - a.length);
  return { center: { lat, lon }, radius, ways, place };
}

// A pre-fetched road network shipped as a static asset, so the default view
// needs no Overpass call. `t` = the classifier tags, `g` = [lat, lon] points.
interface Snapshot {
  center: LatLng;
  radius: number;
  place: string;
  elements: Array<{ t: Record<string, string>; g: [number, number][] }>;
}

/** Load a saved road snapshot from a URL and classify it with the same rules
 *  as a live fetch. */
export async function loadSnapshot(url: string): Promise<RoadData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Saved roads ${res.status}`);
  const snap = (await res.json()) as Snapshot;
  const ways: RoadWay[] = [];
  for (const el of snap.elements) {
    if (!el.g || el.g.length < 2) continue;
    const pts = el.g.map(([lat, lon]) => ({ lat, lon }));
    ways.push({
      designation: classify(el.t ?? {}),
      highway: el.t?.highway ?? "",
      pts,
      length: haversineLen(pts),
    });
  }
  ways.sort((a, b) => b.length - a.length);
  return { center: snap.center, radius: snap.radius, ways, place: snap.place };
}

/** Draw an image to cover a w×h box (object-fit: cover), centered. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
) {
  const ir = img.width / img.height;
  const fr = w / h;
  let dw: number;
  let dh: number;
  if (ir > fr) {
    dh = h;
    dw = h * ir;
  } else {
    dw = w;
    dh = w / ir;
  }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Draw an image inside a w×h box (object-fit: contain), centered. */
export function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
) {
  const ir = img.width / img.height;
  const fr = w / h;
  let dw: number;
  let dh: number;
  if (ir > fr) {
    dw = w;
    dh = w / ir;
  } else {
    dh = h;
    dw = h * ir;
  }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Alpha mask from an uploaded silhouette — PNG/SVG alpha, or dark-on-light raster. */
export function buildShapeMask(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  drawContain(ctx, img, size, size);
  const id = ctx.getImageData(0, 0, size, size);
  const d = id.data;
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 252) {
      hasAlpha = true;
      break;
    }
  }
  if (hasAlpha) {
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = a;
    }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = lum < 140 ? 255 : 0;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** Build a lat/lon → canvas projector for a square of `size` px, with the
 *  circle of `radius` metres inscribed. Local equirectangular tangent plane.
 *  An optional view applies a zoom (about the canvas centre) and pan in px. */
export function makeProjector(
  center: LatLng,
  radius: number,
  w: number,
  h: number,
  view?: View,
) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((center.lat * Math.PI) / 180);
  const zoom = view?.zoom ?? 1;
  const panX = view?.panX ?? 0;
  const panY = view?.panY ?? 0;
  // Uniform scale (no distortion), based on the longer edge so the fetched
  // radius covers the frame — the shorter edge is cropped rather than
  // letterboxed. A square (w === h) keeps the original framing.
  const scale = (Math.max(w, h) / 2 / radius) * zoom; // px per metre
  const cx = w / 2;
  const cy = h / 2;
  return (p: LatLng) => {
    const ex = (p.lon - center.lon) * mPerDegLon;
    const ny = (p.lat - center.lat) * mPerDegLat;
    return { x: cx + ex * scale + panX, y: cy - ny * scale + panY };
  };
}

/** Largest pan (px) per axis that keeps zoomed content covering the frame. */
export function maxPan(w: number, h: number, zoom: number): { x: number; y: number } {
  const content = Math.max(w, h) * zoom;
  return {
    x: Math.max(0, (content - w) / 2),
    y: Math.max(0, (content - h) / 2),
  };
}

/** Designations actually present, in reveal order. */
export function presentDesignations(data: RoadData): Designation[] {
  const seen = new Set(data.ways.map((w) => w.designation));
  return REVEAL_ORDER.filter((d) => seen.has(d));
}
