import { MarrowError } from '../../base/errors';
import type { ConstraintData, TransformProperty } from '../../model/constraints';

/** The official `TransformConstraintData` property numbers, which are also the positions of the six mixes. */
export const PROPERTY_KINDS: Record<TransformProperty, number> = {
    rotate: 0,
    x: 1,
    y: 2,
    scaleX: 3,
    scaleY: 4,
    shearY: 5,
};

const LABELS: Record<ConstraintData['type'], string> = {
    ik: 'IK',
    transform: 'transform',
    path: 'path',
    physics: 'physics',
    slider: 'slider',
};

/**
 * The error for constraint data the official runtime fails on. The message starts with the kind
 * and the name of the constraint.
 */
export function constraintError(type: ConstraintData['type'], name: string, problem: string): MarrowError {
    return new MarrowError('invalid-data', `The ${LABELS[type]} constraint "${name}" ${problem}`, {
        fix: 'Export the skeleton again from Spine.',
    });
}

/**
 * Throws unless every index is one of `count` bones or slots. `what` is "bone" or "slot" and
 * `role` says what the constraint uses it for, for example "target bone".
 */
export function checkIndices(
    data: ConstraintData,
    indices: Iterable<number>,
    count: number,
    what: string,
    role: string = what,
): void {
    for (const index of indices) {
        if (Number.isInteger(index) && index >= 0 && index < count) continue;
        throw constraintError(
            data.type,
            data.name,
            `points at ${role} ${index}, but the skeleton has ${count} ${count === 1 ? what : `${what}s`}.`,
        );
    }
}
