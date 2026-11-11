import { MarrowError } from '../../base/errors';
import type {
    AttachmentData,
    ClippingAttachmentData,
    MeshAttachmentData,
    PathAttachmentData,
    RegionAttachmentData,
    SequenceData,
    VertexData,
} from '../../model/attachments';
import { writeHexColor } from '../shared/color';
import type { JsonAttachment, JsonSequence } from './schema';
import {
    invalid,
    type NameIndex,
    numberAt,
    pick,
    requireAtMost,
    requireList,
    requireName,
    requireNumber,
    resolve,
} from './values';

const ATTACHMENT_TYPES: readonly string[] = [
    'region',
    'boundingbox',
    'mesh',
    'linkedmesh',
    'path',
    'point',
    'clipping',
];

/** The most vertices a mesh can have. The model stores triangle indices as unsigned 16-bit integers. */
const MAX_MESH_VERTICES = 0x10000;

/** A linked mesh that waits for its parent. Parents are found after every skin is read. */
export interface PendingLink {
    mesh: MeshAttachmentData;
    /** The name of the skin that holds the parent, or null for the default skin. */
    skin: string | null;
    slot: number;
    /** The name the skin stores the parent mesh under. */
    parent: string;
    inheritTimeline: boolean;
    /** The linked mesh, as the start of an error sentence. */
    user: string;
}

/** Where an attachment sits, for the parts of the reader that need more than the attachment itself. */
export interface AttachmentSite {
    slot: number;
    slots: NameIndex;
    boneCount: number;
    links: PendingLink[];
    /** The attachment, as the start of an error sentence. */
    user: string;
}

function readColor(hex: string | undefined): Float32Array {
    const color = Float32Array.of(1, 1, 1, 1);

    if (hex) writeHexColor(hex, color, 0);

    return color;
}

function readSequence(map: JsonSequence | null | undefined): SequenceData | null {
    if (map === undefined || map === null) return null;

    return {
        count: pick(map.count, 0),
        start: pick(map.start, 1),
        digits: pick(map.digits, 0),
        setupIndex: pick(map.setup, 0),
    };
}

/**
 * Reads vertices in the official encoding. A list as long as `verticesLength` holds x, y per vertex.
 * Any other list holds weights: per vertex a bone count, then bone, x, y, weight for each bone.
 */
function readVertices(map: JsonAttachment, verticesLength: number, site: AttachmentSite): VertexData {
    const what = `The "vertices" list of ${site.user}`;
    const source = requireList(map.vertices, what);

    if (verticesLength === source.length) {
        return { vertices: Float32Array.from(source), bones: null, worldVerticesLength: verticesLength };
    }
    const weights: number[] = [];
    const bones: number[] = [];

    for (let i = 0; i < source.length; ) {
        const boneCount = numberAt(source, i++, what);

        bones.push(boneCount);
        for (const end = i + boneCount * 4; i < end; i += 4) {
            const bone = numberAt(source, i, what);

            if (!Number.isInteger(bone) || bone < 0 || bone >= site.boneCount) {
                throw invalid(`${site.user} has a weight for the bone ${bone}, which does not exist.`);
            }
            bones.push(bone);
            weights.push(numberAt(source, i + 1, what), numberAt(source, i + 2, what), numberAt(source, i + 3, what));
        }
    }

    return { vertices: Float32Array.from(weights), bones: Int16Array.from(bones), worldVerticesLength: verticesLength };
}

function readRegion(map: JsonAttachment, name: string, user: string): RegionAttachmentData {
    return {
        type: 'region',
        name,
        path: pick(map.path, name),
        x: pick(map.x, 0),
        y: pick(map.y, 0),
        scaleX: pick(map.scaleX, 1),
        scaleY: pick(map.scaleY, 1),
        rotation: pick(map.rotation, 0),
        // the official parser has no default here and would store a size that is not a number
        width: requireNumber(map.width, `The width of ${user}`),
        height: requireNumber(map.height, `The height of ${user}`),
        color: readColor(map.color),
        sequence: readSequence(map.sequence),
    };
}

