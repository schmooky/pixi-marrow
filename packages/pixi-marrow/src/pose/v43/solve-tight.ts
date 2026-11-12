import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { updateLocalTransform } from './bone-pose';
import { COS_QUARTER, DEG_RAD, NORMAL, QUARTER, SIN_QUARTER } from './math';
import { solveConstraint } from './solve-step';
import { ROLE_FREE, ROLE_MULTI } from './solver-types';
import type { Pose43 } from './types';
import { updateBoneWorld } from './world';

/*
 * How two world transforms are compared here: number by number with `===`, and where a number is
 * zero, by the sign of the zero as well. That is what `Object.is` says for numbers, except that
 * a number that is no number counts as changed. `Object.is` itself is not used: until V8 has
 * optimized a function all the way, it allocates for every call with two fractional numbers, and
 * the code here runs seldom enough to stay in that state for a long time.
 */

/**
 * Poses a bone without a parent, or one that does not inherit all of its parent transform, and
 * stamps it. A bone that an update can write more than once gets no stamp here. With `check` the
 * bone gets one only when its world transform came out different. Returns 1 when the bone got a
 * stamp, else 0.
 */
function poseOther(
    pose: Pose43,
    local: Float64Array,
    bone: number,
    parent: number,
    mode: number,
    check: boolean,
): number {
    const { state, solve } = pose;
    const { world } = state;
    const o = bone * WORLD_STRIDE;

    if (check) {
        const a = Number(world[o]);
        const b = Number(world[o + 1]);
        const c = Number(world[o + 2]);
        const d = Number(world[o + 3]);
        const x = Number(world[o + 4]);
        const y = Number(world[o + 5]);

        updateBoneWorld(state, local, bone, parent, mode);
        const wa = Number(world[o]);
        const wb = Number(world[o + 1]);
        const wc = Number(world[o + 2]);
        const wd = Number(world[o + 3]);
        const wx = Number(world[o + 4]);
        const wy = Number(world[o + 5]);

        if (
            wx === x &&
            wy === y &&
            wa === a &&
            wb === b &&
            wc === c &&
            wd === d &&
            (wx * wy * wa * wb * wc * wd !== 0 ||
                (1 / wx === 1 / x &&
                    1 / wy === 1 / y &&
                    1 / wa === 1 / a &&
                    1 / wb === 1 / b &&
                    1 / wc === 1 / c &&
                    1 / wd === 1 / d))
        ) {
            return 0;
        }
    } else updateBoneWorld(state, local, bone, parent, mode);
    if (solve.roles[bone] === ROLE_MULTI) return 0;
    state.boneStamps[bone] = solve.pending;

    return 1;
}

/**
 * Stamps every bone that an update can write more than once and whose world transform is not
 * what it was at the end of the last update. Returns how many there were.
 *
 * When `Solve43.shown` is out of date, every such bone gets a stamp, and `shown` is current again.
 */
function stampMulti(pose: Pose43): number {
    const { state, solve } = pose;
    const { world, boneStamps } = state;
    const { multiList, multiCount, shown, pending, stale } = solve;
    let stamped = 0;

    for (let k = 0; k < multiCount; k++) {
        const bone = Number(multiList[k]);
        const o = bone * WORLD_STRIDE;
        const s = k * WORLD_STRIDE;
        let same = !stale;

        for (let i = 0; i < WORLD_STRIDE; i++) {
            const value = Number(world[o + i]);
            const old = Number(shown[s + i]);

            if (value === old && (value !== 0 || 1 / value === 1 / old)) continue;
            shown[s + i] = value;
            same = false;
        }
        if (same) continue;
        boneStamps[bone] = pending;
        stamped++;
    }
    solve.stale = false;

    return stamped;
}

/**
 * Runs the update cache and looks at what changes. `stamp` is the mark of this update, 0 when no
 * constraint is active. Returns how many bones got the pending version as their stamp.
 *
 * A free bone is left out while its animated pose and the world transform of its parent are what
 * they were when it was posed last. The result would be the same bits. A bone below a bone that
 * moved in this update moves with it, and gets its stamp without a look. Every other bone that is
 * posed gets its stamp only when its world transform came out different. A bone that is written
 * more than once gets it at the end, against `Solve43.shown`.
 *
 * The official `Inherit.Normal` of a bone with a parent, which nearly every bone has, is computed
 * in the loop itself. As a function of its own it is too long for V8 to inline.
 */
