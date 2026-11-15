import { Container } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { nextVersion } from '../../src/pose/state';
import { POSITIONS_CHANGED } from '../../src/render/batch-pack';
import { loadMeshCode } from '../../src/render/mesh-code';
import { expectBatch, loadFamily } from './batch-check';
import { batcherOf, createStage, elementOf, watchUploads } from './batch-stage';
import { RANGED_UPLOADS } from './pixi-version';
import { play, type Rig, step } from './rig';

/*
 * What a view counts about the work that is not in its pose: a display object above it that
 * moves or fades, a build of the instructions, and the bytes it hands to the GPU. And what the
 * batch uploads for changes that are small: a stretch per skeleton, also when many changed.
 */

beforeAll(async () => {
    await loadMeshCode();
});

/** A stage with skeletons of one rig below one container, drawn twice. */
async function crowd(
    count: number,
): Promise<{ stage: ReturnType<typeof createStage>; holder: Container; rigs: Rig[] }> {
    const stage = createStage();
    const family = await loadFamily('4.2/spineboy-pro.skel');
    const holder = new Container();
    const rigs: Rig[] = [];

    stage.root.addChild(holder);
    for (let i = 0; i < count; i++) {
        const rig = await family.create();

        rig.view.update(rig.engine.state);
        holder.addChild(rig.view.container);
        rigs.push(rig);
    }
    stage.render();
    stage.render();

    return { stage, holder, rigs };
}

/** One frame of a game: every skeleton is updated, then Pixi renders. */
function frame(stage: ReturnType<typeof createStage>, rigs: Rig[]): void {
    for (const rig of rigs) rig.view.update(rig.engine.state);
    stage.render();
}

/** Gives a slot of a rig another alpha, as a color timeline does: the slot is stamped, no bone is. */
function pulse(rig: Rig, slot: number, alpha: number): void {
    const { state } = rig.engine;

    state.colors[slot * 4 + 3] = alpha;
    state.version = nextVersion(state.version);
    state.slotStamps[slot] = state.version;
    rig.view.update(state);
}

/** The slot of the third visible entry of a rig: a region. */
function someSlot(rig: Rig): number {
    const { seen, template } = rig.view.parts;

    return template.slots[seen.list[2] ?? 0] ?? 0;
}

