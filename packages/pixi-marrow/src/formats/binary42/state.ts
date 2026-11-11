import { MarrowError } from '../../base/errors';
import type { AttachmentData, MeshAttachmentData, VertexData } from '../../model/attachments';
import type { EventData } from '../../model/model';
import type { BinaryInput } from '../shared/binary-input';

/** The version lines this importer reads. Their byte layouts differ, so most readers branch on it. */
export type BinaryVersion = '4.1' | '4.2';

/** The vertices a deform timeline works on. A linked mesh uses the ones of its parent. */
export type Geometry = Pick<VertexData, 'bones' | 'vertices'>;

/** A skin while it is read. It keeps attachments by slot and by name, like the official skin does. */
export interface SkinDraft {
    name: string;
    bones: number[];
    /** Indices into the one constraint list, in the order the file lists them. */
    constraints: number[];
    /** Slot index, then the name of the skin entry, then the attachment. */
    slots: Map<number, Map<string, AttachmentData>>;
}

/** A linked mesh that waits for every skin to be read, so its parent can be looked up. */
export interface LinkedMesh {
    mesh: MeshAttachmentData;
    /** The skin that holds the parent. 4.2 stores its index. 4.1 stores its name, or null for the default skin. */
    skin: number | string | null;
    slot: number;
    parent: string | null;
    inheritTimelines: boolean;
}

/** What is known about the skeleton while its file is read. Later sections point back at earlier ones. */
export interface ImportState {
    readonly input: BinaryInput;
    readonly version: BinaryVersion;
    /** The size of the file in bytes. No list in the file can have more entries than this. */
    readonly byteLength: number;
    /** True when the file carries editor data, which is read and dropped. */
    readonly nonessential: boolean;
    boneCount: number;
    slotCount: number;
    ikCount: number;
    transformCount: number;
    pathCount: number;
    physicsCount: number;
    /** True when the file has a default skin with attachments. It is then the first skin. */
    hasDefaultSkin: boolean;
    skins: SkinDraft[];
    events: EventData[];
    /** In the order the file lists them, which is the order the official reader links them in. */
    linkedMeshes: LinkedMesh[];
    /** The geometry each linked mesh took from its parent. */
    geometry: Map<MeshAttachmentData, Geometry>;
}

const FIX = 'Export the skeleton again from the Spine editor.';

/** The error for a file whose data points nowhere or contradicts itself. */
export function invalid(message: string): MarrowError {
    return new MarrowError('invalid-data', message, { fix: FIX });
}

/**
 * Reads the length of a list. Every entry of a list takes at least one byte, so a length above
 * the file size means the file is damaged.
 */
export function readCount(state: ImportState, what: string): number {
    const count = state.input.readInt(true);

    if (count < 0 || count > state.byteLength) {
        throw invalid(`The file claims to hold ${count} ${what}, which does not fit its size.`);
    }

    return count;
}

/** Reads an index into a list of `count` entries. */
export function readIndex(state: ImportState, count: number, what: string): number {
    const index = state.input.readInt(true);

    if (index < 0 || index >= count) {
        throw invalid(`The file points at ${what} ${index}, but it has ${count} of them.`);
    }

    return index;
}

/** Checks a name the official reader requires. */
export function requireName(name: string | null, what: string): string {
    if (!name) throw invalid(`The file holds ${what} without a name.`);

    return name;
}

/** Checks a value that selects an entry of a fixed list, for example a blend mode. */
export function requireBelow(value: number, limit: number, what: string): number {
    if (value < 0 || value >= limit) throw invalid(`The file holds the unknown ${what} ${value}.`);

    return value;
}
