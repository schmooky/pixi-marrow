import type {
    AttachmentData,
    BoundingBoxAttachmentData,
    MeshAttachmentData,
    RegionAttachmentData,
} from '../../model/attachments';
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
    WHITE,
} from './attachment-parts';
import { type ImportState, invalid, readCount, readIndex } from './state';

/*
 * The 4.2 layout. One flag byte holds the type in its low three bits. Bit 8 says the attachment
 * has a name of its own. The bits from 16 up mean something different for each type.
 */

function readRegion(state: ImportState, flags: number, name: string): RegionAttachmentData {
    const { input } = state;
    const regionPath = (flags & 16) !== 0 ? input.readStringRef() : null;
    const color = (flags & 32) !== 0 ? input.readInt32() : WHITE;
    const sequence = (flags & 64) !== 0 ? readSequence(input) : null;
    const rotation = (flags & 128) !== 0 ? input.readFloat() : 0;
    const box = readRegionBox(input);

    return { type: 'region', name, path: regionPath || name, ...box, rotation, color: rgba(color), sequence };
}

function readBoundingBox(state: ImportState, flags: number, name: string): BoundingBoxAttachmentData {
    const geometry = readVertices(state, readCount(state, 'vertices'), (flags & 16) !== 0);

    skipEditorColor(state);

    return { type: 'boundingbox', name, ...geometry };
}

/** The triangle count is not stored. It follows from the vertex count and the hull size. */
function readMesh(state: ImportState, flags: number, name: string): MeshAttachmentData {
    const { input } = state;
    const meshPath = (flags & 16) !== 0 ? input.readStringRef() : name;
    const color = (flags & 32) !== 0 ? input.readInt32() : WHITE;
    const sequence = (flags & 64) !== 0 ? readSequence(input) : null;
    const hullCount = input.readInt(true);
    const geometry = readVertices(state, readCount(state, 'vertices'), (flags & 128) !== 0);
    const regionUVs = readFloats(input, geometry.worldVerticesLength);
    const triangleCount = (geometry.worldVerticesLength - hullCount - 2) * 3;

    if (triangleCount < 0) throw invalid(`The mesh ${name} has a hull that is larger than the mesh.`);
    const triangles = new Uint16Array(triangleCount);

    for (let i = 0; i < triangleCount; i++) triangles[i] = input.readInt(true);
    if (state.nonessential) {
        // the edges, which only the editor draws
        for (let i = 0, n = readCount(state, 'mesh edges'); i < n; i++) input.readInt(true);
    }
    const [width, height] = readMeshSize(state);

    return mesh({ name, path: meshPath, color, sequence, hullCount, geometry, regionUVs, triangles, width, height });
}

/** A linked mesh names the skin of its parent by index. */
function readLinkedMesh(state: ImportState, flags: number, name: string, slot: number): MeshAttachmentData {
    const { input } = state;
    const meshPath = (flags & 16) !== 0 ? input.readStringRef() : name;

    if (meshPath === null) throw invalid(`The linked mesh ${name} has no path.`);
    const color = (flags & 32) !== 0 ? input.readInt32() : WHITE;
    const sequence = (flags & 64) !== 0 ? readSequence(input) : null;
    const inheritTimelines = (flags & 128) !== 0;
    const skin = input.readInt(true);
    const parent = input.readStringRef();
    const linked = linkedMesh(name, meshPath, color, sequence, readMeshSize(state));

    state.linkedMeshes.push({ mesh: linked, skin, slot, parent, inheritTimelines });

    return linked;
}

/** Reads one attachment of a 4.2 skin. `entryName` is the name the skin stores it under. */
export function readAttachment42(state: ImportState, slot: number, entryName: string): AttachmentData {
    const { input } = state;
    const flags = input.readByte();
    const name = (flags & 8) !== 0 ? input.readStringRef() : entryName;

    if (!name) throw invalid('The file holds an attachment without a name.');
    switch (flags & 7) {
        case ATTACHMENT_TYPE.region:
            return readRegion(state, flags, name);
        case ATTACHMENT_TYPE.boundingBox:
            return readBoundingBox(state, flags, name);
        case ATTACHMENT_TYPE.mesh:
            return readMesh(state, flags, name);
        case ATTACHMENT_TYPE.linkedMesh:
            return readLinkedMesh(state, flags, name, slot);
        case ATTACHMENT_TYPE.path: {
            const geometry = readVertices(state, readCount(state, 'vertices'), (flags & 64) !== 0);

            return path(state, name, (flags & 16) !== 0, (flags & 32) !== 0, geometry);
        }
        case ATTACHMENT_TYPE.point:
            return readPoint(state, name);
        case ATTACHMENT_TYPE.clipping: {
            const endSlot = readIndex(state, state.slotCount, 'slot');
            const geometry = readVertices(state, readCount(state, 'vertices'), (flags & 16) !== 0);

            return clipping(state, name, endSlot, geometry);
        }
        default:
            throw invalid(`The attachment ${name} has the unknown type ${flags & 7}.`);
    }
}
