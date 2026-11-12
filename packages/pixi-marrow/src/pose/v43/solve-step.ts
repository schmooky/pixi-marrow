import { solveIk } from './ik';
import { solvePath } from './path';
import { solvePhysics } from './physics';
import { solveSlider } from './slider';
import { solveTransform } from './transform';
import type { Pose43 } from './types';

/** Solves one constraint of the update cache. */
export function solveConstraint(pose: Pose43, index: number): void {
    const plan = pose.rig.solver.plans[index];

    if (plan === undefined) return;
    switch (plan.type) {
        case 'ik':
            solveIk(pose, plan);
            break;
        case 'transform':
            solveTransform(pose, plan);
            break;
        case 'path':
            solvePath(pose, plan);
            break;
        case 'physics':
            solvePhysics(pose, plan);
            break;
        case 'slider':
            solveSlider(pose, plan);
            break;
    }
}

/**
 * The official `skeleton._update++`: a new number that marks what this update has done. The
 * marks are bytes, so the numbers run from 1 to 255. Before they start over every mark is cleared,
 * and no mark of an older update can pass for one of this update.
 */
export function nextStamp(pose: Pose43): number {
    const { solve } = pose;

    if (solve.stamp === 255) {
        solve.worldStamps.fill(0);
        solve.localStamps.fill(0);
        solve.stamp = 0;
    }
    solve.stamp++;

    return solve.stamp;
}
