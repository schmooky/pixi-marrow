import { BrowserAdapter, DOMAdapter, type ICanvas } from 'pixi.js';

/*
 * Tests run in node: there is no DOM and no WebGL. Pixi only needs a canvas when it
 * probes shader precision, so hand it one without a context (it falls back to mediump).
 */
DOMAdapter.set({
    ...BrowserAdapter,
    createCanvas: (width = 1, height = 1) => ({ width, height, getContext: () => null }) as unknown as ICanvas,
});
