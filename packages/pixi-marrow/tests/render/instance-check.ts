import type { BufferImageSource } from 'pixi.js';
import type { AtlasModel } from '../../src/model/atlas';
import type { InstanceLayout, Union } from '../../src/render/instance-layout';
import type { InstancePaint } from '../../src/render/instance-paint';
import { NO_ENTRY, POOL_STRIDE, type PoolSlot } from '../../src/render/instance-pool';
import { STATIC_STRIDE } from '../../src/render/template';
import { createRig, fixtureFiles, meshes, type Rig } from './rig';
import { skinData } from './skin-check';

/*
 * What a view that draws instanced hands the GPU, read from the outside: the buffers of its
 * layout, the index buffer of its draw order and its slot in the textures of a pool. The vertex
 * shader of `instance-shader.ts` is played here in JavaScript, and the one of a view that draws
 * alone in the same way from what that view hands the GPU. A test holds the two against each
 * other: equal numbers in, equal numbers out.
 */

/** What one vertex of a draw is: where it lands, what it samples and how it is tinted. */
export interface ShadedVertex {
    x: number;
    y: number;
    u: number;
    v: number;
    /** The page of its triangle. */
    page: number;
    /** The light color, then the dark color with its flag, as bytes. */
    colors: number[];
}

/** The instanced draw of a view, which must exist. */
export function instanceOf(rig: Rig): InstancePaint {
    const instance = rig.view.parts.paints.mesh?.instanced;

    if (instance === undefined) throw new Error('the view draws alone');

    return instance;
}

/** The pieces of the instanced draw of a view. */
function piecesOf(rig: Rig): { slot: PoolSlot; layout: InstanceLayout; union: Union } {
    const { slot, layout, union } = instanceOf(rig);

    if (slot === undefined || layout === undefined || union === undefined) throw new Error('the view draws alone');

    return { slot, layout, union };
}

/** The typed array a buffer or a data texture holds. */
function dataOf<T>(holder: { data: unknown } | BufferImageSource, type: new (length: number) => T): T {
    const data: unknown = 'resource' in holder ? holder.resource : holder.data;

    if (!(data instanceof type)) throw new Error(`the data is no ${type.name}`);

    return data;
}

/** A number of an array, or NaN past its end. */
const at = (array: ArrayLike<number>, index: number): number => array[index] ?? Number.NaN;

/**
 * Plays the vertex shader of the instanced draw of a view over its union. Returns the vertices
 * of the triangles it keeps, by vertex number. A vertex of a slot that shows another entry, or
 * none, is dropped.
 */
export function shadeInstanced(rig: Rig): Map<number, ShadedVertex> {
    const { slot, layout, union } = piecesOf(rig);
    const { pool } = slot;
    const indices = dataOf(union.buffer, Uint16Array);
    const skin = dataOf(layout.skin, Uint32Array);
    const entries = dataOf(layout.entries, Uint32Array);
    const statics = dataOf(layout.statics, Float32Array);
    const influences = dataOf(layout.influences as BufferImageSource, Float32Array);
    const pose = pool.poseData;
    const palette = pool.paletteData;
    const out = new Map<number, ShadedVertex>();

    for (let i = 0; i < union.count; i++) {
        const vertex = at(indices, i);
        const word = at(skin, vertex * 2 + 1);
        const owner = word >>> 16;
        const texel = (slot.paletteBase + owner * 3) * 4;
        const shown = at(palette, texel + 8) | (at(palette, texel + 9) << 8);

        if (shown !== at(entries, vertex * 2) || shown === NO_ENTRY) continue;
        const colors = Array.from(palette.subarray(texel, texel + 8));
        const count = word & 0xffff;
        const cpu = count === 0 || at(colors, 7) > 127;
        const cpuWord = at(entries, vertex * 2 + 1);
        const fromTexel = cpuWord >= 0x80000000;
        const cpuAt = (slot.cpuBase + (cpuWord & 0x7fffffff)) * 4;
        let x = 0;
        let y = 0;

        if (cpu) {
            x = at(pose, cpuAt);
            y = at(pose, cpuAt + 1);
        } else {
            for (let k = at(skin, vertex * 2); k < at(skin, vertex * 2) + count; k++) {
                const m = slot.poseBase * 4 + at(influences, k * 4) * 6;
                const bone = (n: number): number => at(pose, m + n);
                const vx = at(influences, k * 4 + 1);
                const vy = at(influences, k * 4 + 2);
                const weight = at(influences, k * 4 + 3);

                x += (vx * bone(0) + vy * bone(1) + bone(4)) * weight;
                y += (vx * bone(2) + vy * bone(3) + bone(5)) * weight;
            }
        }
        out.set(vertex, {
            x,
            y,
            u: fromTexel ? at(pose, cpuAt + 2) : at(statics, vertex * STATIC_STRIDE),
            v: fromTexel ? at(pose, cpuAt + 3) : at(statics, vertex * STATIC_STRIDE + 1),
            page: at(palette, texel + 10),
            colors,
        });
    }

    return out;
}

