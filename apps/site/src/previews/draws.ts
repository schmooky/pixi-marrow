/*
 * A draw call counter for one WebGL context. It wraps the draw methods of that context only, so
 * the canvases of other previews on the page do not count.
 */

/** The draw methods of WebGL2 that are counted. */
const DRAWS = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const;

/**
 * Counts the draw calls of one WebGL context, by wrapping its methods. Set `count` back to 0 to
 * start again.
 *
 * @example
 * const counter = countDraws(gl);
 * app.ticker.add(() => {
 *     show(counter.count);
 *     counter.count = 0;
 * });
 */
export function countDraws(gl: WebGL2RenderingContext): { count: number } {
    const counter = { count: 0 };

    for (const name of DRAWS) {
        const original = gl[name].bind(gl) as (...args: unknown[]) => void;

        Reflect.set(gl, name, (...args: unknown[]) => {
            counter.count++;
            original(...args);
        });
    }

    return counter;
}
