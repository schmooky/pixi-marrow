import { BufferImageSource, type Mesh } from 'pixi.js';
import { expect } from 'vitest';
import type { AtlasModel } from '../../src/model/atlas';
import { colorByte, darkByte } from '../../src/render/colors';
import {
    createRig,
    type Drawn,
    fixtureFiles,
    kernelPositions,
    kernelUVs,
    meshes,
    type Rig,
    readDrawn,
    readFlags,
    readUVs,
} from './rig';

/*
 * What a view with `skinning: 'gpu'` hands the GPU, read from the outside: the buffers of its
 * meshes and the data textures their shaders bind. The vertex shader is played here in
 * JavaScript, so that the positions it would compute can be held against the geometry kernel.
 * The shader adds in 32-bit floats, the kernel in 64-bit and rounds once. The two differ in the
 * last bits, which `NEAR` allows for.
 */

/** How far a position the shader computes may be from the kernel: a part of a pixel, and of the size. */
const NEAR = { absolute: 1e-3, relative: 2e-6 };

/** The arrays the vertex shader reads. */
export interface SkinData {
    positions: Float32Array;
    statics: Float32Array;
    /** Per vertex: the first influence, and the count with the slot. */
    skin: Uint32Array;
    /** Per influence: bone, x, y, weight. */
    influences: Float32Array;
    /** 6 numbers a bone: a, b, c, d, worldX, worldY. */
    bones: Float32Array;
    /** 8 bytes a slot: the light color, the dark color and the flag of the CPU. */
    palette: Uint8Array;
    /** The three data textures. */
    sources: { bones: BufferImageSource; influences: BufferImageSource; palette: BufferImageSource };
}

const isFloat32 = (data: unknown): data is Float32Array => data instanceof Float32Array;

/** A data texture a shader binds by name. */
function sourceOf(mesh: Mesh, name: string): BufferImageSource {
    const source: unknown = mesh.shader?.resources[name];

    if (!(source instanceof BufferImageSource)) throw new Error(`the shader binds no ${name}`);

    return source;
}

/** The typed array of a data texture. */
function floatsOf(source: BufferImageSource): Float32Array {
    const data: unknown = source.resource;

    if (!isFloat32(data)) throw new Error(`${source.label} holds no floats`);

    return data;
}

/** The buffers of the first mesh of a view and the data textures of its shader. */
export function skinData(rig: Rig): SkinData {
    const [mesh] = meshes(rig.view);

    if (mesh === undefined) throw new Error('the view has no mesh');
    const { geometry } = mesh;
    const positions = geometry.getBuffer('aPosition').data;
    const statics = geometry.getBuffer('aUV').data;
    const skin = geometry.getBuffer('aSkin').data;
    const sources = {
        bones: sourceOf(mesh, 'uBones'),
        influences: sourceOf(mesh, 'uInfluences'),
        palette: sourceOf(mesh, 'uPalette'),
    };
    const palette: unknown = sources.palette.resource;

    if (!isFloat32(positions) || !isFloat32(statics) || !(skin instanceof Uint32Array)) {
        throw new Error('the view draws without skinning');
    }
    if (!(palette instanceof Uint8Array)) throw new Error('the palette holds no bytes');

    return {
        positions,
        statics,
        skin,
        influences: floatsOf(sources.influences),
        bones: floatsOf(sources.bones),
        palette,
        sources,
    };
}

/** Whether the CPU places the vertices of a slot: the flag of its palette. */
export const placedByCpu = (data: SkinData, slot: number): boolean => (data.palette[slot * 8 + 7] ?? 0) > 127;

