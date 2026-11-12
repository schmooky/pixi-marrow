import { Container, type Renderer, type Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasPage } from '../../src/model/atlas';
import { type PageBlock, pageAllowsCuts, pageBlock, sharedTriangleBytes } from '../../src/render/cuts';
import { bendsEdges } from '../../src/render/gate';
import { describeCuts, inspectView, layoutArrayBytes, templateArrayBytes } from '../../src/render/inspect';
import { ownsStatics, releaseTemplate } from '../../src/render/layouts';
import { buildTemplate, showFrame } from '../../src/render/template';
import { type CoverSlot, coverFiles, coverRig, framesUntilCovered, opaqueSquares, slotOf } from './cover-rig';
import { cutView, PENTAGON, pageTextures, plainOutlines, setPolygon } from './cuts';
import { createRig, step } from './rig';

/** A small slot behind a big one: the small one is covered. */
const BEHIND: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
];

/** The bytes the test of covered slots holds besides its three arrays per slot. */
const COVER_FIXED = 16 + 16 + 16 + 4 + 256 + 128;

/** A renderer as far as the view looks at it. */
function renderer(roundPixels: boolean, antialias: boolean): Renderer {
    const target = { antialias };

    return { roundPixels, renderTarget: { renderTarget: { colorTextures: [target] } } } as unknown as Renderer;
}

const PAGE: AtlasPage = {
    name: 'page.png',
    width: 64,
    height: 32,
    minFilter: 'linear',
    magFilter: 'linear',
    repeatX: false,
    repeatY: false,
    pma: false,
};

describe('what a view says about its visible slots', () => {
    it('lists them in draw order with their clip, their shape and their vertices', async () => {
        const rig = await coverRig(
            [
                { name: 'cut', shows: 'big', as: 'clip', end: 'inner' },
                { name: 'inner', shows: 'mid', as: 'mesh' },
                { name: 'shape', shows: 'small', at: [300, 0] },
                { name: 'empty', shows: 'seq', at: [0, 300] },
                { name: 'quad', shows: 'big', at: [600, 0] },
            ],
            { tightMesh: 'on' },
            (outlines) => {
                setPolygon(outlines, 'small', PENTAGON);
            },
        );

        step(rig, 0);
        const { visible } = inspectView(rig.view);
        const cut = slotOf(rig, 'cut');

        expect(visible).toEqual([
            { slot: slotOf(rig, 'inner'), clip: cut, pageGroup: 0, covered: false, shape: 'mesh', vertices: 4 },
            { slot: slotOf(rig, 'shape'), clip: -1, pageGroup: 0, covered: false, shape: 'polygon', vertices: 5 },
            { slot: slotOf(rig, 'empty'), clip: -1, pageGroup: 0, covered: false, shape: 'quad', vertices: 4 },
            { slot: slotOf(rig, 'quad'), clip: -1, pageGroup: 0, covered: false, shape: 'quad', vertices: 4 },
        ]);
    });

    it('calls a region without a visible pixel hollow, with no vertex', async () => {
        const rig = await coverRig([{ name: 'clear', shows: 'mid' }, ...BEHIND], {}, (outlines) => {
            setPolygon(outlines, 'mid', []);
        });

        step(rig, 0);

        expect(inspectView(rig.view).visible[0]).toMatchObject({ slot: 0, shape: 'hollow', vertices: 0 });
    });

    it('marks the slots a later opaque slot covers', async () => {
        const rig = await coverRig(BEHIND);

        framesUntilCovered(rig, 1);
        const report = inspectView(rig.view);

        expect(report.visible.map(({ slot, covered }) => [rig.model.slots.names[slot], covered])).toEqual([
            ['small', true],
            ['big', false],
        ]);
        expect(report.opaqueRects).toBe(2);
        expect(report.plain).toBe(true);
    });

    it('says when Pixi does not draw the meshes as their vertices say', async () => {
        const rig = await coverRig(BEHIND);
        const parent = new Container();

        parent.addChild(rig.view.container);
        parent.alpha = 0.5;
        step(rig, 0);

        expect(inspectView(rig.view).plain).toBe(false);
    });

    it('lists nothing before the first update and after destroy', async () => {
        const rig = await coverRig(BEHIND);

        expect(inspectView(rig.view).visible).toEqual([]);
        step(rig, 0);
        rig.view.destroy();
        expect(inspectView(rig.view)).toMatchObject({ visible: [], gpuBytes: 0 });
    });
});

