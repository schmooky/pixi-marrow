import type {
    AttachmentData,
    BoundingBoxAttachmentData,
    MeshAttachmentData,
    RegionAttachmentData,
    SequenceData,
    VertexData,
} from '../../model/attachments';
import type { BinaryInput } from '../shared/binary-input';
import {
    ATTACHMENT_TYPE,
    clipping,
    linkedMesh,
    mesh,
    path,
    readFloats,
    readMeshSize,
    readPoint,
    readRegionBox,
    readSequence,
    readVertices,
    rgba,
    skipEditorColor,
} from './attachment-parts';
import { type ImportState, invalid, readCount, readIndex } from './state';

/*
 * The 4.1 layout. Every field is stored, in a fixed order, after a name and a type byte.
 * A boolean in front of the vertices says whether they have weights, and one in front of a
 * sequence says whether there is one.
 */

const readOptionalSequence = (input: BinaryInput): SequenceData | null =>
    input.readBoolean() ? readSequence(input) : null;

const readGeometry = (state: ImportState, vertexCount: number): VertexData =>
    readVertices(state, vertexCount, state.input.readBoolean());

/** Reads a list of 16-bit integers with its length in front: triangles or edges. */
function readShorts(state: ImportState, what: string): Uint16Array {
    const values = new Uint16Array(readCount(state, what));

    for (let i = 0; i < values.length; i++) values[i] = state.input.readShort();

    return values;
}

function readRegion(state: ImportState, name: string): RegionAttachmentData {
    const { input } = state;
    const regionPath = input.readStringRef();
    const rotation = input.readFloat();
    const box = readRegionBox(input);
    const color = input.readInt32();
    const sequence = readOptionalSequence(input);

    return { type: 'region', name, path: regionPath || name, ...box, rotation, color: rgba(color), sequence };
}

function readBoundingBox(state: ImportState, name: string): BoundingBoxAttachmentData {
    const geometry = readGeometry(state, readCount(state, 'vertices'));

    skipEditorColor(state);

    return { type: 'boundingbox', name, ...geometry };
}

function readMesh(state: ImportState, name: string): MeshAttachmentData {
    const { input } = state;
    const meshPath = input.readStringRef();
    const color = input.readInt32();
    const vertexCount = readCount(state, 'vertices');
    const regionUVs = readFloats(input, vertexCount << 1);
    const triangles = readShorts(state, 'triangle indices');
    const geometry = readGeometry(state, vertexCount);
    const hullCount = input.readInt(true);
    const sequence = readOptionalSequence(input);

    // the edges, which only the editor draws
    if (state.nonessential) readShorts(state, 'mesh edges');
    const [width, height] = readMeshSize(state);

    return mesh({ name, path: meshPath, color, sequence, hullCount, geometry, regionUVs, triangles, width, height });
}

/** A linked mesh names the skin of its parent by name. No name means the default skin. */
function readLinkedMesh(state: ImportState, name: string, slot: number): MeshAttachmentData {
    const { input } = state;
    const meshPath = input.readStringRef();
    const color = input.readInt32();
    const skin = input.readStringRef();
    const parent = input.readStringRef();
    const inheritTimelines = input.readBoolean();
    const sequence = readOptionalSequence(input);
    const linked = linkedMesh(name, meshPath || name, color, sequence, readMeshSize(state));

    state.linkedMeshes.push({ mesh: linked, skin, slot, parent, inheritTimelines });

    return linked;
}

/** Reads one attachment of a 4.1 skin. `entryName` is the name the skin stores it under. */
export function readAttachment41(state: ImportState, slot: number, entryName: string): AttachmentData {
    const { input } = state;
    const name = input.readStringRef() || entryName;
    const type = input.readByte();

    switch (type) {
        case ATTACHMENT_TYPE.region:
            return readRegion(state, name);
        case ATTACHMENT_TYPE.boundingBox:
            return readBoundingBox(state, name);
        case ATTACHMENT_TYPE.mesh:
            return readMesh(state, name);
        case ATTACHMENT_TYPE.linkedMesh:
            return readLinkedMesh(state, name, slot);
        case ATTACHMENT_TYPE.path: {
            const closed = input.readBoolean();
            const constantSpeed = input.readBoolean();
            const geometry = readGeometry(state, readCount(state, 'vertices'));

            return path(state, name, closed, constantSpeed, geometry);
        }
        case ATTACHMENT_TYPE.point:
            return readPoint(state, name);
        case ATTACHMENT_TYPE.clipping: {
            const endSlot = readIndex(state, state.slotCount, 'slot');
            const geometry = readGeometry(state, readCount(state, 'vertices'));

            return clipping(state, name, endSlot, geometry);
        }
        default:
            throw invalid(`The attachment ${name} has the unknown type ${type}.`);
    }
}
