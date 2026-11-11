import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importJson43 } from '../../src/formats/json43/index';
import { differences } from '../parity/compare';
import { officialModel } from '../parity/model-official';

const f32 = (...values: number[]): Float32Array => Float32Array.from(values);
const i16 = (...values: number[]): Int16Array => Int16Array.from(values);

/** An atlas with every region of the skeleton below. The official core needs it to load the file. */
const REGIONS = ['quad', 'skinned', 'copy', 'far', 'echo', 'b', 'B', ...[1, 2, 3, 4].map((n) => `walk/frame0${n}`)];
const ATLAS = ['page.png', '\tsize: 8, 8', ...REGIONS.flatMap((name) => [name, '\tbounds: 0, 0, 8, 8'])].join('\n');

/** A small skeleton file that uses what the official example exports leave out. */
const RIG = `{
"skeleton": { "spine": "4.3.39-beta", "hash": "h", "x": 1, "y": 2, "width": 3, "height": 4 },
"bones": [
    { "name": "root" },
    { "name": "arm", "parent": "root", "length": 5, "x": 1, "y": 2, "rotation": 90, "scaleX": 2, "shearY": 5,
      "inherit": "noScale", "skin": true },
    { "name": "hand", "parent": "arm", "inherit": "OnlyTranslation" }
],
"slots": [
    { "name": "back", "bone": "root" },
    { "name": "body", "bone": "arm", "color": "ff000080", "dark": "00ff00", "attachment": "box", "blend": "screen",
      "visible": false },
    { "name": "front", "bone": "hand" },
    { "name": "top", "bone": "hand" }
],
"constraints": [
    { "type": "ik", "name": "reach", "bones": ["arm"], "target": "hand", "scaleY": "uniform", "bendPositive": false },
    { "type": "transform", "name": "copy", "bones": ["hand"], "source": "root", "x": 2, "mixX": 0.5,
      "properties": { "rotate": { "offset": 1, "to": { "x": { "max": 3 }, "y": {} } }, "x": {} } },
    { "type": "path", "name": "rail", "bones": ["arm"], "slot": "front", "spacingMode": "percent" },
    { "type": "physics", "name": "sway", "bone": "hand", "fps": 30, "mass": 4, "scaleY": "volume" },
    { "type": "slider", "name": "dial", "animation": "second", "time": 0.5 },
    { "type": "slider", "name": "lever", "animation": "first", "bone": "arm", "property": "y", "from": 1, "to": 2,
      "scale": 3, "time": 9 }
],
"skins": [
    { "name": "default", "attachments": {
        "body": {
            "box": { "type": "boundingbox", "vertexCount": 3, "vertices": [0, 0, 10, 0, 10, 10] },
            "quad": { "type": "mesh", "uvs": [0, 0, 1, 0, 1, 1], "triangles": [0, 1, 2], "hull": 3,
                      "vertices": [0, 0, 10, 0, 10, 10] },
            "skinned": { "type": "mesh", "uvs": [0, 0, 1, 0], "triangles": [],
                         "vertices": [1, 1, 5, 6, 1, 2, 0, 1, 2, 0.5, 2, 3, 4, 0.5] },
            "copy": { "type": "linkedmesh", "source": "quad", "width": 7, "height": 8 }
        },
        "front": {
            "rail": { "type": "path", "vertexCount": 6, "lengths": [4], "closed": true,
                      "vertices": [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] },
            "pin": { "type": "point", "x": 1, "rotation": 30 },
            "mask": { "type": "clipping", "end": "top", "vertexCount": 3, "vertices": [0, 0, 1, 0, 1, 1], "convex": true },
            "frames": { "name": "walk", "path": "walk/frame", "width": 2, "height": 3,
                        "sequence": { "count": 4, "digits": 2 } }
        }
    } },
    { "name": "alt", "bones": ["hand"], "ik": ["reach"], "slider": ["lever"], "path": ["rail"], "attachments": {
        "top": { "b": { "width": 1, "height": 1 }, "B": { "width": 1, "height": 1 },
                 "echo": { "type": "linkedmesh", "source": "quad", "slot": "body", "skin": "default" } },
        "back": { "far": { "type": "linkedmesh", "source": "skinned", "slot": "body", "skin": "default",
                           "timelines": false } }
    } }
],
"events": {
    "step": {},
    "bang": { "int": 2, "float": 1.5, "string": "loud", "audio": "bang.wav", "volume": 0.5 },
    "mute": { "volume": 0.9 }
},
"animations": {
    "first": {
        "slots": { "body": {
            "attachment": [{ "name": "quad" }, { "time": 0.5, "name": null }],
            "rgba": [{ "color": "ff000080" }, { "time": 1, "color": "00ff00" }],
            "rgb": [{ "color": "ff0000", "curve": "stepped" }, { "time": 1, "color": "0000ff" }],
            "alpha": [{ "value": 0.5 }, { "time": 1 }],
            "rgba2": [{ "light": "ffffffff", "dark": "000000" }],
            "rgb2": [{ "light": "ffffff", "dark": "ff0000" }]
        } },
        "bones": {
            "arm": {
                "rotate": [{ "value": 10, "curve": [0.25, 10, 0.75, 20] }, { "time": 1, "value": 20 }],
                "translate": [{ "x": 1 }, { "time": 1, "y": 2 }],
                "translatex": [{ "value": 1 }], "translatey": [{ "value": 1 }],
                "scale": [{ "x": 2 }], "scalex": [{}], "scaley": [{}],
                "shear": [{}], "shearx": [{}], "sheary": [{}],
                "inherit": [{ "inherit": "noScale" }, { "time": 0.5 }]
            },
            "hand": { "rotate": [] }
        },
        "ik": { "reach": [{ "mix": 0.5, "bendPositive": false, "compress": true },
                          { "time": 1, "softness": 2, "stretch": true }] },
        "transform": { "copy": [{ "mixX": 0.5 }], "missing": [] },
        "path": { "rail": { "position": [{ "value": 1 }], "spacing": [{}], "mix": [{ "mixX": 0.5 }], "other": [] } },
        "physics": {
            "sway": { "inertia": [{ "value": 1 }], "strength": [{}], "damping": [{}], "mass": [{}], "wind": [{}],
                      "gravity": [{}], "mix": [{}], "reset": [{ "time": 0.25 }] },
            "": { "wind": [{ "value": 3 }] }
        },
        "slider": { "dial": { "time": [{}], "mix": [{ "value": 0.5 }] } },
        "attachments": { "default": {
            "body": {
                "quad": { "deform": [{ "offset": 2, "vertices": [1, 2], "curve": [0.25, 0, 0.75, 1] }, { "time": 1 }] },
                "skinned": { "deform": [{ "offset": 1, "vertices": [0.5], "curve": "stepped" }, { "time": 0.5 }] },
                "copy": { "deform": [{ "vertices": [1] }] }
            },
            "front": { "frames": { "sequence": [{ "mode": "loop", "index": 2, "delay": 0.1 }, { "time": 1 }] } }
        } },
        "drawOrder": [{ "offsets": [{ "slot": "back", "offset": 2 }] }, { "time": 1 }],
        "drawOrderFolder": [
            { "slots": ["body", "top"], "keys": [{ "time": 0.5, "offsets": [{ "slot": "body", "offset": 1 }] }] }
        ],
        "events": [
            { "name": "step" },
            { "time": 0.5, "name": "bang" },
            { "time": 2.1, "name": "bang", "int": 7, "float": 3, "string": "x", "volume": 0.25, "balance": 1 },
            { "time": 2.1, "name": "mute", "volume": 0.25 }
        ]
    },
    "second": {}
}
}`;

