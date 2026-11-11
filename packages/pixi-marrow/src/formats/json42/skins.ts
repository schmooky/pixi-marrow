import { MarrowError } from '../../base/errors';
import type { AttachmentData, VertexData } from '../../model/attachments';
import type { SkinAttachment, SkinData } from '../../model/model';
import { type PendingLink, readAttachment } from './attachments';
import type { SkeletonRefs, SkinAttachments } from './context';
import type { JsonRoot, JsonSkin } from './schema';
import { entries, indexNames, invalid, list, type NameIndex, requireName, resolve } from './values';

/** The skins of a file with what animations need to find their attachments. */
export interface SkinSet {
    list: SkinData[];
    index: NameIndex;
    /** The attachments of each skin, in skin order. */
    attachments: SkinAttachments[];
    /** The vertices a linked mesh took from its parent. */
    geometry: Map<AttachmentData, VertexData>;
}

/** The constraint indices of a skin in the order the official parser adds them: IK, transform, path, physics. */
function readSkinConstraints(skin: JsonSkin, refs: SkeletonRefs, user: string): Int16Array {
    const { constraints } = refs;
    const out: number[] = [];

    for (const name of list(skin.ik, `The "ik" list of ${user}`)) {
        out.push(resolve(constraints.ik, name, 'IK constraint', user));
    }
    for (const name of list(skin.transform, `The "transform" list of ${user}`)) {
        out.push(constraints.transformOffset + resolve(constraints.transform, name, 'transform constraint', user));
    }
    for (const name of list(skin.path, `The "path" list of ${user}`)) {
        out.push(constraints.pathOffset + resolve(constraints.path, name, 'path constraint', user));
    }
    if (refs.version === '4.2') {
        for (const name of list(skin.physics, `The "physics" list of ${user}`)) {
            out.push(constraints.physicsOffset + resolve(constraints.physics, name, 'physics constraint', user));
        }
    }

    return Int16Array.from(out);
}

function readSkinAttachments(skin: JsonSkin, name: string, refs: SkeletonRefs, links: PendingLink[]): SkinAttachments {
    const user = `The skin "${name}"`;
    const bySlot: SkinAttachments = new Map();

    for (const [slotName, slotMap] of entries(skin.attachments, `The attachments of ${user}`)) {
        const slot = resolve(refs.slots, slotName, 'slot', user);
        const byName = bySlot.get(slot) ?? new Map<string, AttachmentData>();

        bySlot.set(slot, byName);
        for (const [entryName, map] of entries(slotMap, `The attachments of ${user} in the slot "${slotName}"`)) {
            const site = {
                slot,
                slots: refs.slots,
                boneCount: refs.boneCount,
                links,
                user: `The attachment "${entryName}" of the slot "${slotName}" in the skin "${name}"`,
            };

            byName.set(entryName, readAttachment(map, entryName, site));
        }
    }

    return bySlot;
}

/** By slot index, then by name in UTF-16 code unit order. */
function compareAttachments(a: SkinAttachment, b: SkinAttachment): number {
    if (a.slot !== b.slot) return a.slot - b.slot;
    if (a.name < b.name) return -1;

    return a.name > b.name ? 1 : 0;
}

function sortedAttachments(bySlot: SkinAttachments): SkinAttachment[] {
    const out: SkinAttachment[] = [];

    for (const [slot, byName] of bySlot) {
        for (const [name, attachment] of byName) out.push({ slot, name, attachment });
    }

    return out.sort(compareAttachments);
}

/**
 * Gives every linked mesh its parent, in file order like the official parser.
 *
 * A mesh without a skin name looks in the default skin, which is the last skin named `default`.
 * A named skin is the first skin of that name.
 */
function linkMeshes(
    links: readonly PendingLink[],
    index: NameIndex,
    defaultSkin: number,
    attachments: readonly SkinAttachments[],
): Map<AttachmentData, VertexData> {
    const geometry = new Map<AttachmentData, VertexData>();

    for (const link of links) {
        const skin = link.skin ? resolve(index, link.skin, 'skin', link.user) : defaultSkin;

        if (skin < 0) throw invalid(`${link.user} is linked to a mesh in the default skin, which does not exist.`);
        const parent = attachments[skin]?.get(link.slot)?.get(link.parent);

        if (parent === undefined || parent.type !== 'mesh') {
            throw new MarrowError(
                'invalid-data',
                `${link.user} is linked to the mesh "${link.parent}", which its skin does not have in that slot.`,
                {
                    fix: 'Link the mesh to an existing mesh, or export the skeleton again from the Spine editor.',
                    validNames: [...(attachments[skin]?.get(link.slot)?.keys() ?? [])],
                },
            );
        }
        const ref = { skin, slot: link.slot, name: link.parent };

        link.mesh.parent = ref;
        link.mesh.timelineAttachment = link.inheritTimeline ? ref : null;
        // the official parser copies the parent's vertices as they are at this moment
        geometry.set(link.mesh, geometry.get(parent) ?? parent);
    }

    return geometry;
}

/** Reads `skins`, then links the linked meshes to their parents. */
export function readSkins(root: JsonRoot, refs: SkeletonRefs): SkinSet {
    const links: PendingLink[] = [];
    const attachments: SkinAttachments[] = [];
    let defaultSkin = -1;

    const skins = list(root.skins, 'The "skins" entry').map((skin, i): SkinData => {
        const name = requireName(skin.name, `Skin ${i}`);
        const user = `The skin "${name}"`;
        const bones = Int16Array.from(list(skin.bones, `The "bones" list of ${user}`), (bone) =>
            resolve(refs.bones, bone, 'bone', user),
        );
        const constraints = readSkinConstraints(skin, refs, user);
        const bySlot = readSkinAttachments(skin, name, refs, links);

        attachments.push(bySlot);
        if (name === 'default') defaultSkin = i;

        return { name, bones, constraints, attachments: sortedAttachments(bySlot) };
    });
    const index = indexNames(skins.map((skin) => skin.name));

    return { list: skins, index, attachments, geometry: linkMeshes(links, index, defaultSkin, attachments) };
}
