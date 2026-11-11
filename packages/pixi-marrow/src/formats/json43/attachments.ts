import type {
    AttachmentData,
    BoundingBoxAttachmentData,
    ClippingAttachmentData,
    MeshAttachmentData,
    PathAttachmentData,
    RegionAttachmentData,
    SequenceData,
    VertexData,
} from '../../model/attachments';
import { writeHexColor } from '../shared/color';
import { type ImportContext, invalid, requireList } from './context';
import type {
    JsonAttachment,
    JsonBoundingBox,
    JsonClipping,
    JsonMesh,
    JsonPath,
    JsonRegion,
    JsonSequence,
} from './schema';

/** A linked mesh that waits for every skin to be read, so its source can be found. */
export interface LinkedMesh {
    mesh: MeshAttachmentData;
    /** The index of the slot the skin stores the linked mesh under. */
    slot: number;
    /** The skin that holds the source mesh, or null for the default skin. */
    skin: string | null;
    /** The index of the slot that holds the source mesh. */
    sourceSlot: number;
    /** The name the skin stores the source mesh under. */
    source: string;
    /** True when the deform timelines of the source also move this mesh. */
    inheritTimelines: boolean;
}

function readColor(hex: string | undefined): Float64Array {
    const color = Float64Array.of(1, 1, 1, 1);

    if (hex) writeHexColor(hex, color, 0);

    return color;
}

function readSequence(map: JsonSequence | undefined): SequenceData | null {
    if (map == null) return null;

    return { count: map.count ?? 0, start: map.start ?? 1, digits: map.digits ?? 0, setupIndex: map.setup ?? 0 };
}

/**
 * Reads vertices in the encoding of the official `readVertices`.
 *
 * A list as long as `verticesLength` holds x, y per vertex. Any other list is weighted. It holds
 * per vertex a bone count, then a bone index, x, y and weight for each of those bones.
 */
function readVertices(
    values: readonly number[] | undefined,
    verticesLength: number,
    user: string,
    ctx: ImportContext,
): VertexData {
    const vertices = requireList(values, `The vertex list of ${user}`);

    if (verticesLength === vertices.length) {
        return { vertices: Float32Array.from(vertices), bones: null, worldVerticesLength: verticesLength };
    }
    const weights: number[] = [];
    const bones: number[] = [];
    const next = (index: number): number => {
        const value = vertices[index];

        if (typeof value !== 'number') throw invalid(`The vertex list of ${user} ends before its data does.`);

        return value;
    };

    for (let i = 0, n = vertices.length; i < n; ) {
        const boneCount = next(i++);

        bones.push(boneCount);
        for (const end = i + boneCount * 4; i < end; i += 4) {
            const bone = next(i);

            if (!(bone >= 0 && bone < ctx.boneCount)) {
                throw invalid(`${user} is weighted to the bone index ${bone}, which does not exist.`);
            }
            bones.push(bone);
            weights.push(next(i + 1), next(i + 2), next(i + 3));
        }
    }

    return { vertices: Float32Array.from(weights), bones: Int16Array.from(bones), worldVerticesLength: verticesLength };
}

function readRegion(map: JsonRegion, name: string, user: string): RegionAttachmentData {
    // the official parser multiplies both by the scale and stores a value that is not a number
    if (typeof map.width !== 'number' || typeof map.height !== 'number') {
        throw invalid(`${user} has no width or no height.`);
    }

    return {
        type: 'region',
        name,
        path: map.path ?? name,
        x: map.x ?? 0,
        y: map.y ?? 0,
        scaleX: map.scaleX ?? 1,
        scaleY: map.scaleY ?? 1,
        rotation: map.rotation ?? 0,
        width: map.width,
        height: map.height,
        color: readColor(map.color),
        sequence: readSequence(map.sequence),
    };
}

/**
 * Reads a mesh. A linked mesh keeps empty geometry and is queued in `linked`. Its links are set
 * once every skin is read.
 */
