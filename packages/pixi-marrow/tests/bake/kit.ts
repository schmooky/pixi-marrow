import { bakeBlocker } from '../../src/bake/eligible';
import type { BakeHost } from '../../src/bake/playback';
import { importSkeleton, loadPoseEngine, type PoseEngine, type PoseEvent, type SkeletonModel } from '../../src/core';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import type { PoseState } from '../../src/pose/state';
import { listFixtures, readFixture } from '../parity/fixtures';

/*
 * What the tests of baking share: the rigs, engines placed as a display object places them, and
 * a comparison of two poses at the precision of a baked clip.
 */

/** One frame of the rate clips are baked at, in seconds. */
export const DT = 1 / 60;

/** One skeleton per rig and version: the binary export, which poses as the JSON one does. */
export const BAKE_RIGS = listFixtures().filter((fixture, _, all) => {
    const same = all.filter((other) => other.version === fixture.version && other.rig === fixture.rig);

    return fixture === (same.find((other) => other.format === 'binary') ?? same[0]);
});

const models = new Map<string, Promise<SkeletonModel>>();

/** The model of a fixture, imported once per test file. */
export function modelOf(id: string): Promise<SkeletonModel> {
    let model = models.get(id);

    if (model === undefined) {
        const fixture = listFixtures().find((candidate) => candidate.id === id);

        if (fixture === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);
        model = importSkeleton(readFixture(fixture).skeleton);
        models.set(id, model);
    }

    return model;
}

/** An asset as baked playback sees it: the model and a factory of engines. */
export async function hostOf(model: SkeletonModel): Promise<BakeHost> {
    return { model, createEngine: await loadPoseEngine(model) };
}

/** An engine placed as a `MarrowSpine` places it, in the setup pose as its constructor leaves it. */
export function displayEngine(host: BakeHost): PoseEngine {
    const engine = host.createEngine();

    engine.state.scaleY = -1;
    engine.state.yDown = true;
    engine.physics = 'none';
    engine.update(0);
    engine.physics = 'update';
    engine.takeEvents();

    return engine;
}

/** True when the default skin of a model plays its animations baked. */
export const bakeable = (model: SkeletonModel): boolean =>
    bakeBlocker(model, createAttachmentLookup(model).skin(-1)) === null;

/** Two numbers equal at 32 bits: the baked one is the other rounded, give or take the last bit of a sum. */
export function close32(live: number, baked: number): boolean {
    if (Math.fround(live) === baked) return true;
    const scale = Math.max(Math.abs(live), Math.abs(baked), 2 ** -20);

    return Math.abs(live - baked) <= scale * 2 ** -23;
}

/**
 * Two numbers equal within a millionth of their size, or of 1. That is the reach of two sums
 * that arrive at one time by other steps: the pose of 4.1 and 4.2 depends on the pose before
 * in its last bits, and a constraint can grow such a difference. A millionth of a pixel.
 */
function closeAcross(live: number, baked: number): boolean {
    return Math.abs(live - baked) <= 1e-6 * Math.max(1, Math.abs(live));
}

type Same = (a: number, b: number) => boolean;

/** Where the numbers of two arrays differ, as the index of the first, or -1. */
function firstDifference(
    live: ArrayLike<number>,
    baked: ArrayLike<number>,
    from: number,
    to: number,
    same: Same,
): number {
    for (let i = from; i < to; i++) if (!same(Number(live[i]), Number(baked[i]))) return i;

    return -1;
}

/** Where the values of one slot differ, or null. */
function slotDifference(live: PoseState, baked: PoseState, slot: number, same: Same): string | null {
    const { slots } = live.model;
    const name = slots.names[slot];
    const dark = slots.hasDark[slot] === 1 ? 3 : 0;

    if (firstDifference(live.colors, baked.colors, slot * 4, slot * 4 + 4, same) >= 0) return `color of ${name}`;
    if (firstDifference(live.darkColors, baked.darkColors, slot * 3, slot * 3 + dark, same) >= 0) {
        return `dark color of ${name}`;
    }
    if (live.attachments[slot] !== baked.attachments[slot]) return `attachment of ${name}`;
    if (live.attachments[slot] === null) return null;
    if (live.sequenceIndices[slot] !== baked.sequenceIndices[slot]) return `sequence index of ${name}`;
    const length = Number(live.deformLengths[slot]);

    if (length !== baked.deformLengths[slot])
        return `deform length of ${name}: ${baked.deformLengths[slot]}, live ${length}`;
    const deform = firstDifference(live.deform[slot] ?? [], baked.deform[slot] ?? [], 0, length, same);

    return deform >= 0 ? `deform of ${name}[${deform}]` : null;
}

/**
 * Where a baked pose differs from the live one, or null. World transforms of active bones, slot
 * colors, attachments, sequence indices, deforms and the draw order. `exact` asks for the live
 * numbers rounded to 32 bits, else {@link closeAcross}.
 */
export function poseDifference(live: PoseState, baked: PoseState, exact: boolean): string | null {
    const same: Same = (a, b) => (exact ? Math.fround(a) === Math.fround(b) : closeAcross(a, b));
    const { model } = live;

    for (let bone = 0; bone < model.bones.count; bone++) {
        if (live.active[bone] !== 1) continue;
        const i = firstDifference(live.world, baked.world, bone * 6, bone * 6 + 6, same);

        if (i >= 0)
            return `world of bone ${model.bones.names[bone]}[${i % 6}]: ${baked.world[i]}, live ${live.world[i]}`;
    }
    for (let slot = 0; slot < model.slots.count; slot++) {
        const difference = slotDifference(live, baked, slot, same);

        if (difference !== null) return difference;
    }
    const order = firstDifference(live.drawOrder, baked.drawOrder, 0, live.drawOrder.length, (a, b) => a === b);

    return order >= 0 ? `draw order at ${order}` : null;
}

/** An event as plain data, with its entry named by track and animation. */
export const eventData = ({ type, track, animation, key }: PoseEvent) => ({
    type,
    track,
    animation,
    key: key === undefined ? null : { ...key },
});
