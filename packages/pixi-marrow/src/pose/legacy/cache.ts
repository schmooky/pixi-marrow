import type { SkinData } from '../../model/model';
import {
    C_IK,
    C_PATH,
    C_PHYSICS,
    C_TRANSFORM,
    type ConstraintPlan,
    type LegacyConstraint,
    pathBonesOfSkin,
} from './constraints';
import { buildGroups, type Groups } from './groups';
import type { Rig } from './rig';

/**
 * The official update cache for one skin: the bones and constraints in the order they are
 * updated, with what the sort found active. Shared by all instances that wear the skin.
 */
export interface UpdateCache {
    /** A bone index, or for a constraint -1 minus its index. A bone can come more than once. */
    readonly entries: Int32Array;
    /** 1 for each bone that is posed with this skin. */
    readonly boneActive: Uint8Array;
    /** How many bones are posed with this skin. */
    readonly posed: number;
    /** 1 for each constraint that is solved and animated with this skin: the official `constraint.active`. */
    readonly constraintActive: Uint8Array;
    /**
     * 1 for each physics constraint whose bone has its applied pose read later in the update: by
     * an update of the bone, or by an IK or transform constraint. Only then does the constraint
     * compute that pose from the world transform it wrote. Nothing else can see the applied pose.
     */
    readonly appliedRead: Uint8Array;
    /** Which entries run together when an update computes only what changed. */
    readonly groups: Groups;
}

/** What the sort functions work on: the official `sorted` and `active` flags and the cache so far. */
interface Sort {
    readonly plan: ConstraintPlan;
    /** The skin the cache is sorted for, and the default skin. -1 is none. */
    readonly skin: number;
    readonly defaultSkin: number;
    /** The skin the cache is sorted for when `combineSkins` made it: the model has no path bones for it. */
    readonly combined: SkinData | undefined;
    readonly parents: Int16Array;
    readonly sorted: Uint8Array;
    readonly active: Uint8Array;
    readonly entries: number[];
}

/** The official `sortBone`: adds a bone to the cache after its parents, unless it is there. */
function sortBone(sort: Sort, bone: number): void {
    if (bone < 0 || sort.sorted[bone] !== 0) return;
    sortBone(sort, sort.parents[bone] ?? -1);
    sort.sorted[bone] = 1;
    sort.entries.push(bone);
}

/**
 * The official `sortReset` for the children of a bone: active bones below it are sorted again,
 * so they update after the constraint that moved the bone.
 */
function sortReset(sort: Sort, bone: number): void {
    const { childStart, childList } = sort.plan;

    for (let i = childStart[bone] ?? 0, n = childStart[bone + 1] ?? 0; i < n; i++) {
        const child = childList[i] ?? -1;

        if (sort.active[child] !== 1) continue;
        if (sort.sorted[child] === 1) sortReset(sort, child);
        sort.sorted[child] = 0;
    }
}

/** The official `sortIkConstraint`. */
function sortIk(sort: Sort, constraint: LegacyConstraint): void {
    const bones = constraint.bones;
    const parent = bones[0] ?? -1;

    sortBone(sort, constraint.target);
    sortBone(sort, parent);
    if (bones.length === 1) {
        sort.entries.push(-1 - constraint.index);
        sortReset(sort, parent);
    } else {
        const child = bones[bones.length - 1] ?? -1;

        sortBone(sort, child);
        sort.entries.push(-1 - constraint.index);
        sortReset(sort, parent);
        sort.sorted[child] = 1;
    }
}

/** What the official sort functions do after the bones a constraint reads: add it, then sort the bones below again. */
function pushConstraint(sort: Sort, constraint: LegacyConstraint): void {
    const bones = constraint.bones;

    sort.entries.push(-1 - constraint.index);
    for (let i = 0; i < bones.length; i++) sortReset(sort, bones[i] ?? -1);
    for (let i = 0; i < bones.length; i++) sort.sorted[bones[i] ?? -1] = 1;
}

/** The official `sortTransformConstraint`. A local constraint also needs the parent of each bone. */
function sortTransform(sort: Sort, constraint: LegacyConstraint): void {
    const bones = constraint.bones;

    sortBone(sort, constraint.target);
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i] ?? -1;

        if (constraint.local) sortBone(sort, sort.parents[bone] ?? -1);
        sortBone(sort, bone);
    }
    pushConstraint(sort, constraint);
}

/** Sorts the bones the path attachments of one skin follow: the official `sortPathConstraintAttachment`. */
function sortPathBones(sort: Sort, bones: Int16Array | undefined): void {
    if (bones === undefined) return;
    for (let i = 0; i < bones.length; i++) sortBone(sort, bones[i] ?? -1);
}

/**
 * The official `sortPathConstraint`. It sorts the bones of the path attachments the slot has in
 * the active skin, in the default skin and then in every skin, and after them the constrained
 * bones. The official code also sorts for the attachment the slot shows. That one comes from a
 * skin, so its bones are sorted by then, and the cache depends on the skin alone.
 */
