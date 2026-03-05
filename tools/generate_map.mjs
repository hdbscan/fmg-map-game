#!/usr/bin/env bun
// Headless-ish FMG SVG generator using linkedom DOM shim.
// Goal: generate an FMG-style map SVG and write it to disk for Godot to display.

import { parseHTML } from "linkedom";
import * as d3 from "d3";
import Alea from "alea";
import { generateGrid } from "./fmg/src/utils/graphUtils.ts";

const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : new URL("../godot/generated/latest.svg", import.meta.url).pathname;

const WIDTH = Number(process.env.FMG_WIDTH ?? "2000");
const HEIGHT = Number(process.env.FMG_HEIGHT ?? "1200");
const SEED = process.env.FMG_SEED ?? String(Math.floor(Math.random() * 1e9));

const { window, document, Node, Event, CustomEvent, Element } = parseHTML(
  "<!doctype html><html><body></body></html>",
);

// ---- globals expected by FMG ----
globalThis.window = window;
globalThis.document = document;
globalThis.Node = Node;
globalThis.Event = Event;
globalThis.CustomEvent = CustomEvent;
globalThis.navigator = { userAgent: "bun-fmg-headless" };

// FMG debug flags used across modules
// Keep them defined to avoid ReferenceError.
globalThis.PRODUCTION = false;
globalThis.DEBUG = {};
globalThis.INFO = false;
globalThis.TIME = false;
globalThis.WARN = false;
globalThis.ERROR = true;

// d3 is used as a global in parts of FMG (e.g. old main.js); safe to expose.
globalThis.d3 = d3;

// timers
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// linkedom innerText setter shim
Object.defineProperty(Element.prototype, "innerText", {
  get() {
    return this.textContent;
  },
  set(v) {
    this.textContent = String(v);
  },
  configurable: true,
});

// ---- DOM stubs required by some modules ----
function addInput(id, value = "") {
  const el = document.createElement("input");
  el.setAttribute("id", id);
  el.value = value;
  document.body.appendChild(el);
  return el;
}

const styleSelectFont = document.createElement("select");
styleSelectFont.id = "styleSelectFont";
document.body.appendChild(styleSelectFont);

// Grid generator expects pointsInput.dataset.cells
{
  const el = addInput("pointsInput", "");
  el.dataset.cells = String(process.env.FMG_CELLS ?? "10000");
}

// HeightmapGenerator expects a template id here
addInput("templateInput", process.env.FMG_TEMPLATE ?? "pangea");

class FontFaceStub {
  constructor() {}
  load() {
    return Promise.resolve(this);
  }
}
globalThis.FontFace = FontFaceStub;
if (!document.fonts) document.fonts = { add() {} };

// Provide polygonclip/lineclip used by clipPoly in utils.
// FMG bundles these in public/libs/lineclip.min.js; for now a no-op clip is OK.
// Provide polygonclip/lineclip used by clipPoly in utils.
// Implemented inline (from FMG's public/libs/lineclip.min.js) to avoid eval quirks.
{
  function bitCode(p, bbox) {
    let code = 0;
    if (p[0] < bbox[0]) code |= 1;
    else if (p[0] > bbox[2]) code |= 2;
    if (p[1] < bbox[1]) code |= 4;
    else if (p[1] > bbox[3]) code |= 8;
    return code;
  }

  function intersect(a, b, edge, bbox) {
    return edge & 8
      ? [a[0] + (b[0] - a[0]) * (bbox[3] - a[1]) / (b[1] - a[1]), bbox[3]]
      : edge & 4
        ? [a[0] + (b[0] - a[0]) * (bbox[1] - a[1]) / (b[1] - a[1]), bbox[1]]
        : edge & 2
          ? [bbox[2], a[1] + (b[1] - a[1]) * (bbox[2] - a[0]) / (b[0] - a[0])]
          : edge & 1
            ? [bbox[0], a[1] + (b[1] - a[1]) * (bbox[0] - a[0]) / (b[0] - a[0])]
            : null;
  }

  window.lineclip = function lineclip(points, bbox, result) {
    let codeA = bitCode(points[0], bbox);
    const out = [];
    result = result || [];

    for (let i = 1; i < points.length; i++) {
      let a = points[i - 1];
      let b = points[i];
      let codeB = bitCode(b, bbox);
      let lastCodeB = codeB;

      while (true) {
        if (!(codeA | codeB)) {
          out.push(a);
          if (codeB !== lastCodeB) {
            out.push(b);
            if (i < points.length - 1) {
              result.push(out);
              out.length = 0;
            }
          } else if (i === points.length - 1) out.push(b);
          break;
        }
        if (codeA & codeB) break;
        if (codeA) {
          a = intersect(a, b, codeA, bbox);
          codeA = bitCode(a, bbox);
        } else {
          b = intersect(a, b, codeB, bbox);
          codeB = bitCode(b, bbox);
        }
      }

      codeA = lastCodeB;
    }

    if (out.length) result.push(out);
    return result;
  };

  window.polygonclip = function polygonclip(points, bbox, secure = 0) {
    let result;
    let edge = 1;

    for (; edge <= 8; edge *= 2) {
      result = [];
      let prev = points[points.length - 1];
      let prevInside = !(bitCode(prev, bbox) & edge);

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const inside = !(bitCode(p, bbox) & edge);
        const crossing = inside !== prevInside;
        const inter = intersect(prev, p, edge, bbox);

        if (crossing && inter) {
          result.push(inter);
          if (secure) result.push(inter, inter);
        }
        if (inside) result.push(p);

        prev = p;
        prevInside = inside;
      }

      points = result;
      if (!points.length) break;
    }

    return result;
  };
}


