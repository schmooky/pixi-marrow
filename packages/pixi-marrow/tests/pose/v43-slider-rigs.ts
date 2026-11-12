/*
 * The skeletons of v43-sliders.test.ts, as the JSON of Spine 4.3. They show paths only, so they
 * need no regions.
 */

/** A piece of the JSON of a skeleton. */
export type Json = Record<string, unknown>;

const PATH = {
    type: 'path',
    lengths: [30, 60],
    vertexCount: 6,
    vertices: [-10, 0, 0, 0, 10, 5, 30, 25, 40, 30, 50, 35],
};
const BENT = { ...PATH, vertices: [-5, 5, 0, 0, 8, 9, 20, 35, 44, 20, 60, 15] };
/** Three keys of one value: from `a` to `b` and back. */
export const wave = (a: number, b: number): Json[] => [{ value: a }, { time: 0.5, value: b }, { time: 1, value: a }];

/*
 * Three sliders. `timed` runs by its own time and plays `inner`, which keys bones, an inherit
 * mode, slots, an IK constraint, a physics constraint and the slider `driven`. `driven` reads a
 * bone and loops `second`. `gated` needs a skin and plays `third`. Only that one keys the slot
 * `s4` and the draw order, so both have a pose of their own with the skin and none without it.
 * The animation `play` is for a track: it keys the same bones and slots, so that the animated
 * pose is another than the applied one.
 */
export const RIG: Json = {
    skeleton: { spine: '4.3.39-beta' },
    bones: [
        { name: 'root', rotation: 4 },
        { name: 'a', parent: 'root', x: 10, length: 30, rotation: 20 },
        { name: 'b', parent: 'a', x: 30, length: 20, rotation: -10, scaleX: 1.2 },
        { name: 'c', parent: 'root', x: 60, y: 30, length: 10 },
        { name: 'drive', parent: 'root', x: 25, y: -40, rotation: 15 },
        { name: 'gated', parent: 'a', x: 4, y: 8, length: 12, skin: true },
    ],
    slots: [
        { name: 's0', bone: 'a', color: 'ff8040c0', attachment: 'p0' },
        { name: 's1', bone: 'b', dark: '102030', attachment: 'p0' },
        { name: 's2', bone: 'c', color: '80ff80ff', attachment: 'p0' },
        { name: 's3', bone: 'gated', attachment: 'p0' },
        { name: 's4', bone: 'c', attachment: 'p0' },
    ],
    events: { ping: {} },
    constraints: [
        { type: 'ik', name: 'aim', bones: ['b'], target: 'c', mix: 0.5 },
        { type: 'slider', name: 'timed', animation: 'inner', time: 0.3, mix: 0.8 },
        {
            type: 'slider',
            name: 'driven',
            animation: 'second',
            bone: 'drive',
            property: 'x',
            local: true,
            scale: 0.02,
            loop: true,
        },
        { type: 'slider', name: 'gated', animation: 'third', time: 0.4, skin: true },
        { type: 'physics', name: 'sway', bone: 'c', x: 1, rotate: 1 },
    ],
    skins: [
        {
            name: 'default',
            attachments: {
                s0: { p0: PATH, p1: BENT },
                s1: { p0: PATH, p1: BENT },
                s2: { p0: BENT, p1: PATH },
                s3: { p0: PATH },
                s4: { p0: PATH, p1: BENT },
            },
        },
        { name: 'on', bones: ['gated'], slider: ['gated'], attachments: { s2: { p0: PATH } } },
    ],
    animations: {
        inner: {
            bones: {
                a: { rotate: wave(0, 50) },
                b: {
                    inherit: [{ inherit: 'noScale' }, { time: 0.5, inherit: 'onlyTranslation' }],
                    scale: [{ x: 1.5, y: 0.5 }, { time: 1 }],
                },
            },
            slots: {
                s0: { rgba: [{ color: '00ff00ff' }, { time: 1, color: 'ff0000ff' }] },
                s1: {
                    rgba2: [
                        { light: 'ffffff80', dark: 'ff0000' },
                        { time: 1, light: '000000ff', dark: '00ff00' },
                    ],
                    attachment: [{ name: 'p1' }, { time: 0.6, name: null }],
                },
            },
            attachments: {
                default: {
                    s0: { p0: { deform: [{ vertices: [3, 2, 1, 0, -1, -2, -3, 4, 5, 6, 7, 8] }, { time: 0.8 }] } },
                },
            },
            ik: { aim: [{ mix: 0.1 }, { time: 1, mix: 1 }] },
            physics: { sway: { mix: wave(0.2, 1) } },
            slider: { driven: { mix: wave(0.3, 0.9) } },
            events: [
                { time: 0.1, name: 'ping' },
                { time: 0.3, name: 'ping' },
            ],
        },
        second: {
            bones: { c: { translate: [{ x: 0 }, { time: 0.5, x: -30, y: 20 }, { time: 1 }] } },
            slots: { s2: { alpha: wave(1, 0.2) } },
        },
        third: {
            slots: { s4: { rgb: [{ color: '0000ff' }, { time: 1, color: 'ffff00' }], attachment: [{ name: 'p1' }] } },
            drawOrder: [
                {
                    offsets: [
                        { slot: 's1', offset: 1 },
                        { slot: 's2', offset: -1 },
                    ],
                },
            ],
            slider: { timed: { time: wave(0, 0.9) } },
        },
        play: {
            bones: {
                a: { rotate: wave(10, -60) },
                drive: { translate: [{ x: 0 }, { time: 1, x: 80 }] },
                b: { inherit: [{ inherit: 'noRotationOrReflection' }] },
            },
            slots: {
                s0: {
                    rgba: [{ color: 'ffffffff' }, { time: 1, color: '00000000' }],
                    attachment: [
                        { time: 0.4, name: 'p1' },
                        { time: 0.8, name: 'p0' },
                    ],
                },
                s1: { attachment: [{ name: 'p0' }] },
                s2: { rgba: [{ color: '12345678' }, { time: 1, color: '87654321' }] },
                s4: { rgba: [{ color: 'abcdef12' }, { time: 1, color: '21fedcba' }] },
            },
            attachments: {
                default: {
                    s0: {
                        p0: {
                            deform: [
                                { vertices: [9, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7] },
                                { time: 0.9, vertices: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3] },
                            ],
                        },
                    },
                },
            },
            drawOrder: [
                {
                    time: 0.2,
                    offsets: [
                        { slot: 's0', offset: 1 },
                        { slot: 's1', offset: -1 },
                    ],
                },
                { time: 0.9 },
            ],
            // for a while the slider has no mix: then it does nothing at all
            slider: {
                timed: {
                    time: wave(0.1, 0.8),
                    mix: [{ value: 1 }, { time: 0.3, value: 0, curve: 'stepped' }, { time: 0.7, value: 0.6 }],
                },
            },
        },
    },
};
/** The JSON of {@link RIG}. */
export const TEXT: string = JSON.stringify(RIG);

