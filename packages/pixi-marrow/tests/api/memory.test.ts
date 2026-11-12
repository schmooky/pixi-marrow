import { Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { textureBytes, typedArrayBytes } from '../../src/api/memory';
import { type MarrowAsset, MarrowSpine } from '../../src/index';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { layoutArrayBytes } from '../../src/render/inspect';
import { buildTemplate } from '../../src/render/template';
import { createStage } from '../render/batch-stage';
import type { CoverSlot } from '../render/cover-rig';
import { PENTAGON, setPolygon } from '../render/cuts';
import { coverAsset } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';

/** A small slot behind a big one. */
const BEHIND: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
];

/*
 * The cover rig of BEHIND, counted by hand: 3 bones, 2 slots, 2 region attachments, an atlas
 * of 5 regions on one page of 512 by 512 pixels.
 */
const BONES = 3;
const SLOTS = 2;
/** Per bone: a parent, 7 setup numbers, a length and two flags. */
const BONE_TABLE = BONES * (2 + 7 * 8 + 8 + 1 + 1);
/** Per slot: a bone, a color, a dark color and three flags. */
const SLOT_TABLE = SLOTS * (2 + 4 * 8 + 3 * 8 + 1 + 1 + 1);
/** Per region attachment: its color. */
const ATTACHMENTS = 2 * 4 * 8;
/** Per atlas region: 11 integers. */
const ATLAS = 5 * 11 * 4;
/** The vertex data of two quads: positions, texture coordinates with flags, colors. */
const VERTEX_DATA = 8 * (8 + 12 + 4);
/** One range with room for the indices of two quads, 16-bit. */
const INDEX_DATA = 12 * 2;
/**
 * The vertex layout, which the instances of the asset share. The entries of the slots, then per
 * entry 9 integers, the hollow flag, an area and a tint, then the texture coordinates with flags.
 */
const LAYOUT = (SLOTS + 1) * 4 + 2 * (9 * 4 + 1 + 8 + 32) + 8 * 12;
/** Per entry, shared too: the page of its frame, the 8 offsets of its quad and the 8 of its opaque rectangle. */
const FRAMES = 2 * (4 + 8 * 4 + 8 * 8);
/** What the asset and its layout hold once, however many instances exist. */
const SHARED = BONE_TABLE + SLOT_TABLE + ATTACHMENTS + ATLAS + LAYOUT + FRAMES;
/** What an instance writes per entry: the frame, the page and two colors. Then its positions. */
const OWN = 2 * (4 * 4) + 8 * 8;
/** The colors per vertex of an instance in the mesh mode. */
const COLORS = 8 * 4;
/** The visible list and the test of covered slots, with its four rectangles, and a flag per page. */
const LISTS = SLOTS * (4 + 2 + 4) + SLOTS * (1 + 4 + 1) + (16 + 16 + 16 + 4 + 256 + 128) + 1;

describe('the bytes of typed arrays behind a value', () => {
    it('are counted through plain objects and arrays', () => {
        const value = {
            name: 'rig',
            parents: new Int16Array(4),
            nested: { setup: new Float64Array(3), list: [new Uint8Array(5), [new Float32Array(2)]] },
            nothing: null,
            count: 7,
        };

        expect(typedArrayBytes(value)).toBe(8 + 24 + 5 + 8);
        expect(typedArrayBytes(new Uint16Array(6))).toBe(12);
        expect(typedArrayBytes('text')).toBe(0);
        expect(typedArrayBytes(undefined)).toBe(0);
    });

    it('count a buffer once that several arrays share, with its whole size', () => {
        const buffer = new ArrayBuffer(64);
        const value = { a: new Float32Array(buffer, 0, 4), b: new Uint8Array(buffer, 16, 8), c: new Int32Array(2) };

        expect(typedArrayBytes(value)).toBe(64 + 8);
    });

    it('count an object once that is reached twice or through itself', () => {
        const shared = { data: new Float64Array(2) };
        const loop: { self?: unknown; first: unknown; second: unknown } = { first: shared, second: shared };

        loop.self = loop;

        expect(typedArrayBytes(loop)).toBe(16);
    });
});