export function poseChanged(pose: Pose43, stamp: number): number {
    const { state, solve } = pose;
    const { cache, cacheLength, worldStamps, localStamps, inherit, roles, fresh, pending, force } = solve;
    const { world, boneStamps } = state;
    const { parents } = pose.rig.model.bones;
    // with no constraint active every active bone is in the cache once, after its parents, and reads its animated pose
    const plain = solve.solved === 0;
    const local = plain ? state.local : solve.local;
    let changed = 0;

    for (let i = 0; i < cacheLength; i++) {
        const item = Number(cache[i]);

        if (!plain) {
            if (item < 0) {
                solveConstraint(pose, ~item);
                continue;
            }
            // the official BonePose.update: a world transform from this update stays
            if (worldStamps[item] === stamp) continue;
            // a bone that a constraint moved in the world gets its local numbers first
            if (localStamps[item] === stamp) updateLocalTransform(pose, item);
            else worldStamps[item] = stamp;
        }
        const parent = Number(parents[item]);
        const role = Number(roles[item]);
        const pushed = parent >= 0 && boneStamps[parent] === pending;

        // a free bone whose pose and whose parent stayed has its world transform already
        if (role === ROLE_FREE && fresh[item] === 0 && !pushed && !force) {
            // a parent that is written more than once has no stamp yet: it may have moved or not
            if (parent < 0 || roles[parent] !== ROLE_MULTI) continue;
        }
        const mode = Number(inherit[item]);

        fresh[item] = 0;
        if (parent < 0 || mode !== NORMAL) {
            changed += poseOther(pose, local, item, parent, mode, !pushed);
            continue;
        }
        const p = parent * WORLD_STRIDE;
        const l = item * LOCAL_STRIDE;
        const o = item * WORLD_STRIDE;
        const pa = Number(world[p]);
        const pb = Number(world[p + 1]);
        const pc = Number(world[p + 2]);
        const pd = Number(world[p + 3]);
        const x = Number(local[l]);
        const y = Number(local[l + 1]);
        const rotation = Number(local[l + 2]);
        const scaleX = Number(local[l + 3]);
        const scaleY = Number(local[l + 4]);
        const rx = (rotation + Number(local[l + 5])) * DEG_RAD;
        const ry = (rotation + 90 + Number(local[l + 6])) * DEG_RAD;
        // a bone that is not turned needs no cosine and no sine: see world.ts
        let cosX = 1;
        let sinX = rx;
        let cosY = COS_QUARTER;
        let sinY = SIN_QUARTER;

        if (rx !== 0) {
            cosX = Math.cos(rx);
            sinX = Math.sin(rx);
        }
        if (ry !== QUARTER) {
            cosY = Math.cos(ry);
            sinY = Math.sin(ry);
        }
        const la = cosX * scaleX;
        const lb = cosY * scaleY;
        const lc = sinX * scaleX;
        const ld = sinY * scaleY;
        const wx = pa * x + pb * y + Number(world[p + 4]);
        const wy = pc * x + pd * y + Number(world[p + 5]);
        const wa = pa * la + pb * lc;
        const wb = pa * lb + pb * ld;
        const wc = pc * la + pd * lc;
        const wd = pc * lb + pd * ld;

        const oa = Number(world[o]);
        const ob = Number(world[o + 1]);
        const oc = Number(world[o + 2]);
        const od = Number(world[o + 3]);
        const ox = Number(world[o + 4]);
        const oy = Number(world[o + 5]);

        if (
            role !== ROLE_MULTI &&
            (pushed ||
                !(
                    wx === ox &&
                    wy === oy &&
                    wa === oa &&
                    wb === ob &&
                    wc === oc &&
                    wd === od &&
                    (wx * wy * wa * wb * wc * wd !== 0 ||
                        (1 / wx === 1 / ox &&
                            1 / wy === 1 / oy &&
                            1 / wa === 1 / oa &&
                            1 / wb === 1 / ob &&
                            1 / wc === 1 / oc &&
                            1 / wd === 1 / od))
                ))
        ) {
            boneStamps[item] = pending;
            changed++;
        }
        world[o + 4] = wx;
        world[o + 5] = wy;
        world[o] = wa;
        world[o + 1] = wb;
        world[o + 2] = wc;
        world[o + 3] = wd;
    }

    return changed + stampMulti(pose);
}
