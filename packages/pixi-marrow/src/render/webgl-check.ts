import type { Renderer } from 'pixi.js';
import { MarrowError } from '../base/errors';

/**
 * Throws a {@link MarrowError} for a renderer whose WebGL context is version 1. Every program of
 * this library is written in GLSL 3.00, which WebGL1 cannot compile, and Pixi falls back to
 * WebGL1 where a browser has no WebGL2. A renderer of WebGPU, and one that does not say its
 * version, pass.
 *
 * @example
 * requireWebGL2(renderer); // throws on WebGL1
 */
export function requireWebGL2(renderer: Renderer): void {
    if (!('gl' in renderer) || renderer.context?.webGLVersion !== 1) return;
    throw new MarrowError(
        'unsupported-feature',
        'The renderer draws with WebGL1. The shaders of pixi-marrow need WebGL2 or WebGPU, and Pixi falls back to WebGL1 where a browser has no WebGL2.',
        {
            fix: 'Create the renderer with the preference "webgpu", or check renderer.context.webGLVersion before you add skeletons.',
        },
    );
}
