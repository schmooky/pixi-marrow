import { AnimationState, AnimationStateData, Physics, Skeleton, type SkeletonData } from 'spine-core-4.3';
import { createPoseEngine, importSkeleton, type PhysicsMode, type PoseEngine, WORLD_STRIDE } from '../../src/core';
import type { RigFiles } from '../parity/official';
import { readData43 } from '../parity/pose-official43';

/*
 * Our 4.3 engine and the official 4.3 skeleton of one rig, side by side, for tests that make the
 * same calls on both and compare the whole pose after any call, not only after an update.
 */

/** Our engine and the official skeleton of one rig, which take the same calls. */
export interface Pair {
    engine: PoseEngine;
    data: SkeletonData;
    skeleton: Skeleton;
    state: AnimationState;
    /** The official physics mode of the next update. */
    physics: PhysicsMode;
    /** True once the official core has thrown: nothing can be compared from then on. */
    broken: boolean;
}

const PHYSICS: Record<PhysicsMode, Physics> = {
    none: Physics.none,
    reset: Physics.reset,
    update: Physics.update,
    pose: Physics.pose,
};

/** One page without regions, for a rig that shows paths only. */
export const NO_REGIONS: string = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');

/** Loads a rig on both sides. Both start in the setup pose with nothing playing. */
export async function createPair(files: RigFiles): Promise<Pair> {
    const data = readData43(files);
    const engine = await createPoseEngine(await importSkeleton(files.skeleton));
    const skeleton = new Skeleton(data);

    return {
        engine,
        data,
        skeleton,
        state: new AnimationState(new AnimationStateData(data)),
        physics: 'update',
        broken: false,
    };
}

/** True when two lists hold the same numbers, bit for bit. */
const same = (mine: ArrayLike<number>, theirs: ArrayLike<number>): boolean =>
    mine.length === theirs.length && Array.from(mine).every((value, i) => Object.is(value, theirs[i]));

/** Where the bones of the two sides differ: the animated local pose and the world transform of the applied pose. */
function boneDifferences({ engine, skeleton }: Pair, where: string): string[] {
    const { state } = engine;

    return skeleton.bones.flatMap((bone, i) => {
        const { a, b, c, d, worldX, worldY } = bone.appliedPose;
        const { x, y, rotation, scaleX, scaleY, shearX, shearY, inherit } = bone.pose;
        const world = state.world.subarray(i * WORLD_STRIDE, (i + 1) * WORLD_STRIDE);
        const local = state.local.subarray(i * 7, i * 7 + 7);
        const lines: string[] = [];

        if (!same(world, [a, b, c, d, worldX, worldY]))
            lines.push(
                `${where}: bone ${i}, active ${bone.active}: world ${world} is not ${[a, b, c, d, worldX, worldY]}`,
            );
        if (!same(local, [x, y, rotation, scaleX, scaleY, shearX, shearY]) || state.inherit[i] !== inherit)
            lines.push(
                `${where}: bone ${i}: local ${local} is not ${[x, y, rotation, scaleX, scaleY, shearX, shearY]}`,
            );
        if ((state.active[i] === 1) !== bone.active) lines.push(`${where}: bone ${i}: active ${state.active[i]}`);

        return lines;
    });
}

/** Where the slots of the two sides differ: the applied pose, which is what is drawn. */
function slotDifferences({ engine, skeleton }: Pair, where: string): string[] {
    const { state } = engine;

    return skeleton.slots.flatMap((slot, i) => {
        const { color, darkColor, attachment, sequenceIndex, deform } = slot.appliedPose;
        const mine = state.attachments[i] ?? null;
        const lines: string[] = [];
        const light = state.colors.subarray(i * 4, i * 4 + 4);
        const dark = state.darkColors.subarray(i * 3, i * 3 + 3);

        if (!same(light, [color.r, color.g, color.b, color.a]))
            lines.push(`${where}: slot ${i}: color ${light} is not ${[color.r, color.g, color.b, color.a]}`);
        if (
            darkColor !== null &&
            slot.data.setupPose.darkColor !== null &&
            !same(dark, [darkColor.r, darkColor.g, darkColor.b])
        )
            lines.push(`${where}: slot ${i}: dark color ${dark} is not ${[darkColor.r, darkColor.g, darkColor.b]}`);
        if ((mine?.name ?? null) !== (attachment?.name ?? null))
            lines.push(`${where}: slot ${i}: attachment ${mine?.name} is not ${attachment?.name}`);
        if (attachment === null || mine === null) return lines;
        if (state.sequenceIndices[i] !== sequenceIndex)
            lines.push(`${where}: slot ${i}: sequence index ${state.sequenceIndices[i]} is not ${sequenceIndex}`);
        const used = state.deform[i]?.subarray(0, state.deformLengths[i]) ?? [];

        if (!same(used, deform)) lines.push(`${where}: slot ${i}: deform ${used} is not ${deform}`);

        return lines;
    });
}

/** Where the two sides differ. The official draw order is empty before the first update of a slider that animates it. */
export function differences(pair: Pair, where: string): string[] {
    const order = pair.skeleton.drawOrder.appliedPose.map((slot) => slot.data.index);
    const lines = [...boneDifferences(pair, where), ...slotDifferences(pair, where)];

    if (order.length > 0 && !same(pair.engine.state.drawOrder, order))
        lines.push(`${where}: draw order ${pair.engine.state.drawOrder} is not ${order}`);

    return lines;
}

/**
 * One update on both sides, in the official order. Returns false when the official core threw.
 * Then nothing can be compared any more, and `broken` of the pair is set.
 */
export function updateBoth(pair: Pair, dt: number): boolean {
    const { engine, skeleton, state } = pair;

    engine.update(dt);
    state.update(dt);
    skeleton.update(dt);
    state.apply(skeleton);
    try {
        skeleton.updateWorldTransform(PHYSICS[pair.physics]);
    } catch {
        pair.broken = true;
    }

    return !pair.broken;
}

/** Plays an animation on a track of both sides. */
export function playBoth({ engine, data, state }: Pair, track: number, animation: number, loop: boolean) {
    const name = data.animations[animation]?.name;

    if (name === undefined) throw new Error(`The rig has no animation ${animation}`);

    return { mine: engine.setAnimation(track, animation, loop), theirs: state.setAnimation(track, name, loop) };
}

/** Makes a skin active on both sides. -1 for none. */
export function skinBoth({ engine, data, skeleton }: Pair, skin: number): void {
    engine.setSkin(skin);
    skeleton.setSkin(data.skins[skin] ?? null);
}

/** Sets the physics mode of the updates that follow, on both sides. */
export function physicsBoth(pair: Pair, mode: PhysicsMode): void {
    pair.physics = mode;
    pair.engine.physics = mode;
}
