import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { buildAtlasOutlines } from '../../src/geometry/outlines';
import type { AtlasModel, AtlasPage } from '../../src/model/atlas';
import type { AtlasOutlines } from '../../src/model/outlines';
import { touchPose } from '../../src/pose/state';
import { pageAllowsCuts } from '../../src/render/page-block';
import { listAtlasFixtures, loadAtlasFixture } from '../geometry/outline-checks';
import { DEGREES, regionName, syntheticRig } from '../geometry/synthetic';
import { cutView, PENTAGON, pageTexture, pageTextures, plainOutlines, setPolygon } from './cuts';
import { settle, WINDOW } from './heap';
import { createRig, drawPose, expectKernel, fixtureFiles, meshes, play, readDrawn, step, vertexData } from './rig';

const REGIONS = DEGREES.flatMap((degrees) => [regionName(degrees, false), regionName(degrees, true)]);

const pentagons = (outlines: AtlasOutlines): void => {
    for (const name of REGIONS) setPolygon(outlines, name, PENTAGON);
};

/** The outlines of the synthetic atlas with a pentagon for every test region. */
function pentagonOutlines(atlas: AtlasModel): AtlasOutlines {
    const outlines = plainOutlines(atlas);

    pentagons(outlines);

    return outlines;
}

const page = (change: Partial<AtlasPage> = {}): AtlasPage => ({
    name: 'page.png',
    width: 64,
    height: 32,
    minFilter: 'linear',
    magFilter: 'linear',
    repeatX: false,
    repeatY: false,
    pma: false,
    ...change,
});

describe('the pages that allow cuts', () => {
    it('allows a texture of the page size without mipmaps, in either filter', () => {
        const nearest = pageTexture(page());

        nearest.source.style.scaleMode = 'nearest';
        expect(pageAllowsCuts(pageTexture(page()).source, page())).toBe(true);
        expect(pageAllowsCuts(nearest.source, page())).toBe(true);
    });

    it('refuses a texture of another pixel size: the margin of an outline is then less than a texel', () => {
        const half = new TextureSource({ width: 32, height: 16 });
        const dense = new TextureSource({ width: 64, height: 32, resolution: 2 });
        const wide = new TextureSource({ width: 64, height: 64 });

        for (const source of [half, dense, wide, Texture.WHITE.source])
            expect(pageAllowsCuts(source, page())).toBe(false);
        // the same pixels at another resolution are the same pixels
        expect(pageAllowsCuts(new TextureSource({ width: 32, height: 16, resolution: 2 }), page())).toBe(true);
    });

    it('refuses mipmaps and anisotropic filtering, which mix pixels that are further apart', () => {
        const generated = pageTexture(page()).source;
        const levels = new TextureSource({ width: 64, height: 32, mipLevelCount: 3 });
        const anisotropic = pageTexture(page()).source;

        generated.autoGenerateMipmaps = true;
        anisotropic.style.maxAnisotropy = 4;
        for (const source of [generated, levels, anisotropic]) expect(pageAllowsCuts(source, page())).toBe(false);
    });

    it('refuses a texture that repeats where the atlas page does not', () => {
        const repeats = pageTexture(page()).source;
        const mirrors = pageTexture(page()).source;

        repeats.style.addressModeU = 'repeat';
        mirrors.style.addressModeV = 'mirror-repeat';
        expect(pageAllowsCuts(repeats, page())).toBe(false);
        expect(pageAllowsCuts(repeats, page({ repeatY: true }))).toBe(false);
        // the outlines of a page that repeats count the pixels of the other edge
        expect(pageAllowsCuts(repeats, page({ repeatX: true }))).toBe(true);
        // a mirrored edge shows its own pixels again, as a clamped edge does
        expect(pageAllowsCuts(mirrors, page())).toBe(true);
    });

    it('refuses a premultiplied texture for a page the atlas calls straight', () => {
        const premultiplied = pageTexture(page()).source;

        premultiplied.alphaMode = 'premultiplied-alpha';
        expect(pageAllowsCuts(premultiplied, page())).toBe(false);
        expect(pageAllowsCuts(premultiplied, page({ pma: true }))).toBe(true);
        // multiplied once more on upload: a pixel with alpha 0 is black either way
        expect(pageAllowsCuts(pageTexture(page()).source, page({ pma: true }))).toBe(true);
    });
});

