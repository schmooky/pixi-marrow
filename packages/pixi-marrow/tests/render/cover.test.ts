import { describe, expect, it } from 'vitest';
import { MAX_OCCLUDERS, MIN_OCCLUDER_AREA, SEARCH_FIRST, SEARCH_LAST } from '../../src/render/cover-search';
import { type CoverSlot, coverRig, framesUntilCovered, moveSlot, slotOf } from './cover-rig';
import { drawnIndices, readCutSlots } from './cuts';
import { drawPose, meshes, type Rig, redraw, step } from './rig';

/** A small slot behind a big one: the small one is covered. */
const BEHIND: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
];

/** The names of the slots that have no index in the buffers of a view with one range. */
function skipped(rig: Rig, covered: readonly string[]): string[] {
    const slots = readCutSlots(rig, (slot) => (covered.includes(rig.model.slots.names[slot] ?? '') ? 0 : 6));

    return slots.filter((item) => item.triangles.length === 0).map((item) => rig.model.slots.names[item.slot] ?? '');
}

/** How many slots a rig skips after one update. */
async function coveredIn(slots: readonly CoverSlot[]): Promise<number> {
    const rig = await coverRig(slots);

    redraw(rig);

    return rig.view.stats.coveredSlots;
}

describe('covered slots', () => {
    it('leaves a slot out that lies inside the opaque rectangle of a later slot', async () => {
        const rig = await coverRig(BEHIND);

        redraw(rig);
        expect(rig.view.stats).toMatchObject({
            coveredSlots: 1,
            indices: 6,
            vertices: 8,
            drawCalls: 1,
            tightRanges: 0,
        });
        expect(skipped(rig, ['small'])).toEqual(['small']);
        // the big quad alone
        expect(drawnIndices(rig)).toEqual([[4, 5, 6, 4, 6, 7]]);
    });

    it('draws every slot with occlusion off and without outlines', async () => {
        const off = await coverRig(BEHIND, { occlusion: 'off' });
        const bare = await coverRig(BEHIND, {}, (outlines) => {
            for (const region of outlines.regions) if (region) region.opaque = null;
        });

        for (const rig of [off, bare]) {
            redraw(rig);
            expect(rig.view.stats).toMatchObject({ coveredSlots: 0, indices: 12, drawCalls: 1 });
            expect(skipped(rig, [])).toEqual([]);
        }
    });

    it('wants every vertex inside: a slot that leaves the rectangle is drawn', async () => {
        const rig = await coverRig(BEHIND);
        const { stats } = rig.view;
        const at = (x: number, y: number): number => {
            moveSlot(rig, 'small', x, y);
            redraw(rig);

            return stats.coveredSlots;
        };

        // the opaque rectangle reaches from -90 to 90, the small slot is 20 wide
        expect(at(79.5, 0)).toBe(1);
        expect(at(79.9, -79.9)).toBe(1);
        expect(stats.indexRebuilds).toBe(1);
        expect(at(80.5, 0)).toBe(0);
        expect(stats).toMatchObject({ indexRebuilds: 2, indices: 12 });
        expect(at(0, -81)).toBe(0);
        expect(at(300, 300)).toBe(0);
        expect(stats.indexRebuilds).toBe(2);
        // while nothing is skipped, a slot that goes behind is found by the next search
        moveSlot(rig, 'small', -79, 79);
        expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_LAST);
        expect(stats).toMatchObject({ indexRebuilds: 3, indices: 6 });
        // the vertices of a skipped slot are still placed in every frame: the test reads them
        const uploads = stats.positionUploads;

        redraw(rig);
        expect(stats.positionUploads).toBe(uploads + 1);
    });

    it('wants the slot that hides to be drawn later', async () => {
        const rig = await coverRig([BEHIND[1], BEHIND[0]].flatMap((slot) => (slot ? [slot] : [])));
        const { state } = rig.engine;

        redraw(rig);
        expect(rig.view.stats.coveredSlots).toBe(0);
        state.drawOrder.reverse();
        // another draw order starts the search over: it is found within the first wait
        expect(framesUntilCovered(rig, 1, () => drawPose(rig.view, state))).toBeLessThanOrEqual(SEARCH_FIRST);
        // one rewrite for the order, one for the slot that is skipped
        expect(rig.view.stats.indexRebuilds).toBe(3);
    });

    it('wants an alpha byte of 255 on the slot that hides', async () => {
        const rig = await coverRig(BEHIND);
        const { state } = rig.engine;
        const big = slotOf(rig, 'big');
        const withAlpha = (alpha: number): number => {
            state.colors[big * 4 + 3] = alpha;
            drawPose(rig.view, state);

            return rig.view.stats.coveredSlots;
        };

        redraw(rig);
        // 0.999 is the byte 254
        expect(withAlpha(0.999)).toBe(0);
        expect(withAlpha(0.5)).toBe(0);
        // the alpha of a slot that can hide starts the search over
        state.colors[big * 4 + 3] = 1;
        expect(framesUntilCovered(rig, 1, () => drawPose(rig.view, state))).toBeLessThanOrEqual(SEARCH_FIRST);
        // the color of the attachment counts as well
        expect(
            await coveredIn([
                { name: 'small', shows: 'small' },
                { name: 'big', shows: 'big', tint: 'fffffffe' },
            ]),
        ).toBe(0);
        expect(
            await coveredIn([
                { name: 'small', shows: 'small' },
                { name: 'big', shows: 'big', tint: '808080ff' },
            ]),
        ).toBe(1);
        // the slot that is hidden can have any color
        expect(
            await coveredIn([
                { name: 'small', shows: 'small', color: 'ff000040' },
                { name: 'big', shows: 'big' },
            ]),
        ).toBe(1);
    });

    it.each(['additive', 'multiply', 'screen'] as const)(
        'wants normal blending on the slot that hides, not %s',
        async (blend) => {
            const rig = await coverRig([
                { name: 'small', shows: 'small' },
                { name: 'big', shows: 'big', blend },
            ]);

            redraw(rig);
            expect(rig.view.stats.coveredSlots).toBe(0);
        },
    );

    it('skips a hidden slot of any blend mode, and keeps the draw ranges as they are', async () => {
        const slots: CoverSlot[] = [
            { name: 'small', shows: 'small', blend: 'multiply' },
            { name: 'big', shows: 'big' },
        ];
        const off = await coverRig(slots, { occlusion: 'off' });
        const rig = await coverRig(slots);

        step(off, 0);
        redraw(rig);
        expect(off.view.stats).toMatchObject({ coveredSlots: 0, drawCalls: 2, indices: 12 });
        // the multiply range stays and draws one triangle without area
        expect(rig.view.stats).toMatchObject({ coveredSlots: 1, drawCalls: 2, indices: 9 });
        expect(drawnIndices(rig)).toEqual([
            [0, 0, 0],
            [4, 5, 6, 4, 6, 7],
        ]);
        expect(meshes(rig.view).map((mesh) => mesh.blendMode)).toEqual(meshes(off.view).map((mesh) => mesh.blendMode));
    });

    it('wants the slot that hides outside of every clip', async () => {
        // the clip ends at the big slot, so it cuts the big slot
        const clipped = await coverRig([
            { name: 'small', shows: 'small' },
            { name: 'clip', shows: 'small', as: 'clip', end: 'big' },
            { name: 'big', shows: 'big' },
        ]);
        // the clip ends at the small slot, so the big slot is whole
        const free = await coverRig([
            { name: 'clip', shows: 'small', as: 'clip', end: 'small' },
            { name: 'small', shows: 'small' },
            { name: 'big', shows: 'big' },
        ]);

        step(clipped, 0);
        step(free, 0);
        expect(clipped.view.stats).toMatchObject({ coveredSlots: 0, maskDraws: 2 });
        // the slot that is hidden may be clipped. Its range and its mask stay, as without the cut
        expect(free.view.stats).toMatchObject({ coveredSlots: 1, maskDraws: 2, drawCalls: 4, indices: 9 });
    });

    it('wants the slot that hides to be drawn itself', async () => {
        // the middle slot is covered by the big one, which also covers the small one
        expect(
            await coveredIn([
                { name: 'small', shows: 'small' },
                { name: 'mid', shows: 'mid' },
                { name: 'big', shows: 'big' },
            ]),
        ).toBe(2);
        // the middle slot is drawn, and covers the small one
        expect(
            await coveredIn([
                { name: 'small', shows: 'small' },
                { name: 'mid', shows: 'mid' },
                { name: 'big', shows: 'big', at: [400, 0] },
            ]),
        ).toBe(1);
        // a slot with alpha 0 is not drawn and hides nothing
        expect(
            await coveredIn([
                { name: 'small', shows: 'small' },
                { name: 'big', shows: 'big', color: 'ffffff00' },
            ]),
        ).toBe(0);
    });

    it('wants a region attachment without a sequence on the slot that hides', async () => {
        expect(
            await coveredIn([
                { name: 'small', shows: 'small' },
                { name: 'big', shows: 'big', as: 'mesh' },
            ]),
        ).toBe(0);
        expect(
            await coveredIn([
                { name: 'small', shows: 'small' },
                { name: 'frames', shows: 'seq' },
            ]),
        ).toBe(0);
        // a mesh can be the one that is hidden
        expect(
            await coveredIn([
                { name: 'small', shows: 'small', as: 'mesh' },
                { name: 'big', shows: 'big' },
            ]),
        ).toBe(1);
        expect(
            await coveredIn([
                { name: 'frames', shows: 'seq' },
                { name: 'big', shows: 'big' },
            ]),
        ).toBe(1);
    });

    it('wants an opaque rectangle that keeps the margin bilinear filtering takes', async () => {
        const thin = await coverRig(BEHIND, {}, (outlines) => {
            outlines.opaqueMargin = 0.25;
        });

        step(thin, 0);
        expect(thin.view.stats.coveredSlots).toBe(0);
    });

    it('hides behind two color tint as well, by the alpha of the light color', async () => {
        const rig = await coverRig([
            { name: 'small', shows: 'small', dark: '00ff00' },
            { name: 'big', shows: 'big', dark: 'ff0000' },
        ]);
        const { state } = rig.engine;

        redraw(rig);
        expect(rig.view.stats).toMatchObject({ coveredSlots: 1, indices: 6 });
        // 8 bytes of color per vertex with dark colors
        expect(rig.view.stats.bufferBytes).toBe(
            8 * 28 + (meshes(rig.view)[0]?.geometry.indexBuffer.data.byteLength ?? 0),
        );
        state.colors[slotOf(rig, 'big') * 4 + 3] = 0.5;
        drawPose(rig.view, state);
        expect(rig.view.stats.coveredSlots).toBe(0);
    });

    it(`tests against the ${MAX_OCCLUDERS} largest rectangles of a frame, and not against a small one`, async () => {
        const spread = (count: number): CoverSlot[] =>
            Array.from({ length: count }, (_, i) => ({
                name: `big${i}`,
                shows: 'big' as const,
                at: [300 * (i + 1), 0],
            }));
        const hidden: CoverSlot = { name: 'small', shows: 'small' };
        const mid: CoverSlot = { name: 'mid', shows: 'mid' };

        // the middle rectangle is the smallest of five, so it is not tested
        expect(await coveredIn([hidden, mid, ...spread(MAX_OCCLUDERS)])).toBe(0);
        expect(await coveredIn([hidden, mid, ...spread(MAX_OCCLUDERS - 1)])).toBe(1);
        // a rectangle of 9 by 9 units after the scale of its bone is below the least area
        expect(9 * 9).toBeLessThan(MIN_OCCLUDER_AREA);
        expect(36 * 36).toBeGreaterThan(MIN_OCCLUDER_AREA);
        expect(
            await coveredIn([
                { name: 'small', shows: 'small', scale: 0.1 },
                { name: 'mid', shows: 'mid', scale: 0.1 },
            ]),
        ).toBe(0);
        expect(
            await coveredIn([
                { name: 'small', shows: 'small', scale: 0.1 },
                { name: 'mid', shows: 'mid', scale: 0.4 },
            ]),
        ).toBe(1);
    });

    it('finds every covered slot in one search, and tests each of them again in every frame', async () => {
        const count = 40;
        const rig = await coverRig([
            ...Array.from(
                { length: count },
                (_, i): CoverSlot => ({ name: `s${i}`, shows: 'small', at: [(i % 8) * 20 - 70, 0] }),
            ),
            { name: 'big', shows: 'big' },
        ]);
        const { stats } = rig.view;

        redraw(rig);
        expect(stats).toMatchObject({ coveredSlots: count, indices: 6, indexRebuilds: 1 });
        // every one of them is tested again in the frame the big slot moves away
        moveSlot(rig, 'big', 500, 0);
        redraw(rig);
        expect(stats).toMatchObject({ coveredSlots: 0, indices: (count + 1) * 6, indexRebuilds: 2 });
        moveSlot(rig, 'big', 0, 0);
        expect(framesUntilCovered(rig, count)).toBeLessThanOrEqual(SEARCH_LAST);
        // one that leaves alone is drawn in that frame, while the others stay skipped
        moveSlot(rig, `s${count - 1}`, 300, 0);
        redraw(rig);
        expect(stats).toMatchObject({ coveredSlots: count - 1, indices: 12 });
    });

    it('waits longer from search to search while it finds nothing, and starts over when the slots change', async () => {
        const rig = await coverRig([
            { name: 'small', shows: 'small', at: [300, 0] },
            { name: 'other', shows: 'small', at: [300, 300] },
            { name: 'big', shows: 'big' },
        ]);
        const { state } = rig.engine;
        // the frames that search: the first one, then after twice the wait each time, up to the longest
        const turns = [1];

        for (let wait = SEARCH_FIRST * 2; (turns.at(-1) ?? 0) < 400; wait = Math.min(wait * 2, SEARCH_LAST)) {
            turns.push((turns.at(-1) ?? 0) + wait);
        }
        const idle = 130;
        const next = turns.find((turn) => turn > idle) ?? 0;

        for (let frame = 0; frame < idle; frame++) redraw(rig);
        expect(rig.view.stats).toMatchObject({ coveredSlots: 0, indexRebuilds: 1 });
        // a bone that moves is no reason to search: the slot is found at the next turn
        moveSlot(rig, 'small', 0, 0);
        expect(next - idle).toBeGreaterThan(SEARCH_LAST / 2);
        expect(framesUntilCovered(rig, 1)).toBe(next - idle);
        // back out, and wait until the searches are far apart again
        moveSlot(rig, 'small', 300, 0);
        for (let frame = 0; frame < 300; frame++) redraw(rig);
        expect(rig.view.stats.coveredSlots).toBe(0);
        // a slot that goes away changes the visible slots: the search starts over at once
        moveSlot(rig, 'small', 0, 0);
        state.colors[slotOf(rig, 'other') * 4 + 3] = 0;
        expect(framesUntilCovered(rig, 1)).toBeLessThanOrEqual(SEARCH_FIRST);
    });

    it('tests a skipped slot against the slots that still hide, in the frame one of them goes away', async () => {
        const rig = await coverRig([
            { name: 'far', shows: 'small', at: [300, 0] },
            { name: 'near', shows: 'small' },
            { name: 'big', shows: 'big' },
            { name: 'other', shows: 'big', at: [300, 0] },
        ]);
        const { state } = rig.engine;
        const { stats } = rig.view;
        const alpha = (name: string, value: number): void => {
            state.colors[slotOf(rig, name) * 4 + 3] = value;
            drawPose(rig.view, state);
        };

        redraw(rig);
        expect(stats).toMatchObject({ coveredSlots: 2, indices: 12 });
        // the slot behind the one that goes is drawn at once, the other one stays skipped
        alpha('big', 0);
        expect(stats).toMatchObject({ coveredSlots: 1, indices: 12 });
        alpha('other', 0.5);
        expect(stats).toMatchObject({ coveredSlots: 0, indices: 18 });
        alpha('big', 1);
        alpha('other', 1);
        expect(framesUntilCovered(rig, 2, () => drawPose(rig.view, state))).toBeLessThanOrEqual(SEARCH_FIRST);
    });
});
