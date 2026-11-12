import {
    type Constraint,
    constraintLists,
    type Json,
    keys,
    keysXY,
    madeRig,
    type RigParts,
    SEQUENCE_ATLAS,
    slider,
} from './pose-rig-kit';

/*
 * A rig made for what a 4.3 slider does to slots and to the draw order. The animations of its
 * sliders hold timelines for the color and the dark color of a slot in every form, for the
 * attachment, the alpha, the sequence and the deform, for the draw order and a draw order folder,
 * and events. One slider reads a bone, one runs by its own time and adds, and one has a mix below 1.
 *
 * Two meshes in other slots follow the deform and sequence timelines of the mesh in `s3`. The
 * slider gives the slot of every slot timeline a pose of its own, but not these two slots. The slot
 * `s5` has a color timeline in the animation of the slider, so it has a pose of its own. The slot
 * `s4` has none: there the slider writes the animated pose, and what it wrote stays for the next
 * update.
 *
 * The animations a script plays key the same slots, so the animated pose and the applied pose differ.
 */

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
/** A mesh that follows the timelines of the mesh in `s3`. */
const LINKED = { type: 'linkedmesh', path: 'img', sequence: SEQUENCE, source: 'quad' };

function bones(): Json[] {
    return [
        { name: 'root', rotation: 8 },
        { name: 'a', parent: 'root', x: 10, y: 5, rotation: 30, length: 20, scaleX: 1.2 },
        { name: 'b', parent: 'a', x: 20, rotation: -45 },
        { name: 'c', parent: 'root', x: -20, y: 10, scaleY: -0.9 },
        // the sliders read these two
        { name: 'knob', parent: 'root', x: -60, y: 60 },
        { name: 'dial', parent: 'root', x: 60, y: 60, rotation: 20 },
    ];
}

function slots(): Json[] {
    return [
        { name: 's0', bone: 'a', color: 'ff8040c0', attachment: 'img' },
        { name: 's1', bone: 'b', dark: '102030', attachment: 'img' },
        { name: 's2', bone: 'c', color: '80808080', dark: '000000', attachment: 'img' },
        { name: 's3', bone: 'a', attachment: 'quad' },
        { name: 's4', bone: 'b', attachment: 'far' },
        { name: 's5', bone: 'c', color: 'ffff00ff', attachment: 'far2' },
        { name: 's6', bone: 'root', color: '00ff00ff' },
    ];
}

function skins(): Json[] {
    return [
        {
            name: 'default',
            attachments: {
                s0: { img: IMAGE },
                s1: { img: IMAGE },
                s2: { img: IMAGE },
                s3: { quad: QUAD, twin: LINKED },
                s4: { far: { ...LINKED, slot: 's3' } },
                s5: { far2: { ...LINKED, slot: 's3' } },
            },
        },
        // a mesh of its own in `s4`: the timelines of `quad` leave it alone
        { name: 'own', attachments: { s0: { img: { ...IMAGE, x: 3, rotation: 45 } }, s4: { far: QUAD } } },
    ];
}

function constraints(): Constraint[] {
    return [
        slider('paint', 'paint', {
            bone: 'knob',
            property: 'x',
            local: true,
            from: -60,
            scale: 0.01,
            loop: true,
            mix: 0.5,
        }),
        slider('shuffle', 'shuffle', {
            bone: 'dial',
            property: 'rotate',
            local: true,
            from: 20,
            scale: 0.005,
            loop: true,
        }),
        // on top of what `paint` left
        slider('fade', 'fade', { time: 0.5, mix: 0.6, additive: true }),
    ];
}

