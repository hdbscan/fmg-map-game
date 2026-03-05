#!/usr/bin/env bun
// Headless-ish FMG SVG generator (WIP): boot a lightweight DOM (linkedom) and import FMG modules.
// Next step will call the actual generation pipeline and renderers.

import { parseHTML } from 'linkedom';

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : new URL('../godot/generated/latest.svg', import.meta.url).pathname;

const { window, document, Node, Event, CustomEvent, Element } = parseHTML('<!doctype html><html><body></body></html>');

// globals expected by FMG
globalThis.window = window;
globalThis.document = document;
globalThis.Node = Node;
globalThis.Event = Event;
globalThis.CustomEvent = CustomEvent;
globalThis.navigator = { userAgent: 'bun-fmg-headless' };

globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

Object.defineProperty(Element.prototype, 'innerText', {
  get() { return this.textContent; },
  set(v) { this.textContent = String(v); },
  configurable: true,
});

// stubs required by fonts module
const styleSelectFont = document.createElement('select');
styleSelectFont.id = 'styleSelectFont';
document.body.appendChild(styleSelectFont);
class FontFaceStub { constructor(){} load(){ return Promise.resolve(this); } }
globalThis.FontFace = FontFaceStub;
if (!document.fonts) document.fonts = { add(){} };

// Import FMG TS modules directly from the submodule.
// NOTE: This just proves loading works. Real generation comes next.
await import('../tools/fmg/src/utils/index.ts');
await import('../tools/fmg/src/modules/index.ts');
await import('../tools/fmg/src/renderers/index.ts');

// Placeholder output so pipeline is end-to-end
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200" viewBox="0 0 2000 1200">
  <rect width="2000" height="1200" fill="#0f172a"/>
  <text x="40" y="80" font-size="56" fill="#e2e8f0">FMG generator loaded (next: actual map generation)</text>
</svg>`;

await Bun.write(OUT, svg);
console.log(`Wrote: ${OUT}`);
