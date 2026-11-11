import { MarrowError } from '../../base/errors';
import type { AttachmentData, MeshAttachmentData, VertexData } from '../../model/attachments';
import type { ConstraintData } from '../../model/constraints';
import type { EventData } from '../../model/model';
import type { BinaryInput } from '../shared/binary-input';

const FIX = 'Export the skeleton again from Spine 4.3.';

/** The error for data that a 4.3 binary skeleton must not hold. */
export function invalid(message: string): MarrowError {
    return new MarrowError('invalid-data', message, { fix: FIX });
}

/** Checks that `index` points into a list of `count` items. `what` names the items, for example `bone`. */
export function checkIndex(index: number, count: number, what: string): number {
    if (index < 0 || index >= count) {
        throw invalid(`The file points at ${what} ${index}, but the skeleton has ${count}.`);
    }

    return index;
}

/** Reads an index and checks that it points into a list of `count` items. */
export function readIndex(input: BinaryInput, count: number, what: string): number {
    return checkIndex(input.readInt(true), count, what);
}

/** Checks that a number from the file selects one of `count` choices. `what` names them, for example `blend mode`. */
export function checkChoice(index: number, count: number, what: string): number {
    if (index < 0 || index >= count) throw invalid(`The file holds ${what} ${index}, which Spine 4.3 does not have.`);

    return index;
}

/** Returns the entry of a list that a number from the file selects. A hole in the list is not a choice. */
export function pick<T>(list: readonly (T | undefined)[], index: number, what: string): T {
    const value = list[index];

    if (value === undefined) throw invalid(`The file holds ${what} ${index}, which Spine 4.3 does not have.`);

    return value;
}

/** Reads a string that the file must hold. `what` starts the error message, for example `A bone`. */
export function readName(input: BinaryInput, what: string): string {
    const name = input.readString();

    if (name === null || name === '') throw invalid(`${what} has no name.`);

    return name;
}

/** A linked mesh that waits for its parent. The parent can be in a skin that is read later. */
export interface LinkedMesh {
    mesh: MeshAttachmentData;
    /** The index of the skin that holds the parent. */
    skin: number;
    /** The index of the slot that holds the parent. */
    slot: number;
    /** The name the parent is stored under, or null when the file has none. */
    name: string | null;
    inheritTimelines: boolean;
}

/** A skin while the file is read. Attachments are kept by slot and name, like the official `Skin`. */
export interface SkinBuild {
    name: string;
    bones: Int16Array;
    constraints: Int16Array;
    slots: Map<number, Map<string, AttachmentData>>;
}

/** What the readers share while one file is imported. */
export interface ImportState {
    readonly input: BinaryInput;
    /** True when the file holds editor data. It is read to stay in step, then dropped. */
    readonly nonessential: boolean;
    boneCount: number;
    slotCount: number;
    constraints: ConstraintData[];
    skins: SkinBuild[];
    /** Linked meshes in file order. */
    linked: LinkedMesh[];
    /** The vertices a linked mesh took from its parent. Deform timelines need them. */
    geometry: Map<AttachmentData, VertexData>;
    events: EventData[];
}

/** Finds an attachment by skin, slot and the name the skin stores it under. */
export function findAttachment(state: ImportState, skin: number, slot: number, name: string): AttachmentData {
    const attachment = state.skins[skin]?.slots.get(slot)?.get(name);

    if (attachment === undefined) {
        throw invalid(`The file points at attachment "${name}" of slot ${slot} in skin ${skin}, which does not exist.`);
    }

    return attachment;
}
