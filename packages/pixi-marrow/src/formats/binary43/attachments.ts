import type {
    AttachmentData,
    BoundingBoxAttachmentData,
    ClippingAttachmentData,
    MeshAttachmentData,
    PathAttachmentData,
    PointAttachmentData,
    RegionAttachmentData,
    SequenceData,
    VertexData,
} from '../../model/attachments';
import type { BinaryInput } from '../shared/binary-input';
import { writeRgba8888 } from '../shared/color';
import { type ImportState, invalid, readIndex } from './reader';

const TYPE_REGION = 0;
const TYPE_BOUNDING_BOX = 1;
const TYPE_MESH = 2;
const TYPE_LINKED_MESH = 3;
const TYPE_PATH = 4;
const TYPE_POINT = 5;
const TYPE_CLIPPING = 6;
const WHITE = 0xffffffff;

/** Reads `count` floats. A count with a fraction rounds up, as the official read loop does. */
function readFloats(input: BinaryInput, count: number): Float32Array {
    const out = new Float32Array(Math.max(0, Math.ceil(count)));

    for (let i = 0; i < out.length; i++) out[i] = input.readFloat();

    return out;
}

/** Reads the color of a drawn attachment. Without the flag the color is white. */
function readColor(input: BinaryInput, stored: boolean): Float32Array {
    const color = new Float32Array(4);

    writeRgba8888(stored ? input.readInt32() : WHITE, color, 0);

    return color;
}

function readSequence(input: BinaryInput, stored: boolean): SequenceData | null {
    if (!stored) return null;
    const count = input.readInt(true);
    const start = input.readInt(true);
    const digits = input.readInt(true);
    const setupIndex = input.readInt(true);

    return { count, start, digits, setupIndex };
}

/** Reads vertices in the official encoding. See `VertexData` for the layout. */
function readVertices(state: ImportState, weighted: boolean): VertexData {
    const input = state.input;
    const worldVerticesLength = input.readInt(true) << 1;

    if (!weighted) return { vertices: readFloats(input, worldVerticesLength), bones: null, worldVerticesLength };
    const bones: number[] = [];
    const weights: number[] = [];

    for (const n = input.readInt(true); bones.length < n; ) {
        const boneCount = input.readInt(true);

        bones.push(boneCount);
        for (let i = 0; i < boneCount; i++) {
            bones.push(readIndex(input, state.boneCount, 'bone'));
            weights.push(input.readFloat(), input.readFloat(), input.readFloat());
        }
    }

    return { vertices: new Float32Array(weights), bones: new Int16Array(bones), worldVerticesLength };
}

/** Skips the color that editor data adds to an attachment that is never drawn. */
function skipColor(state: ImportState): void {
    if (state.nonessential) state.input.readInt32();
}

function readRegion(state: ImportState, flags: number, name: string): RegionAttachmentData {
    const input = state.input;
    const path = (flags & 16) !== 0 ? input.readStringRef() : null;
    const color = readColor(input, (flags & 32) !== 0);
    const sequence = readSequence(input, (flags & 64) !== 0);
    const rotation = (flags & 128) !== 0 ? input.readFloat() : 0;
    const x = input.readFloat();
    const y = input.readFloat();
    const scaleX = input.readFloat();
    const scaleY = input.readFloat();
    const width = input.readFloat();
    const height = input.readFloat();

    return { type: 'region', name, path: path ?? name, x, y, scaleX, scaleY, rotation, width, height, color, sequence };
}

function readBoundingBox(state: ImportState, flags: number, name: string): BoundingBoxAttachmentData {
    const vertices = readVertices(state, (flags & 16) !== 0);

    skipColor(state);

    return { type: 'boundingbox', name, ...vertices };
}

/** Reads the other slots that the deform and sequence timelines of a mesh also apply to. */
function readTimelineSlots(state: ImportState): Int16Array {
    const slots = new Int16Array(state.input.readInt(true));

    for (let i = 0; i < slots.length; i++) slots[i] = readIndex(state.input, state.slotCount, 'slot');

    return slots;
}

/** Skips the edges of a mesh and reads its image size. Without editor data the file has neither, and the size is 0. */
function readMeshEditorData(state: ImportState): { width: number; height: number } {
    const input = state.input;

    if (!state.nonessential) return { width: 0, height: 0 };
    for (let i = 0, n = input.readInt(true); i < n; i++) input.readInt(true);
    const width = input.readFloat();
    const height = input.readFloat();

    return { width, height };
}

