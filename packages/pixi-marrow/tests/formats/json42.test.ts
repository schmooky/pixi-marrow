import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importJson42 } from '../../src/formats/json42/index';
import { differences } from '../parity/compare';
import { officialModel } from '../parity/model-official';

type Version = '4.1' | '4.2';

/** The regions the rig below draws: one image and the frames of two sequences. */
const ATLAS = [
    'page.png',
    'size: 64, 64',
    'filter: Linear, Linear',
    ...['img', 'seq01', 'seq02', 'seq03'].flatMap((name, i) => [name, `bounds: ${i * 8}, 0, 8, 8`]),
    '',
].join('\n');

/**
 * A hand-written skeleton with what the official example exports lack: every timeline type with
 * Bezier and stepped keys, linked meshes in chains, weighted paths, defaults next to set values.
 * `"curve": 3` stands for the Bezier handles of three values. `rig` fills the numbers in.
 */
function rigText(version: Version): string {
    const mode = version === '4.2' ? 'inherit' : 'transform';
    const inherit =
        version === '4.2'
            ? ', "inherit": [{ "inherit": "noScale" }, { "time": 0.5 }, { "time": 1.5, "inherit": "OnlyTranslation" }]'
            : '';

    return `{
"skeleton": { "hash": "h", "spine": "${version}.24", "x": -1.5, "y": 2.25, "width": 10.1, "height": 20.2, "referenceScale": 77 },
"bones": [
  { "name": "root" },
  { "name": "a", "parent": "root", "length": 3.3, "x": 1.1, "y": 2.2, "rotation": 33.3, "scaleX": 1.5, "scaleY": 0.7,
    "shearX": 3, "shearY": 4, "skin": true, "${mode}": "noScale" },
  { "name": "b", "parent": "a", "${mode}": "onlyTranslation" },
  { "name": "c", "parent": "root", "${mode}": "NoRotationOrReflection" },
  { "name": "d", "parent": "c", "${mode}": "noScaleOrReflection" }
],
"slots": [
  { "name": "s0", "bone": "root", "attachment": "img", "color": "ff8040c0", "dark": "102030" },
  { "name": "s1", "bone": "a", "blend": "additive", "color": "#336699", "visible": false },
  { "name": "s2", "bone": "b", "blend": "multiply" },
  { "name": "s3", "bone": "c", "blend": "screen", "dark": "ffffff" },
  { "name": "s4", "bone": "d" }
],
"ik": [
  { "name": "ik0", "bones": ["a", "b"], "target": "c" },
  { "name": "ik1", "order": 3, "skin": true, "bones": ["c"], "target": "d", "mix": 0.3, "softness": 4.4,
    "bendPositive": false, "compress": true, "stretch": true, "uniform": true }
],
"transform": [
  { "name": "t0", "bones": ["a"], "target": "b" },
  { "name": "t1", "order": 2, "skin": true, "bones": ["c", "d"], "target": "a", "local": true, "relative": true,
    "rotation": 1.1, "x": 2.2, "y": 3.3, "scaleX": 0.4, "scaleY": 0.5, "shearY": 6.6,
    "mixRotate": 0.1, "mixX": 0.2, "mixScaleX": 0.4, "mixShearY": 0.6 },
  { "name": "t2", "bones": ["d"], "target": "a", "mixX": 0.25, "mixY": 0.35, "mixScaleX": 0.45, "mixScaleY": 0.55 }
],
"path": [
  { "name": "p0", "bones": ["a"], "target": "s2" },
  { "name": "p1", "order": 5, "skin": true, "bones": ["c", "d"], "target": "s2", "positionMode": "fixed",
    "spacingMode": "proportional", "rotateMode": "chainScale", "rotation": 12, "position": 0.3, "spacing": 4,
    "mixRotate": 0.5, "mixX": 0.6 },
  { "name": "p2", "bones": ["d"], "target": "s2", "spacingMode": "percent", "rotateMode": "chain", "mixX": 0.6, "mixY": 0.7 }
],
"physics": [
  { "name": "ph0", "bone": "a" },
  { "name": "ph1", "order": 7, "skin": true, "bone": "d", "x": 0.1, "y": 0.2, "rotate": 0.3, "scaleX": 0.4, "shearX": 0.5,
    "limit": 123, "fps": 30, "inertia": 0.6, "strength": 77, "damping": 0.8, "mass": 3, "wind": 1.5, "gravity": -2.5,
    "mix": 0.9, "inertiaGlobal": true, "strengthGlobal": true, "dampingGlobal": true, "massGlobal": true,
    "windGlobal": true, "gravityGlobal": true, "mixGlobal": true }
],
"skins": [
  { "name": "default", "attachments": {
    "s1": {
      "zlinked": { "type": "linkedmesh", "parent": "mesh", "timelines": false, "path": "img", "width": 5, "height": 6 },
      "mesh": { "type": "mesh", "path": "img", "uvs": [0, 0, 1, 0, 1, 1, 0, 1], "triangles": [0, 1, 2, 2, 3, 0], "hull": 4,
        "vertices": [0, 0, 8, 0, 8, 8, 0, 8], "color": "11223344", "width": 8, "height": 9 },
      "wmesh": { "type": "mesh", "name": "renamed", "path": "seq", "sequence": { "count": 3, "digits": 2 },
        "uvs": [0, 0, 1, 0, 1, 1, 0, 1], "triangles": [0, 1, 2, 2, 3, 0], "hull": 4,
        "vertices": [1, 1, 0.1, 0.2, 1, 2, 1, 1.1, 2.2, 0.6, 2, 3.3, 4.4, 0.4, 1, 2, 5.5, 6.6, 1, 1, 0, 7.7, 8.8, 1] },
      "alinked": { "type": "linkedmesh", "parent": "wmesh", "path": "img" }
    },
    "s0": {
      "img": { "x": 1, "y": 2, "scaleX": 3, "scaleY": 4, "rotation": 5, "width": 6, "height": 7, "color": "aabbccdd" },
      "seq": { "path": "seq", "width": 8, "height": 8, "sequence": { "count": 2, "start": 2, "digits": 2, "setup": 1 } },
      "plain": { "name": "img", "width": 1, "height": 1 }
    },
    "s2": {
      "path": { "type": "path", "vertexCount": 6, "vertices": [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5], "lengths": [1.1, 2.5],
        "closed": true, "constantSpeed": false },
      "wpath": { "type": "path", "vertexCount": 3, "vertices": [1, 1, 1, 2, 1, 1, 0, 3, 4, 1, 1, 2, 5, 6, 1], "lengths": [9] },
      "box": { "type": "boundingbox", "vertexCount": 3, "vertices": [0, 0, 1, 0, 1, 1] },
      "point": { "type": "point", "x": 1.5, "y": 2.5, "rotation": 45 },
      "point0": { "type": "point" }
    },
    "s3": {
      "clip": { "type": "clipping", "end": "s4", "vertexCount": 3, "vertices": [0, 0, 1, 0, 1, 1] },
      "clip2": { "type": "clipping", "vertexCount": 3, "vertices": [0, 0, 1, 0, 1, 1] }
    }
  } },
  { "name": "other", "bones": ["a", "d"], "ik": ["ik1"], "transform": ["t1"], "path": ["p1"], "physics": ["ph1"],
    "attachments": { "s1": {
      "chain": { "type": "linkedmesh", "parent": "second", "skin": "other", "path": "img" },
      "second": { "type": "linkedmesh", "parent": "mesh", "skin": "default", "path": "img" },
      "third": { "type": "linkedmesh", "parent": "second", "skin": "other", "path": "img" }
    } } }
],
"events": {
  "plain": {}, "full": { "int": 3, "float": 1.5, "string": "text" },
  "sound": { "audio": "a.wav", "volume": 0.5, "balance": -0.25 }, "sound2": { "audio": "b.wav", "string": "x" }
},
"animations": {
  "slots": { "slots": {
    "s0": {
      "attachment": [{ "name": "img" }, { "time": 0.5, "name": null }, { "time": 1 }],
      "rgba": [{ "color": "ff0000ff", "curve": 4 }, { "time": 0.4, "color": "00ff0080", "curve": "stepped" },
        { "time": 0.9, "color": "0000ff40" }],
      "rgb": [{ "color": "ff0000", "curve": 3 }, { "time": 0.4, "color": "00ff00ff" }],
      "alpha": [{ "value": 0.3, "curve": 1 }, { "time": 0.7 }, { "time": 1.1, "value": 1 }],
      "rgba2": [{ "light": "ff8800cc", "dark": "112233", "curve": 7 },
        { "time": 0.6, "light": "00ff0080", "dark": "445566", "curve": "stepped" },
        { "time": 1.3, "light": "0000ff40", "dark": "778899" }],
      "rgb2": [{ "light": "ff8800", "dark": "112233", "curve": 6 }, { "time": 0.6, "light": "00ff00", "dark": "445566" }]
    },
    "s3": { "rgb2": [{ "time": 2, "light": "ffffff", "dark": "000000" }] }
  } },
  "bones": { "bones": {
    "a": {
      "rotate": [{ "value": 10, "curve": 1 }, { "time": 0.5, "curve": "stepped" }, { "time": 1, "value": -20.5 }],
      "translate": [{ "x": 1, "curve": 2 }, { "time": 0.5, "y": 2.5 }, { "time": 1 }],
      "translatex": [{ "value": 1, "curve": 1 }, { "time": 0.5 }],
      "translatey": [{ "value": 1, "curve": 1 }, { "time": 0.5 }],
      "scale": [{ "x": 2, "curve": 2 }, { "time": 0.5, "y": 2.5 }, { "time": 1 }],
      "scalex": [{ "curve": 1 }, { "time": 0.5, "value": 3 }],
      "scaley": [{ "curve": 1 }, { "time": 0.5, "value": 3 }],
      "shear": [{ "x": 2, "curve": 2 }, { "time": 0.5, "y": 2.5 }, { "time": 1 }],
      "shearx": [{ "curve": 1 }, { "time": 0.5, "value": 3 }],
      "sheary": [{ "curve": 1 }, { "time": 0.5, "value": 3 }]${inherit}
    },
    "d": { "rotate": [], "translate": [{ "time": 3, "x": 1, "y": 1 }] }
  } },
  "constraints": {
    "ik": {
      "ik1": [{ "mix": 0.5, "softness": 2, "bendPositive": false, "compress": true, "curve": 2 },
        { "time": 0.5, "stretch": true, "curve": "stepped" }, { "time": 1, "mix": 0, "softness": 1 }],
      "missing": []
    },
    "transform": {
      "t1": [{ "mixRotate": 0.1, "mixX": 0.2, "mixScaleX": 0.4, "mixShearY": 0.5, "curve": 6 },
        { "time": 0.5, "mixRotate": 0.2, "mixX": 0.3, "mixY": 0.35, "mixScaleX": 0.5, "mixScaleY": 0.55, "mixShearY": 0.7,
          "curve": 6 },
        { "time": 1, "mixShearY": 0.9, "curve": "stepped" }, { "time": 1.5, "mixShearY": 0.2 }],
      "missing": []
    },
    "path": {
      "p1": {
        "position": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }],
        "spacing": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }],
        "mix": [{ "mixRotate": 0.2, "mixX": 0.3, "curve": 3 }, { "time": 0.5, "mixY": 0.9, "curve": "stepped" }, { "time": 0.75 }]
      },
      "p0": { "position": [], "spacing": [], "mix": [] }
    },
    "physics": {
      "ph1": {
        "reset": [{}, { "time": 0.5 }, { "time": 2.5 }],
        "inertia": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }],
        "strength": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }],
        "damping": [{ "value": 0.2, "curve": "stepped" }, { "time": 0.5 }],
        "mass": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }],
        "wind": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }],
        "gravity": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }],
        "mix": [{ "value": 0.2, "curve": 1 }, { "time": 0.5 }]
      },
      "": { "reset": [{ "time": 0.1 }], "wind": [{ "value": 3 }], "mix": [] }
    }
  },
  "attachments": { "attachments": {
    "default": {
      "s1": {
        "mesh": { "deform": [{ "curve": 1 }, { "time": 0.5, "offset": 2, "vertices": [1.1, 2.2, 3.3], "curve": "stepped" },
          { "time": 1, "vertices": [0.5, 0.25, 0.125, 1, 2, 3, 4, 5] }] },
        "wmesh": {
          "deform": [{ "curve": 1 }, { "time": 0.5, "offset": 3, "vertices": [1.1, 2.2, 3.3] }, { "time": 1 }],
          "sequence": [{ "mode": "loop", "delay": 0.1 }, { "time": 0.5, "index": 2 },
            { "time": 1, "mode": "pingpongReverse", "index": 1, "delay": 0.3 }, { "time": 2 }]
        },
        "alinked": { "deform": [{ "time": 0.25, "vertices": [1, 2] }], "sequence": [] },
        "zlinked": { "deform": [{ "time": 0.25, "offset": 1, "vertices": [1, 2] }] }
      },
      "s2": { "wpath": { "deform": [{ "vertices": [1] }] }, "box": { "deform": [{ "offset": 4, "vertices": [1, 2] }, { "time": 4 }] } },
      "s3": { "clip": { "deform": [{ "vertices": [1] }] } },
      "s0": { "seq": { "sequence": [{ "mode": "once" }, { "time": 0.5, "mode": "onceReverse", "index": 1 },
        { "time": 0.7, "mode": "loopReverse" }, { "time": 0.8, "mode": "pingpong" }, { "time": 0.9, "mode": "hold" }] } }
    },
    "other": { "s1": {
      "chain": { "deform": [{ "vertices": [1, 2] }] }, "second": { "deform": [{ "vertices": [1, 2] }] },
      "third": { "deform": [{ "offset": 1, "vertices": [1, 2] }] }
    } }
  } },
  "order": {
    "drawOrder": [{ "offsets": [{ "slot": "s0", "offset": 4 }, { "slot": "s3", "offset": -2 }] }, { "time": 0.5 },
      { "time": 1, "offsets": [] }, { "time": 1.5, "offsets": [{ "slot": "s1", "offset": 2 }, { "slot": "s4", "offset": -4 }] }],
    "events": [{ "name": "plain" }, { "time": 0.1, "name": "full" },
      { "time": 0.2, "name": "full", "int": 9, "float": 2.5, "string": "other", "volume": 0.3, "balance": 0.4 },
      { "time": 0.3, "name": "sound" }, { "time": 0.4, "name": "sound2", "volume": 0.3, "balance": 0.4 }]
  },
  "empty": {}
}
}`;
}

