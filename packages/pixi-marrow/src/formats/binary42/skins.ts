import type { AttachmentData, AttachmentRef } from '../../model/attachments';
import type { SkinAttachment, SkinData } from '../../model/model';
import { readAttachment41 } from './attachments41';
import { readAttachment42 } from './attachments42';
import { type ImportState, invalid, type LinkedMesh, readCount, readIndex, requireName, type SkinDraft } from './state';

/** Reads a list of indices into one constraint group and adds them to the skin as unified indices. */
function readConstraintList(state: ImportState, skin: SkinDraft, count: number, start: number, what: string): void {
    for (let i = 0, n = readCount(state, 'skin constraints'); i < n; i++) {
        skin.constraints.push(start + readIndex(state, count, what));
    }
}

/**
 * Reads the head of a named skin and returns how many slots it has attachments for.
 * 4.1 stores the name as an index into the string table. 4.2 stores it inline, adds an editor
 * color, and lists physics constraints.
 */
function readSkinHead(state: ImportState, skin: SkinDraft): number {
    const { input, version, nonessential } = state;
    const transformStart = state.ikCount;
    const pathStart = transformStart + state.transformCount;

    skin.name = requireName(version === '4.2' ? input.readString() : input.readStringRef(), 'a skin');
    if (version === '4.2' && nonessential) input.readInt32();
    for (let i = 0, n = readCount(state, 'skin bones'); i < n; i++) {
        skin.bones.push(readIndex(state, state.boneCount, 'bone'));
    }
    readConstraintList(state, skin, state.ikCount, 0, 'IK constraint');
    readConstraintList(state, skin, state.transformCount, transformStart, 'transform constraint');
    readConstraintList(state, skin, state.pathCount, pathStart, 'path constraint');
    if (version === '4.2') {
        readConstraintList(state, skin, state.physicsCount, pathStart + state.pathCount, 'physics constraint');
    }

    return readCount(state, 'skin slots');
}

/** Reads the attachments of a skin, slot by slot. A later entry with the same name replaces an earlier one. */
function readSkinSlots(state: ImportState, skin: SkinDraft, slotCount: number): SkinDraft {
    const { input, version } = state;
    const read = version === '4.2' ? readAttachment42 : readAttachment41;

    for (let i = 0; i < slotCount; i++) {
        const slot = readIndex(state, state.slotCount, 'slot');
        const entries = skin.slots.get(slot) ?? new Map<string, AttachmentData>();

        skin.slots.set(slot, entries);
        for (let ii = 0, nn = readCount(state, 'attachments'); ii < nn; ii++) {
            const name = requireName(input.readStringRef(), 'a skin attachment');

            entries.set(name, read(state, slot, name));
        }
    }

    return skin;
}

const emptySkin = (): SkinDraft => ({ name: 'default', bones: [], constraints: [], slots: new Map() });

/**
 * Reads the default skin and the named skins into the state, in the order of the official skin
 * list. The default skin has no head, and the official reader leaves it out when it is empty.
 */
export function readSkins(state: ImportState): void {
    const defaultSlotCount = readCount(state, 'skin slots');

    if (defaultSlotCount > 0) {
        state.hasDefaultSkin = true;
        state.skins.push(readSkinSlots(state, emptySkin(), defaultSlotCount));
    }
    for (let i = 0, n = readCount(state, 'skins'); i < n; i++) {
        const skin = emptySkin();

        state.skins.push(readSkinSlots(state, skin, readSkinHead(state, skin)));
    }
}

/** The index of the skin the official reader looks the parent of a linked mesh up in. */
function parentSkin(state: ImportState, linked: LinkedMesh): number {
    const { skin } = linked;

    if (typeof skin === 'number') {
        if (skin < 0 || skin >= state.skins.length) {
            throw invalid(`A linked mesh points at skin ${skin}, but the file has ${state.skins.length} skins.`);
        }

        return skin;
    }
    if (!skin) {
        if (!state.hasDefaultSkin) throw invalid('A linked mesh points at the default skin, which is empty.');

        return 0;
    }
    const index = state.skins.findIndex((candidate) => candidate.name === skin);

    if (index < 0) throw invalid(`A linked mesh points at the skin ${skin}, which does not exist.`);

    return index;
}

/**
 * Gives every linked mesh its parent, in file order like the official reader.
 * The geometry a mesh takes over is the one its parent has at that moment.
 */
export function linkMeshes(state: ImportState): void {
    for (const linked of state.linkedMeshes) {
        const skin = parentSkin(state, linked);
        const name = requireName(linked.parent, 'a linked mesh parent');
        const parent = state.skins[skin]?.slots.get(linked.slot)?.get(name);

        if (parent === undefined || parent.type !== 'mesh') {
            throw invalid(
                `The linked mesh ${linked.mesh.name} has the parent ${name}, which is not a mesh of its skin.`,
            );
        }
        const ref: AttachmentRef = { skin, slot: linked.slot, name };

        linked.mesh.parent = ref;
        if (linked.inheritTimelines) linked.mesh.timelineAttachment = { ...ref };
        state.geometry.set(linked.mesh, state.geometry.get(parent) ?? parent);
    }
}

function byCodeUnits(a: string, b: string): number {
    if (a < b) return -1;

    return a > b ? 1 : 0;
}

/** Turns a skin into its model form: attachments sorted by slot index, then by entry name. */
export function skinData(skin: SkinDraft): SkinData {
    const attachments: SkinAttachment[] = [];

    for (const [slot, entries] of [...skin.slots].sort(([a], [b]) => a - b)) {
        for (const [name, attachment] of [...entries].sort(([a], [b]) => byCodeUnits(a, b))) {
            attachments.push({ slot, name, attachment });
        }
    }

    return {
        name: skin.name,
        bones: Int16Array.from(skin.bones),
        constraints: Int16Array.from(skin.constraints),
        attachments,
    };
}
