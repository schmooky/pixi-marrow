import { MarrowError } from '../../base/errors';
import type { SkeletonModel } from '../../model/model';

/**
 * Checks a slot index for a write from outside the engine. Throws a {@link MarrowError} for one
 * that is not a slot of the model.
 *
 * @example
 * checkSlot(model, slot);
 */
export function checkSlot(model: SkeletonModel, slot: number): void {
    const { count } = model.slots;

    if (!Number.isInteger(slot) || slot < 0 || slot >= count) {
        throw new MarrowError('invalid-data', `The skeleton has no slot ${slot}. It has ${count} slots.`, {
            fix: 'Pass an index into the slot list of the model.',
        });
    }
}

/**
 * Checks that a slot has a dark color, as the official `slot.darkColor` is null without one.
 * Throws a {@link MarrowError} for a slot that has none.
 *
 * @example
 * checkDark(model, slot);
 */
export function checkDark(model: SkeletonModel, slot: number): void {
    if (model.slots.hasDark[slot] !== 1) {
        throw new MarrowError('invalid-data', `The slot "${model.slots.names[slot]}" has no dark color.`, {
            fix: 'Give the slot a dark color (tint black) in the Spine editor, or leave its dark color alone.',
        });
    }
}

/** A part of a color for a write: clamped to 0 and 1, as the official `Color.set` does. */
function part(value: number): number {
    if (!Number.isFinite(value)) {
        throw new MarrowError('invalid-data', `${value} is not a color value.`, {
            fix: 'Pass a number from 0 to 1.',
        });
    }

    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Writes a color into a color array of a pose, clamped as the official `Color.set` does. A dark
 * color has no alpha: leave `a` out. Nothing is written when one part is not a number.
 *
 * @example
 * writeColor(state.colors, slot * 4, 1, 0.5, 0.5, 1);
 */
export function writeColor(target: Float64Array, at: number, r: number, g: number, b: number, a?: number): void {
    const red = part(r);
    const green = part(g);
    const blue = part(b);
    const alpha = a === undefined ? undefined : part(a);

    target[at] = red;
    target[at + 1] = green;
    target[at + 2] = blue;
    if (alpha !== undefined) target[at + 3] = alpha;
}
