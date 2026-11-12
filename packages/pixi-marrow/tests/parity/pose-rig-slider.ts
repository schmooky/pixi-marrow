import {
    type Constraint,
    constraintLists,
    copy,
    ik,
    type Json,
    keys,
    keysOf,
    keysXY,
    madeRig,
    path,
    pathAttachment,
    physics,
    type RigParts,
    slider,
} from './pose-rig-kit';
import { wakeSlider } from './pose-rig-wake';

/*
 * A rig made for sliders, which only 4.3 has. The one official slider reads the local rotation of
 * a bone. This rig has a slider for each of the six properties of a bone, in world and in local
 * space, with and without an offset, a loop and the additive flag, and sliders that run by their
 * own time and mix, which animations key. Four sliders play each of three animations, the later
 * ones on top of the earlier. The animations hold bone timelines of every kind.
 *
 * Other sliders stand before and after an IK, a transform, a path and a physics constraint. One
 * plays an animation that keys the values of these constraints, of all physics constraints at
 * once and of a later slider, and that has events, which a slider does not fire. One needs a
 * skin, one reads a bone that needs a skin, and one plays an animation without a length. A slider
 * and a physics constraint that need a skin are keyed and reset while no skin has them.
 *
 * The animations a script plays key the same bones as the sliders, so the animated pose and the
 * applied pose differ.
 */

const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];
const TARGETS = Array.from({ length: 10 }, (_, i) => i + 1);

function bones(): Json[] {
    // what the sliders move: every second bone is below the tilted bone
    const targets = TARGETS.map((n) => [
        {
            name: `t${n}`,
            parent: n % 2 === 0 ? 'tilt' : 'root',
            x: n * 20 - 110,
            y: -20 - (n % 3) * 15,
            rotation: n * 31 - 100,
            length: 15,
            scaleX: [1, 1.2, 0.8][n % 3],
            shearY: n % 4 === 1 ? 8 : 0,
        },
        { name: `t${n}Tip`, parent: `t${n}`, x: 15, rotation: 10 },
    ]);

    return [
        { name: 'root', rotation: 5 },
        // the world values of the knobs are not their local values
        { name: 'tilt', parent: 'root', x: 10, y: 20, rotation: 25, scaleX: 1.3, scaleY: 0.8 },
        { name: 'knobRotate', parent: 'tilt', x: -90, y: 60, rotation: 30, length: 10 },
        { name: 'knobX', parent: 'tilt', x: -60, y: 60 },
        { name: 'knobY', parent: 'tilt', x: -30, y: 60 },
        { name: 'knobScaleX', parent: 'tilt', y: 60, scaleX: 1.2 },
        { name: 'knobScaleY', parent: 'tilt', x: 30, y: 60, scaleY: 0.8 },
        { name: 'knobShearY', parent: 'tilt', x: 60, y: 60, shearY: 10 },
        { name: 'knobSkin', parent: 'root', x: 90, y: 60, skin: true },
        ...targets.flat(),
        // for the constraints of the other kinds
        { name: 'target', parent: 'root', x: 60, y: -90 },
        { name: 'early', parent: 'root', x: 90, y: -30, length: 20 },
        { name: 'leg1', parent: 'root', x: 20, y: -60, length: 30, rotation: -60 },
        { name: 'leg2', parent: 'leg1', x: 30, length: 30, rotation: 40 },
        { name: 'src', parent: 'root', x: -80, y: -80, rotation: 20, scaleX: 1.1 },
        { name: 'dst', parent: 'root', x: -50, y: -90, length: 12 },
        { name: 'bob', parent: 'dst', x: 12, length: 14, rotation: 30 },
        { name: 'p1', parent: 'root', x: -20, y: -100, length: 15 },
    ];
}

/** A slider that reads a property of a knob bone. `local` reads the local value. */
function knob(name: string, animation: string, more: Json = {}): Constraint {
    const property = name.replace('Local', '');
    const bone = `knob${property.charAt(0).toUpperCase()}${property.slice(1)}`;

    return slider(name, animation, { bone, property, ...(name.endsWith('Local') ? { local: true } : {}), ...more });
}

