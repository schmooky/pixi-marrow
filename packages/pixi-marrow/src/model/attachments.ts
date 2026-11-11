/** Points at an attachment of a skin. Skin attachments have no global index. */
export interface AttachmentRef {
    /** The skin index. */
    skin: number;
    /** The slot index. */
    slot: number;
    /** The name the skin stores the attachment under. */
    name: string;
}

/**
 * Vertices that bones can move, in the encoding the official runtime uses.
 *
 * Without weights, `bones` is null and `vertices` holds x, y per vertex.
 * With weights, `bones` holds per vertex a count followed by that many bone indices,
 * and `vertices` holds x, y, weight for every one of those bones.
 */
export interface VertexData {
    vertices: Float32Array;
    bones: Int16Array | null;
    /** Twice the vertex count: the length of the world position array. */
    worldVerticesLength: number;
}

/** A run of numbered texture regions an attachment can step through. */
export interface SequenceData {
    /** How many regions the sequence has. */
    count: number;
    /** The number of the first region. */
    start: number;
    /** The minimum digits of the number in a region name, padded with zeros. */
    digits: number;
    /** The index of the region shown in the setup pose. */
    setupIndex: number;
}

/** A textured quad. */
export interface RegionAttachmentData {
    type: 'region';
    name: string;
    /** The texture region name in the atlas. */
    path: string;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    width: number;
    height: number;
    /** r, g, b, a. */
    color: Float64Array;
    sequence: SequenceData | null;
}

/**
 * A textured mesh.
 *
 * A linked mesh shares the geometry of another mesh. It has `parent` set, and its own
 * `vertices`, `regionUVs` and `triangles` are empty, `bones` is null and both lengths are 0.
 */
export interface MeshAttachmentData extends VertexData {
    type: 'mesh';
    name: string;
    /** The texture region name in the atlas. */
    path: string;
    /** r, g, b, a. */
    color: Float64Array;
    /** The size of the image in the editor. 0 when the file does not store it. */
    width: number;
    height: number;
    /** u, v per vertex, relative to the texture region. */
    regionUVs: Float32Array;
    /** Three vertex indices per triangle. */
    triangles: Uint16Array;
    /** Twice the number of vertices on the hull. */
    hullLength: number;
    /** The mesh this one takes its geometry from, or null. */
    parent: AttachmentRef | null;
    /** The attachment whose deform timelines move this mesh, or null when it is the mesh itself. */
    timelineAttachment: AttachmentRef | null;
    /**
     * 4.3 only. Indices of other slots that the deform and sequence timelines of this mesh also
     * apply to. Left out when there are none.
     */
    timelineSlots?: Int16Array;
    sequence: SequenceData | null;
}

/** A polygon for hit tests. */
export interface BoundingBoxAttachmentData extends VertexData {
    type: 'boundingbox';
    name: string;
}

/** A path that path constraints place bones along. */
export interface PathAttachmentData extends VertexData {
    type: 'path';
    name: string;
    closed: boolean;
    constantSpeed: boolean;
    /** The length up to the end of each curve. */
    lengths: Float64Array;
}

/** A point and a rotation that follow a bone. */
export interface PointAttachmentData {
    type: 'point';
    name: string;
    x: number;
    y: number;
    rotation: number;
}

/** A polygon that clips the slots after it, up to `endSlot`. */
export interface ClippingAttachmentData extends VertexData {
    type: 'clipping';
    name: string;
    /** The index of the last slot that is clipped, or -1 when clipping runs to the end. */
    endSlot: number;
    /** 4.3 only. False for older files. */
    convex: boolean;
    /** 4.3 only. False for older files. */
    inverse: boolean;
}

/** Any attachment. `type` tells which. */
export type AttachmentData =
    | RegionAttachmentData
    | MeshAttachmentData
    | BoundingBoxAttachmentData
    | PathAttachmentData
    | PointAttachmentData
    | ClippingAttachmentData;