describe('the bytes of page textures', () => {
    const page = (width: number, height: number): Texture =>
        new Texture({ source: new TextureSource({ width, height }) });

    it('are 4 per pixel, for every mip level a source has', () => {
        const plain = page(512, 256);
        const mipped = page(8, 2);

        mipped.source.mipLevelCount = 4;

        expect(textureBytes([plain])).toBe(512 * 256 * 4);
        // 8 by 2, 4 by 1, 2 by 1, 1 by 1
        expect(textureBytes([mipped])).toBe((16 + 4 + 2 + 1) * 4);
        expect(textureBytes([plain, mipped])).toBe(512 * 256 * 4 + 92);
        expect(textureBytes([])).toBe(0);
    });

    it('count a source once that two pages share, and the pixels of a texture with a resolution', () => {
        const one = page(16, 16);
        const sharp = new Texture({ source: new TextureSource({ width: 16, height: 16, resolution: 2 }) });

        expect(textureBytes([one, one, new Texture({ source: one.source })])).toBe(16 * 16 * 4);
        expect(textureBytes([sharp])).toBe(32 * 32 * 4);
    });
});

describe('perf.memory', () => {
    const made: MarrowSpine[] = [];

    /** A display object in the mesh mode, which the sums that were made by hand are about, unless asked otherwise. */
    function create(asset: MarrowAsset, options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { renderMode: 'mesh', ...options, autoUpdate: false });

        made.push(spine);

        return spine;
    }

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('counts a small rig as the sums that were made by hand', async () => {
        const spine = create(await coverAsset(BEHIND));

        spine.update(FRAME);
        const memory = await spine.perf.memory();

        expect(memory).toEqual({
            shared: SHARED,
            instance: spine.engine.bytes + OWN + COLORS + LISTS + INDEX_DATA,
            gpu: VERTEX_DATA + INDEX_DATA + 512 * 512 * 4,
            gpuBuffers: VERTEX_DATA + INDEX_DATA,
            gpuTextures: 512 * 512 * 4,
        });
        expect(memory.shared).toBe(610 + 262 + 200);
        expect(memory.gpuBuffers).toBe(spine.stats.bufferBytes);
    });

    it('counts a batched instance with its share of the batch buffers, and no buffer of its own', async () => {
        const stage = createStage();
        const spine = create(await coverAsset(BEHIND), { renderMode: 'batched' });
        // what the batch element keeps, as integers: an entry per slot, a flag per entry, a texture number per page, the layout
        const element = (SLOTS + 2 + 1) * 4 + (SLOTS + 1) * 4;
        // the vertex data the view draws from: its positions and the texture coordinates of its layout
        const vertexData = 8 * (8 + 12);
        // two quads in the batch: positions, then texture coordinates, color, tint and flags. 12 indices and one triangle without area
        const share = 8 * (8 + 20) + (12 + 3) * 2;
        // no color per vertex, which only the buffers of the mesh mode need
        const own = spine.engine.bytes + OWN + LISTS + element;

        spine.update(FRAME);
        // before Pixi built the instructions the skeleton is in no batch
        expect(await spine.perf.memory()).toMatchObject({ instance: own, gpuBuffers: 0, gpu: 512 * 512 * 4 });
        stage.root.addChild(spine);
        stage.render();
        const memory = await spine.perf.memory();

        expect(memory).toEqual({
            shared: SHARED,
            instance: own + share,
            gpu: share + 512 * 512 * 4,
            gpuBuffers: share,
            gpuTextures: 512 * 512 * 4,
        });
        expect(spine.stats).toMatchObject({ renderMode: 'batched', bufferBytes: vertexData + share });
        // no mesh, no geometry and no buffer below the display object
        expect(spine.children[0]?.children.map((child) => child.label)).toEqual(['marrow-batch']);
    });

    it('counts the pose of the engine in the bytes of the instance', async () => {
        const spine = create(await coverAsset(BEHIND));
        const { state } = spine.engine;
        // the arrays of the pose state, by hand: 3 bones and 2 slots
        const pose = BONES * (7 * 8 + 1 + 1 + 6 * 8) + SLOTS * (4 * 8 + 3 * 8 + 4 + 4 + 2);

        expect(state.local.byteLength + state.world.byteLength).toBe(BONES * 13 * 8);
        expect(spine.engine.bytes).toBeGreaterThanOrEqual(pose);
        expect((await spine.perf.memory()).instance).toBeGreaterThan(pose + VERTEX_DATA);
    });

    it('shares the asset and the textures between instances and counts the rest per instance', async () => {
        const asset = await coverAsset(BEHIND);
        const first = create(asset);
        const second = create(asset);

        first.update(FRAME);
        second.update(FRAME);
        const one = await first.perf.memory();
        const other = await second.perf.memory();

        expect(other).toEqual(one);
        expect(one.gpu).toBe(one.gpuBuffers + one.gpuTextures);
        // what the doc says two instances cost
        expect(one.shared + one.gpuTextures + 2 * (one.instance + one.gpuBuffers)).toBe(
            SHARED + 512 * 512 * 4 + 2 * (first.engine.bytes + OWN + COLORS + LISTS + VERTEX_DATA + 2 * INDEX_DATA),
        );
    });

    it('counts dark colors, polygons and clip masks where a view has them', async () => {
        const plain = create(await coverAsset(BEHIND));
        const asset = await coverAsset(
            [
                { name: 'cut', shows: 'big', as: 'clip' },
                { name: 'small', shows: 'small', dark: 'ff0000' },
                { name: 'big', shows: 'big' },
            ],
            { fill: (outlines) => setPolygon(outlines, 'small', PENTAGON) },
        );
        const before = asset.createEngine().bytes - plain.engine.bytes;
        const spine = create(asset, { tightMesh: 'on' });

        plain.update(FRAME);
        spine.update(FRAME);
        const less = await plain.perf.memory();
        const more = await spine.perf.memory();
        // 9 vertices with a dark color in place of 8 without, 16 indices in place of 12, a mask of a triangle
        const buffers = 9 * (8 + 12 + 8) - 8 * (8 + 12 + 4) + (16 - 12) * 2 + (6 * 4 + 4 * 2);

        expect(more.gpuBuffers - less.gpuBuffers).toBe(buffers);
        // a slot more in every list, and what the buffers hold more without the texture coordinates of the layout
        expect(more.instance - less.instance).toBe(before + buffers - 12 + (4 + 2 + 4) + (1 + 4 + 1));
        // a bone, a slot and a clipping attachment more, and the triangles of the pentagon that views share
        const model = 68 + 61 + typedArrayBytes(clipOf(asset)) + 9 * 2;

        // the layout: a slot more, the texture coordinates of a vertex more, the ten numbers of the pentagon
        expect(more.shared - less.shared).toBe(model + 4 + 12 + 10 * 8);
    });

    it('counts the typed arrays of a fixture model and of its atlas as the shared bytes', async () => {
        const asset = await fixtureAsset('4.2/spineboy-pro.skel');
        const spine = create(asset);
        const { model, atlas } = asset;
        const tables = model.bones.count * 68 + model.slots.count * 61;
        const memory = await spine.perf.memory();

        const lookup = createAttachmentLookup(model);
        const layout = layoutArrayBytes(buildTemplate(model, atlas, lookup, -1, null, model.slots.hasDark.includes(1)));

        expect(memory.shared).toBe(typedArrayBytes(model) + typedArrayBytes(atlas) + layout);
        expect(layout).toBeGreaterThan(model.slots.count * 77);
        expect(typedArrayBytes(atlas)).toBe(atlas.regionNames.length * 11 * 4);
        expect(typedArrayBytes({ bones: model.bones, slots: model.slots })).toBe(tables);
        expect(memory.shared).toBeGreaterThan(tables + atlas.regionNames.length * 44);
        // a white texture of one pixel per page
        expect(memory.gpuTextures).toBe(4);
        expect(memory.instance).toBeGreaterThan(spine.engine.bytes);
    });

    it('grows with the deform arrays an animation needs and with a skin that has more attachments', async () => {
        const spine = create(await fixtureAsset('4.2/mix-and-match-pro.skel'));
        const before = await spine.perf.memory();

        spine.skin = 'full-skins/girl';
        spine.play('dance', { loop: true });
        for (let i = 0; i < 20; i++) spine.update(FRAME);
        const after = await spine.perf.memory();

        // the layout of the skin with more attachments is the larger one
        expect(after.shared).toBeGreaterThan(before.shared);
        expect(after.instance).toBeGreaterThan(before.instance);
        expect(after.gpuBuffers).toBeGreaterThan(before.gpuBuffers);
        expect(after.gpuBuffers).toBeGreaterThanOrEqual(spine.stats.bufferBytes);
    });

    it('has no GPU buffers once the instance was destroyed', async () => {
        const spine = create(await coverAsset(BEHIND));

        spine.update(FRAME);
        const { perf } = spine;

        spine.destroy();

        expect(await perf.memory()).toMatchObject({ gpuBuffers: 0, gpu: 512 * 512 * 4, shared: SHARED });
    });
});

/** The clipping attachment of an asset, which holds its vertices. */
function clipOf(asset: MarrowAsset): unknown {
    return asset.model.skins.flatMap((skin) => skin.attachments).find((entry) => entry.attachment.type === 'clipping');
}
