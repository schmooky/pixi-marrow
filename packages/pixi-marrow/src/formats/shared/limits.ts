import { MarrowError } from '../../base/errors';

/** The most bones or slots a skeleton can have: the model keeps their indices in 16 bits with a sign. */
export const MAX_INDEX = 0x7fff;

/**
 * Checks a count against what the integer arrays of the model can hold.
 * Throws `unsupported-feature` when it is over the limit.
 */
export function requireAtMost(count: number, limit: number, what: string): void {
    if (count > limit) {
        throw new MarrowError('unsupported-feature', `${what}: ${count}. The model holds at most ${limit}.`, {
            fix: 'Split the skeleton or the mesh into smaller parts.',
        });
    }
}