/** Slot timelines of every kind. The color curves leave the range of a color on both sides. */
function paint(): Json {
    const rgba = [0.4, 1.7, 0.8, 0, 0.4, 0, 0.8, -1, 0.4, 1, 0.8, 1, 0.4, 0.5, 0.8, 1.4];
    const rgb2 = [
        0.2, 1.5, 0.5, -0.5, 0.2, 1, 0.5, 0.5, 0.2, 1, 0.5, 0.5, 0.2, -0.9, 0.5, 2, 0.2, 0, 0.5, 0, 0.2, 0, 0.5, 1,
    ];

    return {
        slots: {
            s0: {
                rgba: [
                    { color: 'ff00ff80', curve: rgba },
                    { time: 0.6, color: '00ffffff', curve: 'stepped' },
                    { time: 1, color: 'ff00ff80' },
                ],
                attachment: [
                    { time: 0.3, name: null },
                    { time: 0.7, name: 'img' },
                ],
            },
            s1: {
                rgb2: [
                    { light: 'ffffff', dark: '000000', curve: rgb2 },
                    { time: 0.7, light: '808080', dark: 'ff00ff' },
                    { time: 1, light: 'ffffff', dark: '000000' },
                ],
            },
            s2: {
                rgba2: [
                    { light: 'ffffffff', dark: '000000' },
                    { time: 0.5, light: '20406080', dark: '0080ff' },
                    { time: 1, light: 'ffffffff', dark: '000000' },
                ],
            },
            // the twin has the timelines of the mesh, so the deform stays through the change
            s3: {
                rgb: [{ color: 'ff0000' }, { time: 0.5, color: '00ff00' }, { time: 1, color: 'ff0000' }],
                attachment: [
                    { time: 0.4, name: 'twin' },
                    { time: 0.8, name: 'quad' },
                ],
            },
            s5: {
                rgb: [
                    { time: 0.2, color: '123456' },
                    { time: 0.9, color: 'abcdef' },
                ],
            },
            s6: { alpha: keys([1, 0.2, 0.7], 1) },
        },
        attachments: {
            default: {
                s0: {
                    img: {
                        sequence: [
                            { mode: 'loop', index: 1, delay: 0.05 },
                            { time: 0.5, mode: 'pingpongReverse', index: 3, delay: 0.04 },
                        ],
                    },
                },
                s3: {
                    quad: {
                        deform: [
                            { vertices: [1, 0.5, -1, 0.25, 0, 0, 0.5, -0.5] },
                            { time: 0.5, offset: 2, vertices: [1.5, -0.5, 0.25, 2], curve: [0.6, 0.2, 0.8, 1.4] },
                            { time: 1, vertices: [1, 0.5, -1, 0.25, 0, 0, 0.5, -0.5] },
                        ],
                        sequence: [
                            { time: 0.1, mode: 'loop', index: 2, delay: 0.07 },
                            { time: 0.8, mode: 'once' },
                        ],
                    },
                },
            },
        },
    };
}

/** The draw order, a draw order folder and events. A slider fires none of the events. */
function shuffle(): Json {
    return {
        slots: {
            s2: {
                attachment: [
                    { time: 0.2, name: null },
                    { time: 0.6, name: 'img' },
                ],
            },
        },
        drawOrder: [
            { offsets: [{ slot: 's0', offset: 3 }] },
            { time: 0.3, offsets: [{ slot: 's5', offset: -4 }] },
            { time: 0.6 },
        ],
        drawOrderFolder: [
            { slots: ['s1', 's2', 's4'], keys: [{ time: 0.1, offsets: [{ slot: 's1', offset: 2 }] }, { time: 0.5 }] },
        ],
        events: [{ name: 'hit' }, { time: 0.4, name: 'done', string: 'slid' }],
    };
}

/** Colors and a deform that the additive slider adds. */
function fade(): Json {
    return {
        slots: {
            s0: { alpha: keys([0.1, 0.5], 1) },
            s1: {
                rgb2: [
                    { light: '202020', dark: '101010' },
                    { time: 1, light: '404040', dark: '303030' },
                ],
            },
            s2: { rgba: [{ color: '10101010' }, { time: 1, color: '30303030' }] },
            s6: { rgb: [{ color: '200020' }, { time: 1, color: '002000' }] },
        },
        attachments: {
            default: {
                s3: {
                    quad: {
                        deform: [{ vertices: [0.2, 0.2, 0.2, 0.2] }, { time: 1, offset: 4, vertices: [-0.3, 0.3] }],
                    },
                },
            },
        },
    };
}