/** The rig as parsed JSON. Each Bezier curve gets its own handle numbers. */
function rig(version: Version): object {
    let curves = 0;
    const handles = (values: number): number[] =>
        Array.from({ length: values * 4 }, (_, i) => 0.41 + Math.sin(++curves + i * 1.7) * 0.37 + i * 0.013);

    return JSON.parse(rigText(version), (key, value) =>
        key === 'curve' && typeof value === 'number' ? handles(value) : value,
    );
}

describe.each(['4.1', '4.2'] as const)('importJson42 on a hand-written %s skeleton', (version) => {
    const root = rig(version);
    const model = importJson42(root, version);

    it('imports the same model the official core holds', () => {
        const official = officialModel(version, { skeleton: JSON.stringify(root), atlas: ATLAS });

        expect(differences(model, official)).toEqual([]);
    });

    it('reads only what the official parser of that version reads', () => {
        const kinds = new Set(model.animations.flatMap((animation) => animation.timelines.map(({ kind }) => kind)));

        expect(model.referenceScale).toBe(version === '4.2' ? 77 : 100);
        expect(model.slots.visible[1]).toBe(version === '4.2' ? 0 : 1);
        expect(model.constraints.filter(({ type }) => type === 'physics')).toHaveLength(version === '4.2' ? 2 : 0);
        expect(kinds.has('inherit')).toBe(version === '4.2');
        expect(kinds.has('physicsConstraintReset')).toBe(version === '4.2');
        expect(Array.from(model.bones.inherit)).toEqual([0, 3, 1, 2, 4]);
    });

    it('keeps setup values as the 64-bit numbers of the file', () => {
        const { bones, slots, constraints, skins } = model;
        const find = (name: string) => skins[0]?.attachments.find((entry) => entry.name === name)?.attachment;
        const transform = constraints.find(({ name }) => name === 't1');
        const [region, mesh, path] = [find('img'), find('mesh'), find('path')];
        const color = (...bytes: number[]): Float64Array => Float64Array.from(bytes, (byte) => byte / 255);

        // a value that went through 32 bits would not equal the number in the file
        expect(bones.setup.slice(7, 14)).toEqual(Float64Array.of(1.1, 2.2, 33.3, 1.5, 0.7, 3, 4));
        expect(bones.lengths).toEqual(Float64Array.of(0, 3.3, 0, 0, 0));
        expect(slots.colors.slice(0, 8)).toEqual(color(255, 128, 64, 192, 51, 102, 153, 255));
        expect(slots.darkColors.slice(0, 3)).toEqual(color(16, 32, 48));
        expect(transform?.type === 'transform' && transform.offsets).toEqual(
            Float64Array.of(1.1, 2.2, 3.3, 0.4, 0.5, 6.6),
        );
        expect(region?.type === 'region' && region.color).toEqual(color(170, 187, 204, 221));
        expect(mesh?.type === 'mesh' && mesh.color).toEqual(color(17, 34, 51, 68));
        expect(path?.type === 'path' && path.lengths).toEqual(Float64Array.of(1.1, 2.5));
    });

    it('keeps the shearY mix of the first key on every key of a 4.1 transform timeline', () => {
        const timelines = model.animations.flatMap((animation) => animation.timelines);
        const frames = timelines.find(({ kind }) => kind === 'transformConstraint')?.frames ?? [];
        const shearY = [6, 13, 20, 27].map((i) => frames[i]);
        const stored = (values: number[]): number[] => Array.from(Float32Array.from(values));

        // the official 4.1 parser never moves on from the first key here. The 4.2 parser does
        expect(shearY).toEqual(stored(version === '4.1' ? [0.5, 0.5, 0.5, 0.5] : [0.5, 0.7, 0.9, 0.2]));
    });
});

