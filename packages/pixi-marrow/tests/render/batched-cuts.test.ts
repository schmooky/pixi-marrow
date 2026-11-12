import { describe, expect, it } from 'vitest';
import { inspectView } from '../../src/render/inspect';
import { batcherOf, createStage, elementOf, readRuns, readVertex, type Stage, watchUploads } from './batch-stage';
import { type CoverSlot, coverFiles, coverRig, framesUntilCovered, opaqueSquares } from './cover-rig';
import { PENTAGON, pageTextures, plainOutlines, setPolygon } from './cuts';
import { createRig, type Rig, step } from './rig';

/*
 * The cuts of overdraw in the batched mode. No child of the view asks before a draw there: the
 * pipe asks for every skeleton of a batch, right before the batch draws.
 */

/** A small slot behind a big one: the small one is covered. */
const BEHIND: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
];

/** A region that shows as a pentagon with `tightMesh: 'on'`, and one that keeps its quad. */
const SHAPES: readonly CoverSlot[] = [
    { name: 'shape', shows: 'mid', at: [-300, 0] },
    { name: 'quad', shows: 'big', at: [300, 0] },
];

/** Puts a rig on a stage and draws the first frame. */
function show(stage: Stage, rig: Rig): void {
    stage.root.addChild(rig.view.container);
    step(rig, 0);
    stage.render();
}

/** The indices a rig draws in its batch, without the triangles that fill its room. */
const drawn = (rig: Rig): number => readRuns(rig.view).flat().length;

/** Makes the target of a stage multisampled from now on, as a render to another target would be. */
function multisample(stage: Stage): void {
    const [target] = stage.renderer.renderTarget.renderTarget.colorTextures;

    if (target === undefined) throw new Error('the stage has no target');
    Reflect.set(target, 'antialias', true);
}

describe('covered slots in a batch', () => {
    it('are left out of the indices, and come back in the frame an alpha changes, without a build', async () => {
        const stage = createStage();
        const rig = await coverRig(BEHIND, { renderMode: 'batched' });
        const { stats } = rig.view;

        show(stage, rig);
        framesUntilCovered(rig, 1);
        stage.render();
        expect(stats).toMatchObject({ renderMode: 'batched', coveredSlots: 1, indices: 6, drawCalls: 1 });
        expect(drawn(rig)).toBe(6);
        const uploads = watchUploads(batcherOf(rig.view));
        const { indexRebuilds } = stats;

        // user code after the update: a fade that starts in this frame
        stage.root.alpha = 0.99;
        stage.render();
        expect(stats).toMatchObject({ coveredSlots: 0, indices: 12, indexRebuilds: indexRebuilds + 1 });
        // the indices of this draw hold both slots, and they were uploaded before it
        expect(drawn(rig)).toBe(12);
        expect(uploads.indices).toBe(1);
        expect(stage.counts.builds).toBe(1);
        expect(stage.counts.draws).toHaveLength(1);
        // a second draw of the same pose has nothing to do
        stage.render();
        expect(stats.indexRebuilds).toBe(indexRebuilds + 1);
        expect(uploads.indices).toBe(1);
        // the alpha is back: a search of a later update finds the slot again
        stage.root.alpha = 1;
        framesUntilCovered(rig, 1, () => {
            step(rig, 0);
            stage.render();
        });
        expect(drawn(rig)).toBe(6);
        expect(stage.counts.builds).toBe(1);
        expect(stats.templateBuilds).toBe(1);
    });

    it('come back for a blend mode that is set after the update', async () => {
        const stage = createStage();
        const rig = await coverRig(BEHIND, { renderMode: 'batched' });

        show(stage, rig);
        framesUntilCovered(rig, 1);
        stage.render();
        expect(drawn(rig)).toBe(6);
        rig.view.container.blendMode = 'screen';
        stage.render();
        expect(rig.view.stats).toMatchObject({ coveredSlots: 0, indices: 12 });
        expect(drawn(rig)).toBe(12);
        expect(stage.counts.draws[0]?.blendMode).toBe('screen');
    });
});

