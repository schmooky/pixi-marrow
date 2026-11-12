import { beforeAll, describe, expect, it } from 'vitest';
import { batchClipper, loadBatchClipper } from '../../src/render/clip-code';
import { inspectView } from '../../src/render/inspect';
import { loadFamily, populate } from './batch-check';
import { expectClippedBatch } from './batch-clip-check';
import { batcherOf, bodyOf, createStage, elementOf, readRuns, readVertex, type Stage } from './batch-stage';
import { type CoverSlot, coverRig, framesUntilCovered } from './cover-rig';
import { PENTAGON, setPolygon } from './cuts';
import { play, type Rig, step } from './rig';

/*
 * Clips in the batched mode: the triangles of a slot inside a clip are cut on the CPU and stay
 * in the batch of the skeleton. The reference is the official clipper, see `batch-clip-check.ts`.
 */

/** A rig with a clipping attachment, and an animation that shows it. */
const CLIPPED: [string, string, number][] = [
    ['4.1/coin-pro.skel', 'animation', 40],
    ['4.2/coin-pro.skel', 'animation', 40],
    ['4.3/coin-pro.skel', 'animation', 40],
    ['4.1/spineboy-pro.skel', 'portal', 60],
    ['4.2/spineboy-pro.skel', 'portal', 60],
    ['4.3/spineboy-pro.skel', 'portal', 60],
    ['4.1/tank-pro.skel', 'shoot', 30],
    ['4.2/tank-pro.skel', 'shoot', 30],
    ['4.3/tank-pro.skel', 'shoot', 30],
];

beforeAll(async () => {
    await loadBatchClipper();
});

describe('a clip in the batched mode', () => {
    it('has its code once it was asked for', () => {
        expect(batchClipper()).toBeDefined();
    });

    it.each(CLIPPED)('draws what the official clipper leaves of %s in %s', async (id, animation, frames) => {
        const stage = createStage();
        const family = await loadFamily(id);
        const [rig] = await populate(stage, family, 1);
        const total = { cut: 0, whole: 0, corners: 0 };

        if (rig === undefined) throw new Error('no rig');
        rig.view.container.position.set(31.5, -12.25);
        rig.view.container.scale.set(0.75, 1.25);
        play(rig, animation);
        for (let frame = 0; frame < frames; frame++) {
            step(rig, 0.05);
            stage.render();
            const counted = expectClippedBatch(rig);

            total.cut += counted.cut;
            total.whole += counted.whole;
            total.corners += counted.corners;
            // a clip never sends a batched view to its meshes
            expect(rig.view.stats).toMatchObject({ renderMode: 'batched', maskDraws: 0 });
            expect(rig.view.stats.indices).toBe(counted.corners);
        }
        expect(total.cut).toBeGreaterThan(0);
        expect(rig.view.parts.paints.mesh).toBeUndefined();
        expect(inspectView(rig.view).mode).toMatchObject({ mode: 'batched', reason: 'option' });
    });

    it.each(CLIPPED)('builds the instructions no more once %s has played %s for one turn', async (id, animation) => {
        const stage = createStage();
        const family = await loadFamily(id);
        const rigs = await populate(stage, family, 3);
        const index = family.model.animations.findIndex((candidate) => candidate.name === animation);
        const frames = Math.ceil((family.model.animations[index]?.duration ?? 0) / 0.03) + 1;
        const turn = (): void => {
            for (let frame = 0; frame < frames; frame++) {
                for (const rig of rigs) step(rig, 0.03);
                stage.render();
            }
        };

        for (const rig of rigs) play(rig, animation);
        // the instances are at other places of the animation, so they need more room at other times
        rigs.forEach((rig, i) => {
            step(rig, i * 0.21);
        });
        turn();
        const settled = stage.counts.builds;

        turn();
        turn();
        expect(stage.counts.builds - settled).toBe(0);
        // few builds before that: the room grows by a quarter more than a pose asked for
        expect(settled).toBeLessThanOrEqual(10);
        for (const rig of rigs) {
            expect(elementOf(rig.view).resized).toBe(false);
            expectClippedBatch(rig);
            expect(bodyOf(rig.view)?.visible).toBe(true);
        }
    });
});

/** Shows a rig on a stage, in its setup pose. */
function show(stage: Stage, rig: Rig): void {
    step(rig, 0);
    stage.root.addChild(rig.view.container);
}

/** The indices of a rig that draw a triangle with area. */
const drawn = (rig: Rig): number => readRuns(rig.view).flat().length;

/**
 * A clip whose polygon is a triangle with its tip at 0, 500, and slots at that tip: the clip
 * cuts them. `spark` adds and has a dark color, so the skeleton tints with two colors.
 */
const AT_THE_TIP: CoverSlot[] = [
    { name: 'clip', shows: 'big', as: 'clip', end: 'spark' },
    { name: 'small', shows: 'small', at: [0, 495] },
    { name: 'spark', shows: 'small', at: [5, 490], blend: 'additive', color: 'ff8040c0', dark: '204060' },
    { name: 'cover', shows: 'big', at: [0, 495] },
];

/** The clip and the slot `small` alone. */
const SMALL_AT_THE_TIP: CoverSlot[] = AT_THE_TIP.slice(0, 2).map((slot) => ({ ...slot, end: 'small' }));