/** A small valid skeleton. Each error case replaces one or more of its entries. */
const BASE = {
    skeleton: { spine: '4.2.40' },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
    slots: [
        { name: 'front', bone: 'root' },
        { name: 'back', bone: 'arm' },
    ],
    ik: [{ name: 'reach', bones: ['arm'], target: 'root' }],
    transform: [{ name: 'copy', bones: ['arm'], target: 'root' }],
    path: [{ name: 'follow', bones: ['arm'], target: 'front' }],
    physics: [{ name: 'sway', bone: 'arm' }],
    skins: [
        {
            name: 'default',
            attachments: {
                front: {
                    image: { width: 1, height: 1 },
                    shape: { type: 'boundingbox', vertexCount: 2, vertices: [0, 0, 1, 1] },
                    frames: { width: 1, height: 1, sequence: { count: 2 } },
                },
            },
        },
    ],
    events: { step: {} },
};
const QUAD = { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 1, 0, 1, 1] };

const skin = (attachments: object, more: object = {}): object => ({
    skins: [{ name: 'default', attachments: { front: attachments }, ...more }],
});
const animation = (map: object): object => ({ animations: { run: map } });
const slotKeys = (name: string, keys: object[]): object => animation({ slots: { front: { [name]: keys } } });
const attachmentKeys = (name: string, timelines: object): object =>
    animation({ attachments: { default: { front: { [name]: timelines } } } });
