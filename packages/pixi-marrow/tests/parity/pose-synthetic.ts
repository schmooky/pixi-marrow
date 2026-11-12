import type { SpineVersion } from '../../src/core';
import { type Fixture, listFixtures, readFixture } from './fixtures';
import type { RigFiles } from './official';
import { ikRigs } from './pose-rig-ik';
import { orderRigs } from './pose-rig-order';
import { pathRigs } from './pose-rig-path';
import { transformRigs } from './pose-rig-transform';

/*
 * The skeletons the pose suite runs on: the fixtures and the rigs made here. The rigs made for
 * constraints are in the `pose-rig-` files, one for IK, one for transform constraints, one for
 * path constraints and one for the order of constraints.
 *
 * This file holds the rig for what no official example has apart from constraints: the timelines
 * for one scale or shear axis, for rgb, alpha and rgb2, for the inherit mode and for draw order
 * folders, every sequence mode, color curves that leave the range of a color, a 4.3 mesh that
 * follows the timelines of a mesh in another slot, keys on a bone and a slot that need a skin, and
 * bones of every inherit mode. It is written as the JSON of each version.
 */

/** A skeleton the pose suite runs on: a fixture from disk or a rig made here. */
export interface PoseRigSource {
    /** Unique label, for example `4.2/spineboy-pro.skel`. */
    id: string;
    rig: string;
    version: SpineVersion;
    read(): RigFiles;
}

const EDITOR_VERSIONS: Record<SpineVersion, string> = { '4.1': '4.1.24', '4.2': '4.2.43', '4.3': '4.3.39' };

/** Five numbered regions for the sequences, each 2 by 2 pixels. */
const ATLAS = [
    'page.png',
    'size: 16, 4',
    'filter: Linear, Linear',
    ...[1, 2, 3, 4, 5].flatMap((n) => [`img0${n}`, `bounds: ${(n - 1) * 2}, 0, 2, 2`]),
    '',
].join('\n');

/**
 * The bones: one of every inherit mode under a parent that is rotated, scaled, sheared and
 * mirrored, one under a parent without a width, one that needs a skin, and a child of that one
 * that needs none.
 */
function bones(version: SpineVersion): object[] {
    // 4.1 calls the inherit mode the transform mode
    const inherit = (mode: string): object => (version === '4.1' ? { transform: mode } : { inherit: mode });

    return [
        { name: 'root', rotation: 12, scaleX: 1.1 },
        {
            name: 'a',
            parent: 'root',
            length: 20,
            x: 10,
            y: 5,
            rotation: 30,
            scaleX: 1.2,
            scaleY: -0.8,
            shearX: 5,
            shearY: -3,
        },
        { name: 'b', parent: 'a', x: 20, rotation: -45, scaleX: 0.9, ...inherit('onlyTranslation') },
        { name: 'c', parent: 'a', x: 5, y: 5, rotation: 15, scaleX: -1.3, ...inherit('noRotationOrReflection') },
        { name: 'd', parent: 'b', y: 8, rotation: 10, scaleY: 1.4, ...inherit('noScale') },
        { name: 'e', parent: 'c', x: 3, shearX: 10, scaleX: 0.7, ...inherit('noScaleOrReflection') },
        { name: 'f', parent: 'e', x: 4, y: -2, rotation: 100, shearY: 20 },
        { name: 'flat', parent: 'root', x: -6, scaleX: 0 },
        { name: 'g', parent: 'flat', rotation: 33, ...inherit('noRotationOrReflection') },
        { name: 'h', parent: 'a', x: -4, rotation: 50, skin: true },
        // active while its parent is not: the official core poses it from the stale world transform of `h`
        { name: 'i', parent: 'h', x: 2, y: 1, rotation: 20 },
    ];
}

const SEQUENCE = { count: 5, start: 1, digits: 2, setup: 1 };
const IMAGE = { width: 2, height: 2, sequence: SEQUENCE };
const QUAD = {
    type: 'mesh',
    path: 'img',
    sequence: SEQUENCE,
    uvs: [1, 1, 0, 1, 0, 0, 1, 0],
    triangles: [1, 2, 3, 1, 3, 0],
    vertices: [2, -2, -2, -2, -2, 2, 2, 2],
    hull: 4,
};

