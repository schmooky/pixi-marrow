import type { AttachmentData, AttachmentRef } from '../../model/attachments';
import type { SkinAttachment, SkinData } from '../../model/model';
import { readAttachment } from './attachments';
import { checkIndex, type ImportState, invalid, type LinkedMesh, readIndex, readName, type SkinBuild } from './reader';

function readIndexList(state: ImportState, count: number, what: string): Int16Array {
    const indices = new Int16Array(state.input.readInt(true));

    for (let i = 0; i < indices.length; i++) indices[i] = readIndex(state.input, count, what);

    return indices;
}

/** Reads the attachments of `slotCount` slots into a skin. A name that repeats replaces the earlier attachment. */
function readSkinSlots(state: ImportState, skin: SkinBuild, slotCount: number): void {
    const input = state.input;

    for (let i = 0; i < slotCount; i++) {
        const slot = readIndex(input, state.slotCount, 'slot');
        const attachments: Map<string, AttachmentData> = skin.slots.get(slot) ?? new Map();

        skin.slots.set(slot, attachments);
        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
            const placeholder = input.readStringRef();

            if (placeholder === null) throw invalid(`An attachment of skin "${skin.name}" has no name.`);
            attachments.set(placeholder, readAttachment(state, placeholder));
        }
    }
}

/** Reads the default skin. The file stores only its attachments. Null when it has none. */
function readDefaultSkin(state: ImportState): SkinBuild | null {
    const slotCount = state.input.readInt(true);

    if (slotCount === 0) return null;
    const skin: SkinBuild = {
        name: 'default',
        bones: new Int16Array(0),
        constraints: new Int16Array(0),
        slots: new Map(),
    };

    readSkinSlots(state, skin, slotCount);

    return skin;
}

function readSkin(state: ImportState): SkinBuild {
    const name = readName(state.input, 'A skin');

    // the skin color
    if (state.nonessential) state.input.readInt32();
    const bones = readIndexList(state, state.boneCount, 'bone');
    const constraints = readIndexList(state, state.constraints.length, 'constraint');
    const skin: SkinBuild = { name, bones, constraints, slots: new Map() };

    readSkinSlots(state, skin, state.input.readInt(true));

    return skin;
}

/** Gives one linked mesh its parent, like the official `setSourceMesh`. The mesh takes the parent's image size. */
function linkMesh(state: ImportState, linked: LinkedMesh): void {
    const { mesh, name } = linked;
    const skin = checkIndex(linked.skin, state.skins.length, 'skin');
    const slot = checkIndex(linked.slot, state.slotCount, 'slot');

    if (name === null) throw invalid(`Linked mesh "${mesh.name}" names no parent mesh.`);
    const parent = state.skins[skin]?.slots.get(slot)?.get(name);

    if (parent?.type !== 'mesh') throw invalid(`Linked mesh "${mesh.name}" has no parent mesh "${name}".`);
    const ref: AttachmentRef = { skin, slot, name };

    mesh.parent = ref;
    mesh.timelineAttachment = linked.inheritTimelines ? { ...ref } : null;
    mesh.width = parent.width;
    mesh.height = parent.height;
    // a parent that is linked itself passes on the vertices it holds at this moment
    state.geometry.set(mesh, state.geometry.get(parent) ?? parent);
}

/**
 * Reads the default skin and then every other skin into `state.skins`, and links the linked meshes.
 * A default skin without attachments is not in the list, as in the official reader.
 */
export function readSkins(state: ImportState): void {
    const defaultSkin = readDefaultSkin(state);

    if (defaultSkin !== null) state.skins.push(defaultSkin);
    for (let i = 0, n = state.input.readInt(true); i < n; i++) state.skins.push(readSkin(state));
    for (const linked of state.linked) linkMesh(state, linked);
}

const compareNames = (a: string, b: string): number => {
    if (a < b) return -1;

    return a > b ? 1 : 0;
};

/** Turns a skin into its model form. Attachments are sorted by slot index, then by name. */
export function toSkinData(skin: SkinBuild): SkinData {
    const attachments: SkinAttachment[] = [];

    for (const [slot, named] of skin.slots) {
        for (const [name, attachment] of named) attachments.push({ slot, name, attachment });
    }
    attachments.sort((a, b) => a.slot - b.slot || compareNames(a.name, b.name));

    return { name: skin.name, bones: skin.bones, constraints: skin.constraints, attachments };
}