const drawOrder = (...offsets: object[]): object => animation({ drawOrder: [{ offsets }] });

/** What is wrong, the entries that make it wrong, and what the message must name. */
const BROKEN: [string, object, string][] = [
    ['no skeleton.spine field', { skeleton: {} }, 'skeleton.spine'],
    ['a list that is not a list', { bones: {} }, 'must be a list'],
    ['a map that is not a map', { events: [] }, 'must be a map'],
    ['an entry of the wrong type', { bones: [null] }, 'shape of a Spine skeleton'],
    ['a bone without a name', { bones: [{}] }, 'Bone 0 has no name'],
    ['an unknown parent bone', { bones: [{ name: 'root' }, { name: 'arm', parent: 'nope' }] }, '"nope"'],
    ['a parent after its child', { bones: [{ name: 'arm', parent: 'root' }, { name: 'root' }] }, '"root"'],
    ['an unknown inherit mode', { bones: [{ name: 'root', inherit: 'sideways' }] }, '"sideways"'],
    ['a slot without a name', { slots: [{ bone: 'root' }] }, 'Slot 0 has no name'],
    ['an unknown slot bone', { slots: [{ name: 'front', bone: 'nope' }] }, '"nope"'],
    ['a slot without a bone', { slots: [{ name: 'front' }] }, 'bone'],
    ['an unknown blend mode', { slots: [{ name: 'front', bone: 'root', blend: 'glow' }] }, '"glow"'],
    ['an IK constraint without a name', { ik: [{ bones: ['arm'], target: 'root' }] }, 'IK constraint 0 has no name'],
    ['an IK constraint without bones', { ik: [{ name: 'reach', target: 'root' }] }, '"bones"'],
    ['an unknown IK bone', { ik: [{ name: 'reach', bones: ['nope'], target: 'root' }] }, '"nope"'],
    ['an unknown IK target', { ik: [{ name: 'reach', bones: ['arm'], target: 'nope' }] }, '"nope"'],
    ['an unknown transform bone', { transform: [{ name: 'copy', bones: ['nope'], target: 'root' }] }, '"nope"'],
    ['an unknown transform target', { transform: [{ name: 'copy', bones: ['arm'], target: 'nope' }] }, '"nope"'],
    ['an unknown path bone', { path: [{ name: 'follow', bones: ['nope'], target: 'front' }] }, '"nope"'],
    ['an unknown path slot', { path: [{ name: 'follow', bones: ['arm'], target: 'nope' }] }, '"nope"'],
    ['an unknown path mode', { path: [{ name: 'follow', bones: [], target: 'front', rotateMode: 'spin' }] }, '"spin"'],
    ['an unknown physics bone', { physics: [{ name: 'sway', bone: 'nope' }] }, '"nope"'],
    ['a skin without a name', { skins: [{}] }, 'Skin 0 has no name'],
    ['an unknown skin bone', skin({}, { bones: ['nope'] }), '"nope"'],
    ['an unknown skin IK constraint', skin({}, { ik: ['nope'] }), 'IK constraint "nope"'],
    ['an unknown skin transform constraint', skin({}, { transform: ['nope'] }), 'transform constraint "nope"'],
    ['an unknown skin path constraint', skin({}, { path: ['nope'] }), 'path constraint "nope"'],
    ['an unknown skin physics constraint', skin({}, { physics: ['nope'] }), 'physics constraint "nope"'],
    ['an unknown skin slot', { skins: [{ name: 'default', attachments: { nope: {} } }] }, '"nope"'],
    ['an unknown attachment type', skin({ image: { type: 'hologram' } }), '"hologram"'],
    ['an attachment with an empty name', skin({ image: { name: '', width: 1, height: 1 } }), 'has no name'],
    ['a region without a size', skin({ image: { width: 1 } }), 'height'],
    ['a mesh without uvs', skin({ image: { type: 'mesh', vertices: [] } }), '"uvs"'],
    ['a mesh without triangles', skin({ image: { ...QUAD, triangles: undefined } }), '"triangles"'],
    ['a mesh without vertices', skin({ image: { ...QUAD, vertices: undefined } }), '"vertices"'],
    ['weights that end early', skin({ image: { ...QUAD, vertices: [2, 0, 1, 1, 1] } }), 'ends before'],
    ['a weight for a missing bone', skin({ image: { ...QUAD, vertices: [1, 9, 0, 0, 1] } }), 'bone 9'],
    ['a path with a broken vertex count', skin({ image: { type: 'path', vertexCount: 4, lengths: [] } }), 'three'],
    ['a path without lengths', skin({ image: { type: 'path', vertexCount: 3, vertices: [] } }), '"lengths"'],
    ['an unknown clipping end slot', skin({ image: { type: 'clipping', end: 'nope', vertices: [] } }), '"nope"'],
    ['a linked mesh in an unknown skin', skin({ image: { type: 'linkedmesh', parent: 'p', skin: 'nope' } }), '"nope"'],
    ['a linked mesh without its parent', skin({ image: { type: 'linkedmesh', parent: 'nope' } }), '"nope"'],
    [
        'a linked mesh on a region',
        skin({ image: { type: 'linkedmesh', parent: 'p' }, p: { width: 1, height: 1 } }),
        '"p"',
    ],
    [
        'a linked mesh without a default skin',
        { skins: [{ name: 'other', attachments: { front: { image: { type: 'linkedmesh', parent: 'p' } } } }] },
        'default skin',
    ],
    ['an animation without a name', { animations: { '': {} } }, 'empty name'],
    ['an unknown slot in an animation', animation({ slots: { nope: {} } }), '"nope"'],
    ['an unknown slot timeline', slotKeys('glow', [{}]), '"glow"'],
    ['a color timeline without keys', slotKeys('rgba', []), 'has no keys'],
    ['an attachment timeline without keys', slotKeys('attachment', []), 'without keys'],
    ['a color key without a color', slotKeys('rgb2', [{ light: 'ffffff' }]), 'has no color'],
    ['a curve that is too short', slotKeys('alpha', [{ curve: [0.1, 0.2] }, { time: 1 }]), 'ends before'],
    ['a curve of the wrong type', slotKeys('alpha', [{ curve: 'smooth' }, { time: 1 }]), 'not a list'],
    ['an unknown bone in an animation', animation({ bones: { nope: {} } }), '"nope"'],
    ['an unknown bone timeline', animation({ bones: { arm: { wobble: [{}] } } }), '"wobble"'],
    [
        'an unknown inherit mode in a key',
        animation({ bones: { arm: { inherit: [{ inherit: 'sideways' }] } } }),
        '"sideways"',
    ],
    ['an unknown IK constraint in an animation', animation({ ik: { nope: [{}] } }), '"nope"'],
    ['an unknown transform constraint in an animation', animation({ transform: { nope: [{}] } }), '"nope"'],
    ['an unknown path constraint in an animation', animation({ path: { nope: {} } }), '"nope"'],
    ['an unknown path timeline', animation({ path: { follow: { bend: [{}] } } }), '"bend"'],
    ['an unknown physics constraint in an animation', animation({ physics: { nope: {} } }), '"nope"'],
    ['an unknown physics timeline', animation({ physics: { sway: { bounce: [{}] } } }), '"bounce"'],
    ['an unknown skin in an animation', animation({ attachments: { nope: {} } }), '"nope"'],
    ['an unknown attachment slot in an animation', animation({ attachments: { default: { nope: {} } } }), '"nope"'],
    ['a deform of a missing attachment', attachmentKeys('nope', { deform: [{}] }), '"nope"'],
    ['a deform of a region', attachmentKeys('image', { deform: [{}] }), 'no vertices'],
    ['a sequence of a missing attachment', attachmentKeys('nope', { sequence: [{}] }), '"nope"'],
    ['a sequence of an attachment without one', attachmentKeys('image', { sequence: [{}] }), 'no sequence'],
    ['an unknown sequence mode', attachmentKeys('frames', { sequence: [{ mode: 'shuffle' }] }), '"shuffle"'],
    ['an unknown attachment timeline', attachmentKeys('shape', { morph: [{}] }), '"morph"'],
    ['an unknown slot in a draw order key', drawOrder({ slot: 'nope', offset: 0 }), '"nope"'],
    [
        'draw order offsets out of order',
        drawOrder({ slot: 'back', offset: -1 }, { slot: 'front', offset: 1 }),
        '"front"',
    ],
    ['a slot moved out of the draw order', drawOrder({ slot: 'back', offset: 1 }), '"back"'],
    [
        'two slots moved to the same place',
        drawOrder({ slot: 'front', offset: 1 }, { slot: 'back', offset: 0 }),
        'same place',
    ],
    ['a draw order timeline without keys', animation({ drawOrder: [] }), 'without keys'],
    ['an unknown event in an animation', animation({ events: [{ name: 'nope' }] }), '"nope"'],
    ['an event timeline without keys', animation({ events: [] }), 'without keys'],
];