/** The slots. In 4.3 the last one shows a mesh that follows the timelines of the mesh in `s3`. */
function slots(version: SpineVersion): object[] {
    return [
        { name: 's0', bone: 'a', color: 'ff8040c0', attachment: 'img' },
        { name: 's1', bone: 'b', dark: '102030' },
        { name: 's2', bone: 'c', color: '80808080', dark: '000000', attachment: 'img' },
        { name: 's3', bone: 'd', attachment: 'quad' },
        { name: 's4', bone: 'f', color: '00ff00ff', ...(version === '4.3' ? { attachment: 'far' } : {}) },
        { name: 's5', bone: 'h', dark: 'ff0000', attachment: 'img' },
    ];
}

/** Three skins: the default one, one that turns on bone `h`, and one with another image for `s0`. */
function skins(version: SpineVersion): object[] {
    // a linked mesh names its source `parent` up to 4.2 and `source` in 4.3
    const linked = { type: 'linkedmesh', path: 'img', sequence: SEQUENCE };
    const twin = version === '4.3' ? { ...linked, source: 'quad' } : { ...linked, parent: 'quad' };
    const far = { ...linked, source: 'quad', slot: 's3' };

    return [
        {
            name: 'default',
            attachments: {
                s0: { img: IMAGE },
                s2: { img: IMAGE },
                s3: { quad: QUAD, twin },
                ...(version === '4.3' ? { s4: { far } } : {}),
            },
        },
        { name: 'left', bones: ['h'], attachments: { s5: { img: IMAGE } } },
        { name: 'right', attachments: { s0: { img: { ...IMAGE, x: 3, rotation: 45 } } } },
    ];
}

/** Keys for the mesh in `s3`: its deform and its sequence. The meshes that follow it get both. */
const QUAD_KEYS = {
    deform: [
        { time: 0.1, vertices: [1, 0.5, -1, 0.25, 0, 0, 0.5, -0.5] },
        { time: 0.6, offset: 2, vertices: [1.5, -0.5, 0.25, 2], curve: [0.7, 0.2, 0.9, 1.4] },
        { time: 1.1 },
    ],
    sequence: [
        { time: 0.2, mode: 'loop', index: 2, delay: 0.07 },
        { time: 0.9, mode: 'once' },
    ],
};

