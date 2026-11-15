import type { AttachmentData } from '../../model/attachments';

/*
 * Whether an apply left a pose as it was is not assumed, it is looked at: the pose is copied
 * before the apply and compared after it, bit for bit. An engine walks over everything its apply
 * can write, once to copy and once to compare, in the same order. The functions here are the
 * steps of that walk. The scratch is shared: no walk keeps it across an update.
 */

/** Scratch of the comparison: every fractional number an apply can write. It grows with the largest pose. */
let floats = new Float64Array(0);
/** Scratch of the comparison: every whole number an apply can write. */
let ints = new Int32Array(0);
/** Scratch of the comparison: the attachment of every slot. */
const shown: (AttachmentData | null)[] = [];
/** Where the walk is in `floats` and in `ints`. */
let floatAt = 0;
let intAt = 0;

/**
 * Starts a walk. A walk that copies makes room first: `floatCount` and `intCount` are the most
 * numbers it takes. A walk that compares takes the room of the walk that copied.
 */
export function startWalk(check: boolean, floatCount: number, intCount: number): void {
    floatAt = 0;
    intAt = 0;
    if (check) return;
    if (floats.length < floatCount) floats = new Float64Array(floatCount);
    if (ints.length < intCount) ints = new Int32Array(intCount);
}

/** Copies `count` numbers to the scratch, or with `check` compares them with it. Returns false when one differs. */
export function walkFloats(source: Float64Array | undefined, count: number, check: boolean): boolean {
    const at = floatAt;

    floatAt += count;
    if (source === undefined) return true;
    if (!check) {
        for (let i = 0; i < count; i++) floats[at + i] = Number(source[i]);

        return true;
    }
    for (let i = 0; i < count; i++) {
        const now = Number(source[i]);
        const before = Number(floats[at + i]);

        // by bits, where every number that is not a number counts as the same
        if (now === before ? now === 0 && 1 / now !== 1 / before : !(Number.isNaN(now) && Number.isNaN(before))) {
            return false;
        }
    }

    return true;
}

/** The same as {@link walkFloats} for whole numbers. */
export function walkInts(source: ArrayLike<number>, count: number, check: boolean): boolean {
    const at = intAt;

    intAt += count;
    if (!check) {
        for (let i = 0; i < count; i++) ints[at + i] = Number(source[i]);

        return true;
    }
    for (let i = 0; i < count; i++) {
        if (Number(source[i]) !== ints[at + i]) return false;
    }

    return true;
}

/** The same as {@link walkInts} for one whole number. */
export function walkInt(value: number, check: boolean): boolean {
    if (!check) ints[intAt] = value;

    return ints[intAt++] === value;
}

/** Copies the attachment of slot `slot`, or with `check` compares it. Returns false when it is another one. */
export function walkAttachment(attachment: AttachmentData | null, slot: number, check: boolean): boolean {
    if (check && shown[slot] !== attachment) return false;
    shown[slot] = attachment;

    return true;
}

/** Ends a walk that compared: the scratch must not keep the attachments of a skeleton alive. */
export function endWalk(): void {
    shown.fill(null);
}
