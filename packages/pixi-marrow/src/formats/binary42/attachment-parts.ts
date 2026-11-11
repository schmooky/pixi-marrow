import type {
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
import { type ImportState, invalid, readCount, readIndex } from './state';

/** The attachment type numbers. Both versions use the same ones. */
export const ATTACHMENT_TYPE = {
    region: 0,
    boundingBox: 1,
    mesh: 2,
    linkedMesh: 3,
    path: 4,
    point: 5,
    clipping: 6,
} as const;

/** The color the 4.2 format leaves out of the file: opaque white. */
export const WHITE = 0xffffffff;

/** Turns a 32-bit RGBA value into r, g, b, a floats. */
export function rgba(value: number): Float32Array {
    const color = new Float32Array(4);

    writeRgba8888(value, color, 0);

    return color;
}

/** Reads `count` floats. */
export function readFloats(input: BinaryInput, count: number): Float32Array {
    const values = new Float32Array(count);

    for (let i = 0; i < count; i++) values[i] = input.readFloat();

    return values;
}

/** Reads the four numbers of a sequence. The caller checks first whether the file stores one. */
export function readSequence(input: BinaryInput): SequenceData {
    const count = input.readInt(true);
    const start = input.readInt(true);
    const digits = input.readInt(true);
    const setupIndex = input.readInt(true);

    return { count, start, digits, setupIndex };
}

/**
 * Reads the vertices of an attachment in the official encoding. With weights, each vertex lists
 * its bones, and every bone adds x, y and a weight.
 */
export function readVertices(state: ImportState, vertexCount: number, weighted: boolean): VertexData {
    const { input } = state;
    const worldVerticesLength = vertexCount << 1;

    if (!weighted) return { vertices: readFloats(input, worldVerticesLength), bones: null, worldVerticesLength };
    const weights: number[] = [];
    const bones: number[] = [];

    for (let i = 0; i < vertexCount; i++) {
        const boneCount = readCount(state, 'vertex weights');

        bones.push(boneCount);
        for (let ii = 0; ii < boneCount; ii++) {
            bones.push(readIndex(state, state.boneCount, 'bone'));
            weights.push(input.readFloat(), input.readFloat(), input.readFloat());
        }
    }

    return { vertices: Float32Array.from(weights), bones: Int16Array.from(bones), worldVerticesLength };
}

/** Skips the editor color of an attachment that is never drawn. Files without editor data have none. */
export function skipEditorColor(state: ImportState): void {
    if (state.nonessential) state.input.readInt32();
}

/** The placement of a region: where it sits on its bone and how large it is. */
export type RegionBox = Pick<RegionAttachmentData, 'x' | 'y' | 'scaleX' | 'scaleY' | 'width' | 'height'>;

/** Reads x, y, scaleX, scaleY, width and height of a region. Both versions store them in this order. */
export function readRegionBox(input: BinaryInput): RegionBox {
    const x = input.readFloat();
    const y = input.readFloat();
    const scaleX = input.readFloat();
    const scaleY = input.readFloat();
    const width = input.readFloat();
    const height = input.readFloat();

    return { x, y, scaleX, scaleY, width, height };
}

/** The fields of a mesh with its own geometry, as either version reads them. */
export interface MeshParts {
    name: string;
    path: string | null;
    color: number;
    sequence: SequenceData | null;
    /** The number of hull vertices, as the file stores it. */
    hullCount: number;
    geometry: VertexData;
    regionUVs: Float32Array;
    triangles: Uint16Array;
    width: number;
    height: number;
}

/** Builds a mesh attachment. A mesh without a path uses its name. */
export function mesh(parts: MeshParts): MeshAttachmentData {
    return {
        type: 'mesh',
        name: parts.name,
        path: parts.path || parts.name,
        color: rgba(parts.color),
        width: parts.width,
        height: parts.height,
        regionUVs: parts.regionUVs,
        triangles: parts.triangles,
        hullLength: parts.hullCount << 1,
        ...parts.geometry,
        parent: null,
        timelineAttachment: null,
        sequence: parts.sequence,
    };
}

/** Builds a linked mesh. Its geometry stays empty, and `parent` is set once every skin is read. */
export function linkedMesh(
    name: string,
    path: string,
    color: number,
    sequence: SequenceData | null,
    size: readonly [number, number],
): MeshAttachmentData {
    return {
        type: 'mesh',
        name,
        path,
        color: rgba(color),
        width: size[0],
        height: size[1],
        regionUVs: new Float32Array(0),
        triangles: new Uint16Array(0),
        hullLength: 0,
        vertices: new Float32Array(0),
        bones: null,
        worldVerticesLength: 0,
        parent: null,
        timelineAttachment: null,
        sequence,
    };
}

/** Reads the editor size of a mesh. Files without editor data store none, and the size is 0. */
export function readMeshSize(state: ImportState): [number, number] {
    if (!state.nonessential) return [0, 0];
    const width = state.input.readFloat();
    const height = state.input.readFloat();

    return [width, height];
}

/** Builds a path attachment and reads its curve lengths, one per three vertices. */
export function path(
    state: ImportState,
    name: string,
    closed: boolean,
    constantSpeed: boolean,
    geometry: VertexData,
): PathAttachmentData {
    const lengthCount = geometry.worldVerticesLength / 6;

    if (!Number.isInteger(lengthCount)) {
        throw invalid(`The path ${name} has a vertex count that is not a multiple of 3.`);
    }
    const lengths = readFloats(state.input, lengthCount);

    skipEditorColor(state);

    return { type: 'path', name, closed, constantSpeed, lengths, ...geometry };
}

/** Reads a point attachment. Both versions store it the same way. */
export function readPoint(state: ImportState, name: string): PointAttachmentData {
    const { input } = state;
    const rotation = input.readFloat();
    const x = input.readFloat();
    const y = input.readFloat();

    skipEditorColor(state);

    return { type: 'point', name, x, y, rotation };
}

/** Builds a clipping attachment and skips its editor color. */
export function clipping(
    state: ImportState,
    name: string,
    endSlot: number,
    geometry: VertexData,
): ClippingAttachmentData {
    skipEditorColor(state);

    return { type: 'clipping', name, endSlot, convex: false, inverse: false, ...geometry };
}