describe('a view whose cuts change', () => {
    it('keeps the quads of a page that does not allow cuts, and follows the texture when it changes', async () => {
        const files = syntheticRig('4.2');
        const quads = await createRig(files);
        const textures: Texture[] = [];
        const rig = await createRig(files, undefined, {
            textures: (atlas) => {
                textures.push(...pageTextures(atlas));

                return textures;
            },
            options: (atlas) => ({ outlines: pentagonOutlines(atlas), tightMesh: 'on' }),
        });
        const source = textures[0]?.source;
        const { stats } = rig.view;

        if (source === undefined) throw new Error('the atlas has a page');
        step(rig, 0);
        expect(stats).toMatchObject({ tightRanges: 8, templateBuilds: 1 });
        // all eight regions are on the first page. A draw of polygons looks at the textures first
        source.autoGenerateMipmaps = true;
        rig.view.beforeDraw(false);
        expect(stats).toMatchObject({ tightRanges: 0, templateBuilds: 2, vertices: quads.view.stats.vertices });
        expectKernel(rig);
        step(rig, 0);
        rig.view.beforeDraw(false);
        expect(stats.templateBuilds).toBe(2);
        // quads cut nothing, so no draw has to look. An update does now and then
        source.autoGenerateMipmaps = false;
        let frames = 0;

        while (stats.templateBuilds === 2 && frames++ < 200) step(rig, 0);
        expect(frames).toBeGreaterThan(1);
        expect(stats).toMatchObject({ tightRanges: 8, templateBuilds: 3 });
        source.style.maxAnisotropy = 8;
        rig.view.beforeDraw(false);
        expect(stats).toMatchObject({ tightRanges: 0, templateBuilds: 4 });
    });

    it('takes outlines that arrive later with one new layout, and gives them back', async () => {
        const files = syntheticRig('4.2');
        const quads = await createRig(files);
        const rig = await createRig(files, undefined, { textures: pageTextures, options: () => ({ tightMesh: 'on' }) });
        const outlines = pentagonOutlines(rig.atlas);
        const { stats } = rig.view;

        play(rig, 'deform');
        step(rig);
        expect(stats).toMatchObject({ templateBuilds: 1, tightRanges: 0 });
        rig.view.setOutlines(outlines);
        // nothing happens before the next update
        expect(stats).toMatchObject({ templateBuilds: 1, tightRanges: 0 });
        step(rig);
        expect(stats).toMatchObject({ templateBuilds: 2, tightRanges: 8, vertices: quads.view.stats.vertices + 8 });
        rig.view.setOutlines(outlines);
        step(rig);
        expect(stats.templateBuilds).toBe(2);
        rig.view.setOutlines(undefined);
        step(rig);
        expect(stats).toMatchObject({ templateBuilds: 3, tightRanges: 0, vertices: quads.view.stats.vertices });
        expectKernel(rig);
    });

    it('does not lay itself out again for outlines when it cuts nothing', async () => {
        const rig = await createRig(syntheticRig('4.2'), undefined, {
            textures: pageTextures,
            options: () => ({ tightMesh: 'off', occlusion: 'off' }),
        });

        step(rig, 0);
        rig.view.setOutlines(pentagonOutlines(rig.atlas));
        step(rig, 0);
        expect(rig.view.stats).toMatchObject({ templateBuilds: 1, tightRanges: 0 });
        // no child that watches the draw either
        expect(rig.view.container.children.every((child) => child.label !== 'marrow-probe')).toBe(true);
    });

    it('goes back to quads in the frame a renderer moves edges inside a pixel, and stays there', async () => {
        const files = syntheticRig('4.2');
        const quads = await createRig(files);
        const rig = await createRig(files, undefined, cutView(pentagons, { tightMesh: 'on' }));
        const { stats } = rig.view;

        play(quads, 'deform');
        play(rig, 'deform');
        step(quads, 0.3);
        step(rig, 0.3);
        const children = [...rig.view.container.children];
        const shown = meshes(rig.view);

        expect(children[0]?.label).toBe('marrow-probe');
        expect(stats).toMatchObject({ tightRanges: 8, templateBuilds: 1 });
        // a draw that leaves edges alone changes nothing
        rig.view.beforeDraw(false);
        expect(stats).toMatchObject({ tightRanges: 8, templateBuilds: 1, indexRebuilds: 1 });
        // a multisampled target, or a renderer that rounds positions
        rig.view.beforeDraw(true);
        expect(stats).toMatchObject({ tightRanges: 0, templateBuilds: 2, vertices: quads.view.stats.vertices });
        // the same meshes in the same order: Pixi has built its list of draws by now
        expect(rig.view.container.children).toEqual(children);
        expect(meshes(rig.view)).toEqual(shown);
        // the quads of the pose that was updated last, as a view without cuts has them
        expectKernel(rig);
        expect(Array.from(vertexData(rig.view).positions)).toEqual(Array.from(vertexData(quads.view).positions));
        expect(meshes(rig.view)[0]?.bounds).toMatchObject({ minX: meshes(quads.view)[0]?.bounds.minX });
        // for good: the next updates and other outlines lay nothing out
        rig.view.beforeDraw(false);
        step(rig);
        rig.view.setOutlines(pentagonOutlines(rig.atlas));
        step(rig);
        expect(stats).toMatchObject({ tightRanges: 0, templateBuilds: 2 });
        expectKernel(rig);
    });

    it('keeps its buffers when the pose moved on without an update, until that update', async () => {
        const rig = await createRig(syntheticRig('4.2'), undefined, cutView(pentagons, { tightMesh: 'on' }));
        const { state } = rig.engine;
        const { stats } = rig.view;

        step(rig, 0);
        const vertices = stats.vertices;
        const slot = rig.model.slots.names.indexOf(`quad-${regionName(0, false)}`);

        state.attachments[slot] = null;
        touchPose(state);
        rig.view.beforeDraw(true);
        expect(stats).toMatchObject({ templateBuilds: 1, vertices });
        drawPose(rig.view, state);
        expect(stats).toMatchObject({ templateBuilds: 2, tightRanges: 0 });
        readDrawn(rig);
    });

    it('does nothing before its first update and after it was destroyed', async () => {
        const rig = await createRig(syntheticRig('4.2'), undefined, cutView(pentagons, { tightMesh: 'on' }));

        expect(() => rig.view.beforeDraw(true)).not.toThrow();
        expect(rig.view.stats.templateBuilds).toBe(1);
        step(rig, 0);
        // the draw before forbade the cuts, so this update laid the quads out
        expect(rig.view.stats).toMatchObject({ templateBuilds: 2, tightRanges: 0 });
        rig.view.destroy();
        expect(() => rig.view.beforeDraw(false)).not.toThrow();
        expect(rig.view.stats).toMatchObject({ tightRanges: 0, coveredSlots: 0, vertices: 0 });
    });
});