/** Reads a mesh. A mesh with a parent is a linked mesh: it keeps empty geometry and is queued for linking. */
function readMesh(map: JsonAttachment, name: string, site: AttachmentSite): MeshAttachmentData {
    const mesh: MeshAttachmentData = {
        type: 'mesh',
        name,
        path: pick(map.path, name),
        color: readColor(map.color),
        width: pick(map.width, 0),
        height: pick(map.height, 0),
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

    if (map.parent) {
        site.links.push({
            mesh,
            skin: pick<string | null>(map.skin, null),
            slot: site.slot,
            parent: map.parent,
            inheritTimeline: Boolean(pick(map.timelines, true)),
            user: site.user,
        });

        return mesh;
    }
    const uvs = requireList(map.uvs, `The "uvs" list of ${site.user}`);

    requireAtMost(uvs.length / 2, MAX_MESH_VERTICES, `The number of vertices of ${site.user}`);
    Object.assign(mesh, readVertices(map, uvs.length, site));
    mesh.regionUVs = Float32Array.from(uvs);
    mesh.triangles = Uint16Array.from(requireList(map.triangles, `The "triangles" list of ${site.user}`));
    mesh.hullLength = pick(map.hull, 0) * 2;

    return mesh;
}

function readPath(map: JsonAttachment, name: string, site: AttachmentSite): PathAttachmentData {
    const { user } = site;
    const vertexCount = requireNumber(map.vertexCount, `The vertex count of ${user}`);
    const source = requireList(map.lengths, `The "lengths" list of ${user}`);

    if (!Number.isInteger(vertexCount / 3) || vertexCount < 0) {
        throw invalid(`${user} has ${vertexCount} vertices. A path has three vertices per point.`);
    }
    // the official parser makes one length per curve, and the list grows when the file holds more
    const lengths = new Float32Array(Math.max(vertexCount / 3, source.length));

    lengths.set(source);

    return {
        type: 'path',
        name,
        closed: pick(map.closed, false),
        constantSpeed: pick(map.constantSpeed, true),
        ...readVertices(map, vertexCount << 1, site),
        lengths,
    };
}

function readClipping(map: JsonAttachment, name: string, site: AttachmentSite): ClippingAttachmentData {
    return {
        type: 'clipping',
        name,
        endSlot: map.end ? resolve(site.slots, map.end, 'slot', site.user) : -1,
        convex: false,
        inverse: false,
        ...readVertices(map, pick(map.vertexCount, 0) << 1, site),
    };
}

/**
 * Reads one attachment of a skin. Colors of attachments that are never drawn and mesh edges are
 * editor data and are skipped.
 *
 * @param entryName the name the skin stores the attachment under. The attachment's own name
 * defaults to it.
 */
export function readAttachment(map: JsonAttachment, entryName: string, site: AttachmentSite): AttachmentData {
    const name = requireName(pick(map.name, entryName), site.user);
    const type = pick(map.type, 'region');

    switch (type) {
        case 'region':
            return readRegion(map, name, site.user);
        case 'boundingbox':
            return { type: 'boundingbox', name, ...readVertices(map, pick(map.vertexCount, 0) << 1, site) };
        case 'mesh':
        case 'linkedmesh':
            return readMesh(map, name, site);
        case 'path':
            return readPath(map, name, site);
        case 'point':
            return { type: 'point', name, x: pick(map.x, 0), y: pick(map.y, 0), rotation: pick(map.rotation, 0) };
        case 'clipping':
            return readClipping(map, name, site);
        default:
            throw new MarrowError('invalid-data', `${site.user} has the unknown type "${String(type)}".`, {
                fix: 'Export the skeleton again from Spine 4.1 or 4.2.',
                validNames: ATTACHMENT_TYPES,
            });
    }
}