describe('what a view says about its cuts', () => {
    it('states the options and that nothing stops the cuts', async () => {
        const rig = await coverRig(BEHIND);
        const picky = await coverRig(BEHIND, { tightMesh: 'on', occlusion: 'off' });
        const plain = await coverRig(BEHIND, { tightMesh: 'off' });

        expect(inspectView(rig.view).cuts).toEqual({
            tightMesh: 'auto',
            occlusion: 'auto',
            outlines: true,
            hostile: false,
            bend: null,
            pages: [null],
            polygonMargin: true,
            opaqueMargin: true,
        });
        expect(inspectView(picky.view).cuts).toMatchObject({ tightMesh: 'on', occlusion: 'off' });
        expect(inspectView(plain.view).cuts).toMatchObject({ tightMesh: 'off', occlusion: 'auto' });
    });

    it('are described from the state the view hands out, which is the state it draws with', async () => {
        const rig = await coverRig(BEHIND, { tightMesh: 'on' });
        step(rig, 0);
        const { cutState, template, seen, cover, paints } = rig.view.parts;

        expect(describeCuts(cutState)).toEqual(inspectView(rig.view).cuts);
        expect(cutState).toMatchObject({ tight: true, hollow: true, occlusion: true, hostile: false });
        expect(cutState.held?.regions).toHaveLength(rig.atlas.regionNames.length);
        expect(cutState.allowed).toEqual(Uint8Array.of(1));
        // the same objects in every call, and the template of the last layout
        expect(rig.view.parts).toEqual({
            cutState,
            template,
            seen,
            cover,
            paints,
            reason: 'option',
            renderMode: 'mesh',
        });
        expect(rig.view.parts.paints).toBe(paints);
        expect(seen.count).toBe(2);
        expect(paints.mesh?.ranges.active).toBe(1);
        expect(paints).toMatchObject({ mode: 'mesh', ready: true, body: undefined, element: undefined });
    });

    it('states that a view has no outlines', async () => {
        const rig = await createRig(coverFiles(BEHIND));

        expect(inspectView(rig.view).cuts).toMatchObject({
            outlines: false,
            pages: ['size'],
            polygonMargin: false,
            opaqueMargin: false,
        });
    });

    it('states margins that are too small for bilinear filtering', async () => {
        const rig = await coverRig(BEHIND, {}, (outlines) => {
            outlines.margin = 0.25;
            outlines.opaqueMargin = 0;
        });

        expect(inspectView(rig.view).cuts).toMatchObject({ polygonMargin: false, opaqueMargin: false });
    });

    it.each([
        ['roundPixels', 'roundPixels'],
        ['multisample', 'multisample'],
        [true, null],
    ] as const)('keeps what the draw that forbade the cuts did: %s', async (bends, bend) => {
        const rig = await coverRig(BEHIND);

        step(rig, 0);
        rig.view.beforeDraw(false);
        expect(inspectView(rig.view).cuts).toMatchObject({ hostile: false, bend: null });
        rig.view.beforeDraw(bends);
        // the first draw that bends edges is the one that is kept
        rig.view.beforeDraw('multisample');

        expect(inspectView(rig.view).cuts).toMatchObject({ hostile: true, bend });
    });

    it('states why a page keeps its quads, as the texture is at the moment', async () => {
        const textures: Texture[] = [];
        const rig = await createRig(coverFiles(BEHIND), undefined, {
            ...cutView(opaqueSquares),
            textures: (atlas) => {
                textures.push(...pageTextures(atlas));

                return textures;
            },
        });
        const source = textures[0]?.source;

        if (source === undefined) throw new Error('the atlas has a page');
        expect(inspectView(rig.view).cuts.pages).toEqual([null]);
        source.autoGenerateMipmaps = true;
        expect(inspectView(rig.view).cuts.pages).toEqual(['mipmaps']);
    });
});

