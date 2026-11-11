import type { AttachmentRef } from '../../model/attachments';
import type { ConstraintData } from '../../model/constraints';
import type { SkinAttachment, SkinData } from '../../model/model';
import { type LinkedMesh, readAttachment } from './attachments';
import { type ImportContext, invalid, requireName, type SkinAttachments, type SkinEntry } from './context';
import type { JsonSkin } from './schema';

/** The constraint lists of a skin, in the order the official parser reads them. */
const CONSTRAINT_LISTS: readonly ConstraintData['type'][] = ['ik', 'transform', 'path', 'physics', 'slider'];

function readSkinConstraints(map: JsonSkin, user: string, ctx: ImportContext): Int16Array {
    const indices: number[] = [];

    for (const type of CONSTRAINT_LISTS) {
        for (const name of map[type] ?? []) indices.push(ctx.constraint(type, name, user));
    }

    return Int16Array.from(indices);
}

function readSkinAttachments(map: JsonSkin, user: string, ctx: ImportContext, linked: LinkedMesh[]): SkinAttachments {
    const attachments: SkinAttachments = new Map();

    for (const [slotName, slotMap] of Object.entries(map.attachments ?? {})) {
        const slot = ctx.slots.require(slotName, user);
        const bySlot = attachments.get(slot) ?? new Map();

        attachments.set(slot, bySlot);
        for (const [key, attachmentMap] of Object.entries(slotMap)) {
            bySlot.set(key, readAttachment(attachmentMap, slot, key, ctx, linked));
        }
    }

    return attachments;
}

/** The attachments of a skin as a list, sorted by slot index and then by name in code unit order. */
function sortedAttachments(attachments: SkinAttachments): SkinAttachment[] {
    const list: SkinAttachment[] = [];

    for (const [slot, bySlot] of attachments) {
        for (const [name, attachment] of bySlot) list.push({ slot, name, attachment });
    }

    return list.sort((a, b) => a.slot - b.slot || (a.name < b.name ? -1 : 1));
}

/**
 * Points every linked mesh at its source, in the order the official parser does.
 *
 * The official parser copies the geometry and the size of the source into the linked mesh.
 * The model keeps the geometry in the source only, so the copy goes to `ctx.geometry`.
 * A source also collects the other slots its timelines apply to, in `timelineSlots`.
 *
 * @param entries the skins that were read, in file order
 * @param defaultSkin the index of the default skin, or -1
 */
function linkMeshes(
    linked: readonly LinkedMesh[],
    entries: readonly SkinEntry[],
    defaultSkin: number,
    ctx: ImportContext,
): void {
    for (const link of linked) {
        const user = `Linked mesh "${link.mesh.name}"`;
        const skin = link.skin ? ctx.skins.require(link.skin, user) : entries[defaultSkin];

        if (skin === undefined) throw invalid(`${user} names no skin, and the skeleton has no default skin.`);
        const source = skin.attachments.get(link.sourceSlot)?.get(link.source);

        if (source?.type !== 'mesh') {
            throw invalid(`${user} refers to the mesh "${link.source}", which its skin does not have in that slot.`);
        }
        const ref: AttachmentRef = { skin: skin.index, slot: link.sourceSlot, name: link.source };

        link.mesh.parent = ref;
        link.mesh.timelineAttachment = link.inheritTimelines ? { ...ref } : null;
        link.mesh.width = source.width;
        link.mesh.height = source.height;
        ctx.geometry.set(link.mesh, ctx.geometry.get(source) ?? source);
        // the timelines of the source also apply to the slot of a linked mesh that follows them
        if (link.inheritTimelines && link.slot !== link.sourceSlot && !source.timelineSlots?.includes(link.slot)) {
            source.timelineSlots = Int16Array.of(...(source.timelineSlots ?? []), link.slot);
        }
    }
}

/** Reads `skins` and links the linked meshes. */
export function readSkins(maps: readonly JsonSkin[], ctx: ImportContext): SkinData[] {
    const linked: LinkedMesh[] = [];
    const entries: SkinEntry[] = [];
    let defaultSkin = -1;
    const skins = maps.map((map, index) => {
        const name = requireName(map.name, `Skin ${index}`);
        const user = `Skin "${name}"`;
        const bones = Int16Array.from(map.bones ?? [], (bone) => ctx.bones.require(bone, user));
        const constraints = readSkinConstraints(map, user, ctx);
        const entry: SkinEntry = { index, attachments: readSkinAttachments(map, user, ctx, linked) };

        entries.push(entry);
        ctx.skins.add(name, entry);
        // the official parser keeps the last skin of that name as the default skin
        if (name === 'default') defaultSkin = index;

        return { name, bones, constraints, attachments: sortedAttachments(entry.attachments) };
    });

    linkMeshes(linked, entries, defaultSkin, ctx);

    return skins;
}