function constraints(): Constraint[] {
    const loop = { loop: true };
    const additive = { additive: true };
    const part = { mixRotate: 0.7, mixX: 0.6, mixY: 0.6, mixScaleX: 0.5, mixScaleY: 0, mixShearY: 0 };

    return [
        // by its own time: animations key the time and the mix
        slider('own', 'nod', { time: 0.3, mix: 0.8 }),
        // the first of four on one animation sets the pose, the others mix into it or add to it
        knob('rotate', 'turn', { scale: 0.005, ...loop }),
        knob('xLocal', 'turn', { from: -60, to: 0.5, scale: 0.02, max: 1, ...loop, ...additive }),
        knob('scaleY', 'turn', { from: 0.5, scale: 1.5, mix: 0.5 }),
        knob('shearYLocal', 'turn', { to: 0.2, scale: 0.02, ...additive }),
        knob('x', 'wave', { from: -60, scale: 0.01 }),
        knob('rotateLocal', 'wave', { from: 30, scale: 0.01, ...loop, ...additive }),
        knob('yLocal', 'wave', { from: 60, to: 0.4, scale: -0.02, mix: 0.5 }),
        knob('scaleX', 'wave', { scale: 0.4, ...loop, ...additive }),
        knob('y', 'pulse', { scale: 0.01, ...loop }),
        knob('scaleXLocal', 'pulse', { from: 1.2, scale: 1, ...additive }),
        knob('scaleYLocal', 'pulse', { to: 0.3, scale: 0.8, mix: 0.6, ...loop }),
        knob('shearY', 'pulse', { to: 0.6, scale: 0.02, ...additive }),
        // solved before the slider that keys its mix
        ik('4.3', 'early', ['early'], 'target'),
        // moves what the constraints after it read
        slider('pre', 'bend', { bone: 'knobX', property: 'x', local: true, from: -60, scale: 0.01, ...loop }),
        // keys the values of the constraints after it
        slider('driver', 'drive', {
            bone: 'knobRotate',
            property: 'rotate',
            local: true,
            from: 30,
            scale: 0.005,
            ...loop,
        }),
        ik('4.3', 'leg', ['leg1', 'leg2'], 'target', { softness: 4 }),
        copy('4.3', 'follow', { bones: ['dst'], from: 'src', ...part }),
        path('4.3', 'ride', ['p1'], 'rail', { position: 0.3 }),
        physics('4.3', 'bob', 'bob', { rotate: 1, x: 0.5, windGlobal: true, mixGlobal: true }),
        // needs a skin: without it the keys of animations and of the driver pass it by
        physics('4.3', 'charm', 'leg2', { rotate: 0.5, skin: true, windGlobal: true, mixGlobal: true }),
        // the driver keys its time and its mix
        slider('own2', 'nod', { time: 0.2, mix: 0.5, ...additive }),
        // the same animation again, on what the constraints left
        slider('post', 'bend', { bone: 'knobY', property: 'y', local: true, from: 60, scale: 0.01, mix: 0.6, ...loop }),
        slider('skinned', 'pulse', { time: 0.4, skin: true, ...additive }),
        // its bone needs a skin
        slider('ghost', 'wave', {
            bone: 'knobSkin',
            property: 'rotate',
            local: true,
            to: 0.3,
            scale: 0.01,
            ...additive,
        }),
        // an animation without a length
        slider('frozen', 'still', { mix: 0.5 }),
    ];
}

/** Bone timelines of every kind. */
function turn(): Json {
    const k = (values: number[]): Json[] => keys(values, 1);
    const xy = (points: number[]): Json[] => keysXY(points, 1);

    return {
        bones: {
            t1: {
                rotate: k([0, 120, -200]),
                translate: xy([0, 0, 20, -10, -15, 25]),
                scale: xy([1, 1, 1.6, 0.6, 0.5, 1.4]),
                shear: xy([0, 0, 20, -30]),
            },
            t2: {
                translatex: k([0, 30, -20]),
                translatey: k([0, -25]),
                scalex: k([1, 1.8, 0.4]),
                scaley: k([1, 0.5]),
                shearx: k([0, 35, -15]),
                sheary: k([0, -40]),
            },
            t3: {
                rotate: k([0, -90]),
                inherit: [
                    { inherit: 'noScale' },
                    { time: 0.4, inherit: 'onlyTranslation' },
                    { time: 0.8, inherit: 'normal' },
                ],
            },
        },
    };
}

