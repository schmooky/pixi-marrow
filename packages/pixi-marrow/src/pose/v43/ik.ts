import { solveOneBone } from './ik-one';
import { solveTwoBones } from './ik-two';
import { CONSTRAINT_STRIDE, IK_COMPRESS, IK_MIX, IK_STRETCH, type IkPlan } from './solver-types';
import type { Pose43 } from './types';

/** The official `IkConstraint.update`: points one bone, or a parent bone and its child, at the target bone. */
export function solveIk(pose: Pose43, plan: IkPlan): void {
    const { values } = pose.solve;
    const v = plan.index * CONSTRAINT_STRIDE;
    const { bones } = plan;

    if (values[v + IK_MIX] === 0) return;
    const stretch = values[v + IK_STRETCH] === 1;

    if (bones.length === 1) {
        solveOneBone(pose, plan, bones[0] ?? -1, values[v + IK_COMPRESS] === 1, stretch, plan.scaleYMode);
    } else if (bones.length === 2) solveTwoBones(pose, plan, bones[0] ?? -1, bones[1] ?? -1, stretch);
}
