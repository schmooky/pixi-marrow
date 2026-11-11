import type { SpineVersion } from '../../src/base/version';
import type { RigFiles } from '../parity/official';

/*
 * A small rig for what the official example exports do not have: every rotation of an atlas
 * region with and without trimming, shown by region attachments and by meshes. It also has
 * sequences with a setup index, linked meshes on other regions, weights and a bounding box.
 * The official JSON readers of 4.1, 4.2 and 4.3 all read it.
 */

/** The rotations a region can have inside its page. */
export const DEGREES: readonly number[] = [0, 90, 180, 270];

/** The name of the test region for a rotation, trimmed or not. */
export const regionName = (degrees: number, trimmed: boolean): string => `${trimmed ? 'trim' : 'full'}${degrees}`;

/** Every test region: 4 rotations, each whole and trimmed. */
const REGION_NAMES: readonly string[] = DEGREES.flatMap((degrees) => [
    regionName(degrees, false),
    regionName(degrees, true),
]);

/** Two pages of different sizes. A trimmed region is 36x22 pixels cut from a 44x32 image. */
export const ATLAS_TEXT: string = [
    'page-a.png',
    'size: 256, 128',
    'filter: Linear, Linear',
    ...DEGREES.flatMap((degrees, i) => [
        regionName(degrees, false),
        `bounds: ${2 + i * 50}, 2, 40, 30`,
        ...(degrees === 0 ? [] : [`rotate: ${degrees}`]),
        regionName(degrees, true),
        `bounds: ${2 + i * 50}, 60, 36, 22`,
        'offsets: 3, 5, 44, 32',
        ...(degrees === 0 ? [] : [`rotate: ${degrees}`]),
    ]),
    '',
    'page-b.png',
    'size: 64, 512',
    'filter: Nearest, Nearest',
    'flame_08',
    'bounds: 1, 1, 20, 24',
    'flame_09',
    'bounds: 1, 30, 18, 22',
    'offsets: 1, 2, 20, 24',
    'rotate: 90',
    'flame_10',
    'bounds: 1, 60, 16, 20',
    'offsets: 2, 1, 20, 24',
    'rotate: 270',
    '',
].join('\n');

/** The sequence of the flame attachments: flame_08, flame_09 and flame_10, with the second one in the setup pose. */
const FLAME_SEQUENCE = { count: 3, start: 8, digits: 2, setup: 1 };

/** A quad with a vertex inside. The UVs are exact in 32 bits, so JSON and model agree on them. */
const QUAD_UVS = [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.25];
const QUAD_TRIANGLES = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
const QUAD_VERTICES = [-22.5, -16.25, 21.75, -15.5, 22.25, 16.5, -21.5, 15.75, 1.5, -6.25];

/** The same 5 vertices with weights: a bone count per vertex, then bone, x, y and weight for each bone. */
// biome-ignore format: one vertex per line
const WEIGHTED_VERTICES = [
    1, 1, -22.5, -16.25, 1,
    2, 1, 21.75, -15.5, 0.75, 2, -8.5, 3.25, 0.25,
    3, 1, 22.25, 16.5, 0.5, 2, -7.75, 12.5, 0.3, 3, 4.5, -9.25, 0.2,
    2, 2, -30.5, 11.75, 0.6, 3, 14.25, 6.5, 0.4,
    1, 3, 1.5, -6.25, 1,
];

const mesh = (path: string, extra: object = {}): object => ({
    type: 'mesh',
    path,
    uvs: QUAD_UVS,
    triangles: QUAD_TRIANGLES,
    vertices: QUAD_VERTICES,
    hull: 4,
    ...extra,
});

/** One slot per test region with a region attachment, and one with a mesh. Each has its own placement. */
function regionSlots(): { slots: object[]; attachments: Record<string, object> } {
    const bones = ['arm', 'hand', 'tail'];
    const slots: object[] = [];
    const attachments: Record<string, object> = {};

    REGION_NAMES.forEach((name, i) => {
        const bone = bones[i % bones.length];

        slots.push({ name: `quad-${name}`, bone, attachment: name });
        slots.push({ name: `mesh-${name}`, bone, attachment: name });
        attachments[`quad-${name}`] = {
            [name]: {
                x: 3.5 * i - 7,
                y: 11 - 2.25 * i,
                rotation: [0, 90, -37.5, 180, 12.125, 270, -90, 333.3][i],
                scaleX: 1 + 0.25 * i,
                scaleY: i % 3 === 0 ? -1.5 : 0.75,
                width: 44 + i,
                height: 32 - i,
            },
        };
        attachments[`mesh-${name}`] = { [name]: mesh(name) };
    });

    return { slots, attachments };
}

/**
 * A linked mesh: it takes the vertices of another mesh and shows its own region. 4.1 and 4.2 files
 * name the other mesh `parent`, 4.3 files name it `source`.
 */
const linked = (version: SpineVersion, source: string, path: string, extra: object = {}): object => ({
    type: 'linkedmesh',
    [version === '4.3' ? 'source' : 'parent']: source,
    path,
    ...extra,
});