function wave(): Json {
    const k = (values: number[]): Json[] => keys(values, 0.8);
    const xy = (points: number[]): Json[] => keysXY(points, 0.8);

    return {
        bones: {
            t4: { rotate: k([0, 70, -50]), translate: xy([0, 0, -20, 30]) },
            t5: { scale: xy([1, 1, 0.6, 1.5]), shearx: k([0, 25]) },
        },
    };
}

function pulse(): Json {
    const k = (values: number[]): Json[] => keys(values, 1.2);
    const xy = (points: number[]): Json[] => keysXY(points, 1.2);

    return {
        bones: {
            t6: { scale: xy([1, 1, 2, 2, 0.5, 0.5]), rotate: k([0, 45]) },
            t7: { translatey: k([0, 40, -20]), sheary: k([0, 30]) },
        },
    };
}

function nod(): Json {
    const k = (values: number[]): Json[] => keys(values, 1);

    return { bones: { t8: { rotate: k([0, 80, -60]), translatex: k([0, 25]) }, t9: { rotate: k([0, -150]) } } };
}

/** Moves what the IK, transform, path and physics constraints read and what they place. */
function bend(): Json {
    const k = (values: number[]): Json[] => keys(values, 1);
    const xy = (points: number[]): Json[] => keysXY(points, 1);

    return {
        bones: {
            target: { translate: xy([0, 0, -50, 30, 20, 50]) },
            leg1: { rotate: k([0, 60]) },
            leg2: { rotate: k([0, -80, 40]) },
            src: { rotate: k([0, 150]), scale: xy([1, 1, 1.5, 0.7]) },
            dst: { translate: xy([0, 0, 20, 20]) },
            p1: { rotate: k([0, 100]) },
            bob: { rotate: k([0, -70]) },
        },
        // the path constraint reads the path the slider left
        attachments: {
            default: {
                rail: {
                    rail: {
                        deform: [
                            { vertices: [0, 8, 0, -8, 5, 5] },
                            { time: 0.5, offset: 6, vertices: [12, -9] },
                            { time: 1 },
                        ],
                    },
                },
            },
        },
    };
}

/** Keys the values of other constraints, of all physics constraints and of a slider. A slider fires none of the events. */
function drive(): Json {
    const k = (values: number[]): Json[] => keys(values, 1);
    const leg = keysOf(['mix', 'softness'], [1, 4, 0.2, 20, 0.7, 0], 1);

    return {
        ik: {
            leg: leg.map((key, i) => ({ ...key, bendPositive: i % 2 === 0 })),
            early: [{ mix: 0.3 }, { time: 1, mix: 0 }],
        },
        transform: { follow: keysOf(MIXES, [0.7, 0.6, 0.6, 0.5, 0, 0, 0, 1, 1, 0, 1, 0.5, 1, 0, 0, 1, 0.5, 1], 1) },
        path: {
            ride: {
                position: k([0.3, 1.1, -0.2]),
                spacing: k([0, 10]),
                mix: keysOf(MIXES.slice(0, 3), [1, 1, 1, 0.3, 0.5, 0.5], 1),
            },
        },
        physics: {
            bob: {
                inertia: k([0.5, 1]),
                strength: k([100, 40]),
                damping: k([0.85, 0.6]),
                mass: k([1, 2]),
                wind: k([0, 15]),
                gravity: k([0, 25]),
                reset: [{ time: 0.5 }],
            },
            charm: { damping: k([0.85, 0.5]), reset: [{ time: 0.3 }] },
            '': { wind: k([0, 30, -30]), mix: k([1, 0.4]), reset: [{}] },
        },
        slider: {
            own2: { time: k([0.2, 0.9, 0.5]), mix: k([0.5, 1, 0]) },
            own: { mix: k([0.8, 0]) },
            skinned: { mix: k([1, 0.3]) },
        },
        events: [
            { time: 0.2, name: 'tick' },
            { time: 0.7, name: 'tick', int: 3 },
        ],
    };
}

