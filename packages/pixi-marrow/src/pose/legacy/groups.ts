import { C_IK, C_PATH, C_PHYSICS, C_TRANSFORM, type ConstraintPlan, type LegacyConstraint } from './constraints';

/*
 * An update computes only what changed. For that the entries of an update cache are sorted into
 * two kinds.
 *
 * A free bone has one entry, no constraint writes it and none reads its applied pose. Its world
 * transform depends on its own local pose and on its parent, so it is computed again only when
 * one of the two changed.
 *
 * Everything else is in a group: a constraint, the bones it writes, and the bones that are posed
 * a second time because a constraint moved a bone above them. The entries of a group change the
 * same world transforms one after the other, so they run together or not at all. A group runs
 * when something it reads from outside changed. An entry that reads a bone before the group of
 * that bone is done with it joins that group, so every read from outside a group sees a world
 * transform that is final for this update.
 *
 * A group with a physics constraint keeps state from one run to the next: it also runs while its
 * last run changed its bones or left the constraint in motion.
 */

/** How the entries of an update cache are grouped. Shared by all instances that wear the skin. */
export interface Groups {
    /** Per cache entry: its group, or -1 for a free bone. */
    readonly of: Int16Array;
    /** The number of groups. */
    readonly count: number;
    /** Per group, where its entries start in `entries`. One more entry than groups. */
    readonly entryStart: Int32Array;
    /** The cache positions of the entries of every group, in update order. */
    readonly entries: Int32Array;
    /** Per group, where its bones start in `bones`. One more entry than groups. */
    readonly boneStart: Int32Array;
    /** The bones every group writes. */
    readonly bones: Int16Array;
    /** Per cache entry, where the bones it is the last to write start in `settled`. One more than entries. */
    readonly settleStart: Int32Array;
    /** Bones of groups, by the entry after which their world transform is final. */
    readonly settled: Int16Array;
    /** Per cache entry of a group, where the bones it reads from outside start in `reads`. One more than entries. */
    readonly readStart: Int32Array;
    /** Bones outside the group of an entry whose world transform the entry reads. */
    readonly reads: Int16Array;
    /** Per cache entry: 1 when it is the last entry of its group. */
    readonly last: Uint8Array;
    /** Per group, where its physics constraints start in `physics`. One more entry than groups. */
    readonly physicsStart: Int32Array;
    /** The physics constraints of every group, as indices into the constraint list. */
    readonly physics: Int32Array;
    /** Per group: 1 when it has a physics constraint. */
    readonly physical: Uint8Array;
    /** How many groups have a physics constraint. */
    readonly physicalCount: number;
    /**
     * Per cache entry: 1 when the world transforms of its group are looked at after it. The group
     * has a physics constraint, and the entry is one, or is the last to write a bone, or is the
     * last of the group.
     */
    readonly checks: Uint8Array;
    /**
     * The bones a constraint writes that have no entry of their own. An active constraint poses
     * its bones although no skin lists them, as the official one does.
     */
    readonly unlisted: Int16Array;
    /** True when the cache has a path constraint: then a slot that changes can change world transforms. */
    readonly paths: boolean;
}

/** The bones whose world transform an entry reads: the parent of a bone, or what the solver of a constraint reads. */
function readsOf(entry: number, plan: ConstraintPlan, parents: Int16Array): number[] {
    if (entry >= 0) return [parents[entry] ?? -1];
    const constraint = plan.constraints[-1 - entry];

    if (constraint === undefined) return [];
    // every solver reads the parent of a bone it writes, to pose the bone or to find its applied pose
    const reads = Array.from(constraint.bones, (bone) => parents[bone] ?? -1);

    if (constraint.kind === C_IK || constraint.kind === C_TRANSFORM) reads.push(constraint.target);
    if (constraint.kind === C_PATH) {
        reads.push(constraint.targetBone);
        // the bones the path can be weighted to, in any skin
        for (const bones of constraint.pathBones) reads.push(...bones);
    }

    return reads;
}

/** Union-find over bones and constraints: `root` finds the set, `join` merges two. */
function sets(size: number) {
    const parent = Int32Array.from({ length: size }, (_, i) => i);
    const root = (item: number): number => {
        let at = item;

        while (parent[at] !== at) at = parent[at] ?? at;
        parent[item] = at;

        return at;
    };

    return {
        root,
        join(a: number, b: number): void {
            parent[root(a)] = root(b);
        },
    };
}

/** Per bone: the cache position of the last entry that writes it, and whether it belongs in a group. */
function writers(plan: ConstraintPlan, entries: readonly number[], boneCount: number) {
    const lastWrite = new Int32Array(boneCount).fill(-1);
    const bound = new Uint8Array(boneCount);

    entries.forEach((entry, i) => {
        if (entry >= 0) {
            // a second entry: a constraint moved a bone above this one
            if (lastWrite[entry] !== -1) bound[entry] = 1;
            lastWrite[entry] = i;
        } else {
            for (const bone of plan.constraints[-1 - entry]?.bones ?? []) {
                bound[bone] = 1;
                lastWrite[bone] = i;
            }
        }
    });

    return { lastWrite, bound };
}

