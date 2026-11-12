import type { AttachmentData } from '../../model/attachments';
import { WORLD_STRIDE } from '../state';
import { constraintError } from './plan-checks';
import type { IkPlan, PathPlan, PhysicsPlan, Plan43, SliderPlan, TransformPlan } from './solver-types';
import { beginPosed, endPosed } from './split';
import type { Pose43 } from './types';

/*
 * The official `Skeleton.updateCache`: which bones and constraints are active, and the order in
 * which an update computes world transforms and solves constraints. The pose it is given is the
 * animated one: a path constraint is sorted by the attachment its slot has there.
 */

/**
 * The official `Skeleton.updateCache`, for bones: a bone that needs a skin is active while the
 * active skin lists it or one of its descendants. The official `bone.sorted` starts as the opposite.
 */
function updateActive(pose: Pose43): void {
    const { active } = pose.state;
    const { sorted } = pose.rig.solver.scratch;
    const { parents, skinRequired, count } = pose.rig.model.bones;
    const skin = pose.rig.model.skins[pose.state.skin];

    for (let bone = 0; bone < count; bone++) active[bone] = skinRequired[bone] === 1 ? 0 : 1;
    for (const listed of skin?.bones ?? []) {
        for (let bone: number = listed; bone >= 0; bone = parents[bone] ?? -1) active[bone] = 1;
    }
    for (let bone = 0; bone < count; bone++) sorted[bone] = active[bone] === 1 ? 0 : 1;
}

/** The official `Skeleton.sortBone`: puts a bone into the update cache, after its parents. */
function sortBone(pose: Pose43, bone: number): void {
    const { sorted, items } = pose.rig.solver.scratch;

    if (sorted[bone] === 1 || pose.state.active[bone] !== 1) return;
    const parent = pose.rig.model.bones.parents[bone] ?? -1;

    if (parent >= 0) sortBone(pose, parent);
    sorted[bone] = 1;
    items.push(bone);
}

/**
 * The official `Skeleton.sortReset` for the children of `bone`: the bones below a constrained
 * bone go into the update cache once more, after the constraint.
 */
function sortReset(pose: Pose43, bone: number): void {
    const { childStarts, children, scratch } = pose.rig.solver;
    const { active } = pose.state;
    const end = childStarts[bone + 1] ?? 0;

    for (let i = childStarts[bone] ?? 0; i < end; i++) {
        const child = children[i] ?? -1;

        if (active[child] !== 1) continue;
        if (scratch.sorted[child] === 1) sortReset(pose, child);
        scratch.sorted[child] = 0;
    }
}

/** The official `Skeleton.constrained` for a bone: its applied pose is its constrained pose from now on. */
function constrain(pose: Pose43, bone: number): void {
    pose.solve.constrained[bone] = 1;
}

/** The official `IkConstraint.sort`. */
function sortIk(pose: Pose43, plan: IkPlan): void {
    const { scratch } = pose.rig.solver;
    const parent = plan.bones[0];

    // the official code fails here with a TypeError
    if (parent === undefined) throw constraintError('ik', plan.name, 'has no bones.');
    sortBone(pose, plan.target);
    sortBone(pose, parent);
    scratch.items.push(~plan.index);
    scratch.sorted[parent] = 0;
    sortReset(pose, parent);
    constrain(pose, parent);
    if (plan.bones.length > 1) constrain(pose, plan.bones[1] ?? -1);
}

/** The official `TransformConstraint.sort`. */
function sortTransform(pose: Pose43, plan: TransformPlan): void {
    const { scratch } = pose.rig.solver;
    const { bones } = plan;
    const worldTarget = !plan.localTarget;

    if (!plan.localSource) sortBone(pose, plan.source);
    if (worldTarget) for (let i = 0; i < bones.length; i++) sortBone(pose, bones[i] ?? -1);
    scratch.items.push(~plan.index);
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i] ?? -1;

        sortReset(pose, bone);
        constrain(pose, bone);
    }
    for (let i = 0; i < bones.length; i++) scratch.sorted[bones[i] ?? -1] = worldTarget ? 1 : 0;
}

/** The official `PathConstraint.sortPath`: the bones a path attachment follows come before the constraint. */
function sortPathAttachment(pose: Pose43, plan: PathPlan, attachment: AttachmentData | null | undefined): void {
    if (attachment == null || attachment.type !== 'path') return;
    const pathBones = attachment.bones;

    if (pathBones === null) {
        sortBone(pose, plan.slotBone);

        return;
    }
    const { count } = pose.rig.model.bones;

    // per vertex: a count, then that many bone indices
    for (let i = 0, n = pathBones.length; i < n; ) {
        let nn = pathBones[i++] ?? 0;

        nn += i;
        while (i < nn) {
            const bone = pathBones[i++] ?? -1;

            // the official code fails here with a TypeError
            if (bone < 0 || bone >= count) {
                throw constraintError(
                    'path',
                    plan.name,
                    `has the path "${attachment.name}" with weights for bone ${bone}.`,
                );
            }
            sortBone(pose, bone);
        }
    }
}

/** The official `PathConstraint.sortPathSlot`: every attachment a skin has for the slot of the constraint. */
function sortPathSlot(pose: Pose43, plan: PathPlan, skin: number): void {
    for (const entry of pose.rig.model.skins[skin]?.attachments ?? []) {
        if (entry.slot === plan.slot) sortPathAttachment(pose, plan, entry.attachment);
    }
}