function sortPath(sort: Sort, constraint: LegacyConstraint): void {
    const { bones, pathBones } = constraint;

    if (sort.skin >= 0) {
        const { combined } = sort;
        const own =
            combined === undefined
                ? pathBones[sort.skin]
                : pathBonesOfSkin(combined, constraint.target, constraint.targetBone, sort.parents.length);

        sortPathBones(sort, own);
    }
    if (sort.defaultSkin >= 0 && sort.defaultSkin !== sort.skin) sortPathBones(sort, pathBones[sort.defaultSkin]);
    for (const each of pathBones) sortPathBones(sort, each);
    for (let i = 0; i < bones.length; i++) sortBone(sort, bones[i] ?? -1);
    pushConstraint(sort, constraint);
}

/** The official `sortPhysicsConstraint`. */
function sortPhysics(sort: Sort, constraint: LegacyConstraint): void {
    sortBone(sort, constraint.targetBone);
    pushConstraint(sort, constraint);
}

/** Sorts one constraint if it is active: its target bone is, and a skin lists it if it needs one. */
function sortConstraint(sort: Sort, constraint: LegacyConstraint, listed: boolean, active: Uint8Array): void {
    if (sort.active[constraint.targetBone] !== 1 || (constraint.skinRequired && !listed)) return;
    active[constraint.index] = 1;
    if (constraint.kind === C_IK) sortIk(sort, constraint);
    else if (constraint.kind === C_TRANSFORM) sortTransform(sort, constraint);
    else if (constraint.kind === C_PATH) sortPath(sort, constraint);
    else if (constraint.kind === C_PHYSICS) sortPhysics(sort, constraint);
}

/**
 * Finds the physics constraints that must compute the applied pose of their bone, for
 * {@link UpdateCache.appliedRead}. It walks the update order from its end and notes the bones
 * whose applied pose an entry reads. A bone entry reads its own. An IK or transform constraint
 * reads those of its bones and of its target. A path or physics constraint reads world transforms only.
 */
function appliedReads(plan: ConstraintPlan, entries: readonly number[], boneCount: number): Uint8Array {
    const reads = new Uint8Array(plan.constraints.length);
    const readLater = new Uint8Array(boneCount);

    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] ?? 0;
        const constraint = plan.constraints[-1 - entry];

        if (entry >= 0) readLater[entry] = 1;
        else if (constraint?.kind === C_PHYSICS) reads[constraint.index] = readLater[constraint.targetBone] ?? 0;
        else if (constraint?.kind === C_IK || constraint?.kind === C_TRANSFORM) {
            readLater[constraint.target] = 1;
            for (const bone of constraint.bones) readLater[bone] = 1;
        }
    }

    return reads;
}

/** The official `Skeleton.updateCache` for a skin. -1 is no skin. */
function buildCache(rig: Rig, skinIndex: number): UpdateCache {
    const { count, parents, skinRequired } = rig.model.bones;
    const plan = rig.plan;
    const skin = rig.lookup.skin(skinIndex);
    const sort: Sort = {
        plan,
        skin: skin === undefined ? -1 : skinIndex,
        defaultSkin: rig.lookup.defaultSkin,
        combined: skinIndex >= rig.model.skins.length ? skin : undefined,
        parents,
        sorted: new Uint8Array(count),
        active: new Uint8Array(count),
        entries: [],
    };
    const constraintActive = new Uint8Array(plan.constraints.length);

    for (let i = 0; i < count; i++) {
        sort.sorted[i] = skinRequired[i] === 1 ? 1 : 0;
        sort.active[i] = skinRequired[i] === 1 ? 0 : 1;
    }
    for (const skinBone of skin?.bones ?? []) {
        // a parent index is below its bone, so the walk ends at a root
        for (let bone = skinBone; bone >= 0 && bone < count; bone = parents[bone] ?? -1) {
            sort.sorted[bone] = 0;
            sort.active[bone] = 1;
        }
    }
    for (const index of plan.order) {
        const constraint = plan.constraints[index];

        if (constraint === undefined) continue;
        sortConstraint(sort, constraint, skin?.constraints.includes(index) === true, constraintActive);
    }
    for (let i = 0; i < count; i++) sortBone(sort, i);

    return {
        entries: Int32Array.from(sort.entries),
        boneActive: sort.active,
        posed: sort.active.reduce((sum, active) => sum + active, 0),
        constraintActive,
        appliedRead: appliedReads(plan, sort.entries, count),
        groups: buildGroups(plan, parents, sort.entries, count),
    };
}

/**
 * The update cache of a skin. Built the first time a skin is active and kept for every instance:
 * the official cache depends on the skin alone.
 */
export function cacheOf(rig: Rig, skinIndex: number): UpdateCache {
    let cache = rig.caches.get(skinIndex);

    if (cache === undefined) {
        cache = buildCache(rig, skinIndex);
        rig.caches.set(skinIndex, cache);
    }

    return cache;
}