/** Plays the vertex shader of a view that draws alone over its index buffers, as {@link shadeInstanced} does. */
export function shadeAlone(rig: Rig): Map<number, ShadedVertex> {
    // a view that shows nothing has no mesh that draws
    if (meshes(rig.view).length === 0) return new Map();
    const data = skinData(rig);
    const flags = new Uint8Array(data.statics.buffer, data.statics.byteOffset, data.statics.byteLength);
    const out = new Map<number, ShadedVertex>();

    for (const mesh of meshes(rig.view)) {
        const indices: unknown = mesh.geometry.indexBuffer.data;

        if (!(indices instanceof Uint16Array)) throw new Error('the index buffer is no Uint16Array');
        for (let i = 0; i < (mesh.geometry.indexCount ?? indices.length); i++) {
            const vertex = at(indices, i);
            const word = at(data.skin, vertex * 2 + 1);
            const owner = word >>> 16;
            const colors = Array.from(data.palette.subarray(owner * 8, owner * 8 + 8));
            const count = word & 0xffff;
            let x = at(data.positions, vertex * 2);
            let y = at(data.positions, vertex * 2 + 1);

            if (count > 0 && at(colors, 7) <= 127) {
                x = 0;
                y = 0;
                for (let k = at(data.skin, vertex * 2); k < at(data.skin, vertex * 2) + count; k++) {
                    const m = at(data.influences, k * 4) * 6;
                    const bone = (n: number): number => at(data.bones, m + n);
                    const vx = at(data.influences, k * 4 + 1);
                    const vy = at(data.influences, k * 4 + 2);
                    const weight = at(data.influences, k * 4 + 3);

                    x += (vx * bone(0) + vy * bone(1) + bone(4)) * weight;
                    y += (vx * bone(2) + vy * bone(3) + bone(5)) * weight;
                }
            }
            out.set(vertex, {
                x,
                y,
                u: at(data.statics, vertex * STATIC_STRIDE),
                v: at(data.statics, vertex * STATIC_STRIDE + 1),
                page: at(flags, vertex * STATIC_STRIDE * 4 + 8),
                colors,
            });
        }
    }

    return out;
}

/** The entry each slot of the skeleton shows in the palette of an instanced view, or {@link NO_ENTRY}. */
export function shownEntries(rig: Rig): number[] {
    const { slot } = piecesOf(rig);

    return Array.from({ length: rig.model.slots.count }, (_, owner) => {
        const texel = owner * POOL_STRIDE;

        return at(slot.colors, texel + 8) | (at(slot.colors, texel + 9) << 8);
    });
}

/** A fixture in the mesh mode with `skinning: 'gpu'`, drawing instanced, or alone with `alone`. */
export const loadInstanced = (
    id: string,
    alone = false,
    more: (atlas: AtlasModel) => object = () => ({}),
): Promise<Rig> =>
    createRig(fixtureFiles(id), undefined, {
        options: (atlas) => ({
            renderMode: 'mesh',
            skinning: 'gpu',
            instancing: alone ? 'off' : 'auto',
            ...more(atlas),
        }),
    });