describe('why a page texture keeps the quads of its regions', () => {
    const source = (change: (source: TextureSource) => void = () => undefined): TextureSource => {
        const made = new TextureSource({ width: PAGE.width, height: PAGE.height });

        change(made);

        return made;
    };
    const cases: [PageBlock | null, TextureSource, AtlasPage][] = [
        [null, source(), PAGE],
        ['size', new TextureSource({ width: 32, height: 32 }), PAGE],
        ['size', new TextureSource({ width: PAGE.width, height: PAGE.height, resolution: 2 }), PAGE],
        [
            'mipmaps',
            source((made) => {
                made.autoGenerateMipmaps = true;
            }),
            PAGE,
        ],
        [
            'mipmaps',
            source((made) => {
                made.mipLevelCount = 3;
            }),
            PAGE,
        ],
        [
            'anisotropy',
            source((made) => {
                made.style.maxAnisotropy = 4;
            }),
            PAGE,
        ],
        [
            'repeat',
            source((made) => {
                made.style.addressModeU = 'repeat';
            }),
            PAGE,
        ],
        [
            'repeat',
            source((made) => {
                made.style.addressModeV = 'repeat';
            }),
            { ...PAGE, repeatX: true },
        ],
        [
            null,
            source((made) => {
                made.style.addressMode = 'repeat';
            }),
            { ...PAGE, repeatX: true, repeatY: true },
        ],
        [
            'premultiplied',
            source((made) => {
                made.alphaMode = 'premultiplied-alpha';
            }),
            PAGE,
        ],
        [
            null,
            source((made) => {
                made.alphaMode = 'premultiplied-alpha';
            }),
            { ...PAGE, pma: true },
        ],
    ];

    it.each(cases)('is %s', (block, texture, page) => {
        expect(pageBlock(texture, page)).toBe(block);
        expect(pageAllowsCuts(texture, page)).toBe(block === null);
    });
});

describe('what a renderer does to edges', () => {
    it('is named: rounding first, then a multisampled target, else nothing', () => {
        expect(bendsEdges(renderer(false, false))).toBe(false);
        expect(bendsEdges(renderer(true, false))).toBe('roundPixels');
        expect(bendsEdges(renderer(false, true))).toBe('multisample');
        expect(bendsEdges(renderer(true, true))).toBe('roundPixels');
        expect(bendsEdges({ roundPixels: false, renderTarget: { renderTarget: { colorTextures: [] } } } as never)).toBe(
            false,
        );
    });
});

