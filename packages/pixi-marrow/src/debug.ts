/**
 * The debug overlays of pixi-marrow: bones, attachment shapes, bounding boxes, clipping, paths,
 * point attachments, events and overdraw, drawn over a `MarrowSpine`. An entry of its own, so a
 * game that does not import it carries none of it. It draws with pixi-silk, an optional peer:
 * install `pixi-silk` next to `pixi.js` to use it.
 *
 * @example
 * const debug = new MarrowDebug(hero, { layers: { overdraw: true } });
 */
export type { DebugLayer, DebugOptions } from './debug/overlay';
export { DEBUG_COLORS, DEBUG_LAYERS, MarrowDebug } from './debug/overlay';
export type { DebugShapes, PathShape } from './debug/shapes';
export { collectShapes } from './debug/shapes';