// ---- Create minimal SVG + layer selections expected by renderers ----
// Create <svg id="map"><defs><g id="deftemp">...</g></defs><g id="viewbox"/>
const svgEl = document.createElement("svg");
svgEl.setAttribute("id", "map");
svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
svgEl.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
svgEl.setAttribute("width", String(WIDTH));
svgEl.setAttribute("height", String(HEIGHT));
svgEl.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
document.body.appendChild(svgEl);

// Add a solid background so viewers that default to transparent don't look blank.
d3.select(svgEl)
  .append("rect")
  .attr("id", "bg")
  .attr("x", 0)
  .attr("y", 0)
  .attr("width", WIDTH)
  .attr("height", HEIGHT)
  .attr("fill", "#0b1020");

const defsEl = document.createElement("defs");
svgEl.appendChild(defsEl);
const deftemp = document.createElement("g");
deftemp.setAttribute("id", "deftemp");
// groups used by drawFeatures
for (const id of ["featurePaths", "textPaths", "statePaths", "defs-emblems"]) {
  const g = document.createElement("g");
  g.setAttribute("id", id);
  deftemp.appendChild(g);
}
const landMask = document.createElement("mask");
landMask.setAttribute("id", "land");
deftemp.appendChild(landMask);
const waterMask = document.createElement("mask");
waterMask.setAttribute("id", "water");
deftemp.appendChild(waterMask);
defsEl.appendChild(deftemp);

const viewboxEl = document.createElement("g");
viewboxEl.setAttribute("id", "viewbox");
svgEl.appendChild(viewboxEl);

const scaleBarEl = document.createElement("g");
scaleBarEl.setAttribute("id", "scaleBar");
const scaleBarBack = document.createElement("rect");
scaleBarBack.setAttribute("id", "scaleBarBack");
scaleBarEl.appendChild(scaleBarBack);
svgEl.appendChild(scaleBarEl);

// d3 selections (global variables used by renderers)
globalThis.svg = d3.select(svgEl);
globalThis.defs = globalThis.svg.select("#deftemp");
globalThis.viewbox = globalThis.svg.select("#viewbox");
globalThis.scaleBar = globalThis.svg.select("#scaleBar");

// Minimal set of groups used by the TS renderers we call
// (we’re not trying to replicate the whole UI.)
globalThis.terrs = globalThis.viewbox.append("g").attr("id", "terrs");
const oceanHeights = globalThis.terrs.append("g").attr("id", "oceanHeights");
const landHeights = globalThis.terrs.append("g").attr("id", "landHeights");
// render options for drawHeightmap
oceanHeights.attr("data-render", "0");
landHeights.attr("skip", "0").attr("relax", "0");

// groups for features renderer
globalThis.lakes = globalThis.viewbox.append("g").attr("id", "lakes");
for (const id of ["freshwater", "salt", "sinkhole", "frozen", "lava", "dry"]) {
  globalThis.lakes.append("g").attr("id", id);
}

globalThis.coastline = globalThis.viewbox.append("g").attr("id", "coastline");
for (const id of ["sea_island", "lake_island"]) {
  globalThis.coastline.append("g").attr("id", id);
}