/*
 * A path constraint whose slot a later slider gives another attachment. The path the slot has in
 * the animated pose has weights for the bone `w`, which comes after the bones of the constraint.
 * The official core sorts `w` before the constraint because of that path.
 */
export const SORTED: Json = {
    skeleton: { spine: '4.3.39-beta' },
    bones: [
        { name: 'root' },
        { name: 'hip', parent: 'root', x: 10, y: 20, rotation: 30 },
        { name: 'c1', parent: 'root', length: 18, x: 4, y: 6 },
        { name: 'w', parent: 'root', x: -20, y: 15, rotation: 40 },
    ],
    slots: [{ name: 'track', bone: 'hip', attachment: 'bent' }],
    constraints: [
        {
            type: 'path',
            name: 'ride',
            bones: ['c1'],
            slot: 'track',
            positionMode: 'fixed',
            position: 20,
            rotateMode: 'chain',
        },
        { type: 'slider', name: 'show', animation: 'inner' },
    ],
    skins: [
        { name: 'default', attachments: { track: { line: PATH } } },
        {
            name: 'first',
            attachments: {
                track: {
                    bent: { ...PATH, vertices: PATH.vertices.flatMap((v, i) => (i % 2 === 0 ? [1, 3, v] : [v, 1])) },
                },
            },
        },
        { name: 'second' },
    ],
    animations: {
        inner: { slots: { track: { attachment: [{ name: 'line' }] } } },
        move: {
            bones: { w: { translate: [{ x: 0 }, { time: 0.5, x: 60, y: -40 }, { time: 1 }], rotate: wave(0, 90) } },
        },
    },
};
