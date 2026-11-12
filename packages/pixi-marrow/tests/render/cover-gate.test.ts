import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { SEARCH_LAST } from '../../src/render/cover-search';
import { drawsPlain } from '../../src/render/gate';
import { type CoverSlot, coverFiles, coverRig, framesUntilCovered, moveSlot, opaqueSquares } from './cover-rig';
import { cutView, drawnIndices, pageTextures } from './cuts';
import { settle, WINDOW } from './heap';
import { createRig, meshes, redraw, step } from './rig';

/** A small slot behind a big one: the small one is covered. */
const BEHIND: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
];

describe('what Pixi does to a skeleton', () => {
    it('is plain only with an alpha of exactly 1 and a normal or inherited blend mode, up to the root', () => {
        const root = new Container();
        const parent = new Container();
        const child = new Container();

        root.addChild(parent);
        parent.addChild(child);
        expect(drawsPlain(child)).toBe(true);
        for (const node of [child, parent, root]) {
            node.alpha = 0.999;
            expect(drawsPlain(child)).toBe(false);
            node.alpha = 1;
            node.blendMode = 'add';
            expect(drawsPlain(child)).toBe(false);
            node.blendMode = 'normal';
            expect(drawsPlain(child)).toBe(true);
            node.blendMode = 'inherit';
        }
        // a tint changes colors and no alpha
        parent.tint = 0x336699;
        expect(drawsPlain(child)).toBe(true);
        // a container that is drawn on its own has no parent for that draw
        parent.alpha = 0.5;
        parent.removeChild(child);
        expect(drawsPlain(child)).toBe(true);
    });
});

describe('covered slots and the alpha of the display object', () => {
    it('skips nothing while an alpha below 1 or a blend mode is multiplied in from above', async () => {
        const rig = await coverRig(BEHIND);
        const parent = new Container();
        const stage = new Container();
        const { stats } = rig.view;
        const covered = (): number => {
            redraw(rig);

            return stats.coveredSlots;
        };

        stage.addChild(parent);
        parent.addChild(rig.view.container);
        expect(covered()).toBe(1);
        for (const node of [rig.view.container, parent, stage]) {
            // a slot that is skipped is put back by the update that sees the alpha
            node.alpha = 0.5;
            expect(covered()).toBe(0);
            expect(stats.indices).toBe(12);
            // no search finds it while the alpha stays
            for (let frame = 0; frame < SEARCH_LAST * 2; frame++) expect(covered()).toBe(0);
            // and the next search after the alpha is back finds it
            node.alpha = 1;
            expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_LAST);
            node.blendMode = 'add';
            expect(covered()).toBe(0);
            node.blendMode = 'inherit';
            expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_LAST);
        }
        expect(stats.templateBuilds).toBe(1);
    });

    it('puts the covered slots back in the frame the alpha changes, after the update and before the draw', async () => {
        const rig = await coverRig(BEHIND);
        const stage = new Container();
        const { stats } = rig.view;

        stage.addChild(rig.view.container);
        redraw(rig);
        const children = [...rig.view.container.children];
        const shown = meshes(rig.view);

        expect(stats).toMatchObject({ coveredSlots: 1, indices: 6, indexRebuilds: 1 });
        // user code after the update: a fade that starts in this frame
        stage.alpha = 0.99;
        // Pixi asks right before it draws the meshes
        rig.view.beforeDraw(false);
        expect(stats).toMatchObject({ coveredSlots: 0, indices: 12, indexRebuilds: 2, templateBuilds: 1 });
        expect(drawnIndices(rig)).toEqual([[0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]]);
        // index data alone changed: the meshes Pixi is about to draw are the same
        expect(rig.view.container.children).toEqual(children);
        expect(meshes(rig.view)).toEqual(shown);
        // a second draw of the same frame has nothing to do
        rig.view.beforeDraw(false);
        expect(stats.indexRebuilds).toBe(2);
        // the alpha is back: the slots stay drawn until a search of an update has tested them
        stage.alpha = 1;
        rig.view.beforeDraw(false);
        expect(stats.coveredSlots).toBe(0);
        expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_LAST);
        expect(stats).toMatchObject({ indices: 6, indexRebuilds: 3 });
    });

    it('puts the covered slots back for a blend mode that is set after the update', async () => {
        const rig = await coverRig(BEHIND);
        const stage = new Container();

        stage.addChild(rig.view.container);
        redraw(rig);
        stage.blendMode = 'screen';
        rig.view.beforeDraw(false);
        expect(rig.view.stats).toMatchObject({ coveredSlots: 0, indices: 12 });
    });

    it('skips nothing from the frame a renderer moves edges inside a pixel', async () => {
        const rig = await coverRig(BEHIND);
        const { stats } = rig.view;

        redraw(rig);
        expect(stats.coveredSlots).toBe(1);
        rig.view.beforeDraw(true);
        expect(stats).toMatchObject({ coveredSlots: 0, indices: 12, templateBuilds: 2 });
        redraw(rig);
        expect(stats).toMatchObject({ coveredSlots: 0, templateBuilds: 2 });
    });

    it('skips nothing on a page that does not allow cuts, and follows the texture', async () => {
        const white = await createRig(coverFiles(BEHIND), undefined, {
            ...cutView(opaqueSquares),
            textures: (atlas) => atlas.pages.map(() => Texture.WHITE),
        });
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
        step(white, 0);
        redraw(rig);
        expect(white.view.stats.coveredSlots).toBe(0);
        expect(rig.view.stats.coveredSlots).toBe(1);
        // a draw that skips a slot looks at the page textures first, and lays the quads out again
        source.autoGenerateMipmaps = true;
        rig.view.beforeDraw(false);
        expect(rig.view.stats).toMatchObject({ coveredSlots: 0, templateBuilds: 2, indices: 12 });
        // an update looks at them now and then, so the cut comes back some frames after the texture allows it
        source.autoGenerateMipmaps = false;
        expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_LAST * 2);
        expect(rig.view.stats.templateBuilds).toBe(3);
        source.autoGenerateMipmaps = true;
        rig.view.beforeDraw(false);
        expect(rig.view.stats).toMatchObject({ coveredSlots: 0, templateBuilds: 4, indices: 12 });
    });
});

describe('the cost of the test', () => {
    it('allocates nothing while slots go behind an opaque slot and come out again', async () => {
        const rig = await coverRig([
            { name: 'a', shows: 'small' },
            { name: 'b', shows: 'small', at: [40, 40] },
            { name: 'mid', shows: 'mid' },
            { name: 'big', shows: 'big', at: [30, 0] },
        ]);
        const { stats } = rig.view;
        const run = (i: number): void => {
            // in and out of the rectangles, and the middle slot in and out of the big one
            moveSlot(rig, 'a', i % 4 === 0 ? 200 : 0, 0);
            moveSlot(rig, 'mid', i % 6 < 3 ? 0 : 150, 0);
            redraw(rig);
            rig.view.beforeDraw(false);
        };

        run(0);
        const before = stats.indexRebuilds;
        const windows = settle(run);

        expect(windows).toBeGreaterThan(0);
        expect(stats.indexRebuilds - before).toBeGreaterThan(windows * WINDOW * 0.1);
        expect(stats.templateBuilds).toBe(1);
    });
});
