import { GlProgram, type Shader } from 'pixi.js';
import { webGL1 } from './context-watch';

/*
 * WebGL1 compiles GLSL 1.00 only, and the programs of this library are GLSL 3.00. Pixi falls back
 * to WebGL1 where a browser has no WebGL2: old machines, old phones, some drivers that a browser
 * blocks.
 *
 * A shader of the batched mode, of the mesh mode with `skinning: 'cpu'` and of a clip mask gets a
 * second program, made from the same sources. Pixi itself makes such a source run on WebGL1: a
 * source without `#version 300 es` gets defines that turn `in`, `out`, `texture` and `finalColor`
 * into their GLSL 1.00 names. Only `flat` has no such name. It goes, and the page of a triangle is
 * then interpolated between three equal values. The fragment stage compares it with the middle
 * between two pages, `vPage < 0.5` and up, so the error of the interpolation never picks another
 * page. The batch shader of Pixi 7 did the same.
 *
 * The shader reads its program through `glProgram`. This module puts an accessor there: in a
 * render of a WebGL1 renderer it returns the second program, in all other renders the first one.
 * So WebGL2 compiles the same source as before, and its picture keeps every bit. The second
 * program is made the first time a WebGL1 renderer asks for it.
 *
 * The shaders of `skinning: 'gpu'` and of instanced draws get no second program. They read data
 * textures with `texelFetch` and integer math, which GLSL 1.00 does not have. On WebGL1 those
 * views draw nothing, and the console warns once.
 */

/** The shaders that have a program for WebGL1. */
const served = new WeakSet<Shader>();

/**
 * A GLSL 3.00 source as GLSL 1.00 that Pixi completes: without its version and without `flat`.
 *
 * @example
 * toGlsl100('#version 300 es\nflat out float vPage;'); // '\nout float vPage;'
 */
export function toGlsl100(source: string): string {
    return source.replace('#version 300 es', '').replace(/\bflat /g, '');
}

/**
 * Gives a shader a program for WebGL1, made from the GLSL 3.00 sources of its program. In a
 * render of a WebGL1 renderer `shader.glProgram` is then that program. Returns the shader.
 *
 * @example
 * const shader = serveWebGL1(new Shader({ glProgram, gpuProgram, resources }), name, vertex, fragment);
 */
export function serveWebGL1(shader: Shader, name: string, vertex: string, fragment: string): Shader {
    let modern: GlProgram | null = shader.glProgram;
    let old: GlProgram | undefined;

    Object.defineProperty(shader, 'glProgram', {
        configurable: true,
        enumerable: true,
        get(): GlProgram | null {
            // a destroyed shader has no program, for both versions
            if (modern === null || !webGL1()) return modern;
            old ??= GlProgram.from({ name: `${name}-100`, vertex: toGlsl100(vertex), fragment: toGlsl100(fragment) });

            return old;
        },
        set(value: GlProgram | null): void {
            modern = value;
        },
    });
    served.add(shader);

    return shader;
}

/**
 * Whether a shader can draw on the renderer of this render: always, except on WebGL1 without a
 * program of {@link serveWebGL1}.
 *
 * @example
 * if (!drawsHere(mesh.shader)) return false;
 */
export function drawsHere(shader: Shader | null): boolean {
    return !webGL1() || (shader !== null && served.has(shader));
}