/** Turns every knob, and keys what the sliders move and the values of two sliders. */
function main(): Json {
    const k = (values: number[]): Json[] => keys(values, 2);
    const xy = (points: number[]): Json[] => keysXY(points, 2);

    return {
        bones: {
            knobRotate: { rotate: k([0, 200, -150]) },
            knobX: { translate: xy([0, 0, 80, 10, -70, -20]) },
            knobY: { translate: xy([0, 0, 5, 90, -10, -60]) },
            knobScaleX: { scale: xy([1, 1, 2, 1, 0.4, 1]) },
            knobScaleY: { scale: xy([1, 1, 1, 2.2, 1, 0.5]) },
            knobShearY: { shear: xy([0, 0, 0, 40, 0, -30]) },
            // moves only while a skin has the bone
            knobSkin: { rotate: k([0, 80, -40]) },
            tilt: { rotate: k([0, 30]) },
            t1: { rotate: k([0, -60]), scale: xy([1, 1, 0.7, 1.2]) },
            t2: { translate: xy([0, 0, 10, 10]) },
            t4: { rotate: k([0, 90, -90]) },
            t6: { scale: xy([1, 1, 1.3, 0.8]) },
            t8: { rotate: k([0, 45]) },
            leg1: { rotate: k([0, -30]) },
            target: { translate: xy([0, 0, 30, -20]) },
            src: { rotate: k([0, -60, 60]) },
        },
        ik: { leg: keysOf(['mix', 'softness'], [1, 4, 0.5, 0], 2) },
        physics: { bob: { wind: k([0, -20]) }, charm: { strength: k([100, 30]), reset: [{ time: 1 }] } },
        slider: {
            own: { time: k([0.3, 1, 0]), mix: k([0.8, 0.2, 1]) },
            // needs a skin
            skinned: { time: k([0.4, 1.1]), mix: k([1, 0.5]) },
            // the mix of a slider that reads a bone
            rotate: { mix: k([1, 0.5]) },
            post: { mix: k([0.6, 0, 1]) },
        },
        events: [{ time: 1, name: 'tick', int: 7 }],
    };
}

/** Other keys on some of the same values, so that mixes hold and release. */
function other(): Json {
    const k = (values: number[]): Json[] => keys(values, 1.3);
    const xy = (points: number[]): Json[] => keysXY(points, 1.3);

    return {
        bones: {
            knobRotate: { rotate: k([90, -90]) },
            knobX: { translate: xy([40, 0, -40, 0]) },
            knobScaleX: { scale: xy([0.8, 1, 1.6, 1]) },
            knobSkin: { rotate: k([-30, 60]) },
            t3: { rotate: k([0, 70]), inherit: [{ time: 0.3, inherit: 'noRotationOrReflection' }] },
            t5: { scale: xy([1, 1, 1.4, 1.4]) },
            t9: { rotate: k([0, 200]) },
            leg2: { rotate: k([0, 50]) },
            dst: { rotate: k([0, -45]) },
            p1: { translate: xy([0, 0, 15, -15]) },
        },
        path: { ride: { position: k([0.3, 0.8]) } },
        physics: { '': { wind: k([0, -15]), mix: k([1, 0.5]), reset: [{ time: 0.6 }] } },
        slider: { own: { time: k([0.6, 0.1]) }, own2: { mix: k([0.5, 1]) }, frozen: { mix: k([0.5, 1, 0]) } },
    };
}

/** One key at time 0: an animation without a length. A slider plays it too. */
function still(): Json {
    return {
        bones: { t10: { rotate: [{ value: 75 }], scale: [{ x: 1.5, y: 0.5 }] }, knobY: { translate: [{ y: 35 }] } },
        slider: { own: { time: [{ value: 0.7 }], mix: [{ value: 0.4 }] } },
    };
}

function parts(): RigParts {
    return {
        bones: bones(),
        slots: [{ name: 'rail', bone: 'root', attachment: 'rail' }],
        constraints: constraintLists('4.3', constraints()),
        skins: [
            { name: 'default', attachments: { rail: { rail: pathAttachment([-40, -110, 0, -90, 40, -115]) } } },
            { name: 'extra', bones: ['knobSkin'], slider: ['skinned'], physics: ['charm'] },
            // the bone without the constraints, and the constraints without the bone
            { name: 'bone', bones: ['knobSkin'] },
            { name: 'slider', slider: ['skinned'], physics: ['charm'] },
        ],
        events: { tick: { int: 1 } },
        animations: {
            main: main(),
            other: other(),
            turn: turn(),
            wave: wave(),
            pulse: pulse(),
            nod: nod(),
            bend: bend(),
            drive: drive(),
            wake: wakeSlider(),
            still: still(),
        },
    };
}

/** The slider rig, for the one version that has sliders. */
export const sliderRigs = () => madeRig('made-slider', parts, ['4.3']);