/** Moves the two bones the sliders read, and keys the slots, the mesh and the draw order they write. */
function main(): Json {
    const k = (values: number[]): Json[] => keys(values, 2);

    return {
        bones: {
            knob: { translate: keysXY([0, 0, 90, 0, -50, 10], 2) },
            dial: { rotate: k([0, 160, -120]) },
            a: { rotate: k([0, 40]) },
        },
        slots: {
            s0: { rgba: [{ color: 'ffffffff' }, { time: 1, color: '80402010' }, { time: 2, color: 'ffffffff' }] },
            s1: {
                rgb2: [
                    { light: 'ff0000', dark: '00ff00' },
                    { time: 2, light: '0000ff', dark: 'ffff00' },
                ],
            },
            s2: {
                attachment: [
                    { time: 0.5, name: null },
                    { time: 1.5, name: 'img' },
                ],
            },
            s3: {
                attachment: [
                    { time: 0.9, name: 'twin' },
                    { time: 1.7, name: 'quad' },
                ],
            },
            s4: { alpha: k([1, 0.3]) },
            s5: { rgba: [{ color: 'ffffffff' }, { time: 2, color: '00000080' }] },
        },
        attachments: {
            default: {
                s3: {
                    quad: {
                        deform: [
                            { vertices: [0, 1, 0, 1, 0, 1, 0, 1] },
                            { time: 1, vertices: [1, 0, 1, 0] },
                            { time: 2, vertices: [0, 1, 0, 1, 0, 1, 0, 1] },
                        ],
                        sequence: [
                            { mode: 'pingpong', delay: 0.1 },
                            { time: 1.2, mode: 'hold', index: 4 },
                        ],
                    },
                },
            },
        },
        drawOrder: [
            { time: 0.4, offsets: [{ slot: 's3', offset: -3 }] },
            { time: 1.4, offsets: [{ slot: 's1', offset: 4 }] },
            { time: 1.9 },
        ],
        slider: { fade: { time: k([0.5, 1, 0]), mix: k([0.6, 0.1, 1]) } },
        events: [
            { time: 0.5, name: 'hit', int: 5 },
            { time: 2, name: 'done' },
        ],
    };
}

/** No deform and no sequence keys: what the slider wrote to the animated pose of `s4` stays. */
function other(): Json {
    const k = (values: number[]): Json[] => keys(values, 1.3);

    return {
        bones: { knob: { translate: keysXY([30, 0, -80, 0], 1.3) }, dial: { rotate: k([60, -60]) } },
        slots: {
            s0: { alpha: k([1, 0.4]) },
            s5: {
                rgba: [
                    { time: 0.2, color: '40c08040' },
                    { time: 1.3, color: 'ffffffff' },
                ],
            },
            s6: { rgba: [{ color: 'ff0000ff' }, { time: 1.3, color: '0000ff80' }] },
        },
        drawOrder: [{ offsets: [{ slot: 's6', offset: -5 }] }, { time: 0.7 }],
        slider: { paint: { mix: k([0.5, 1, 0]) }, shuffle: { mix: k([1, 0]) } },
    };
}

function parts(): RigParts {
    return {
        bones: bones(),
        slots: slots(),
        constraints: constraintLists('4.3', constraints()),
        skins: skins(),
        events: { hit: { int: 1, string: 'start' }, done: {} },
        animations: {
            main: main(),
            other: other(),
            paint: paint(),
            shuffle: shuffle(),
            fade: fade(),
            // one key at time 0: an animation without a length
            still: { bones: { knob: { translate: [{ x: 45 }] } }, slots: { s4: { alpha: [{ value: 0.4 }] } } },
        },
        atlas: SEQUENCE_ATLAS,
    };
}

/** The rig for sliders and slots, for the one version that has sliders. */
export const sliderSlotRigs = () => madeRig('made-slider-slots', parts, ['4.3']);