/** The official `PathConstraint.sort`. */
function sortPath(pose: Pose43, plan: PathPlan): void {
    const { state, rig } = pose;
    const { scratch } = rig.solver;
    const { bones } = plan;
    const { defaultSkin } = rig.lookup;

    if (state.skin !== -1) sortPathSlot(pose, plan, state.skin);
    if (defaultSkin !== -1 && defaultSkin !== state.skin) sortPathSlot(pose, plan, defaultSkin);
    sortPathAttachment(pose, plan, pose.attachments[plan.slot]);
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i] ?? -1;

        sortBone(pose, bone);
        constrain(pose, bone);
    }
    scratch.items.push(~plan.index);
    for (let i = 0; i < bones.length; i++) sortReset(pose, bones[i] ?? -1);
    for (let i = 0; i < bones.length; i++) scratch.sorted[bones[i] ?? -1] = 1;
}

/** The official `PhysicsConstraint.sort`. */
function sortPhysics(pose: Pose43, plan: PhysicsPlan): void {
    sortBone(pose, plan.bone);
    pose.rig.solver.scratch.items.push(~plan.index);
    sortReset(pose, plan.bone);
    constrain(pose, plan.bone);
}

/**
 * The official `Slider.sort`. The bones its animation animates get a constrained pose and go into
 * the update cache once more. The slots its animation animates get a pose of their own, and so
 * does the draw order when the animation has a timeline for it. So do the constraints it
 * animates: their applied pose is the animated pose again at the start of every update, so there
 * is nothing to note for them here.
 */
function sortSlider(pose: Pose43, plan: SliderPlan): void {
    const { scratch } = pose.rig.solver;
    const { split } = pose.solve;
    const { bones, slots } = plan;

    if (plan.bone >= 0 && !plan.local) sortBone(pose, plan.bone);
    scratch.items.push(~plan.index);
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i] ?? -1;

        scratch.sorted[bone] = 0;
        sortReset(pose, bone);
        constrain(pose, bone);
    }
    if (split === null) return;
    for (let i = 0; i < slots.length; i++) split.slotPosed[slots[i] ?? -1] = 1;
    if (plan.drawOrder) split.drawOrderPosed = true;
}

/** The official `isSourceActive` of a constraint: whether the bone it reads from is active. */
function sourceActive(pose: Pose43, plan: Plan43): boolean {
    const { active } = pose.state;

    switch (plan.type) {
        case 'ik':
            return active[plan.target] === 1;
        case 'transform':
            return active[plan.source] === 1;
        case 'path':
            return active[plan.slotBone] === 1;
        case 'physics':
            return active[plan.bone] === 1;
        case 'slider':
            return true;
    }
}

/** Puts a constraint into the update cache, with the bones it needs before it and after it. */
function sortConstraint(pose: Pose43, plan: Plan43): void {
    switch (plan.type) {
        case 'ik':
            sortIk(pose, plan);
            break;
        case 'transform':
            sortTransform(pose, plan);
            break;
        case 'path':
            sortPath(pose, plan);
            break;
        case 'physics':
            sortPhysics(pose, plan);
            break;
        case 'slider':
            sortSlider(pose, plan);
            break;
    }
}

/** Sets which constraints are active and sorts the active ones, in the order of the model. */
function sortConstraints(pose: Pose43): void {
    const { plans } = pose.rig.solver;
    const { active } = pose.solve;
    const skin = pose.rig.model.skins[pose.state.skin];

    for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];

        active[i] = 0;
        if (plan === undefined || !sourceActive(pose, plan)) continue;
        if (plan.skinRequired && !(skin?.constraints.includes(i) ?? false)) continue;
        active[i] = 1;
        sortConstraint(pose, plan);
    }
}

/**
 * Keeps `PoseState.world` the world transform of the applied pose. The official pose and
 * constrained pose of a bone each have a world transform. A bone that changes from one to the
 * other shows the numbers the other had last.
 */
function swapWorlds(pose: Pose43): void {
    const { world } = pose.state;
    const { constrained, spare } = pose.solve;
    const { previous } = pose.rig.solver.scratch;

    for (let bone = 0; bone < constrained.length; bone++) {
        if (constrained[bone] === previous[bone]) continue;
        for (let i = bone * WORLD_STRIDE; i < (bone + 1) * WORLD_STRIDE; i++) {
            const value = Number(world[i]);

            world[i] = Number(spare[i]);
            spare[i] = value;
        }
    }
}

/** How many constraints the update cache holds. */
function countSolved(items: readonly number[]): number {
    let solved = 0;

    for (let i = 0; i < items.length; i++) if ((items[i] ?? 0) < 0) solved++;

    return solved;
}

/**
 * The official `Skeleton.updateCache`: sets which bones and constraints are active and builds the
 * update order. The official runtime calls it for a new skeleton and when the skin changes.
 */
export function updateCache(pose: Pose43): void {
    const { solve, state } = pose;
    const { scratch } = pose.rig.solver;
    const { count } = pose.rig.model.bones;
    const { items } = scratch;

    const hadDrawOrder = beginPosed(pose);

    scratch.previous.set(solve.constrained);
    solve.constrained.fill(0);
    items.length = 0;
    updateActive(pose);
    sortConstraints(pose);
    for (let bone = 0; bone < count; bone++) sortBone(pose, bone);
    swapWorlds(pose);
    endPosed(pose, hadDrawOrder);
    solve.solved = countSolved(items);
    if (solve.solved === 0) {
        // nothing is solved: the order of the bones is free, as long as parents come first
        items.length = 0;
        for (let bone = 0; bone < count; bone++) if (state.active[bone] === 1) items.push(bone);
    }
    if (solve.cache.length < items.length) solve.cache = new Int32Array(items.length);
    solve.cache.set(items);
    solve.cacheLength = items.length;
}