/** The animation with every kind of timeline. 4.1 has no inherit timeline, only 4.3 has draw order folders. */
function kinds(version: SpineVersion): object {
    const boneA = {
        scalex: [{ value: 1.4 }, { time: 0.4, value: 0.6, curve: [0.5, 0.6, 0.9, 1.3] }, { time: 1.2, value: 1.4 }],
        scaley: [
            { time: 0.1, value: 0.8, curve: 'stepped' },
            { time: 0.9, value: 1.3 },
            { time: 1.2, value: 0.8 },
        ],
        shearx: [
            { value: 10, curve: [0.2, 10, 0.4, -20] },
            { time: 0.6, value: -20 },
            { time: 1.2, value: 10 },
        ],
        sheary: [
            { time: 0.2, value: -15 },
            { time: 1, value: 25 },
        ],
        translatex: [{ value: 4 }, { time: 1.2, value: -4 }],
        translatey: [
            { time: 0.3, value: 2 },
            { time: 0.8, value: 6 },
        ],
    };
    const inherit = [
        { inherit: 'noScale' },
        { time: 0.5, inherit: 'normal' },
        { time: 0.9, inherit: 'onlyTranslation' },
    ];
    const rotate = [{ value: 20 }, { time: 0.6, value: -200 }, { time: 1.2, value: 20 }];
    const folder = {
        slots: ['s1', 's2', 's4'],
        keys: [{ time: 0.2, offsets: [{ slot: 's1', offset: 2 }] }, { time: 0.7 }],
    };

    return {
        bones: {
            a: boneA,
            b: version === '4.1' ? { rotate } : { rotate, inherit },
            // two full turns: mixing has to pick a direction
            c: {
                rotate: [{}, { time: 1.2, value: 720 }],
                scale: [
                    { x: 1.2, y: 0.9 },
                    { time: 1.2, x: 0.8, y: 1.1 },
                ],
            },
            e: {
                shear: [
                    { x: 5, y: -5 },
                    { time: 0.7, x: -10, y: 15 },
                ],
                translate: [{}, { time: 1, x: 3, y: 1 }],
            },
            flat: { scalex: [{ value: 0 }, { time: 0.6, value: 0.00001 }, { time: 1.2, value: 0.5 }] },
            g: { rotate: [{ value: 5 }, { time: 1.2, value: 95 }] },
            i: { rotate: [{ value: 10 }, { time: 1.2, value: -80 }] },
            // not active without the skin `left`
            h: {
                rotate: [{ value: -30 }, { time: 1.2, value: 30 }],
                scalex: [{ time: 0.2, value: 2 }],
                ...(version === '4.1' ? {} : { inherit: [{ time: 0.3, inherit: 'noScale' }] }),
            },
        },
        slots: {
            s0: {
                // the curves leave the range of a color on both sides
                rgb: [
                    { time: 0.1, color: 'ff0000', curve: [0.2, 1.9, 0.4, -0.8, 0.2, -0.7, 0.4, 1.6, 0.2, 0, 0.4, 0] },
                    { time: 0.6, color: '00ff00' },
                    { time: 1.2, color: '0000ff' },
                ],
                alpha: [
                    { time: 0.05, value: 1, curve: [0.2, 1.8, 0.5, -0.6] },
                    { time: 0.7, value: 0.2 },
                    { time: 1.2 },
                ],
            },
            s1: {
                rgb2: [
                    {
                        light: 'ffffff',
                        dark: '000000',
                        curve: [
                            0.2, 1.5, 0.6, -0.5, 0.2, 1, 0.6, 0.5, 0.2, 1, 0.6, 0.5, 0.2, -0.9, 0.6, 2, 0.2, 0, 0.6, 0,
                            0.2, 0, 0.6, 1,
                        ],
                    },
                    { time: 0.8, light: '808080', dark: 'ff00ff', curve: 'stepped' },
                    { time: 1.1, light: '102030', dark: '405060' },
                ],
            },
            s2: {
                rgba2: [
                    { light: 'ffffffff', dark: '000000' },
                    { time: 1, light: '20406080', dark: '0080ff' },
                ],
                attachment: [
                    { time: 0.3, name: null },
                    { time: 0.9, name: 'img' },
                ],
            },
            // the twin has the timelines of the mesh, so the deform stays through the change
            s3: {
                attachment: [
                    { time: 0.5, name: 'twin' },
                    { time: 1, name: 'quad' },
                ],
            },
            s4: {
                rgba: [
                    {
                        time: 0.2,
                        color: 'ff00ff80',
                        curve: [0.4, 1.7, 0.8, 0, 0.4, 0, 0.8, -1, 0.4, 1, 0.8, 1, 0.4, 0.5, 0.8, 1.4],
                    },
                    { time: 1, color: '00ffffff' },
                ],
            },
            s5: {
                rgba2: [
                    { time: 0.1, light: 'ffffff80', dark: '00ff00' },
                    { time: 0.9, light: '000000ff', dark: '0000ff' },
                ],
                attachment: [
                    { time: 0.4, name: null },
                    { time: 0.8, name: 'img' },
                ],
            },
        },
        attachments: {
            default: {
                s0: {
                    img: {
                        sequence: [
                            { mode: 'loop', index: 1, delay: 0.05 },
                            { time: 0.3, mode: 'pingpong', delay: 0.04 },
                            { time: 0.6, mode: 'onceReverse', index: 4 },
                            { time: 0.8, mode: 'loopReverse' },
                            { time: 1, mode: 'pingpongReverse', index: 2 },
                        ],
                    },
                },
                s2: {
                    img: {
                        sequence: [
                            { time: 0.1, mode: 'once', delay: 0.03 },
                            { time: 0.7, index: 3 },
                        ],
                    },
                },
                s3: { quad: QUAD_KEYS },
            },
            left: { s5: { img: { sequence: [{ time: 0.3, mode: 'loop', delay: 0.02 }] } } },
        },
        drawOrder: [
            { time: 0.4, offsets: [{ slot: 's0', offset: 2 }] },
            { time: 0.8, offsets: [{ slot: 's3', offset: -3 }] },
            { time: 1.1 },
        ],
        ...(version === '4.3' ? { drawOrderFolder: [folder] } : {}),
        events: [
            { name: 'hit' },
            { time: 0.5, name: 'hit', int: 7, float: 1.5, string: 'middle', volume: 0.5, balance: -1 },
            // two events at one time
            { time: 0.5, name: 'done', string: 'same time' },
            { time: 1.2, name: 'done' },
        ],
    };
}

