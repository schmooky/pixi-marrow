import { describe, expect, it } from 'vitest';
import { SEARCH_FIRST } from '../../src/render/cover-search';
import { cutCode, cutCodeState, loadCutCode } from '../../src/render/cut-code';
import { inspectView } from '../../src/render/inspect';
import { expectBatch } from './batch-check';
import { createStage, readRuns } from './batch-stage';
import { type CoverSlot, coverFiles, framesUntilCovered, opaqueSquares } from './cover-rig';
import { cutView, outlineOf, pageTextures, plainOutlines, setPolygon } from './cuts';
import { createBareRig, redraw } from './rig';

/*
 * The code that cuts overdraw loads on demand, with the outlines. This file never loads it
 * before a view asks for it, and its tests run in order: the code stays once it is there.
 */

/** A small slot behind a big one, and a region that shows no pixel next to them. */
const SLOTS: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
    { name: 'clear', shows: 'mid', at: [400, 0] },
];

/** Outlines with an opaque rectangle for every region but the one without a pixel, which gets an empty polygon. */
const withCuts = cutView((outlines) => {
    opaqueSquares(outlines);
    setPolygon(outlines, 'mid', []);
    // a region without a visible pixel has no opaque part
    outlineOf(outlines, 'mid').opaque = null;
});

describe('a view before the code that cuts is loaded', () => {
    it('does not ask for the code while it has no outlines', async () => {
        const rig = await createBareRig(coverFiles(SLOTS), { textures: pageTextures });

        for (let frame = 0; frame < 5; frame++) redraw(rig);
        expect(cutCodeState()).toBe('idle');
        expect(cutCode()).toBeUndefined();
        expect(inspectView(rig.view).cuts).toMatchObject({ outlines: false, code: 'idle' });
        expect(rig.view.stats).toMatchObject({ coveredSlots: 0, tightRanges: 0, vertices: 12 });
    });

    it('asks for the code when it is made with outlines, keeps its quads and draws every slot until then', async () => {
        const stage = createStage();
        const rig = await createBareRig(coverFiles(SLOTS), withCuts);
        const { stats } = rig.view;

        stage.root.addChild(rig.view.container);

        // the constructor asked, and nothing was awaited since
        expect(cutCodeState()).toBe('loading');
        redraw(rig);
        // the first update lays the vertex ranges out for what the slots show, and no update after it
        const builds = stats.templateBuilds;

        for (let frame = 0; frame < SEARCH_FIRST * 3; frame++) redraw(rig);
        expect(stats).toMatchObject({
            coveredSlots: 0,
            tightRanges: 0,
            vertices: 12,
            templateBuilds: builds,
            indices: 18,
        });
        expect(inspectView(rig.view)).toMatchObject({ cuts: { outlines: true, code: 'loading' }, opaqueRects: 0 });
        stage.render();
        expectBatch(rig);
        await loadCutCode();
        expect(cutCodeState()).toBe('loaded');
        // The code that arrived is work for a view whose pose rests: it lays its vertex ranges out
        // again, once. The region without a pixel loses its quad
        const { skips } = stats;

        rig.view.update(rig.engine.state);
        expect(stats).toMatchObject({ templateBuilds: builds + 1, vertices: 8, tightRanges: 1, skips });
        expect(inspectView(rig.view)).toMatchObject({ cuts: { outlines: true, code: 'loaded' }, opaqueRects: 2 });
        // and the search finds the small slot behind the big one
        expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_FIRST);
        expect(stats).toMatchObject({ templateBuilds: builds + 1, indices: 6 });
        stage.render();
        // the batch draws the big slot alone
        expect(readRuns(rig.view).flat()).toHaveLength(6);
    });

    it('cuts at once when it gets outlines later, now that the code is there', async () => {
        const rig = await createBareRig(coverFiles(SLOTS), { textures: pageTextures });
        const outlines = plainOutlines(rig.atlas);

        redraw(rig);
        const builds = rig.view.stats.templateBuilds;

        opaqueSquares(outlines);
        rig.view.setOutlines(outlines);
        redraw(rig);
        expect(rig.view.stats.templateBuilds).toBe(builds + 1);
        expect(inspectView(rig.view).opaqueRects).toBe(3);
        expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_FIRST);
    });
});