describe('the counters of a view in a batch', () => {
    it('count a build of the instructions, with all the bytes of the skeleton', async () => {
        const { stage, rigs } = await crowd(3);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        const element = elementOf(rig.view);
        const { stats } = rig.view;
        const whole = {
            positions: element.attributeSize * 8,
            statics: element.attributeSize * element.staticWords * 4,
            indices: element.indexSize * 2,
            bones: 0,
            masks: 0,
        };
        const sum = whole.positions + whole.statics + whole.indices;

        expect(stats.instructionBuilds).toBe(1);
        expect(stats.uploadBytes).toEqual(whole);
        expect(stats).toMatchObject({ transformReplaces: 0, tintRewrites: 0 });
        // the build was in the frame of the last update. The frame after it wrote nothing
        expect(stats.frameBytes).toBe(sum);
        frame(stage, rigs);
        expect(stats.frameBytes).toBe(0);
        // another display object in the render group: Pixi builds again
        stage.root.addChild(new Container());
        rigs[1]?.view.container.removeFromParent();
        frame(stage, rigs);
        expect(stats.instructionBuilds).toBe(2);
        expect(stats.frameBytes).toBe(sum);
        expect(stats.uploadBytes.positions).toBe(2 * whole.positions);
        frame(stage, rigs);
        expect(stats.frameBytes).toBe(0);
    });

    it('count a frame that placed every vertex again for a parent that moved, though the pose rests', async () => {
        const { stage, holder, rigs } = await crowd(4);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        const { stats } = rig.view;
        const element = elementOf(rig.view);
        const before = { ...stats.uploadBytes };
        const { skips, positionUploads } = stats;

        for (let turn = 1; turn <= 3; turn++) {
            holder.x += 5;
            frame(stage, rigs);
            expect(stats.transformReplaces).toBe(turn);
            expect(stats.frameBytes).toBe(element.attributeSize * 8);
        }
        // the pose was at rest all the time, and the old counters say so
        expect(stats.skips).toBe(skips + 3);
        expect(stats.positionUploads).toBe(positionUploads);
        expect(stats.uploadBytes.positions - before.positions).toBe(3 * element.attributeSize * 8);
        expect(stats.tintRewrites).toBe(0);
        expect(stage.counts.builds).toBe(1);
        // a frame in which nothing moves counts nothing, and its bytes are 0
        frame(stage, rigs);
        expect(stats.transformReplaces).toBe(3);
        expect(stats.frameBytes).toBe(0);
        for (const item of rigs) expectBatch(item);
    });

    it('count a frame that wrote every static again for a parent that fades', async () => {
        const { stage, holder, rigs } = await crowd(4);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        const { stats } = rig.view;
        const { positions } = stats.uploadBytes;
        let { statics } = stats.uploadBytes;

        for (let turn = 1; turn <= 3; turn++) {
            holder.alpha = 1 - turn / 10;
            frame(stage, rigs);
            expect(stats.tintRewrites).toBe(turn);
            expect(stats.frameBytes).toBeGreaterThan(0);
            expect(stats.uploadBytes.positions).toBe(positions);
            expect(stats.uploadBytes.statics).toBe(statics + stats.frameBytes);
            statics = stats.uploadBytes.statics;
        }
        expect(stats.transformReplaces).toBe(0);
        frame(stage, rigs);
        expect(stats.tintRewrites).toBe(3);
        expect(stats.frameBytes).toBe(0);
        for (const item of rigs) expectBatch(item);
    });

    it('count nothing for a parent that is a render group: the GPU moves and fades it', async () => {
        const { stage, holder, rigs } = await crowd(3);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        holder.isRenderGroup = true;
        stage.render();
        stage.render();
        const { stats } = rig.view;
        const before = { ...stats, uploadBytes: { ...stats.uploadBytes } };

        for (let turn = 0; turn < 3; turn++) {
            holder.x += 5;
            holder.alpha = 0.9 - turn / 10;
            frame(stage, rigs);
        }
        expect(stats).toMatchObject({ transformReplaces: before.transformReplaces, tintRewrites: before.tintRewrites });
        expect(stats.uploadBytes).toEqual(before.uploadBytes);
    });
});

