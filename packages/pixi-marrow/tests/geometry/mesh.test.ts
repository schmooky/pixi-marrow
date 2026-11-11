import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importAtlas } from '../../src/formats/atlas';
import { importSkeleton } from '../../src/formats/import';
import { type AtlasRegion, attachmentRegions, findRegion, readRegion } from '../../src/geometry/atlas-regions';
import { computeMeshUVs } from '../../src/geometry/mesh';
import type { MeshAttachmentData } from '../../src/model/attachments';
import { createAttachmentLookup, meshSource } from '../../src/pose/shared/lookup';
import { ATLAS_TEXT, regionName, syntheticRig } from './synthetic';

/*
 * Numbers worked out by hand. The page is 256x128 pixels, so every expected coordinate is exact.
 * The parity test and the synthetic rig compare the same function with the official cores.
 */

const atlas = importAtlas(ATLAS_TEXT);
const region = (degrees: number, trimmed: boolean): AtlasRegion =>
    readRegion(atlas, findRegion(atlas, regionName(degrees, trimmed)));

/** The corners of the image, then a point at a half and a quarter. */
const REGION_UVS = Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.25);

/** Texture coordinates from pixel positions on the 256x128 page. */
const onPage = (...pixels: number[]): number[] => pixels.map((pixel, i) => pixel / (i % 2 === 0 ? 256 : 128));

function uvs(on: AtlasRegion, regionUVs: Float32Array = REGION_UVS): number[] {
    const out = new Float32Array(regionUVs.length);

    computeMeshUVs(on, regionUVs, out);

    return Array.from(out);
}

describe('computeMeshUVs', () => {
    it('maps region UVs onto an upright region', () => {
        // 40x30 pixels at 2, 2
        expect(uvs(region(0, false))).toEqual(onPage(2, 2, 42, 2, 42, 32, 2, 32, 22, 9.5));
    });

    it('maps region UVs onto the whole image of a trimmed region', () => {
        // 36x22 pixels at 2, 60, cut from a 44x32 image: 3 from the left, 5 from the bottom, so 5 from the top
        expect(uvs(region(0, true))).toEqual(onPage(-1, 55, 43, 55, 43, 87, -1, 87, 21, 63));
    });

    it('turns region UVs for a region rotated by 90 degrees', () => {
        // on the page the image is 30 wide and 40 high, and u runs up
        expect(uvs(region(90, false))).toEqual(onPage(52, 42, 52, 2, 82, 2, 82, 42, 59.5, 22));
        expect(uvs(region(90, true))).toEqual(onPage(47, 99, 47, 55, 79, 55, 79, 99, 55, 77));
    });

    it('turns region UVs for a region rotated by 180 degrees', () => {
        expect(uvs(region(180, false))).toEqual(onPage(142, 32, 102, 32, 102, 2, 142, 2, 122, 24.5));
        expect(uvs(region(180, true))).toEqual(onPage(141, 87, 97, 87, 97, 55, 141, 55, 119, 79));
    });

    it('turns region UVs for a region rotated by 270 degrees', () => {
        expect(uvs(region(270, false))).toEqual(onPage(182, 2, 182, 42, 152, 42, 152, 2, 174.5, 22));
        expect(uvs(region(270, true))).toEqual(onPage(179, 57, 179, 101, 147, 101, 147, 57, 171, 79));
    });

    it('stores 32-bit floats', () => {
        const out = new Float64Array(2);

        computeMeshUVs(region(0, false), Float32Array.of(1 / 3, 1 / 7), out);
        expect(Array.from(out).every((value) => Math.fround(value) === value)).toBe(true);
        expect(out[0]).toBeCloseTo((2 + 40 / 3) / 256, 7);
        expect(out[1]).toBeCloseTo((2 + 30 / 7) / 128, 7);
    });

    it('takes region UVs of 64 bits and uses all of them', () => {
        // the official JSON reader keeps region UVs like these, which 32 bits cannot hold
        const wide = Float64Array.of(1 / 3, 1 / 7);
        const fromWide = new Float64Array(2);
        const fromRounded = new Float64Array(2);

        computeMeshUVs(region(0, false), wide, fromWide);
        computeMeshUVs(region(0, false), Float32Array.from(wide), fromRounded);
        expect(fromWide[0]).toBe(Math.fround(2 / 256 + (1 / 3) * (40 / 256)));
        expect(fromWide[1]).toBe(Math.fround(2 / 128 + (1 / 7) * (30 / 128)));
        expect(fromRounded[0]).toBe(Math.fround(2 / 256 + Math.fround(1 / 3) * (40 / 256)));
    });

    it('writes one pair every stride numbers from the offset on', () => {
        const out = new Float32Array(9).fill(9);

        computeMeshUVs(region(0, false), Float32Array.of(0, 0, 1, 1), out, 2, 3);
        expect(Array.from(out)).toEqual([9, 9, 2 / 256, 2 / 128, 9, 42 / 256, 32 / 128, 9, 9]);
    });

    it('refuses region UVs that end in the middle of a pair', () => {
        const half = (): void => computeMeshUVs(region(0, false), Float32Array.of(0, 0, 1), new Float32Array(4));

        expect(half).toThrow(MarrowError);
    });
});

describe('linked meshes', () => {
    /** A mesh of the default skin of the synthetic rig. */
    async function load(slotName: string, name: string) {
        const model = await importSkeleton(syntheticRig('4.2').skeleton);
        const lookup = createAttachmentLookup(model);
        const found = lookup.get(lookup.defaultSkin, model.slots.names.indexOf(slotName), name);

        if (found?.type !== 'mesh') throw new Error(`${slotName}/${name} is not a mesh`);

        return { mesh: found, source: meshSource(lookup, found) };
    }

    /** The texture coordinates a renderer computes for a mesh: its own region, the region UVs of its source. */
    const meshUvs = (mesh: MeshAttachmentData, source: MeshAttachmentData): number[] =>
        uvs(readRegion(atlas, attachmentRegions(atlas, mesh)[0] ?? -1), source.regionUVs);

    it('has no geometry of its own', async () => {
        const { mesh, source } = await load('linked', 'linked-270');

        expect([mesh.regionUVs.length, mesh.vertices.length, mesh.worldVerticesLength]).toEqual([0, 0, 0]);
        expect(source.name).toBe('source');
        expect(Array.from(source.regionUVs)).toEqual(Array.from(REGION_UVS));
    });

    it('maps the region UVs of its source onto its own region', async () => {
        const { mesh, source } = await load('linked', 'linked-270');

        expect(mesh.path).toBe(regionName(270, true));
        expect(meshUvs(mesh, source)).toEqual(uvs(region(270, true)));
        // the source itself shows another region
        expect(meshUvs(source, source)).toEqual(uvs(region(0, false)));
    });

    it('follows a chain of linked meshes to the mesh that holds the geometry', async () => {
        const { mesh, source } = await load('linked', 'linked-chain');

        expect(mesh.parent?.name).toBe('linked-270');
        expect(source.name).toBe('source');
        expect(meshUvs(mesh, source)).toEqual(uvs(region(90, false)));
    });
});
