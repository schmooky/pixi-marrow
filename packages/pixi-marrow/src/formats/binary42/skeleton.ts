import {
    BLEND_MODES,
    BONE_SETUP_STRIDE,
    type BoneTable,
    type EventData,
    INHERIT_MODES,
    type SlotTable,
} from '../../model/model';
import type { BinaryInput } from '../shared/binary-input';
import { writeRgb888, writeRgba8888 } from '../shared/color';
import {
    type BinaryVersion,
    type ImportState,
    invalid,
    readCount,
    readIndex,
    requireBelow,
    requireName,
} from './state';

/** What the start of the file holds, before the string table. */
export interface Header {
    hash: string | null;
    editorVersion: string;
    x: number;
    y: number;
    width: number;
    height: number;
    referenceScale: number;
    nonessential: boolean;
}

/** Reads the header. 4.1 files have no reference scale. */
export function readHeader(input: BinaryInput, version: BinaryVersion): Header {
    const lowHash = input.readInt32();
    const highHash = input.readInt32();
    const hash = highHash === 0 && lowHash === 0 ? null : highHash.toString(16) + lowHash.toString(16);
    const editorVersion = input.readString();

    if (editorVersion === null) throw invalid('The file has no version string.');
    const x = input.readFloat();
    const y = input.readFloat();
    const width = input.readFloat();
    const height = input.readFloat();
    const referenceScale = version === '4.2' ? input.readFloat() : 100;
    const nonessential = input.readBoolean();

    if (nonessential) {
        // the frame rate, the images path and the audio path
        input.readFloat();
        input.readString();
        input.readString();
    }

    return { hash, editorVersion, x, y, width, height, referenceScale, nonessential };
}

/** Reads the string table into the input, where `readStringRef` finds it. */
export function readStrings(state: ImportState): void {
    const { input } = state;

    for (let i = 0, n = readCount(state, 'strings'); i < n; i++) {
        const text = input.readString();

        if (!text) throw invalid('The string table holds an empty string.');
        input.strings.push(text);
    }
}

/** Reads the bones. 4.1 stores the inherit mode as a variable-length integer and has no icon or visibility. */
export function readBones(state: ImportState): BoneTable {
    const { input, version, nonessential } = state;
    const count = readCount(state, 'bones');
    const names: string[] = [];
    const parents = new Int16Array(count);
    // 64-bit, like the numbers the official bone data holds
    const setup = new Float64Array(count * BONE_SETUP_STRIDE);
    const lengths = new Float64Array(count);
    const inherit = new Uint8Array(count);
    const skinRequired = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        const at = i * BONE_SETUP_STRIDE;

        names.push(requireName(input.readString(), 'a bone'));
        // a parent comes before its children, so its index is below the index of the bone
        parents[i] = i === 0 ? -1 : readIndex(state, i, 'parent bone');
        // the file stores the rotation first. The model stores x, y, rotation
        setup[at + 2] = input.readFloat();
        setup[at] = input.readFloat();
        setup[at + 1] = input.readFloat();
        for (let value = 3; value < BONE_SETUP_STRIDE; value++) setup[at + value] = input.readFloat();
        lengths[i] = input.readFloat();
        inherit[i] = requireBelow(
            version === '4.2' ? input.readByte() : input.readInt(true),
            INHERIT_MODES.length,
            'inherit mode',
        );
        skinRequired[i] = input.readBoolean() ? 1 : 0;
        if (nonessential) skipBoneEditorData(input, version);
    }
    state.boneCount = count;

    return { count, names, parents, setup, lengths, inherit, skinRequired };
}

function skipBoneEditorData(input: BinaryInput, version: BinaryVersion): void {
    input.readInt32();
    if (version === '4.2') {
        // the icon and the visibility
        input.readString();
        input.readBoolean();
    }
}

/** Reads the slots. Only 4.2 files with editor data store whether a slot is visible. */
export function readSlots(state: ImportState): SlotTable {
    const { input, version, nonessential } = state;
    const count = readCount(state, 'slots');
    const names: string[] = [];
    const bones = new Int16Array(count);
    const colors = new Float64Array(count * 4);
    const darkColors = new Float64Array(count * 3);
    const hasDark = new Uint8Array(count);
    const attachments: (string | null)[] = [];
    const blendModes = new Uint8Array(count);
    const visible = new Uint8Array(count).fill(1);

    for (let i = 0; i < count; i++) {
        names.push(requireName(input.readString(), 'a slot'));
        bones[i] = readIndex(state, state.boneCount, 'bone');
        writeRgba8888(input.readInt32(), colors, i * 4);
        const darkColor = input.readInt32();

        // all bits set means the slot has no dark color
        if (darkColor !== -1) {
            writeRgb888(darkColor, darkColors, i * 3);
            hasDark[i] = 1;
        }
        attachments.push(input.readStringRef());
        blendModes[i] = requireBelow(input.readInt(true), BLEND_MODES.length, 'blend mode');
        if (version === '4.2' && nonessential) visible[i] = input.readBoolean() ? 1 : 0;
    }
    state.slotCount = count;

    return { count, names, bones, colors, darkColors, hasDark, attachments, blendModes, visible };
}

/** Reads the events. 4.1 stores the name as an index into the string table. */
export function readEvents(state: ImportState): EventData[] {
    const { input, version } = state;
    const events: EventData[] = [];

    for (let i = 0, n = readCount(state, 'events'); i < n; i++) {
        const name = requireName(version === '4.2' ? input.readString() : input.readStringRef(), 'an event');
        const int = input.readInt(false);
        const float = input.readFloat();
        const string = input.readString() ?? '';
        const audioPath = input.readString();
        let volume = 0;
        let balance = 0;

        // the file stores volume and balance only for events with audio
        if (audioPath) {
            volume = input.readFloat();
            balance = input.readFloat();
        }
        events.push({ name, int, float, string, audioPath, volume, balance });
    }
    state.events = events;

    return events;
}
