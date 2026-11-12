import { type AttachmentData, isNewer, type PoseState, WORLD_STRIDE } from '../../src/core';

/*
 * The check of the stamps of a pose state. A renderer does work only for what a stamp reports, so
 * a value that changes without its stamp is a picture that stays wrong.
 *
 * A reader keeps the version it saw and asks `isNewer(stamp, seen)`. The watch is such a reader
 * that looks after every call, an update or any other: a renderer can draw between a call that
 * changed the pose and the next update. After a call, whatever differs from the look before must
 * have a stamp that is newer than the version of the look before. No stamp may be ahead of the
 * version, and no stamp may move while the version stays.
 *
 * A value that changes and changes back inside one call is not seen, and no reader can see it.
 */

/** What the watch keeps of a state from one look to the next. */
interface Seen {
    world: Float64Array;
    active: Uint8Array;
    colors: Float64Array;
    darkColors: Float64Array;
    attachments: (AttachmentData | null)[];
    sequenceIndices: Int32Array;
    /** Per slot, the numbers of its deform that are in use. An array grows when a deform needs more room. */
    deform: Float64Array[];
    deformLengths: Int32Array;
    drawOrder: Int16Array;
    boneStamps: Uint32Array;
    slotStamps: Uint32Array;
    drawOrderStamp: number;
    version: number;
}

/** Copies what the watch keeps. The arrays of `into` are used again, so a look allocates next to nothing. */
function look(state: PoseState, into: Seen): void {
    into.world.set(state.world);
    into.active.set(state.active);
    into.colors.set(state.colors);
    into.darkColors.set(state.darkColors);
    into.sequenceIndices.set(state.sequenceIndices);
    into.deformLengths.set(state.deformLengths);
    into.drawOrder.set(state.drawOrder);
    into.boneStamps.set(state.boneStamps);
    into.slotStamps.set(state.slotStamps);
    into.drawOrderStamp = state.drawOrderStamp;
    into.version = state.version;
    state.attachments.forEach((attachment, i) => {
        const length = state.deformLengths[i] ?? 0;
        let kept = into.deform[i];

        if (kept === undefined || kept.length < length) {
            kept = new Float64Array(length);
            into.deform[i] = kept;
        }
        kept.set((state.deform[i] ?? kept).subarray(0, length));
        into.attachments[i] = attachment;
    });
}

function firstLook(state: PoseState): Seen {
    const seen: Seen = {
        world: new Float64Array(state.world.length),
        active: new Uint8Array(state.active.length),
        colors: new Float64Array(state.colors.length),
        darkColors: new Float64Array(state.darkColors.length),
        attachments: new Array<AttachmentData | null>(state.attachments.length).fill(null),
        sequenceIndices: new Int32Array(state.sequenceIndices.length),
        deform: [],
        deformLengths: new Int32Array(state.deformLengths.length),
        drawOrder: new Int16Array(state.drawOrder.length),
        boneStamps: new Uint32Array(state.boneStamps.length),
        slotStamps: new Uint32Array(state.slotStamps.length),
        drawOrderStamp: 0,
        version: 0,
    };

    look(state, seen);

    return seen;
}

/** True when two stretches of numbers differ in a bit. NaN equals NaN. */
function differs(now: ArrayLike<number>, before: ArrayLike<number>, at: number, count: number): boolean {
    for (let i = at; i < at + count; i++) {
        if (!Object.is(now[i], before[i])) return true;
    }

    return false;
}

function slotChanged(state: PoseState, before: Seen, i: number): boolean {
    const length = state.deformLengths[i] ?? 0;

    return (
        differs(state.colors, before.colors, i * 4, 4) ||
        differs(state.darkColors, before.darkColors, i * 3, 3) ||
        state.attachments[i] !== before.attachments[i] ||
        state.sequenceIndices[i] !== before.sequenceIndices[i] ||
        length !== before.deformLengths[i] ||
        differs(state.deform[i] ?? [], before.deform[i] ?? [], 0, length)
    );
}

/** One stamp against the look before. Adds what is wrong to `faults` and returns whether the stamp moved. */
function judge(
    what: string,
    changed: boolean,
    stamp: number,
    old: number,
    state: PoseState,
    before: Seen,
    faults: string[],
): boolean {
    if (changed && stamp === old) faults.push(`${what} changed and its stamp stayed`);
    else if (changed && !isNewer(stamp, before.version)) {
        faults.push(
            `${what} changed and its stamp ${stamp} is not newer than the version ${before.version} of the look before`,
        );
    }
    if (isNewer(stamp, state.version))
        faults.push(`the stamp ${stamp} of ${what} is ahead of the version ${state.version}`);

    return stamp !== old;
}

/**
 * Watches the stamps of a pose state. Call `faults` after every call on the engine: it names what
 * changed since the call before without a stamp that reports it, as one text. The text is empty
 * when the stamps are honest. At most eight faults are named.
 */
export function stampWatch(state: PoseState): { faults(): string } {
    const { bones, slots } = state.model;
    const before = firstLook(state);

    return {
        faults(): string {
            const faults: string[] = [];
            let moved = false;

            for (let i = 0; i < bones.count; i++) {
                const changed =
                    differs(state.world, before.world, i * WORLD_STRIDE, WORLD_STRIDE) ||
                    state.active[i] !== before.active[i];
                const stamp = Number(state.boneStamps[i]);

                if (judge(`bone ${i}`, changed, stamp, Number(before.boneStamps[i]), state, before, faults))
                    moved = true;
            }
            for (let i = 0; i < slots.count; i++) {
                const stamp = Number(state.slotStamps[i]);
                const changed = slotChanged(state, before, i);

                if (judge(`slot ${i}`, changed, stamp, Number(before.slotStamps[i]), state, before, faults))
                    moved = true;
            }
            const reordered = differs(state.drawOrder, before.drawOrder, 0, slots.count);

            if (
                judge('the draw order', reordered, state.drawOrderStamp, before.drawOrderStamp, state, before, faults)
            ) {
                moved = true;
            }
            // first, so that the cut below keeps it
            if (moved && state.version === before.version) faults.unshift('a stamp moved and the version stayed');
            look(state, before);

            return faults.slice(0, 8).join('. ');
        },
    };
}