describe('what a batch uploads for small changes', () => {
    it('is the vertices of the slot whose color changed, and no position', async () => {
        const { stage, rigs } = await crowd(6);
        const rig = rigs[3];

        if (rig === undefined) throw new Error('no rig');
        const slot = someSlot(rig);
        const uploads = watchUploads(batcherOf(rig.view));
        const element = elementOf(rig.view);
        const positions = Float32Array.from(rig.view.parts.template.positions);

        pulse(rig, slot, 0.5);
        stage.render();
        // the color is in the batch, the vertices of the slot stayed where they were
        expectBatch(rig);
        expect(rig.view.stats).toMatchObject({ placedSlots: 0, coloredSlots: 1 });
        expect(rig.view.parts.template.positions).toEqual(positions);
        expect(uploads).toMatchObject({ positions: 0, statics: 1, indices: 0 });
        // one slot, not the skeleton: on every pixi.js, since one stretch is all there is
        expect(uploads.staticBytes).toBeLessThan(element.attributeSize * element.staticWords);
        expect(rig.view.stats.frameBytes).toBe(uploads.staticBytes);
        expect(stage.counts.builds).toBe(1);
    });

    it('stays small when more skeletons changed than the batcher keeps stretches for', async () => {
        const { stage, rigs } = await crowd(40);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        const slot = someSlot(rig);
        const batcher = batcherOf(rig.view);
        const uploads = watchUploads(batcher);
        const whole = (batcher.attributeSize / 2) * batcher.staticWords * 4;

        for (const item of rigs) pulse(item, slot, 0.5);
        stage.render();
        for (const item of rigs) expectBatch(item);
        expect(uploads.positions).toBe(0);
        if (RANGED_UPLOADS) {
            // a stretch per skeleton
            expect(uploads.statics).toBe(40);
            expect(uploads.staticBytes).toBeLessThan(whole / 50);
        } else {
            // a WebGL buffer of pixi.js before 8.23 keeps one stretch: from the first change to the last
            expect(uploads.statics).toBe(1);
            expect(uploads.staticBytes).toBeLessThan(whole);
        }
        // one skeleton of many that walks: its vertices alone, on every pixi.js
        play(rig, 'walk');
        step(rig, 0.1);
        stage.render();
        uploads.positions = 0;
        uploads.positionBytes = 0;
        step(rig, 0.1);
        stage.render();
        expect(uploads.positions).toBe(1);
        expect(uploads.positionBytes).toBeLessThanOrEqual(elementOf(rig.view).attributeSize * 8);
    });

    it('uploads a buffer whole after a build, also when a skeleton writes a stretch before it is bound', async () => {
        const { stage, rigs } = await crowd(4);
        const rig = rigs[1];

        if (rig === undefined) throw new Error('no rig');
        const batcher = batcherOf(rig.view);
        const [positions] = batcher.geometry.buffers;
        const told: [number, number][] = [];

        if (positions === undefined) throw new Error('no positions');
        const update = positions.update.bind(positions);

        positions.update = (size?: number, offset?: number): void => {
            told.push([offset ?? 0, size ?? positions.data.byteLength]);
            update(size, offset);
        };
        // a build, and in the same frame a skeleton that moves when Pixi is about to draw it
        rigs[3]?.view.container.removeFromParent();
        const { beforeDraw } = rig.view;

        rig.view.beforeDraw = (bends): void => {
            const element = elementOf(rig.view);
            const entry = rig.view.parts.seen.list[2] ?? 0;

            // as a pose that placed one slot again
            element.state[element.changedAt + entry] = POSITIONS_CHANGED;
            element.dirty = true;
            beforeDraw.call(rig.view, bends);
        };
        stage.render();
        rig.view.beforeDraw = beforeDraw;
        expect(stage.counts.builds).toBe(2);
        // A WebGL buffer before pixi.js 8.23 keeps the last stretch it was told until it is bound:
        // that must be all of the buffer, or the skeletons the build moved would keep old vertices
        if (!RANGED_UPLOADS) expect(told.at(-1)).toEqual([0, batcher.attributeSize * 4]);
        expect(told.some(([from, size]) => from === 0 && size === batcher.attributeSize * 4)).toBe(true);
    });

    it('keeps a skeleton that shows nothing in its batch, so that Pixi builds nothing again', async () => {
        const { stage, rigs } = await crowd(5);
        const rig = rigs[2];

        if (rig === undefined) throw new Error('no rig');
        const { colors } = rig.engine.state;
        const saved = colors.slice();
        const draws = stage.counts.draws.length;

        for (let turn = 0; turn < 6; turn++) {
            if (turn % 2 === 0) for (let slot = 0; slot < rig.model.slots.count; slot++) colors[slot * 4 + 3] = 0;
            else colors.set(saved);
            rig.engine.state.version = nextVersion(rig.engine.state.version);
            rig.engine.state.slotStamps.fill(rig.engine.state.version);
            rig.view.update(rig.engine.state);
            stage.render();
            expect(stage.counts.builds).toBe(1);
            expect(stage.counts.draws).toHaveLength(draws);
            expect(rig.view.stats.drawCalls).toBe(turn % 2 === 0 ? 0 : 1);
            expect(rig.view.stats.indices > 0).toBe(turn % 2 === 1);
            expect(elementOf(rig.view).drawn > 0).toBe(turn % 2 === 1);
            for (const item of rigs) if (item !== rig || turn % 2 === 1) expectBatch(item);
        }
    });
});