// graph dims expected by some functions
globalThis.graphWidth = WIDTH;
globalThis.graphHeight = HEIGHT;

// Fallback simplify (FMG browser uses simplify.js). Start with no-op.
// It’s enough to get a valid SVG; we can optimize later.
// Load FMG bundled simplify implementation from public/libs/simplify.js
{
  const p = new URL("./fmg/public/libs/simplify.js", import.meta.url);
  const js = await Bun.file(p).text();
  (0, eval)(js);
  // simplify is now a global function
  globalThis.simplify = globalThis.simplify || ((pts) => pts);
}


// Color helpers normally set up by FMG main.js
// Provide minimal implementations for drawHeightmap.
globalThis.getColorScheme = (_scheme) => {
  return (t) => {
    // t is 0..100
    const v = Math.max(0, Math.min(255, Math.round((t / 100) * 255)));
    const hex = v.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
  };
};
globalThis.getColor = (height, scheme) => scheme(height);

// ---- Load heightmap templates (browser file) into globalThis.heightmapTemplates ----
{
  const p = new URL("./fmg/public/config/heightmap-templates.js", import.meta.url);
  let js = await Bun.file(p).text();
  // Rewrite top-level const binding into a global assignment.
  js = js.replace("const heightmapTemplates =", "globalThis.heightmapTemplates =");
  // Execute in the current global scope.
  (0, eval)(js);
}

// ---- Import FMG code (TS modules) ----
await import("./fmg/src/utils/index.ts");
await import("./fmg/src/modules/index.ts");
await import("./fmg/src/renderers/index.ts");

// Make window.* helpers accessible as real globals for renderers that call
// connectVertices(...) instead of window.connectVertices(...)
for (const k of Object.keys(window)) {
  if (!(k in globalThis)) globalThis[k] = window[k];
}

// ---- Generate map (minimal pipeline) ----
// Seed
// Many modules read `seed` global.
globalThis.seed = SEED;
Math.random = Alea(SEED);

// Grid
// Many modules read `grid` global.
globalThis.grid = generateGrid(SEED, WIDTH, HEIGHT);

// Heightmap
// HeightmapGenerator is attached to window by module init.
// It returns an array assigned to grid.cells.h.
globalThis.grid.cells.h = await window.HeightmapGenerator.generate(globalThis.grid);

// Pack: for now, use grid as pack (avoid main.js reGraph complexity)
// Enough for Features.markupPack + drawHeightmap/drawFeatures.
globalThis.pack = {
  cells: globalThis.grid.cells,
  vertices: globalThis.grid.vertices,
};
// Some algorithms assume pack.cells.p exists (points per cell)
if (!globalThis.pack.cells.p) globalThis.pack.cells.p = globalThis.grid.points;

// Feature markup
window.Features.markupGrid();
window.Features.markupPack();

// ---- Render (SVG) ----
// Height contours + land/water feature paths
window.drawHeightmap();
window.drawFeatures();

// Godot's SVG rasterizer is limited and often doesn't support <use href="#...">.
// Flatten <use> elements by inlining referenced paths.
{
  const uses = Array.from(svgEl.querySelectorAll("use"));
  for (const u of uses) {
    const href = u.getAttribute("href") || u.getAttribute("xlink:href");
    if (!href || !href.startsWith("#")) continue;
    const id = href.slice(1);
    // CSS.escape is not available in this headless env; ids here are simple (feature_123)
    const ref = svgEl.querySelector(`#${id}`);
    if (!ref) continue;

    // Clone referenced element and merge attributes from <use>
    const clone = ref.cloneNode(true);
    // drop id to avoid duplicates
    clone.removeAttribute("id");
    for (const attr of u.getAttributeNames()) {
      if (attr === "href" || attr === "xlink:href") continue;
      clone.setAttribute(attr, u.getAttribute(attr));
    }
    u.replaceWith(clone);
  }
}

// Metadata
// add a tiny label
globalThis.svg
  .append("text")
  .attr("x", 20)
  .attr("y", 50)
  .attr("fill", "#e2e8f0")
  .attr("font-size", 32)
  .text(`seed: ${SEED}`);

// Write SVG
const outSvg = svgEl.outerHTML;
await Bun.write(OUT, outSvg);
console.log(`Wrote: ${OUT}`);