/** A second animation that keys some of the same properties and some others, so that mixes hold and release. */
function other(version: SpineVersion): object {
    const inherit = [
        { time: 0.1, inherit: 'noScaleOrReflection' },
        { time: 0.6, inherit: 'noRotationOrReflection' },
    ];

    return {
        bones: {
            a: {
                scalex: [{ value: 0.5 }, { time: 0.8, value: 2 }],
                sheary: [{ value: 30 }, { time: 0.8, value: -30 }],
            },
            b: version === '4.1' ? { scaley: [{ value: 2 }, { time: 0.8 }] } : { inherit },
            d: { rotate: [{ value: -170 }, { time: 0.8, value: 170 }], shearx: [{ time: 0.4, value: 45 }] },
            h: {
                translate: [
                    { x: 1, y: 1 },
                    { time: 0.8, x: -1, y: 4 },
                ],
            },
        },
        slots: {
            // starts late: before its first key it mixes toward the setup color
            s0: {
                rgba: [
                    { time: 0.3, color: '40c08040' },
                    { time: 0.8, color: 'ffffffff' },
                ],
            },
            s1: {
                rgb2: [
                    { time: 0.2, light: 'ff0000', dark: '00ff00' },
                    { time: 0.8, light: '0000ff', dark: 'ffff00' },
                ],
            },
            // the slot is empty for a while. In 4.3 the mesh in `s4` still follows the deform keys then.
            s3: {
                rgb: [
                    { time: 0.15, color: '123456' },
                    { time: 0.5, color: 'abcdef' },
                ],
                attachment: [
                    { time: 0.2, name: null },
                    { time: 0.6, name: 'quad' },
                ],
            },
            s4: {
                alpha: [
                    { time: 0.1, value: 0.5 },
                    { time: 0.8, value: 0.9 },
                ],
            },
            s5: {
                rgb2: [
                    { light: '808080', dark: '404040' },
                    { time: 0.8, light: 'ffffff', dark: '000000' },
                ],
                alpha: [{ value: 0.3 }, { time: 0.4, value: 0.6 }],
            },
        },
        attachments: {
            default: {
                s3: {
                    quad: { deform: [{ vertices: [0, 1, 0, 1, 0, 1, 0, 1] }, { time: 0.8, vertices: [1, 0, 1, 0] }] },
                },
            },
        },
        drawOrder: [{ offsets: [{ slot: 's1', offset: 3 }] }, { time: 0.5, offsets: [{ slot: 's4', offset: -4 }] }],
        events: [
            { time: 0.25, name: 'done', string: 'early' },
            { time: 0.8, name: 'hit' },
        ],
    };
}

function skeletonJson(version: SpineVersion): string {
    return JSON.stringify({
        skeleton: { hash: 'pose-suite', spine: EDITOR_VERSIONS[version], x: -20, y: -20, width: 60, height: 60 },
        bones: bones(version),
        slots: slots(version),
        skins: skins(version),
        events: { hit: { int: 1, float: 2.5, string: 'start', volume: 0.75, balance: 0.25 }, done: {} },
        animations: {
            kinds: kinds(version),
            other: other(version),
            // one key at time 0: an animation without a length
            still: {
                bones: { f: { scaley: [{ value: 1.5 }], shearx: [{ value: -12 }] } },
                slots: { s4: { alpha: [{ value: 0.4 }] } },
            },
        },
    });
}

/** The rig made here, once for each version. */
function syntheticRigs(): PoseRigSource[] {
    const versions: SpineVersion[] = ['4.1', '4.2', '4.3'];

    return versions.map((version) => ({
        id: `${version}/made-for-pose.json`,
        rig: 'made-for-pose',
        version,
        read: () => ({ skeleton: skeletonJson(version), atlas: ATLAS }),
    }));
}

const fromFixture = (fixture: Fixture): PoseRigSource => ({
    id: fixture.id,
    rig: fixture.rig,
    version: fixture.version,
    read: () => readFixture(fixture),
});

/** Every skeleton the pose suite runs on: the fixtures, then the rigs made here. */
export function listPoseRigs(): PoseRigSource[] {
    return [
        ...listFixtures().map(fromFixture),
        ...syntheticRigs(),
        ...ikRigs(),
        ...transformRigs(),
        ...pathRigs(),
        ...orderRigs(),
    ];
}