function readMesh(
    map: JsonMesh,
    name: string,
    slot: number,
    user: string,
    ctx: ImportContext,
    linked: LinkedMesh[],
): MeshAttachmentData {
    const mesh: MeshAttachmentData = {
        type: 'mesh',
        name,
        path: map.path ?? name,
        color: readColor(map.color),
        width: map.width ?? 0,
        height: map.height ?? 0,
        regionUVs: new Float32Array(0),
        triangles: new Uint16Array(0),
        hullLength: 0,
        vertices: new Float32Array(0),
        bones: null,
        worldVerticesLength: 0,
        parent: null,
        timelineAttachment: null,
        sequence: readSequence(map.sequence),
    };

    if (map.source) {
        linked.push({
            mesh,
            slot,
            skin: map.skin ?? null,
            sourceSlot: map.slot ? ctx.slots.require(map.slot, user) : slot,
            source: map.source,
            inheritTimelines: map.timelines ?? true,
        });

        return mesh;
    }
    const uvs = requireList(map.uvs, `The UV list of ${user}`);

    Object.assign(mesh, readVertices(map.vertices, uvs.length, user, ctx));
    mesh.regionUVs = Float32Array.from(uvs);
    mesh.triangles = Uint16Array.from(requireList(map.triangles, `The triangle list of ${user}`));
    mesh.hullLength = (map.hull ?? 0) * 2;

    return mesh;
}

function readBoundingBox(
    map: JsonBoundingBox,
    name: string,
    user: string,
    ctx: ImportContext,
): BoundingBoxAttachmentData {
    return { type: 'boundingbox', name, ...readVertices(map.vertices, (map.vertexCount ?? 0) << 1, user, ctx) };
}

function readPath(map: JsonPath, name: string, user: string, ctx: ImportContext): PathAttachmentData {
    const vertexCount = map.vertexCount ?? 0;
    const fileLengths = requireList(map.lengths, `The length list of ${user}`);
    // one length per curve. The official parser sizes the list by the vertex count first
    const lengths = new Float64Array(Math.max(Math.ceil(vertexCount / 3), fileLengths.length));

    lengths.set(fileLengths);

    return {
        type: 'path',
        name,
        closed: map.closed ?? false,
        constantSpeed: map.constantSpeed ?? true,
        lengths,
        ...readVertices(map.vertices, vertexCount << 1, user, ctx),
    };
}

function readClipping(map: JsonClipping, name: string, user: string, ctx: ImportContext): ClippingAttachmentData {
    return {
        type: 'clipping',
        name,
        endSlot: map.end ? ctx.slots.require(map.end, user) : -1,
        convex: map.convex ?? false,
        inverse: map.inverse ?? false,
        ...readVertices(map.vertices, (map.vertexCount ?? 0) << 1, user, ctx),
    };
}

/**
 * Reads one attachment of a skin.
 *
 * @param slot the index of the slot the skin stores the attachment under
 * @param key the name the skin stores the attachment under. The attachment's own name defaults to it.
 * @param linked receives the attachment when it is a linked mesh
 */
export function readAttachment(
    map: JsonAttachment,
    slot: number,
    key: string,
    ctx: ImportContext,
    linked: LinkedMesh[],
): AttachmentData {
    const type: string | undefined = map.type;
    const name = map.name ?? key;
    const user = `Attachment "${name}"`;

    switch (map.type) {
        case undefined:
        case 'region':
            return readRegion(map, name, user);
        case 'mesh':
        case 'linkedmesh':
            return readMesh(map, name, slot, user, ctx, linked);
        case 'boundingbox':
            return readBoundingBox(map, name, user, ctx);
        case 'path':
            return readPath(map, name, user, ctx);
        case 'point':
            return { type: 'point', name, x: map.x ?? 0, y: map.y ?? 0, rotation: map.rotation ?? 0 };
        case 'clipping':
            return readClipping(map, name, user, ctx);
        default:
            throw invalid(`${user} has the unknown type "${String(type)}".`);
    }
}
