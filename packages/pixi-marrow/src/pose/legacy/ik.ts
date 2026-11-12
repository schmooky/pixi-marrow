import { CONSTRAINT_STRIDE, IK_COMPRESS, IK_MIX, IK_STRETCH, type LegacyConstraint } from './constraints';
import { ik1 } from './ik1';
import { ik2 } from './ik2';
import type { Solver } from './solver';

/** The official `IkConstraint.update`. A constraint with more than two bones does nothing. */
export function solveIk(solver: Solver, constraint: LegacyConstraint): void {
    const v = constraint.index * CONSTRAINT_STRIDE;
    const values = solver.values;
    const bones = constraint.bones;

    if (Number(values[v + IK_MIX]) === 0) return;
    if (bones.length === 1) {
        const compress = Number(values[v + IK_COMPRESS]) !== 0;

        ik1(solver, constraint, bones[0] ?? -1, compress, Number(values[v + IK_STRETCH]) !== 0, constraint.uniform);
    } else if (bones.length === 2) {
        ik2(solver, constraint, bones[0] ?? -1, bones[1] ?? -1);
    }
}