describe('the bytes of a view', () => {
    it('are the typed arrays of its layout, its lists and its index data, counted by hand', async () => {
        const rig = await coverRig(BEHIND);
        const slots = 2;
        const entries = 2;
        const vertices = 8;
        // per entry, shared by the instances of the layout: 9 numbers of 4 bytes, the hollow flag, an area of 8 bytes and a tint of 32
        const perEntry = entries * (9 * 4 + 1 + 8 + 32);
        const texture = vertices * 12;
        const layout = (slots + 1) * 4 + perEntry + entries * 4 + entries * 32 + entries * 64 + texture;
        // per entry, for the instance alone: the frame, the page and two colors of 4 bytes
        const own = entries * 4 * 4 + vertices * 8 + vertices * 4;
        const lists = slots * (4 + 2 + 4) + slots * (1 + 4 + 1) + COVER_FIXED + 1;

        step(rig, 0);
        const report = inspectView(rig.view);
        // one range with room for both quads
        const indexData = 12 * 2;

        expect(report.arrayBytes).toBe(own + lists + indexData);
        expect(report.layoutBytes).toBe(layout);
        // the buffers hold positions, colors and a copy of the texture coordinates
        expect(report.gpuBytes).toBe(vertices * (8 + 12 + 4) + indexData);
        expect(rig.view.stats.bufferBytes).toBe(report.gpuBytes);
    });

    it('count the dark colors, the polygons and the masks a view holds', async () => {
        const plain = await coverRig(BEHIND);
        const rig = await coverRig(
            [
                { name: 'cut', shows: 'big', as: 'clip' },
                { name: 'small', shows: 'small', dark: 'ff0000' },
                { name: 'big', shows: 'big' },
            ],
            { tightMesh: 'on' },
            (outlines) => {
                setPolygon(outlines, 'small', PENTAGON);
            },
        );

        step(plain, 0);
        step(rig, 0);
        const before = inspectView(plain.view);
        const after = inspectView(rig.view);
        // a slot more in every list, and a vertex more with 8 bytes of color each
        const lists = 4 + 2 + 4 + (1 + 4 + 1);
        const own = 9 * (8 + 8) - 8 * (8 + 4);
        // the polygon has 9 indices, which makes room for 16 in place of 12, and the range sits behind a mask
        const indexData = 16 * 2 - 12 * 2;
        const mask = 6 * 4 + 4 * 2;

        expect(after.arrayBytes - before.arrayBytes).toBe(lists + own + indexData + mask);
        // the layout: a slot more, the texture coordinates of a vertex more, ten numbers of a polygon
        expect(after.layoutBytes - before.layoutBytes).toBe(4 + 12 + 10 * 8);
        expect(after.gpuBytes - before.gpuBytes).toBe(own + 12 + indexData + mask);
    });

    it('count a vertex buffer once that several draw ranges share', async () => {
        const rig = await coverRig([
            { name: 'body', shows: 'small', at: [0, 0] },
            { name: 'shade', shows: 'small', at: [400, 0], blend: 'multiply' },
        ]);

        step(rig, 0);
        const report = inspectView(rig.view);

        // two ranges on the same three vertex buffers, each with room for the indices of both quads
        expect(rig.view.stats.drawCalls).toBe(2);
        expect(report.gpuBytes).toBe(8 * (8 + 12 + 4) + 2 * 12 * 2);
        expect(report.gpuBytes).toBe(rig.view.stats.bufferBytes);
    });

    it('count the layout of a template apart from what an instance writes, without the triangles its entries share', async () => {
        const rig = await coverRig(BEHIND);
        const template = buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false);
        const other = buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false);

        expect(layoutArrayBytes(template)).toBe(3 * 4 + 2 * 77 + 2 * 4 + 2 * 32 + 8 * 12);
        expect(templateArrayBytes(template)).toBe(2 * 16 + 8 * 8 + 8 * 4);
        // two instances of one layout: the same arrays for what no pose writes, and their own for the rest
        expect(other.statics).toBe(template.statics);
        expect(other.first).toBe(template.first);
        expect(other.offsets).toBe(template.offsets);
        for (const key of ['positions', 'colors', 'light', 'dark', 'frames', 'pages'] as const) {
            expect(other[key], key).not.toBe(template[key]);
            expect(other[key], key).toEqual(template[key]);
        }
    });

    it('gives an instance its own texture coordinates when an entry has a sequence', async () => {
        const rig = await coverRig([{ name: 'flip', shows: 'seq' }]);
        const template = buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false);
        const other = buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false);

        expect(other.statics).not.toBe(template.statics);
        expect(other.frameUVs).toBe(template.frameUVs);
        expect([ownsStatics(template), ownsStatics(rig.view.parts.template)]).toEqual([true, true]);
        // the second frame of one instance leaves the other one at its first
        expect(showFrame(other, 0, 1)).toBe(true);
        expect(other.statics).not.toEqual(template.statics);
        expect(template.frames[0]).toBe(0);
        expect(templateArrayBytes(template)).toBe(16 + 4 * (8 + 4) + 4 * 12);
    });

    it('forgets a layout once its last instance lets it go', async () => {
        const rig = await coverRig(BEHIND);
        const first = buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false);
        const second = buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false);

        releaseTemplate(first);
        expect(buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false).statics).toBe(second.statics);
        releaseTemplate(second);
        // letting go twice counts once
        releaseTemplate(second);
        expect(buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false).statics).toBe(second.statics);
    });

    it('count the triangles that views share for the outlines once a view laid a polygon out', async () => {
        const files = coverFiles(BEHIND);
        const made = await createRig(files);
        const outlines = plainOutlines(made.atlas);

        setPolygon(outlines, 'small', PENTAGON);
        expect(sharedTriangleBytes(outlines)).toBe(0);
        const rig = await createRig(files, undefined, {
            textures: pageTextures,
            options: () => ({ outlines, tightMesh: 'on' }),
        });

        step(rig, 0);
        // a fan of three triangles, 16-bit
        expect(sharedTriangleBytes(outlines)).toBe(9 * 2);
        expect(sharedTriangleBytes({ ...outlines, regions: [null] })).toBe(0);
    });
});
