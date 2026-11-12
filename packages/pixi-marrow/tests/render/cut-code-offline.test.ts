import { describe, expect, it, vi } from 'vitest';
import { SEARCH_LAST } from '../../src/render/cover-search';
import { cutCode, cutCodeState, loadCutCode } from '../../src/render/cut-code';
import { inspectView } from '../../src/render/inspect';
import { expectBatch } from './batch-check';
import { createStage } from './batch-stage';
import { type CoverSlot, coverFiles, opaqueSquares } from './cover-rig';
import { cutView, plainOutlines, setPolygon } from './cuts';
import { createBareRig, redraw } from './rig';

/*
 * The code that cuts overdraw is a chunk of its own, and a chunk can fail to load. A view with
 * outlines then keeps its quads and draws every slot. In this file the chunk never loads.
 */

vi.mock('../../src/render/cut-work', () => {
    throw new Error('the chunk did not load');
});

/** A small slot behind a big one, and a region that shows no pixel next to them. */
const SLOTS: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
    { name: 'clear', shows: 'mid', at: [400, 0] },
];

describe('a view whose code that cuts does not load', () => {
    it('keeps its quads, draws every slot, says so, and asks again with other outlines and not with every update', async () => {
        const rig = await createBareRig(
            coverFiles(SLOTS),
            cutView((outlines) => {
                opaqueSquares(outlines);
                setPolygon(outlines, 'mid', []);
            }),
        );
        const stage = createStage();
        const { stats } = rig.view;

        stage.root.addChild(rig.view.container);
        expect(cutCodeState()).toBe('loading');
        // a load that fails never rejects
        await expect(loadCutCode()).resolves.toBeUndefined();
        expect(cutCodeState()).toBe('failed');
        expect(cutCode()).toBeUndefined();
        redraw(rig);
        // the first update lays the vertex ranges out for what the slots show, and no update after it
        const builds = stats.templateBuilds;

        for (let frame = 0; frame < SEARCH_LAST + 2; frame++) {
            redraw(rig);
            expect(cutCodeState()).toBe('failed');
        }
        expect(stats).toMatchObject({
            coveredSlots: 0,
            tightRanges: 0,
            vertices: 12,
            templateBuilds: builds,
            indices: 18,
        });
        expect(inspectView(rig.view)).toMatchObject({ cuts: { outlines: true, code: 'failed' }, opaqueRects: 0 });
        stage.render();
        expectBatch(rig);
        // a draw has nothing to take back
        rig.view.beforeDraw(false);
        expect(stats.templateBuilds).toBe(builds);
        // other outlines are a command: the view asks for the code again
        const others = plainOutlines(rig.atlas);

        opaqueSquares(others);
        rig.view.setOutlines(others);
        expect(cutCodeState()).toBe('loading');
        await loadCutCode();
        expect(cutCodeState()).toBe('failed');
        for (let frame = 0; frame < 5; frame++) redraw(rig);
        // the layout is made again for the outlines, and still has no cut
        expect(stats).toMatchObject({
            coveredSlots: 0,
            tightRanges: 0,
            vertices: 12,
            templateBuilds: builds + 1,
            indices: 18,
        });
        stage.render();
        expectBatch(rig);
    });
});