describe('importJson43', () => {
    const model = importJson43(JSON.parse(RIG));
    const timelines = model.animations[0]?.timelines ?? [];
    const timeline = (kind: string, nth = 0) => timelines.filter((candidate) => candidate.kind === kind)[nth];

    it('holds what the official core holds after loading the same file', () => {
        expect(differences(model, officialModel('4.3', { skeleton: RIG, atlas: ATLAS }))).toEqual([]);
    });

    it('reads the header, bones and slots', () => {
        expect(model).toMatchObject({ version: '4.3', editorVersion: '4.3.39-beta', hash: 'h', x: 1, y: 2, width: 3 });
        expect(model.referenceScale).toBe(100);
        expect(model.bones.parents).toEqual(i16(-1, 0, 1));
        expect(model.bones.setup.slice(7, 14)).toEqual(f32(1, 2, 90, 2, 1, 0, 5));
        expect(model.bones.inherit).toEqual(Uint8Array.of(0, 3, 1));
        expect(model.bones.skinRequired).toEqual(Uint8Array.of(0, 1, 0));
        expect(model.slots.colors.slice(0, 8)).toEqual(f32(1, 1, 1, 1, 1, 0, 0, 128 / 255));
        expect(model.slots.darkColors).toEqual(f32(0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0));
        expect(model.slots.hasDark).toEqual(Uint8Array.of(0, 1, 0, 0));
        expect(model.slots.attachments).toEqual([null, 'box', null, null]);
        expect(model.slots.blendModes).toEqual(Uint8Array.of(0, 3, 0, 0));
        expect(model.slots.visible).toEqual(Uint8Array.of(1, 0, 1, 1));
    });

    it('reads constraints with the defaults of the official parser', () => {
        const [reach, copy, rail, sway, dial, lever] = model.constraints;
        const to = { offset: 0, max: 1, scale: 1 };

        expect(reach).toMatchObject({ type: 'ik', bones: i16(1), target: 2, scaleYMode: 'uniform', bendDirection: -1 });
        // a mix is 0 unless a mapping writes its property. The Y mix falls back to the X mix
        expect(copy).toMatchObject({ mixRotate: 0, mixX: 0.5, mixY: 0.5, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 });
        expect(copy).toMatchObject({ offsets: f32(0, 2, 0, 0, 0, 0), localSource: false, clamp: false });
        // the source property `x` feeds nothing, so it is dropped
        expect(copy).toMatchObject({
            properties: [
                {
                    property: 'rotate',
                    offset: 1,
                    to: [
                        { ...to, property: 'x', max: 3 },
                        { ...to, property: 'y' },
                    ],
                },
            ],
        });
        expect(rail).toMatchObject({ slot: 2, positionMode: 'percent', spacingMode: 'percent', rotateMode: 'tangent' });
        expect(rail).toMatchObject({ mixRotate: 1, mixX: 1, mixY: 1 });
        expect(sway).toMatchObject({ bone: 2, step: 1 / 30, massInverse: 0.25, limit: 5000, scaleYMode: 'volume' });
        expect(dial).toMatchObject({ animation: 1, time: 0.5, bone: -1, property: null, scale: 0 });
        // a slider that a bone drives ignores `time`
        expect(lever).toMatchObject({ animation: 0, time: 0, bone: 1, property: 'y', propertyOffset: 1, offset: 2 });
        expect(lever).toMatchObject({ scale: 3, max: 0, local: false });
    });

    it('reads skins sorted by slot and name', () => {
        const [first, alt] = model.skins;
        const keys = (skin: typeof first) => skin?.attachments.map(({ slot, name }) => `${slot}:${name}`).join(' ');

        expect(keys(first)).toBe('1:box 1:copy 1:quad 1:skinned 2:frames 2:mask 2:pin 2:rail');
        expect(keys(alt)).toBe('0:far 3:B 3:b 3:echo');
        expect(alt).toMatchObject({ bones: i16(2), constraints: i16(0, 2, 5) });
    });

    it('reads attachments', () => {
        const attachments = (model.skins[0]?.attachments ?? []).map((entry) => entry.attachment);
        const [box, copy, quad, skinned, frames, mask, pin, rail] = attachments;
        const far = model.skins[1]?.attachments[0]?.attachment;
        const source = { skin: 0, slot: 1, name: 'quad' };

        expect(box).toMatchObject({ type: 'boundingbox', vertices: f32(0, 0, 10, 0, 10, 10), bones: null });
        expect(box).toMatchObject({ name: 'box', worldVerticesLength: 6 });
        expect(quad).toMatchObject({ path: 'quad', regionUVs: f32(0, 0, 1, 0, 1, 1), hullLength: 6, parent: null });
        expect(quad).toMatchObject({ triangles: Uint16Array.of(0, 1, 2), timelineAttachment: null, sequence: null });
        // the linked mesh `echo` follows the timelines of `quad` from another slot
        expect(quad).toMatchObject({ timelineSlots: i16(3) });
        expect(skinned).not.toHaveProperty('timelineSlots');
        expect(skinned).toMatchObject({ bones: i16(1, 1, 2, 0, 2), vertices: f32(5, 6, 1, 1, 2, 0.5, 3, 4, 0.5) });
        expect(skinned).toMatchObject({ worldVerticesLength: 4, hullLength: 0 });
        // the official parser gives a linked mesh the size of its source
        expect(copy).toMatchObject({ parent: source, timelineAttachment: source, width: 0, height: 0, hullLength: 0 });
        expect(copy).toMatchObject({ vertices: f32(), regionUVs: f32(), triangles: Uint16Array.of(), bones: null });
        expect(frames).toMatchObject({ type: 'region', name: 'walk', path: 'walk/frame', color: f32(1, 1, 1, 1) });
        expect(frames).toMatchObject({ scaleX: 1, sequence: { count: 4, start: 1, digits: 2, setupIndex: 0 } });
        expect(mask).toMatchObject({ type: 'clipping', endSlot: 3, convex: true, inverse: false });
        expect(pin).toEqual({ type: 'point', name: 'pin', x: 1, y: 0, rotation: 30 });
        expect(rail).toMatchObject({ closed: true, constantSpeed: true, lengths: f32(4, 0), worldVerticesLength: 12 });
        // `far` has its own timelines, so its source lists no slot for it
        expect(far).toMatchObject({ parent: { skin: 0, slot: 1, name: 'skinned' }, timelineAttachment: null });
    });

    it('reads events', () => {
        const none = { int: 0, float: 0, string: '', audioPath: null, volume: 0, balance: 0 };

        expect(model.events).toEqual([
            { ...none, name: 'step' },
            { name: 'bang', int: 2, float: 1.5, string: 'loud', audioPath: 'bang.wav', volume: 0.5, balance: 0 },
            // volume and balance are read only for an event with audio
            { ...none, name: 'mute' },
        ]);
    });

    it('creates the timelines in the order of the official parser', () => {
        expect(timelines.map(({ kind }) => kind)).toEqual([
            ...['attachment', 'rgba', 'rgb', 'alpha', 'rgba2', 'rgb2'],
            ...['rotate', 'translate', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY'],
            ...['shear', 'shearX', 'shearY', 'inherit'],
            ...['ikConstraint', 'transformConstraint'],
            ...['pathConstraintPosition', 'pathConstraintSpacing', 'pathConstraintMix'],
            ...['physicsConstraintInertia', 'physicsConstraintStrength', 'physicsConstraintDamping'],
            ...['physicsConstraintMass', 'physicsConstraintWind', 'physicsConstraintGravity'],
            ...['physicsConstraintMix', 'physicsConstraintReset', 'physicsConstraintWind'],
            ...['slider', 'sliderMix', 'deform', 'deform', 'deform', 'sequence'],
            ...['drawOrder', 'drawOrderFolder', 'event'],
        ]);
        // the duration is the time of the last key, as a float
        expect(model.animations.map(({ duration }) => duration)).toEqual([Math.fround(2.1), 0]);
    });

    it('reads slot timelines', () => {
        expect(timeline('attachment')).toMatchObject({ target: 1, frames: f32(0, 0.5), curves: null });
        expect(timeline('attachment')).toMatchObject({ attachmentNames: ['quad', null] });
        // a key without a curve is linear. The last key is marked as stepped
        expect(timeline('rgba')).toMatchObject({
            frames: f32(0, 1, 0, 0, 128 / 255, 1, 0, 1, 0, 1),
            curves: f32(0, 1),
        });
        expect(timeline('rgb')).toMatchObject({ frames: f32(0, 1, 0, 0, 1, 0, 0, 1), curves: f32(1, 1) });
        expect(timeline('alpha')).toMatchObject({ frames: f32(0, 0.5, 1, 0), curves: f32(0, 1) });
        expect(timeline('rgba2')).toMatchObject({ frames: f32(0, 1, 1, 1, 1, 0, 0, 0), curves: f32(1) });
        expect(timeline('rgb2')).toMatchObject({ frames: f32(0, 1, 1, 1, 1, 0, 0), curves: f32(1) });
    });

    it('reads bone timelines', () => {
        const rotate = timeline('rotate');

        expect(rotate).toMatchObject({ target: 1, frames: f32(0, 10, 1, 20) });
        // one Bezier curve after the two key types. The first key points at its samples
        expect(rotate?.curves).toHaveLength(2 + 18);
        expect(rotate?.curves?.[0]).toBe(2 + 2);
        expect(rotate?.curves?.[2]).toBeCloseTo(0.082, 6);
        expect(rotate?.curves?.[3]).toBeCloseTo(10.28, 5);
        expect(timeline('translate')).toMatchObject({ frames: f32(0, 1, 0, 1, 0, 2), curves: f32(0, 1) });
        expect(timeline('scale')).toMatchObject({ frames: f32(0, 2, 1) });
        expect(timeline('scaleX')).toMatchObject({ frames: f32(0, 1) });
        expect(timeline('shearY')).toMatchObject({ frames: f32(0, 0) });
        expect(timeline('inherit')).toEqual({ kind: 'inherit', target: 1, frames: f32(0, 3, 0.5, 0), curves: null });
    });

    it('reads constraint timelines', () => {
        const ik = f32(0, 0.5, 0, -1, 1, 0, 1, 1, 2, 1, 0, 1);

        expect(timeline('ikConstraint')).toMatchObject({ target: 0, frames: ik, curves: f32(0, 1) });
        expect(timeline('transformConstraint')).toMatchObject({ target: 1, frames: f32(0, 1, 0.5, 0.5, 1, 1, 1) });
        expect(timeline('pathConstraintPosition')).toMatchObject({ target: 2, frames: f32(0, 1) });
        expect(timeline('pathConstraintMix')).toMatchObject({ target: 2, frames: f32(0, 1, 0.5, 0.5) });
        expect(timeline('physicsConstraintMix')).toMatchObject({ target: 3, frames: f32(0, 1) });
        expect(timeline('physicsConstraintReset')).toMatchObject({ target: 3, frames: f32(0.25), curves: null });
        // the constraint name "" stands for every physics constraint
        expect(timeline('physicsConstraintWind', 1)).toMatchObject({ target: -1, frames: f32(0, 3) });
        expect(timeline('slider')).toMatchObject({ target: 4, frames: f32(0, 1) });
        expect(timeline('sliderMix')).toMatchObject({ target: 4, frames: f32(0, 0.5) });
    });

    it('reads deform and sequence timelines', () => {
        const quad = timeline('deform');

        // without weights a key holds positions: the setup vertices plus the offsets
        expect(quad).toMatchObject({ target: 1, attachment: { skin: 0, slot: 1, name: 'quad' }, frames: f32(0, 1) });
        expect(quad?.vertices).toEqual([f32(0, 0, 11, 2, 10, 10), f32(0, 0, 10, 0, 10, 10)]);
        expect(quad?.curves).toHaveLength(2 + 18);
        expect(quad?.curves?.[0]).toBe(2 + 2);
        // with weights a key holds the offsets alone
        expect(timeline('deform', 1)).toMatchObject({ vertices: [f32(0, 0.5, 0, 0, 0, 0), f32(0, 0, 0, 0, 0, 0)] });
        expect(timeline('deform', 1)?.curves).toEqual(f32(1, 1));
        // a linked mesh is deformed with the vertices of its source
        expect(timeline('deform', 2)).toMatchObject({ vertices: [f32(1, 0, 10, 0, 10, 10)] });
        // a sequence key packs the mode and the index into one float. The delay carries over
        expect(timeline('sequence')).toMatchObject({ target: 2, frames: f32(0, 2 | (2 << 4), 0.1, 1, 0, 0.1) });
        expect(timeline('sequence')).toMatchObject({ curves: null, attachment: { skin: 0, slot: 2, name: 'frames' } });
    });

    it('reads draw order and event timelines', () => {
        const late = Math.fround(2.1);

        expect(timeline('drawOrder')).toMatchObject({ target: -1, frames: f32(0, 1) });
        expect(timeline('drawOrder')).toMatchObject({ drawOrders: [i16(1, 2, 0, 3), null] });
        // a folder key counts positions and slots within the folder
        expect(timeline('drawOrderFolder')).toMatchObject({ target: -1, frames: f32(0.5), curves: null });
        expect(timeline('drawOrderFolder')).toMatchObject({ drawOrders: [i16(1, 0)], folderSlots: i16(1, 3) });
        expect(timeline('event')).toMatchObject({ frames: f32(0, 0.5, 2.1, 2.1) });
        expect(timeline('event')?.events).toEqual([
            { time: 0, event: 0, int: 0, float: 0, string: '', volume: 0, balance: 0 },
            // the official parser falls back to the volume of the event for the balance
            { time: 0.5, event: 1, int: 2, float: 1.5, string: 'loud', volume: 0.5, balance: 0.5 },
            { time: late, event: 1, int: 7, float: 3, string: 'x', volume: 0.25, balance: 1 },
            // an event without audio keeps volume and balance at 0
            { time: late, event: 2, int: 0, float: 0, string: '', volume: 0, balance: 0 },
        ]);
    });
});

/** A valid skeleton. Each broken one below replaces one part of it. */
const BASE = JSON.parse(`{
"skeleton": { "spine": "4.3.39" },
"bones": [{ "name": "root" }],
"slots": [{ "name": "slot", "bone": "root" }, { "name": "next", "bone": "root" }],
"constraints": [
    { "type": "path", "name": "rail", "bones": ["root"], "slot": "slot" },
    { "type": "physics", "name": "sway", "bone": "root" },
    { "type": "slider", "name": "dial", "animation": "idle" }
],
"skins": [{ "name": "default", "attachments": { "slot": {
    "box": { "type": "boundingbox", "vertexCount": 1, "vertices": [0, 0] },
    "image": { "width": 1, "height": 1 },
    "quad": { "type": "mesh", "uvs": [0, 0, 1, 0], "triangles": [], "vertices": [0, 0, 1, 0] }
} } }],
"events": { "step": {} },
"animations": { "idle": {} }
}`);
const CONSTRAINTS = {
    ik: { bones: ['root'], target: 'root' },
    transform: { bones: [], source: 'root' },
    path: { bones: [], slot: 'slot' },
    physics: { bone: 'root' },
    slider: { animation: 'idle' },
};
const withParts = (parts: object): object => ({ ...BASE, ...parts });
const constraint = (type: keyof typeof CONSTRAINTS, map: object): object =>
    withParts({ constraints: [{ type, name: 'c', ...CONSTRAINTS[type], ...map }] });
const skin = (map: object, name = 'default'): object => withParts({ skins: [{ name, ...map }] });
const attachment = (map: object, skinName?: string): object =>
    skin({ attachments: { slot: { image: { width: 1, height: 1 }, broken: map } } }, skinName);
const box = (vertexCount: number, vertices: number[]): object =>
    attachment({ type: 'boundingbox', vertexCount, vertices });
const linked = (map: object, skinName?: string): object =>
    attachment({ type: 'linkedmesh', source: 'quad', ...map }, skinName);
const animation = (map: object): object => withParts({ animations: { idle: {}, run: map } });
/** An animation with one timeline, in the section `slots`, `bones`, `path`, `physics` or `slider`. */
const keyed = (section: string, target: string, name: string, keys: object[]): object =>
    animation({ [section]: { [target]: { [name]: keys } } });
/** An animation with one timeline for an attachment of the default skin. */
const attached = (name: string, timeline: string, keys: object[]): object =>
    animation({ attachments: { default: { slot: { [name]: { [timeline]: keys } } } } });
const drawOrder = (...offsets: [slot: string, offset: number][]): object =>
    animation({ drawOrder: [{ offsets: offsets.map(([slot, offset]) => ({ slot, offset })) }] });
const folder = (slots: string[], keys?: object[]): object => animation({ drawOrderFolder: [{ slots, keys }] });

/** A skeleton that cannot be imported, and words its error must hold. */
type Broken = [label: string, source: object, words: string];

const BROKEN: Broken[] = [
    ['no version', { bones: [] }, 'skeleton.spine'],
    ['a value of the wrong type', withParts({ bones: 5 }), 'does not have the shape'],
    ['a bone without a name', withParts({ bones: [{}] }), 'Bone 0 has no name'],
    ['an unknown parent bone', withParts({ bones: [{ name: 'root', parent: 'nope' }] }), 'the bone "nope"'],
    ['an unknown inherit mode', withParts({ bones: [{ name: 'root', inherit: 'sideways' }] }), '"sideways"'],
    ['an unknown slot bone', withParts({ slots: [{ name: 'slot', bone: 'nope' }] }), 'the bone "nope"'],
    ['a slot without a bone', withParts({ slots: [{ name: 'slot' }] }), 'the bone "undefined"'],
    ['an unknown blend mode', withParts({ slots: [{ name: 'slot', bone: 'root', blend: 'glow' }] }), '"glow"'],
    ['a constraint without a name', constraint('ik', { name: '' }), 'Constraint 0 has no name'],
    ['an unknown constraint type', constraint('ik', { type: 'spring' }), 'the unknown type "spring"'],
    ['an unknown IK bone', constraint('ik', { bones: ['nope'] }), 'the bone "nope"'],
    ['an unknown IK target', constraint('ik', { target: 'nope' }), 'the bone "nope"'],
    ['an IK constraint without bones', constraint('ik', { bones: null }), 'The bone list'],
    ['an unknown scale Y mode', constraint('ik', { scaleY: 'cube' }), '"cube"'],
    ['an unknown transform source', constraint('transform', { source: 'nope' }), 'the bone "nope"'],
    ['an unknown source property', constraint('transform', { properties: { spin: {} } }), 'property "spin"'],
    ['an unknown target property', constraint('transform', { properties: { x: { to: { spin: {} } } } }), '"spin"'],
    ['an unknown path slot', constraint('path', { slot: 'nope' }), 'the slot "nope"'],
    ['an unknown position mode', constraint('path', { positionMode: 'far' }), '"far"'],
    ['an unknown physics bone', constraint('physics', { bone: 'nope' }), 'the bone "nope"'],
    ['an unknown slider bone', constraint('slider', { bone: 'nope' }), 'the bone "nope"'],
    ['an unknown slider property', constraint('slider', { bone: 'root', property: 'z' }), 'property "z"'],
    ['an unknown slider animation', constraint('slider', { animation: 'nope' }), 'the animation "nope"'],
    ['a slider without an animation', constraint('slider', { animation: null }), 'the animation "null"'],
    ['a skin without a name', withParts({ skins: [{}] }), 'Skin 0 has no name'],
    ['an unknown skin bone', skin({ bones: ['nope'] }), 'the bone "nope"'],
    ['an unknown skin IK constraint', skin({ ik: ['rail'] }), 'the IK constraint "rail"'],
    ['an unknown skin transform constraint', skin({ transform: ['nope'] }), 'the transform constraint "nope"'],
    ['an unknown skin path constraint', skin({ path: ['nope'] }), 'the path constraint "nope"'],
    ['an unknown skin physics constraint', skin({ physics: ['nope'] }), 'the physics constraint "nope"'],
    ['an unknown skin slider', skin({ slider: ['nope'] }), 'the slider "nope"'],
    ['an unknown skin slot', skin({ attachments: { nope: {} } }), 'the slot "nope"'],
    ['an unknown attachment type', attachment({ type: 'blob' }), 'the unknown type "blob"'],
    ['a region without a size', attachment({ width: 1 }), 'no width or no height'],
    ['a mesh without UVs', attachment({ type: 'mesh', vertices: [], triangles: [] }), 'The UV list'],
    ['a mesh without triangles', attachment({ type: 'mesh', vertices: [], uvs: [] }), 'The triangle list'],
    ['a mesh without vertices', attachment({ type: 'mesh', uvs: [], triangles: [] }), 'The vertex list'],
    ['weights that are cut short', box(2, [1, 0, 1]), 'ends before its data does'],
    ['a weight for an unknown bone', box(1, [1, 7, 0, 0, 1]), 'the bone index 7'],
    ['an unknown clipping end slot', attachment({ type: 'clipping', end: 'nope', vertices: [] }), 'the slot "nope"'],
    ['a path without lengths', attachment({ type: 'path', vertices: [] }), 'The length list'],
    ['a linked mesh in an unknown skin', linked({ skin: 'nope' }), 'the skin "nope"'],
    ['a linked mesh in an unknown slot', linked({ slot: 'nope' }), 'the slot "nope"'],
    ['a linked mesh without a source mesh', linked({ source: 'nope' }), 'the mesh "nope"'],
    ['a linked mesh that follows a region', linked({ source: 'image' }), 'the mesh "image"'],
    ['a linked mesh without a default skin', linked({}, 'other'), 'no default skin'],
    ['an animation without a name', withParts({ animations: { '': {} } }), 'An animation has no name'],
    ['an unknown slot in an animation', animation({ slots: { nope: {} } }), 'the slot "nope"'],
    ['an unknown slot timeline', keyed('slots', 'slot', 'glow', [{}]), 'the unknown type "glow"'],
    ['a slot timeline without keys', keyed('slots', 'slot', 'rgba', []), 'the type "rgba" without keys'],
    ['an attachment timeline without keys', keyed('slots', 'slot', 'attachment', []), 'without keys'],
    ['a color key without a color', keyed('slots', 'slot', 'rgb', [{}]), 'without a color'],
    ['an unknown curve', keyed('slots', 'slot', 'alpha', [{ curve: 'bouncy' }, {}]), 'the unknown curve "bouncy"'],
    ['a curve that is too short', keyed('bones', 'root', 'scale', [{ curve: [0, 0, 1, 1] }, {}]), 'too few numbers'],
    ['an unknown bone in an animation', animation({ bones: { nope: {} } }), 'the bone "nope"'],
    ['an unknown bone timeline', keyed('bones', 'root', 'wobble', [{}]), 'the unknown type "wobble"'],
    ['an unknown inherit key', keyed('bones', 'root', 'inherit', [{ inherit: 'up' }]), '"up"'],
    ['an unknown IK timeline constraint', animation({ ik: { nope: [{}] } }), 'the IK constraint "nope"'],
    ['an unknown transform timeline constraint', animation({ transform: { nope: [{}] } }), 'constraint "nope"'],
    ['an unknown path timeline constraint', animation({ path: { nope: {} } }), 'the path constraint "nope"'],
    ['an unknown path timeline', keyed('path', 'rail', 'bend', [{}]), 'the unknown type "bend"'],
    ['an unknown physics timeline constraint', animation({ physics: { nope: {} } }), 'the physics constraint "nope"'],
    ['an unknown physics timeline', keyed('physics', 'sway', 'bounce', [{}]), 'the unknown type "bounce"'],
    ['an unknown slider in an animation', animation({ slider: { nope: {} } }), 'the slider "nope"'],
    ['an unknown slider timeline', keyed('slider', 'dial', 'speed', [{}]), 'the unknown type "speed"'],
    ['an unknown skin in an animation', animation({ attachments: { nope: {} } }), 'the skin "nope"'],
    ['an unknown attachment slot', animation({ attachments: { default: { nope: {} } } }), 'the slot "nope"'],
    ['an unknown timeline attachment', attached('nope', 'deform', [{}]), 'the attachment "nope"'],
    ['an unknown attachment timeline', attached('quad', 'twist', [{}]), 'the unknown type "twist"'],
    ['a deform timeline for a region', attached('image', 'deform', [{}]), 'which has no vertices'],
    ['a deform key that is too long', attached('quad', 'deform', [{ offset: 3, vertices: [1, 2] }]), 'more vertices'],
    ['a deform curve that is too short', attached('quad', 'deform', [{ curve: [0, 0] }, {}]), 'four numbers'],
    ['a sequence timeline for a bounding box', attached('box', 'sequence', [{}]), 'which is no region or mesh'],
    ['an unknown sequence mode', attached('image', 'sequence', [{ mode: 'shuffle' }]), 'the unknown mode "shuffle"'],
    ['an unknown draw order slot', drawOrder(['nope', 1]), 'the slot "nope"'],
    ['draw order offsets out of slot order', drawOrder(['next', -1], ['slot', 1]), 'not in slot order'],
    ['a draw order offset past the end', drawOrder(['next', 1]), 'to a position that is not free'],
    ['two slots moved to one position', drawOrder(['slot', 1], ['next', 0]), 'to a position that is not free'],
    ['a draw order timeline without keys', animation({ drawOrder: [] }), 'the type "drawOrder" without keys'],
    ['an unknown folder slot', folder(['nope']), 'the slot "nope"'],
    ['a key for a slot outside its folder', folder(['slot'], [{ offsets: [{ slot: 'next' }] }]), 'does not hold it'],
    ['a folder timeline without keys', folder(['slot']), 'the type "drawOrderFolder" without keys'],
    ['an unknown event', animation({ events: [{ name: 'nope' }] }), 'the event "nope"'],
    ['an event timeline without keys', animation({ events: [] }), 'the type "event" without keys'],
];

describe('importJson43 with broken data', () => {
    it.each(BROKEN)('rejects %s', (_label, source, words) => {
        const run = () => importJson43(source);

        expect(run).toThrow(MarrowError);
        expect(run).toThrow(expect.objectContaining({ code: 'invalid-data', message: expect.stringContaining(words) }));
    });

    it('lists the names that exist', () => {
        const source = withParts({ slots: [{ name: 'slot', bone: 'nope' }] });

        expect(() => importJson43(source)).toThrow(expect.objectContaining({ validNames: ['root'] }));
    });

    it('imports the skeleton the broken ones are made from', () => {
        expect(importJson43(BASE).constraints.map(({ name }) => name)).toEqual(['rail', 'sway', 'dial']);
    });
});