/** The attachments of the default skin that are not one per test region. */
function otherAttachments(version: SpineVersion): Record<string, object> {
    const flame = { path: 'flame_', sequence: FLAME_SEQUENCE };
    // only a 4.3 file can link to a mesh of another slot
    const crossSlot = linked(version, 'source', regionName(270, false), { slot: 'linked' });

    return {
        weighted: {
            weighted: mesh(regionName(90, true), { vertices: WEIGHTED_VERTICES }),
            'weighted-linked': linked(version, 'weighted', regionName(180, false)),
            ...(version === '4.3' ? { 'cross-slot': crossSlot } : {}),
        },
        linked: {
            source: mesh(regionName(0, false)),
            'linked-270': linked(version, 'source', regionName(270, true)),
            // a linked mesh whose source is itself a linked mesh
            'linked-chain': linked(version, 'linked-270', regionName(90, false)),
        },
        flame: { 'flame-quad': { ...flame, x: 4, y: -2, rotation: 15, width: 20, height: 24 } },
        'flame-mesh': { 'flame-mesh': mesh('flame_', { sequence: FLAME_SEQUENCE }) },
        box: {
            box: { type: 'boundingbox', vertexCount: 4, vertices: [-10.5, -8, 12, -7.25, 11.5, 9, -9.75, 8.5] },
            'box-weighted': { type: 'boundingbox', vertexCount: 5, vertices: WEIGHTED_VERTICES },
        },
        clip: { clip: { type: 'clipping', end: 'clip', vertexCount: 3, vertices: [-40, -30, 45.5, -28, 2.25, 50] } },
        path: {
            path: {
                type: 'path',
                lengths: [60, 120],
                vertexCount: 6,
                vertices: [-30, 0, -20, 10, -10, 20, 10, 20, 20, 10, 30, 0],
            },
        },
    };
}

/** Deforms, attachment changes and sequence keys. Linked meshes take the deform of their source. */
function animations(version: SpineVersion): object {
    const hold = (time: number, index: number): object => ({ time, mode: 'hold', index });
    const weightedKeys = [{ time: 0.5, name: 'weighted-linked' }];

    if (version === '4.3') weightedKeys.push({ time: 0.8, name: 'cross-slot' });

    return {
        deform: {
            bones: {
                arm: { rotate: [{ value: 0 }, { time: 1, value: 80 }] },
                hand: {
                    translate: [
                        { x: 0, y: 0 },
                        { time: 1, x: 12.5, y: -7.5 },
                    ],
                },
            },
            slots: {
                linked: {
                    attachment: [
                        { time: 0.3, name: 'linked-270' },
                        { time: 0.7, name: 'linked-chain' },
                    ],
                },
                weighted: { attachment: weightedKeys },
            },
            attachments: {
                default: {
                    linked: {
                        source: {
                            deform: [
                                { vertices: [1.5, -2.25, 0.75] },
                                { time: 1, offset: 2, vertices: [4.5, -3.5, 2.25, 6.125, -1.75, 0.5] },
                            ],
                        },
                    },
                    weighted: {
                        weighted: {
                            deform: [
                                { offset: 1, vertices: [2.5, -1.25, 3.75, 0.5, -4.5] },
                                { time: 1, vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] },
                            ],
                        },
                    },
                },
            },
        },
        sequence: {
            attachments: {
                default: {
                    // a key that points past the end of the sequence shows the last region
                    flame: { 'flame-quad': { sequence: [hold(0, 0), hold(0.25, 2), hold(0.5, 7), hold(1, 1)] } },
                    'flame-mesh': {
                        'flame-mesh': { sequence: [{ mode: 'loop', index: 2, delay: 0.1 }, hold(0.5, 7), hold(1, 0)] },
                    },
                },
            },
        },
    };
}

/** The skeleton and atlas text of the test rig for one Spine version. */
export function syntheticRig(version: SpineVersion): RigFiles {
    const regions = regionSlots();
    const skeleton = {
        skeleton: { spine: `${version}.0` },
        bones: [
            { name: 'root', x: 5, y: -3, rotation: 10 },
            { name: 'arm', parent: 'root', x: 30, y: 10, rotation: 35, scaleX: 1.25, scaleY: 0.8 },
            { name: 'hand', parent: 'arm', x: 40, rotation: -60, shearX: 10 },
            { name: 'tail', parent: 'root', x: -20, y: 15, rotation: 120, scaleX: -1 },
        ],
        slots: [
            ...regions.slots,
            { name: 'weighted', bone: 'arm', attachment: 'weighted' },
            { name: 'linked', bone: 'hand', attachment: 'source' },
            { name: 'flame', bone: 'tail', attachment: 'flame-quad' },
            { name: 'flame-mesh', bone: 'hand', attachment: 'flame-mesh' },
            { name: 'box', bone: 'tail' },
            { name: 'clip', bone: 'arm', attachment: 'clip' },
            { name: 'path', bone: 'hand', attachment: 'path' },
        ],
        skins: [
            { name: 'default', attachments: { ...regions.attachments, ...otherAttachments(version) } },
            {
                name: 'other',
                // a linked mesh in another skin than its source
                attachments: {
                    linked: { source: linked(version, 'source', regionName(180, true), { skin: 'default' }) },
                },
            },
        ],
        animations: animations(version),
    };

    return { skeleton: JSON.stringify(skeleton), atlas: ATLAS_TEXT };
}