describe('what a clip cuts in a batch', () => {
    it('keeps the colors, the dark color and the blend mode of its slot', async () => {
        const stage = createStage();
        const rig = await coverRig(AT_THE_TIP.slice(0, 3), { renderMode: 'batched', occlusion: 'off' });

        show(stage, rig);
        stage.render();
        const element = elementOf(rig.view);
        const first = element.layout.vertices;
        const counted = expectClippedBatch(rig);

        expect(batcherOf(rig.view).name).toBe('marrow-dark');
        expect(counted).toMatchObject({ cut: 2, whole: 0 });
        expect(element.clipUsed).toBeGreaterThanOrEqual(6);
        // the cut vertices come after the room of the slots: those of `small`, then those of `spark`
        const plain = readVertex(rig.view, first);
        const spark = readVertex(rig.view, first + element.clipUsed - 1);

        expect(plain).toMatchObject({ additive: 0, dark: 0xff000000, light: 0xffffffff });
        // the dark color carries the alpha of the slot in its channels, as in the mesh mode
        expect(spark).toMatchObject({ additive: 255, dark: 0xff483018, light: 0xc04080ff });
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 0, drawCalls: 1 });
    });

    it('is drawn again in the frame an alpha uncovers its slot, with the room it has', async () => {
        const stage = createStage();
        const rig = await coverRig(
            AT_THE_TIP.filter((slot) => slot.name !== 'spark').map((slot) => ({ ...slot, end: 'small' })),
            {
                renderMode: 'batched',
            },
        );

        show(stage, rig);
        framesUntilCovered(rig, 1, () => {
            step(rig, 0);
            stage.render();
        });
        const element = elementOf(rig.view);
        const { builds } = stage.counts;

        // only the slot that covers is drawn, and the batch keeps room for what the clip leaves of the other one
        expect(drawn(rig)).toBe(6);
        expect(element.clipVertices).toBeGreaterThanOrEqual(3);
        stage.root.alpha = 0.99;
        stage.render();
        expect(rig.view.stats.coveredSlots).toBe(0);
        expect(expectClippedBatch(rig)).toMatchObject({ cut: 1 });
        expect(stage.counts.builds).toBe(builds);
        expect(element.resized).toBe(false);
    });

    it('is cut from the polygon of a region that is laid out as one', async () => {
        const stage = createStage();
        const rig = await coverRig(SMALL_AT_THE_TIP, { renderMode: 'batched', tightMesh: 'on' }, (outlines) =>
            setPolygon(outlines, 'small', PENTAGON),
        );

        show(stage, rig);
        stage.render();
        const corners = readRuns(rig.view)
            .flat()
            .map((vertex) => readVertex(rig.view, vertex));

        expect(rig.view.stats).toMatchObject({ tightRanges: 1, renderMode: 'batched' });
        expect(corners.length).toBeGreaterThanOrEqual(3);
        // inside of the square of the region, and below the tip of the clip
        for (const { x, y } of corners) {
            expect(Math.abs(x)).toBeLessThanOrEqual(10);
            expect(y).toBeGreaterThanOrEqual(485);
            expect(y).toBeLessThanOrEqual(500);
        }
        // the polygon is a part of the quad, so what is left of it is a part of what is left of the quad
        expect(areaOf(corners)).toBeGreaterThan(0);
        expect(areaOf(corners)).toBeLessThan(20 * 15);
    });

    it('takes the quad again for a renderer that moves edges, before the batch is sized', async () => {
        const stage = createStage({ antialias: true });
        const rig = await coverRig(SMALL_AT_THE_TIP, { renderMode: 'batched', tightMesh: 'on' }, (outlines) =>
            setPolygon(outlines, 'small', PENTAGON),
        );

        show(stage, rig);
        stage.render();
        expect(rig.view.stats.tightRanges).toBe(0);
        expect(expectClippedBatch(rig)).toMatchObject({ cut: 1 });
        expect(stage.counts.builds).toBe(1);
    });

    it('leaves a cut slot out while the batch has no room for it, and builds the instructions again', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/coin-pro.skel');
        const rigs = await populate(stage, family, 2);
        const [rig, next] = rigs;

        if (rig === undefined || next === undefined) throw new Error('no rig');
        for (const item of rigs) play(item, 'animation');
        for (let frame = 0; frame < 30; frame++) {
            for (const item of rigs) step(item, 0.05);
            stage.render();
        }
        const element = elementOf(rig.view);
        const { builds } = stage.counts;
        const held = expectClippedBatch(next);
        const full = drawn(rig);

        expect(held.cut).toBeGreaterThan(0);
        expect(element.clipUsed).toBeGreaterThan(0);
        // as if a draw asked for more than the batch has room for
        element.clipVertices = 0;
        element.dirty = true;
        element.sync();
        expect(element.resized).toBe(true);
        expect(element.clipUsed).toBe(0);
        expect(drawn(rig)).toBeLessThan(full);
        // the skeleton behind it in the batch is as it was
        expect(expectClippedBatch(next)).toEqual(held);
        for (const item of rigs) step(item, 0);
        stage.render();
        expect(stage.counts.builds).toBe(builds + 1);
        expect(element.clipVertices).toBeGreaterThan(0);
        expectClippedBatch(rig);
        expectClippedBatch(next);
    });
});

/** The area of triangles given corner by corner. */
function areaOf(corners: readonly { x: number; y: number }[]): number {
    let sum = 0;

    for (let i = 0; i + 2 < corners.length; i += 3) {
        const [a, b, c] = [corners[i], corners[i + 1], corners[i + 2]];

        if (a === undefined || b === undefined || c === undefined) continue;
        sum += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    }

    return sum;
}
