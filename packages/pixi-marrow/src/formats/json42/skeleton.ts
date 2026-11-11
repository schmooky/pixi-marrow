import {
    BLEND_MODES,
    BONE_SETUP_STRIDE,
    type BoneTable,
    type EventData,
    INHERIT_MODES,
    type SlotTable,
} from '../../model/model';
import { writeHexColor } from '../shared/color';
import type { Json42Version } from './context';
import type { JsonRoot } from './schema';
import {
    entries,
    enumIndex,
    invalid,
    list,
    lowerFirst,
    type NameIndex,
    pick,
    requireAtMost,
    requireName,
    resolve,
} from './values';

/** The most bones or slots a skeleton can have. The model stores their indices as 16-bit integers. */
const MAX_INDEX = 0x7fff;

/** The values of the `skeleton` entry the model keeps. */
export interface SkeletonInfo {
    editorVersion: string;
    hash: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    referenceScale: number;
}

/** Reads the `skeleton` entry. Only 4.2 files store a reference scale. */
export function readSkeletonInfo(root: JsonRoot, version: Json42Version): SkeletonInfo {
    const skeleton = root.skeleton ?? {};

    if (typeof skeleton.spine !== 'string') throw invalid('The JSON has no "skeleton.spine" version field.');

    return {
        editorVersion: skeleton.spine,
        hash: pick<string | null>(skeleton.hash, null),
        x: pick(skeleton.x, 0),
        y: pick(skeleton.y, 0),
        width: pick(skeleton.width, 0),
        height: pick(skeleton.height, 0),
        referenceScale: version === '4.2' ? pick(skeleton.referenceScale, 100) : 100,
    };
}

/** The bones of a file with the lookup from bone name to index. */
export interface BoneSet {
    table: BoneTable;
    index: NameIndex;
}

/** Reads `bones`. A parent must come before its children. 4.1 stores the inherit mode under `transform`. */
export function readBones(root: JsonRoot, version: Json42Version): BoneSet {
    const bones = list(root.bones, 'The "bones" entry');
    const count = bones.length;

    requireAtMost(count, MAX_INDEX, 'The number of bones');
    const index = new Map<string, number>();
    const table: BoneTable = {
        count,
        names: [],
        parents: new Int16Array(count),
        setup: new Float32Array(count * BONE_SETUP_STRIDE),
        lengths: new Float32Array(count),
        inherit: new Uint8Array(count),
        skinRequired: new Uint8Array(count),
    };

    bones.forEach((bone, i) => {
        const name = requireName(bone.name, `Bone ${i}`);
        const user = `The bone "${name}"`;
        const mode = version === '4.2' ? bone.inherit : bone.transform;

        table.names.push(name);
        table.parents[i] = bone.parent ? resolve(index, bone.parent, 'bone', user) : -1;
        table.lengths[i] = pick(bone.length, 0);
        table.setup.set(
            [
                pick(bone.x, 0),
                pick(bone.y, 0),
                pick(bone.rotation, 0),
                pick(bone.scaleX, 1),
                pick(bone.scaleY, 1),
                pick(bone.shearX, 0),
                pick(bone.shearY, 0),
            ],
            i * BONE_SETUP_STRIDE,
        );
        table.inherit[i] = enumIndex(INHERIT_MODES, lowerFirst(pick(mode, 'normal')), `The inherit mode of ${user}`);
        table.skinRequired[i] = pick(bone.skin, false) ? 1 : 0;
        if (!index.has(name)) index.set(name, i);
    });

    return { table, index };
}

/** The slots of a file with the lookup from slot name to index. */
export interface SlotSet {
    table: SlotTable;
    index: NameIndex;
}

/** Reads `slots`. Only 4.2 files store the visible flag. */
export function readSlots(root: JsonRoot, bones: NameIndex, version: Json42Version): SlotSet {
    const slots = list(root.slots, 'The "slots" entry');
    const count = slots.length;

    requireAtMost(count, MAX_INDEX, 'The number of slots');
    const index = new Map<string, number>();
    const dark = new Float32Array(4);
    const table: SlotTable = {
        count,
        names: [],
        bones: new Int16Array(count),
        colors: new Float32Array(count * 4).fill(1),
        darkColors: new Float32Array(count * 3),
        hasDark: new Uint8Array(count),
        attachments: [],
        blendModes: new Uint8Array(count),
        visible: new Uint8Array(count).fill(1),
    };

    slots.forEach((slot, i) => {
        const name = requireName(slot.name, `Slot ${i}`);
        const user = `The slot "${name}"`;

        table.names.push(name);
        table.bones[i] = resolve(bones, slot.bone, 'bone', user);
        if (slot.color) writeHexColor(slot.color, table.colors, i * 4);
        if (slot.dark) {
            writeHexColor(slot.dark, dark, 0);
            table.darkColors.set(dark.subarray(0, 3), i * 3);
            table.hasDark[i] = 1;
        }
        table.attachments.push(pick<string | null>(slot.attachment, null));
        table.blendModes[i] = enumIndex(
            BLEND_MODES,
            lowerFirst(pick(slot.blend, 'normal')),
            `The blend mode of ${user}`,
        );
        if (version === '4.2') table.visible[i] = pick(slot.visible, true) ? 1 : 0;
        if (!index.has(name)) index.set(name, i);
    });

    return { table, index };
}

/** Reads `events`. Volume and balance are read only for an event with an audio file, as in the official parser. */
export function readEvents(root: JsonRoot): EventData[] {
    return entries(root.events, 'The "events" entry').map(([name, event]) => {
        const audioPath = pick<string | null>(event.audio, null);

        return {
            name,
            int: pick(event.int, 0),
            float: pick(event.float, 0),
            string: pick(event.string, ''),
            audioPath,
            volume: audioPath ? pick(event.volume, 1) : 0,
            balance: audioPath ? pick(event.balance, 0) : 0,
        };
    });
}