describe('memory with cuts', () => {
    it('allocates nothing in update with polygons, once it is warm', async () => {
        const fixture = listAtlasFixtures().find((candidate) => candidate.id === '4.2/spineboy.atlas');

        if (fixture === undefined) throw new Error('no fixture 4.2/spineboy.atlas. Run: pnpm fixtures');
        const { atlas, pages } = await loadAtlasFixture(fixture);
        const outlines = buildAtlasOutlines(atlas, pages);
        const rig = await createRig(fixtureFiles('4.2/spineboy-pro.skel'), undefined, {
            textures: pageTextures,
            options: () => ({ outlines, tightMesh: 'on' }),
        });
        const { state } = rig.engine;

        play(rig, 'run');
        step(rig);
        expect(rig.view.stats.tightRanges).toBeGreaterThan(5);
        const head = rig.model.slots.names.indexOf('head');
        const run = (i: number): void => {
            state.world[4] = i % 50;
            state.colors[head * 4 + 3] = i % 3 === 0 ? 0 : 1;
            drawPose(rig.view, state);
            // what Pixi asks before every draw
            rig.view.beforeDraw(false);
        };
        const windows = settle(run);

        expect(windows).toBeGreaterThan(0);
        expect(rig.view.stats.templateBuilds).toBe(1);
        expect(rig.view.stats.indexRebuilds).toBeGreaterThan(windows * WINDOW * 0.6);
    });
});
