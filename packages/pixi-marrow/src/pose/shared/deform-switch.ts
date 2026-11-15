/*
 * What `PoseEngine.deform` keeps of the deforms it hides. Off, the length of every deform of a
 * pose is kept here and set to 0 in the pose, so that every mesh shows its setup vertices. The
 * numbers stay in their arrays. On, every hidden deform comes back. A deform the official
 * runtime would have cleared meanwhile stays cleared: a slot that showed another attachment
 * forgets its hidden deform.
 *
 * While the switch is off, the deform timelines of the entries that play are left out. Those of
 * an entry that mixes out still run, on the hidden deforms. They mix from the setup shape, so
 * what they write does not depend on the deforms that were left out. A deform that mixes out
 * while hidden comes back as the official runtime leaves it: at the setup shape.
 *
 * The lengths are kept by the array of lengths they belong to. A 4.3 engine with sliders has
 * two such arrays, one for the animated pose and one for the applied pose.
 */

/** The hidden lengths, by the array of deform lengths of a pose. */
const HIDDEN = new WeakMap<Int32Array, Int32Array>();

/**
 * Hides every deform of a pose: keeps its length and sets the length to 0. Calls `changed` for
 * every slot whose deform it hid. Does nothing for lengths that are hidden already.
 *
 * @example
 * hideDeforms(state.deformLengths, (slot) => stampSlot(state, slot));
 */
export function hideDeforms(lengths: Int32Array, changed: (slot: number) => void): void {
    if (HIDDEN.has(lengths)) return;
    HIDDEN.set(lengths, Int32Array.from(lengths));
    for (let slot = 0; slot < lengths.length; slot++) {
        if (lengths[slot] === 0) continue;
        lengths[slot] = 0;
        changed(slot);
    }
}

/**
 * Shows the hidden deforms of a pose again, and calls `changed` for every slot whose deform came
 * back. Does nothing for lengths that hide nothing.
 *
 * @example
 * showDeforms(state.deformLengths, (slot) => stampSlot(state, slot));
 */
export function showDeforms(lengths: Int32Array, changed: (slot: number) => void): void {
    const hidden = HIDDEN.get(lengths);

    if (hidden === undefined) return;
    HIDDEN.delete(lengths);
    for (let slot = 0; slot < lengths.length; slot++) {
        const length = Number(hidden[slot]);

        if (length === 0 || lengths[slot] !== 0) continue;
        lengths[slot] = length;
        changed(slot);
    }
}

/**
 * The hidden lengths of a pose while the switch is off, or undefined while it is on. The deform
 * timelines of an entry that mixes out write these in place of the lengths of the pose.
 *
 * @example
 * const hidden = hiddenLengths(state.deformLengths);
 */
export function hiddenLengths(lengths: Int32Array): Int32Array | undefined {
    return HIDDEN.get(lengths);
}

/**
 * Forgets the hidden deform of a slot, for an attachment change that clears the deform of the
 * slot in the official runtime. Does nothing while the switch is on.
 *
 * @example
 * pose.deformLengths[slot] = 0;
 * forgetDeform(pose.deformLengths, slot);
 */
export function forgetDeform(lengths: Int32Array, slot: number): void {
    const hidden = HIDDEN.get(lengths);

    if (hidden !== undefined) hidden[slot] = 0;
}