describe('importJson42 on broken data', () => {
    it('imports the skeleton the error cases start from', () => {
        const model = importJson42({ ...BASE, ...attachmentKeys('shape', { deform: [{ vertices: [1] }] }) }, '4.2');

        expect(model.animations[0]?.timelines[0]?.vertices).toEqual([Float32Array.of(1, 0, 1, 1)]);
        expect(model.constraints.map(({ name }) => name)).toEqual(['reach', 'copy', 'follow', 'sway']);
    });

    it.each(BROKEN)('throws invalid-data for %s', (_what, entries, named) => {
        let thrown: unknown;

        try {
            importJson42({ ...BASE, ...entries }, '4.2');
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(MarrowError);
        expect(thrown).toMatchObject({ code: 'invalid-data' });
        expect(thrown).toHaveProperty('message', expect.stringContaining(named));
    });

    it('lists the names that exist when a reference is broken', () => {
        const run = (): unknown => importJson42({ ...BASE, slots: [{ name: 'front', bone: 'nope' }] }, '4.2');

        expect(run).toThrowError(expect.objectContaining({ validNames: ['root', 'arm'] }));
    });

    it.each([
        ['bones', { bones: Array.from({ length: 0x8000 }, (_, i) => ({ name: `bone${i}` })) }],
        ['slots', { slots: Array.from({ length: 0x8000 }, (_, i) => ({ name: `slot${i}`, bone: 'root' })) }],
        ['vertices in a mesh', skin({ image: { ...QUAD, uvs: new Array(0x20002).fill(0) } })],
    ])('throws unsupported-feature for more %s than the model can index', (_what, entries) => {
        const run = (): unknown => importJson42({ ...BASE, ...entries }, '4.2');

        expect(run).toThrowError(expect.objectContaining({ code: 'unsupported-feature' }));
    });

    it('does not know 4.2 timelines in a 4.1 file', () => {
        const entries = animation({ bones: { arm: { inherit: [{ inherit: 'noScale' }] } } });
        const run = (): unknown => importJson42({ ...BASE, skeleton: { spine: '4.1.24' }, ...entries }, '4.1');

        expect(run).toThrowError(expect.objectContaining({ code: 'invalid-data' }));
    });
});