/** The positions the vertex shader computes for a range of vertices. */
function shade(data: SkinData, first: number, count: number): Float32Array {
    const out = new Float32Array(count * 2);
    const at = (array: Float32Array, index: number): number => array[index] ?? Number.NaN;

    for (let v = 0; v < count; v++) {
        const start = data.skin[(first + v) * 2] ?? 0;
        const word = data.skin[(first + v) * 2 + 1] ?? 0;
        const influences = word & 0xffff;
        let x = at(data.positions, (first + v) * 2);
        let y = at(data.positions, (first + v) * 2 + 1);

        if (influences > 0 && !placedByCpu(data, word >>> 16)) {
            x = 0;
            y = 0;
            for (let k = start; k < start + influences; k++) {
                const m = at(data.influences, k * 4) * 6;
                const bone = (i: number): number => at(data.bones, m + i);
                const vx = at(data.influences, k * 4 + 1);
                const vy = at(data.influences, k * 4 + 2);
                const weight = at(data.influences, k * 4 + 3);

                x += (vx * bone(0) + vy * bone(1) + bone(4)) * weight;
                y += (vx * bone(2) + vy * bone(3) + bone(5)) * weight;
            }
        }
        out[v * 2] = x;
        out[v * 2 + 1] = y;
    }

    return out;
}

/** The light and dark color of a slot as the palette must hold them, and the flag of the CPU. */
function expectedPalette(rig: Rig, item: Drawn, cpu: boolean): number[] {
    const { state } = rig.engine;
    const { slot, attachment } = item;
    const light = [0, 1, 2, 3].map((i) => colorByte((state.colors[slot * 4 + i] ?? 0) * (attachment.color[i] ?? 0)));
    const dark = rig.model.slots.hasDark.includes(1) && rig.model.slots.hasDark[slot] === 1;
    const darkBytes = [0, 1, 2].map((i) => (dark ? darkByte(state.darkColors[slot * 3 + i] ?? 0, light[3] ?? 0) : 0));

    return [...light, ...darkBytes, cpu ? 255 : 0];
}

/**
 * Checks every visible slot of a view with `skinning: 'gpu'` against the geometry kernel: the
 * positions the vertex shader computes, the texture coordinates, the page and the palette.
 * Returns the slots, each with whether the CPU places it.
 */
export function expectSkinned(rig: Rig): (Drawn & { cpu: boolean })[] {
    const drawn = readDrawn(rig);

    if (drawn.length === 0) return [];
    const data = skinData(rig);

    return drawn.map((item) => {
        const { slot, attachment, first, count } = item;
        const name = rig.model.slots.names[slot];
        const expected = kernelPositions(rig, slot, attachment);
        const shaded = shade(data, first, count);
        const cpu = placedByCpu(data, slot) || (data.skin[first * 2 + 1] ?? 0) % 0x10000 === 0;
        const { uvs, page } = kernelUVs(rig, slot, attachment);

        for (let i = 0; i < expected.length; i++) {
            const want = expected[i] ?? 0;
            const near = NEAR.absolute + NEAR.relative * Math.abs(want);

            expect(Math.abs((shaded[i] ?? Number.NaN) - want), `position ${i} of slot ${name}`).toBeLessThan(near);
        }
        expect(readUVs(data.statics, first, count), `texture coordinates of slot ${name}`).toEqual(uvs);
        expect(readFlags(data.statics, first).unit, `page of slot ${name}`).toBe(page % 8);
        expect(Array.from(data.palette.subarray(slot * 8, slot * 8 + 8)), `palette of slot ${name}`).toEqual(
            expectedPalette(rig, item, placedByCpu(data, slot)),
        );
        // the slot of every vertex is the slot of the entry
        for (let v = first; v < first + count; v++) expect((data.skin[v * 2 + 1] ?? 0) >>> 16).toBe(slot);

        return { ...item, cpu };
    });
}

/**
 * A fixture in the mesh mode with `skinning: 'gpu'`, drawn alone: these tests read the buffers of
 * its meshes. `instance-check.ts` reads a view that draws instanced.
 */
export const loadSkinned = (id: string, more: (atlas: AtlasModel) => object = () => ({})): Promise<Rig> =>
    createRig(fixtureFiles(id), undefined, {
        options: (atlas) => ({ renderMode: 'mesh', skinning: 'gpu', instancing: 'off', ...more(atlas) }),
    });

/** The calls of `update` of a buffer or a texture from now on, with the arguments of each. */
export function watchUpdates(target: { update: (...args: number[]) => void }): number[][] {
    const calls: number[][] = [];
    const update = target.update.bind(target);

    target.update = (...args: number[]): void => {
        calls.push(args);
        update(...args);
    };

    return calls;
}