function readMesh(state: ImportState, flags: number, name: string): MeshAttachmentData {
    const input = state.input;
    const path = (flags & 16) !== 0 ? input.readStringRef() : name;
    const color = readColor(input, (flags & 32) !== 0);
    const sequence = readSequence(input, (flags & 64) !== 0);
    const hull = input.readInt(true);
    const vertices = readVertices(state, (flags & 128) !== 0);
    const regionUVs = readFloats(input, vertices.worldVerticesLength);
    const triangles = new Uint16Array(Math.max(0, (vertices.worldVerticesLength - hull - 2) * 3));

    for (let i = 0; i < triangles.length; i++) triangles[i] = input.readInt(true);
    const timelineSlots = readTimelineSlots(state);
    const { width, height } = readMeshEditorData(state);
    const mesh: MeshAttachmentData = {
        type: 'mesh',
        name,
        path: path ?? name,
        color,
        width,
        height,
        regionUVs,
        triangles,
        hullLength: hull << 1,
        parent: null,
        timelineAttachment: null,
        sequence,
        ...vertices,
    };

    // the model leaves the list out when the mesh has none
    if (timelineSlots.length > 0) mesh.timelineSlots = timelineSlots;

    return mesh;
}

/** Reads a linked mesh. Its parent is looked up after every skin is read, see `linkMeshes`. */
function readLinkedMesh(state: ImportState, flags: number, name: string): MeshAttachmentData {
    const input = state.input;
    const path = (flags & 16) !== 0 ? input.readStringRef() : name;

    if (path === null) throw invalid(`Linked mesh "${name}" has no path.`);
    const color = readColor(input, (flags & 32) !== 0);
    const sequence = readSequence(input, (flags & 64) !== 0);
    const slot = input.readInt(true);
    const skin = input.readInt(true);
    const parentName = input.readStringRef();
    let width = 0;
    let height = 0;

    if (state.nonessential) {
        width = input.readFloat();
        height = input.readFloat();
    }
    const mesh: MeshAttachmentData = {
        type: 'mesh',
        name,
        path,
        color,
        width,
        height,
        regionUVs: new Float32Array(0),
        triangles: new Uint16Array(0),
        hullLength: 0,
        parent: null,
        timelineAttachment: null,
        sequence,
        vertices: new Float32Array(0),
        bones: null,
        worldVerticesLength: 0,
    };

    state.linked.push({ mesh, skin, slot, name: parentName, inheritTimelines: (flags & 128) !== 0 });

    return mesh;
}

function readPath(state: ImportState, flags: number, name: string): PathAttachmentData {
    const vertices = readVertices(state, (flags & 64) !== 0);
    const lengths = readFloats(state.input, vertices.worldVerticesLength / 6);

    skipColor(state);

    return {
        type: 'path',
        name,
        closed: (flags & 16) !== 0,
        constantSpeed: (flags & 32) !== 0,
        lengths,
        ...vertices,
    };
}

function readPoint(state: ImportState, name: string): PointAttachmentData {
    const rotation = state.input.readFloat();
    const x = state.input.readFloat();
    const y = state.input.readFloat();

    skipColor(state);

    return { type: 'point', name, x, y, rotation };
}

function readClipping(state: ImportState, flags: number, name: string): ClippingAttachmentData {
    const end = state.input.readInt(true);
    const vertices = readVertices(state, (flags & 16) !== 0);

    skipColor(state);
    if (end < -1 || end >= state.slotCount) {
        throw invalid(`Clipping "${name}" ends at slot ${end}, but the skeleton has ${state.slotCount}.`);
    }

    return {
        type: 'clipping',
        name,
        endSlot: end,
        convex: (flags & 32) !== 0,
        inverse: (flags & 64) !== 0,
        ...vertices,
    };
}

/**
 * Reads one attachment of a skin.
 *
 * @param placeholder the name the skin stores the attachment under. It is also the attachment's
 * own name, unless the file stores another one.
 */
export function readAttachment(state: ImportState, placeholder: string): AttachmentData {
    const flags = state.input.readByte();
    const name = (flags & 8) !== 0 ? state.input.readStringRef() : placeholder;

    if (name === null) throw invalid(`The attachment stored as "${placeholder}" has no name.`);
    switch (flags & 7) {
        case TYPE_REGION:
            return readRegion(state, flags, name);
        case TYPE_BOUNDING_BOX:
            return readBoundingBox(state, flags, name);
        case TYPE_MESH:
            return readMesh(state, flags, name);
        case TYPE_LINKED_MESH:
            return readLinkedMesh(state, flags, name);
        case TYPE_PATH:
            return readPath(state, flags, name);
        case TYPE_POINT:
            return readPoint(state, name);
        case TYPE_CLIPPING:
            return readClipping(state, flags, name);
        default:
            throw invalid(`Attachment "${name}" has type ${flags & 7}, which Spine 4.3 does not have.`);
    }
}
