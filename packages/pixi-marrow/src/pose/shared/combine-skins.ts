import { MarrowError } from '../../base/errors';
import type { SkeletonModel, SkinAttachment, SkinData } from '../../model/model';
import type { AttachmentLookup } from './lookup';

/** Orders skin attachments as a model does: by slot, then by name in UTF-16 code unit order. */
function bySlotAndName(a: SkinAttachment, b: SkinAttachment): number {
    if (a.slot !== b.slot) return a.slot - b.slot;

    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** The official `Skin.addSkin` for each part, into an empty skin. */
function makeSkin(model: SkeletonModel, parts: readonly number[]): SkinData {
    const bones: number[] = [];
    const constraints = new Set<number>();
    // a later entry under the same slot and name takes the place of the earlier one
    const entries = new Map<string, SkinAttachment>();

    for (const part of parts) {
        const skin = model.skins[part] as SkinData;

        for (const bone of skin.bones) if (!bones.includes(bone)) bones.push(bone);
        for (const constraint of skin.constraints) constraints.add(constraint);
        for (const entry of skin.attachments) entries.set(`${entry.slot}/${entry.name}`, entry);
    }

    return {
        name: parts.map((part) => model.skins[part]?.name).join('+'),
        bones: Int16Array.from(bones),
        // in file order, as the skins of a model hold them
        constraints: Int16Array.from([...constraints].sort((a, b) => a - b)),
        attachments: [...entries.values()].sort(bySlotAndName),
    };
}

/**
 * How many combined skins of a model stay while no engine shows them, so that switching back
 * and forth between a few lists builds nothing again. An older one is freed.
 */
export const KEPT_SKINS = 8;

/** Who shows the combined skins of one model. */
interface Holds {
    /** Per combined skin index: how many engines show it. */
    readonly counts: Map<number, number>;
    /** The combined skins no engine shows, the oldest first. */
    readonly idle: number[];
    /** What drops a cache by skin index when a skin is freed. */
    readonly listeners: ((index: number) => void)[];
}

const HOLDS = new WeakMap<AttachmentLookup, Holds>();

function holdsOf(lookup: AttachmentLookup): Holds {
    let holds = HOLDS.get(lookup);

    if (holds === undefined) {
        holds = { counts: new Map(), idle: [], listeners: [] };
        HOLDS.set(lookup, holds);
    }

    return holds;
}

/** Notes a combined skin that no engine shows, and frees the oldest past {@link KEPT_SKINS}. */
function rest(lookup: AttachmentLookup, holds: Holds, index: number): void {
    holds.idle.push(index);
    while (holds.idle.length > KEPT_SKINS) {
        const freed = holds.idle.shift() ?? -1;

        lookup.drop(freed);
        for (const listener of holds.listeners) listener(freed);
    }
}

/**
 * Asks to be told when a combined skin of a model is freed, so that a cache by skin index can
 * drop its entry. The rig of an engine does that for its update caches and attachment rows.
 *
 * @example
 * onSkinFreed(lookup, (index) => caches.delete(index));
 */
export function onSkinFreed(lookup: AttachmentLookup, listener: (index: number) => void): void {
    holdsOf(lookup).listeners.push(listener);
}

/**
 * Notes that an engine changed from skin `before` to skin `after`. A combined skin stays while an
 * engine shows it. One that no engine shows is kept with the last {@link KEPT_SKINS} of them and
 * freed after that. Skins of the model are never freed. An engine that is dropped while it shows
 * a combined skin keeps it: set skin -1 first, as `MarrowSpine.destroy` does.
 *
 * @example
 * changeSkin(lookup, model, previous, engine.state.skin);
 */
export function changeSkin(lookup: AttachmentLookup, model: SkeletonModel, before: number, after: number): void {
    if (before === after) return;
    const holds = holdsOf(lookup);
    const own = model.skins.length;

    if (after >= own) {
        holds.counts.set(after, (holds.counts.get(after) ?? 0) + 1);
        const waiting = holds.idle.indexOf(after);

        if (waiting >= 0) holds.idle.splice(waiting, 1);
    }
    if (before >= own) {
        const count = (holds.counts.get(before) ?? 0) - 1;

        if (count > 0) holds.counts.set(before, count);
        else {
            holds.counts.delete(before);
            rest(lookup, holds, before);
        }
    }
}

/**
 * The index of one skin made of skins of the model, as the official `Skin.addSkin` builds it
 * into an empty skin, one after the other. It holds the bones and constraints of all of them.
 * Where two hold an attachment under one slot and name, the later one wins. The same list gives
 * the same index again, for every instance of the model, while an engine shows the skin or it is
 * among the last {@link KEPT_SKINS} that none shows. A list of one gives that skin, an empty list -1.
 *
 * Throws a `MarrowError` for an index that is not a skin of the model.
 *
 * @example
 * engine.setSkin(combineSkins(createAttachmentLookup(model), model, [1, 4]));
 */
export function combineSkins(lookup: AttachmentLookup, model: SkeletonModel, skins: readonly number[]): number {
    const own = model.skins.length;

    for (const part of skins) {
        if (!Number.isInteger(part) || part < 0 || part >= own) {
            throw new MarrowError('invalid-data', `The skeleton has no skin ${part}. It has ${own} skins.`, {
                fix: 'Combine indices into the skin list of the model.',
            });
        }
    }
    if (skins.length < 2) return skins[0] ?? -1;
    const count = lookup.skinCount;
    const index = lookup.add(skins.join(','), skins, () => makeSkin(model, skins));

    // a new skin waits with the others until an engine shows it
    if (index >= count) rest(lookup, holdsOf(lookup), index);

    return index;
}
