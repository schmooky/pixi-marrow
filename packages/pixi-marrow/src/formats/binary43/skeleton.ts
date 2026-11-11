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
import { checkChoice, invalid, readIndex, readName } from './reader';

/** The first values of a binary skeleton. */
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

/** Reads the hash, the version, the setup bounds and the flag for editor data. */
export function readHeader(input: BinaryInput): Header {
    const lowHash = input.readInt32();
    const highHash = input.readInt32();
    const hash = highHash === 0 && lowHash === 0 ? null : highHash.toString(16) + lowHash.toString(16);
    const editorVersion = input.readString();

    if (editorVersion === null) throw invalid('The skeleton has no version string.');
    const x = input.readFloat();
    const y = input.readFloat();
    const width = input.readFloat();
    const height = input.readFloat();
    const referenceScale = input.readFloat();
    const nonessential = input.readBoolean();

    if (nonessential) {
        // frames per second, images path, audio path
        input.readFloat();
        input.readString();
        input.readString();
    }

    return { hash, editorVersion, x, y, width, height, referenceScale, nonessential };
}

/** Reads the string table into `input.strings`. */
export function readStrings(input: BinaryInput): void {
    for (let i = 0, n = input.readInt(true); i < n; i++) input.strings.push(readName(input, 'A string table entry'));
}

/** Reads every bone. The file stores rotation before x and y. */
export function readBones(input: BinaryInput, nonessential: boolean): BoneTable {
    const count = input.readInt(true);
    const names: string[] = [];
    const parents = new Int16Array(count);
    const setup = new Float64Array(count * BONE_SETUP_STRIDE);
    const lengths = new Float64Array(count);
    const inherit = new Uint8Array(count);
    const skinRequired = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        const at = i * BONE_SETUP_STRIDE;

        names.push(readName(input, 'A bone'));
        // a parent is always an earlier bone
        parents[i] = i === 0 ? -1 : readIndex(input, i, 'parent bone');
        setup[at + 2] = input.readFloat();
        setup[at] = input.readFloat();
        setup[at + 1] = input.readFloat();
        setup[at + 3] = input.readFloat();
        setup[at + 4] = input.readFloat();
        setup[at + 5] = input.readFloat();
        setup[at + 6] = input.readFloat();
        inherit[i] = checkChoice(input.readByte(), INHERIT_MODES.length, 'inherit mode');
        lengths[i] = input.readFloat();
        skinRequired[i] = input.readBoolean() ? 1 : 0;
        if (nonessential) {
            // color, icon, icon size, icon rotation, visible
            input.readInt32();
            input.readString();
            input.readFloat();
            input.readFloat();
            input.readBoolean();
        }
    }

    return { count, names, parents, setup, lengths, inherit, skinRequired };
}

/** Reads every slot. A dark color of -1 means the slot has none. */
export function readSlots(input: BinaryInput, boneCount: number, nonessential: boolean): SlotTable {
    const count = input.readInt(true);
    const names: string[] = [];
    const bones = new Int16Array(count);
    const colors = new Float64Array(count * 4);
    const darkColors = new Float64Array(count * 3);
    const hasDark = new Uint8Array(count);
    const attachments: (string | null)[] = [];
    const blendModes = new Uint8Array(count);
    const visible = new Uint8Array(count).fill(1);

    for (let i = 0; i < count; i++) {
        names.push(readName(input, 'A slot'));
        bones[i] = readIndex(input, boneCount, 'bone');
        writeRgba8888(input.readInt32(), colors, i * 4);
        const dark = input.readInt32();

        if (dark !== -1) {
            writeRgb888(dark, darkColors, i * 3);
            hasDark[i] = 1;
        }
        attachments.push(input.readStringRef());
        blendModes[i] = checkChoice(input.readInt(true), BLEND_MODES.length, 'blend mode');
        if (nonessential) visible[i] = input.readBoolean() ? 1 : 0;
    }

    return { count, names, bones, colors, darkColors, hasDark, attachments, blendModes, visible };
}

/** Reads every event. Volume and balance are stored only for events with an audio path. */
export function readEvents(input: BinaryInput): EventData[] {
    const events: EventData[] = [];

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const name = readName(input, 'An event');
        const int = input.readInt(false);
        const float = input.readFloat();
        const string = input.readString() ?? '';
        const audioPath = input.readString();
        let volume = 0;
        let balance = 0;

        if (audioPath !== null && audioPath !== '') {
            volume = input.readFloat();
            balance = input.readFloat();
        }
        events.push({ name, int, float, string, audioPath, volume, balance });
    }

    return events;
}