describe('the cuts of the layout in a batch', () => {
    it.each([
        ['roundPixels', { roundPixels: true }],
        ['multisample', { antialias: true }],
    ] as const)('are off from the first build for a renderer that moves edges: %s', async (bend, options) => {
        const stage = createStage(options);
        const rig = await coverRig(SHAPES, { renderMode: 'batched', tightMesh: 'on' }, (outlines) => {
            setPolygon(outlines, 'mid', PENTAGON);
        });

        // the view lays the polygon out, and the first build finds out how the renderer draws
        step(rig, 0);
        expect(rig.view.stats.vertices).toBe(5 + 4);
        show(stage, rig);
        expect(inspectView(rig.view).cuts).toMatchObject({ hostile: true, bend });
        expect(rig.view.stats).toMatchObject({ vertices: 8, indices: 12, tightRanges: 0, templateBuilds: 2 });
        expect(drawn(rig)).toBe(12);
        expect(stage.counts.builds).toBe(1);
        expect(readVertex(rig.view, 0).round).toBe(bend === 'roundPixels' ? 255 : 0);
    });

    it('are taken back while Pixi draws, in the room the skeleton has, when a later draw moves edges', async () => {
        const stage = createStage();
        const rig = await coverRig(SHAPES, { renderMode: 'batched', tightMesh: 'on' }, (outlines) => {
            setPolygon(outlines, 'mid', PENTAGON);
            setPolygon(outlines, 'big', []);
        });

        show(stage, rig);
        // a pentagon for the first slot, and no vertex for the second: its region shows no pixel
        expect(rig.view.stats).toMatchObject({ vertices: 5, indices: 9, tightRanges: 2 });
        expect(drawn(rig)).toBe(9);
        // the batch keeps room for the quads all the same
        expect(elementOf(rig.view)).toMatchObject({ attributeSize: 5 + 4, indexSize: 9 + 6 + 3 });
        const uploads = watchUploads(batcherOf(rig.view));

        multisample(stage);
        stage.render();
        expect(inspectView(rig.view).cuts).toMatchObject({ hostile: true, bend: 'multisample' });
        expect(rig.view.stats).toMatchObject({ vertices: 8, indices: 12, tightRanges: 0, templateBuilds: 2 });
        // this draw has the two quads, uploaded before it, and Pixi built nothing
        expect(drawn(rig)).toBe(12);
        expect(readRuns(rig.view)).toEqual([[0, 1, 2, 0, 2, 3, 5, 6, 7, 5, 7, 8]]);
        expect(uploads).toMatchObject({ statics: 1, indices: 1 });
        expect(uploads.positions).toBeGreaterThan(0);
        expect(stage.counts.builds).toBe(1);
        expect(elementOf(rig.view).resized).toBe(false);
    });

    it('arrive with the outlines in the room the skeleton has, or with one build when they need more', async () => {
        for (const tightMesh of ['auto', 'on'] as const) {
            const stage = createStage();
            const rig = await createRig(coverFiles(SHAPES), undefined, {
                textures: pageTextures,
                options: () => ({ renderMode: 'batched', tightMesh }),
            });
            const outlines = plainOutlines(rig.atlas);

            opaqueSquares(outlines);
            setPolygon(outlines, 'mid', PENTAGON);
            setPolygon(outlines, 'big', []);
            show(stage, rig);
            expect(rig.view.stats).toMatchObject({ vertices: 8, indices: 12 });
            rig.view.setOutlines(outlines);
            step(rig, 0);
            stage.render();
            expect(rig.view.stats.templateBuilds).toBe(2);
            if (tightMesh === 'auto') {
                // the region without a pixel loses its vertices, and nothing needs more room
                expect(rig.view.stats).toMatchObject({ vertices: 4, indices: 6, tightRanges: 1 });
                expect(drawn(rig)).toBe(6);
                expect(stage.counts.builds).toBe(1);
            } else {
                // the pentagon has one vertex more than the quad it replaces
                expect(rig.view.stats).toMatchObject({ vertices: 5, indices: 9, tightRanges: 2 });
                expect(drawn(rig)).toBe(9);
                expect(stage.counts.builds).toBe(2);
            }
            step(rig, 0);
            stage.render();
            expect(stage.counts.builds).toBe(tightMesh === 'auto' ? 1 : 2);
        }
    });

    it('are taken back for a page texture that is sampled in another way at the time of the draw', async () => {
        const stage = createStage();
        const textures = pageTextures((await coverRig(SHAPES)).atlas);
        const rig = await createRig(coverFiles(SHAPES), undefined, {
            textures: () => textures,
            options: (atlas) => {
                const outlines = plainOutlines(atlas);

                setPolygon(outlines, 'big', []);

                return { renderMode: 'batched', outlines };
            },
        });
        const source = textures[0]?.source;

        if (source === undefined) throw new Error('the atlas has a page');
        show(stage, rig);
        expect(drawn(rig)).toBe(6);
        // after the update, before the draw: the outlines no longer hold for the texture
        source.autoGenerateMipmaps = true;
        stage.render();
        expect(drawn(rig)).toBe(12);
        expect(rig.view.stats).toMatchObject({ vertices: 8, templateBuilds: 2 });
        expect(stage.counts.builds).toBe(1);
    });
});