/** Packs lists of numbers into one array with the start of each list. */
function pack<T extends Int16Array | Int32Array>(lists: readonly number[][], into: (values: number[]) => T) {
    const start = new Int32Array(lists.length + 1);

    lists.forEach((list, i) => {
        start[i + 1] = (start[i] ?? 0) + list.length;
    });

    return { start, values: into(lists.flat()) };
}

/**
 * Sorts the entries of an update cache into free bones and groups. `entries` is the cache: a
 * bone index, or for a constraint -1 minus its index.
 */
export function buildGroups(
    plan: ConstraintPlan,
    parents: Int16Array,
    entries: readonly number[],
    boneCount: number,
): Groups {
    const { lastWrite, bound } = writers(plan, entries, boneCount);
    const { root, join } = sets(boneCount + plan.constraints.length);
    const owner = (entry: number): number => (entry >= 0 ? entry : boneCount - 1 - entry);
    const constraintAt = (entry: number): LegacyConstraint | undefined => plan.constraints[-1 - entry];

    entries.forEach((entry, i) => {
        const constraint = constraintAt(entry);

        for (const bone of constraint?.bones ?? []) join(owner(entry), bone);
        // a local transform constraint reads the applied pose of its target, which only a bone of a group has
        if (constraint?.kind === C_TRANSFORM && constraint.local) {
            bound[constraint.target] = 1;
            join(owner(entry), constraint.target);
        }
        for (const read of readsOf(entry, plan, parents)) {
            // the bone is written again after this entry: the entry sees a world transform that is not final
            if (read < 0 || bound[read] !== 1 || (lastWrite[read] ?? -1) <= i) continue;
            if (entry >= 0) bound[entry] = 1;
            join(owner(entry), read);
        }
    });
    const ids = new Map<number, number>();
    const groupOf = (item: number): number => {
        const key = root(item);
        const id = ids.get(key) ?? ids.size;

        ids.set(key, id);

        return id;
    };
    const of = Int16Array.from(entries, (entry) => (entry >= 0 && bound[entry] !== 1 ? -1 : groupOf(owner(entry))));
    const lists = (): number[][] => Array.from({ length: ids.size }, () => []);
    const groupEntries = lists();
    const groupBones = lists();
    const groupPhysics = lists();
    const settled: number[][] = entries.map(() => []);
    const reads: number[][] = entries.map(() => []);
    const last = new Uint8Array(entries.length);
    const boneGroup = (bone: number): number => (bound[bone] === 1 ? groupOf(bone) : -1);

    entries.forEach((entry, i) => {
        const group = of[i] ?? -1;

        if (group < 0) return;
        groupEntries[group]?.push(i);
        if (constraintAt(entry)?.kind === C_PHYSICS) groupPhysics[group]?.push(-1 - entry);
        reads[i] = [...new Set(readsOf(entry, plan, parents))].filter((bone) => bone >= 0 && boneGroup(bone) !== group);
    });
    for (let bone = 0; bone < boneCount; bone++) {
        if (bound[bone] !== 1 || (lastWrite[bone] ?? -1) < 0) continue;
        groupBones[groupOf(bone)]?.push(bone);
        settled[lastWrite[bone] ?? 0]?.push(bone);
    }
    for (const list of groupEntries) {
        if (list.length > 0) last[list[list.length - 1] ?? 0] = 1;
    }
    const physical = Uint8Array.from(groupPhysics, (list) => (list.length > 0 ? 1 : 0));
    const checks = Uint8Array.from(entries, (entry, i) => {
        const ends = last[i] === 1 || (settled[i]?.length ?? 0) > 0 || constraintAt(entry)?.kind === C_PHYSICS;

        return ends && physical[of[i] ?? -1] === 1 ? 1 : 0;
    });
    const int16 = (values: number[]): Int16Array => Int16Array.from(values);
    const int32 = (values: number[]): Int32Array => Int32Array.from(values);
    const packedEntries = pack(groupEntries, int32);
    const packedBones = pack(groupBones, int16);
    const packedSettled = pack(settled, int16);
    const packedReads = pack(reads, int16);
    const packedPhysics = pack(groupPhysics, int32);

    return {
        of,
        count: ids.size,
        entryStart: packedEntries.start,
        entries: packedEntries.values,
        boneStart: packedBones.start,
        bones: packedBones.values,
        settleStart: packedSettled.start,
        settled: packedSettled.values,
        readStart: packedReads.start,
        reads: packedReads.values,
        last,
        physicsStart: packedPhysics.start,
        physics: packedPhysics.values,
        physical,
        physicalCount: physical.reduce((sum, flag) => sum + flag, 0),
        checks,
        unlisted: Int16Array.from(groupBones.flat().filter((bone) => !entries.includes(bone))),
        paths: entries.some((entry) => constraintAt(entry)?.kind === C_PATH),
    };
}
