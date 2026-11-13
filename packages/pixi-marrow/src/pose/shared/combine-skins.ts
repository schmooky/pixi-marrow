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
 * The index of one skin made of skins of the model, as the official `Skin.addSkin` builds it
 * into an empty skin, one after the other. It holds the bones and constraints of all of them.
 * Where two hold an attachment under one slot and name, the later one wins. The lookup keeps the
 * skin, so the same list gives the same index again, for every instance of the model. A list of
 * one gives that skin, an empty list -1.
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

    return lookup.add(skins.join(','), skins, () => makeSkin(model, skins));
}
