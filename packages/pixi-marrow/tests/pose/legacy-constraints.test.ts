import * as core41 from 'spine-core-4.1';
import * as core42 from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, LOCAL_STRIDE, type PoseEngine, type SkeletonModel } from '../../src/core';
import { loadPoseRig } from '../parity/pose-official';
import { attachmentLabels, engineSubject, officialSubject, runScript } from '../parity/pose-run';
import { DT, ODD, type PoseScript, script } from '../parity/pose-script';

/*
 * Constraints in the places the official example exports do not have: a constrained root bone, a
 * second bone without a parent, a slot that changes its path or shows none, a path with one
 * point, bones too short to count, constraints that need a skin or are never sorted, and a
 * two-bone IK under a bone without an area and under a bone that is far wider than tall, and a
 * skeleton that is moved, scaled and mirrored.
 */

type Version = '4.1' | '4.2';

const ATLAS = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');

const LINE = [-10, 4, 0, 0, 12, -6, 22, 14, 34, 10, 46, 2, 52, -12, 60, -4, 70, 3];
const RING = [-8, -6, 0, 0, 9, 7, 28, 16, 20, 22, 11, 27];
/** The line with weights: each vertex follows the bones `rail` and `t`, which are bones 12 and 1. */
const WEIGHTED = Array.from({ length: 9 }, (_, i) => [
    2,
    12,
    LINE[i * 2] ?? 0,
    LINE[i * 2 + 1] ?? 0,
    0.7,
    1,
    i * 3,
    -i,
    0.3,
]);

/** A path attachment as JSON text, from x, y pairs: three vertices for every point. */
const path = (vertices: number[], count: number, more = ''): string =>
    `{ "type": "path", "lengths": [30, 60, 90], "vertexCount": ${count}, "vertices": [${vertices.join()}]${more} }`;

/**
 * The rig as written. `"curve": 2` stands for the Bezier handles of two values. The order numbers
 * are those of 4.2, which has a physics constraint in third place.
 */
function rigText(version: Version): string {
    const mode = version === '4.2' ? 'inherit' : 'transform';

    return `{
"skeleton": { "spine": "${version}.24" },
"bones": [
  { "name": "root", "rotation": 6, "scaleX": 1.05 },
  { "name": "t", "parent": "root", "x": 40, "y": 30, "rotation": 20, "scaleX": 1.3, "shearY": 10 },
  { "name": "arm", "parent": "root", "x": -10, "y": 5, "rotation": 30, "length": 25, "${mode}": "noScale" },
  { "name": "hip", "parent": "root", "x": 5, "y": -20, "rotation": -80, "length": 20, "scaleX": 1.2, "scaleY": 0.8 },
  { "name": "knee", "parent": "hip", "x": 20, "y": 2, "rotation": 40, "length": 18 },
  { "name": "foot", "parent": "knee", "x": 18, "rotation": 10 },
  { "name": "s1", "parent": "root", "x": -5, "y": 12, "length": 12 },
  { "name": "s2", "parent": "s1", "x": 12, "length": 0.000004 },
  { "name": "s3", "parent": "s2", "x": 6, "length": 12, "${mode}": "noRotationOrReflection" },
  { "name": "tip", "parent": "s3", "x": 12, "length": 5 },
  { "name": "copy", "parent": "arm", "x": 10, "y": 3, "rotation": 5, "shearX": 4 },
  { "name": "loose", "parent": "root", "x": 3, "y": 3, "rotation": -12, "skin": true },
  { "name": "rail", "parent": "root", "x": -30, "y": 40, "rotation": 15, "scaleY": -1 },
  { "name": "tail", "parent": "loose", "x": 8, "length": 9, "rotation": 170, "shearY": 160, "skin": true },
  { "name": "free", "x": 100, "y": -50, "rotation": -20, "scaleX": 0.7, "length": 6 },
  { "name": "moon", "parent": "free", "x": 9, "y": 2, "length": 4, "${mode}": "onlyTranslation" },
  { "name": "flat", "parent": "root", "x": 3, "y": -3, "scaleY": 0 },
  { "name": "fp", "parent": "flat", "x": 5, "rotation": 10, "length": 9 },
  { "name": "fc", "parent": "fp", "x": 9, "length": 7 },
  { "name": "hip2", "parent": "root", "x": -12, "y": -18, "rotation": -70, "length": 15, "scaleX": 2, "scaleY": 0.3 },
  { "name": "knee2", "parent": "hip2", "x": 15, "length": 14 }
],
"slots": [{ "name": "track", "bone": "rail", "attachment": "line" }, { "name": "ring", "bone": "rail", "attachment": "loop" }],
"ik": [
  { "name": "reach", "order": 0, "bones": ["arm"], "target": "t", "mix": 0.8, "compress": true, "stretch": true, "uniform": true },
  { "name": "leg", "order": 2, "bones": ["hip", "knee"], "target": "t", "bendPositive": false, "softness": 5, "stretch": true },
  { "name": "squash", "order": 9, "bones": ["fp", "fc"], "target": "t" },
  { "name": "leg2", "order": 10, "bones": ["hip2", "knee2"], "target": "t", "stretch": true },
  { "name": "never", "order": 40, "bones": ["tip"], "target": "t" }
],
"transform": [
  { "name": "hold", "order": 1, "bones": ["root"], "target": "t", "rotation": 10, "x": 2, "y": -3, "scaleX": 0.1, "shearY": 5,
    "mixRotate": 0.3, "mixX": 0.2, "mixY": 0.1, "mixScaleX": 0.4, "mixScaleY": 0.2, "mixShearY": 0.5 },
  { "name": "echo", "order": 5, "bones": ["copy"], "target": "t", "local": true, "relative": true, "rotation": 15, "x": 1,
    "scaleX": 0.2, "mixRotate": 0.5, "mixX": 0.3, "mixScaleX": 0.6, "mixShearY": 0.2 },
  { "name": "pin", "order": 6, "bones": ["tail"], "target": "t", "local": true, "rotation": 200, "shearY": -190,
    "mixRotate": 0.7, "mixShearY": 0.4, "skin": true }
],
"path": [
  { "name": "follow", "order": 4, "bones": ["s1", "s2", "s3"], "target": "track", "rotateMode": "chainScale",
    "spacingMode": "percent", "position": 0.1, "spacing": 0.25, "mixRotate": 0.8, "mixX": 0.9 },
  { "name": "orbit", "order": 7, "bones": ["free", "moon"], "target": "ring", "positionMode": "fixed", "rotation": 30,
    "position": 5, "spacing": 4 },
  { "name": "chain", "order": 8, "bones": ["s3", "tip"], "target": "ring", "rotateMode": "chain",
    "spacingMode": "proportional", "position": 0.6, "spacing": 0.3, "mixRotate": 0.5 }
],
"physics": [{ "name": "wobble", "order": 3, "bone": "knee", "x": 1, "rotate": 1, "inertia": 0.5 }],
"skins": [
  { "name": "default", "attachments": {
    "track": { "line": ${path(LINE, 9)}, "short": ${path(LINE.slice(0, 12), 6, ', "constantSpeed": false')} },
    "ring": { "loop": ${path(RING, 6, ', "closed": true, "constantSpeed": false')},
      "dot": ${path(RING.slice(0, 6), 3, ', "closed": true')}, "bar": ${path(RING, 6, ', "constantSpeed": false')} }
  } },
  { "name": "extra", "bones": ["tail"], "transform": ["pin"], "attachments": { "track": { "line": ${path(WEIGHTED.flat(), 9)} } } }
],
"animations": {
  "move": {
    "bones": {
      "t": {
        "translate": [{ "x": -60, "y": 10, "curve": 2 }, { "time": 0.5, "x": 25, "y": -30 }, { "time": 1, "x": -60, "y": 10 }],
        "rotate": [{ "value": -40 }, { "time": 1, "value": 300 }],
        "scale": [{ "x": 1.4, "y": 0.6 }, { "time": 0.6, "x": -0.8, "y": 1.2 }, { "time": 1, "x": 1.4, "y": 0.6 }]
      },
      "rail": { "rotate": [{ "value": 0 }, { "time": 1, "value": 180 }],
        "scale": [{ "time": 0.3, "x": 1, "y": 1 }, { "time": 0.7, "x": 0.5, "y": -1.5 }] },
      "s2": { "translate": [{ "time": 0.2, "x": 3, "y": 1 }, { "time": 0.8 }] }
    },
    "slots": {
      "ring": { "attachment": [{ "time": 0.2, "name": "dot" }, { "time": 0.4, "name": null }, { "time": 0.6, "name": "bar" },
        { "time": 0.8, "name": "loop" }] },
      "track": { "attachment": [{ "time": 0.5, "name": "short" }, { "time": 0.75, "name": "line" }] }
    },
    "ik": {
      "reach": [{ "mix": 0.2, "compress": true, "curve": 2 }, { "time": 0.4, "stretch": true, "compress": true, "curve": "stepped" },
        { "time": 0.8, "mix": 0.5 }],
      "leg": [{ "time": 0.1, "softness": 12, "bendPositive": false, "stretch": true, "curve": 2 }, { "time": 0.5, "mix": 0.4 },
        { "time": 0.9, "mix": 0.9, "softness": 30, "bendPositive": false }],
      "never": [{ "mix": 0.5 }]
    },
    "transform": {
      "hold": [{ "mixRotate": 0.2, "mixX": 0.8, "mixY": 0.1, "mixScaleX": 0.2, "mixScaleY": 0.3, "mixShearY": 0.9, "curve": 6 },
        { "time": 0.5, "mixRotate": 0.9, "mixX": 0.1, "mixY": 0.4, "mixScaleX": 0.7, "mixScaleY": 0.3, "mixShearY": 0.7, "curve": "stepped" },
        { "time": 0.9, "mixRotate": 0.1, "mixX": 0.9, "mixY": 0.1, "mixScaleX": 0.1, "mixScaleY": 0.3, "mixShearY": 1 }],
      "echo": [{ "time": 0.2 }, { "time": 0.7, "mixRotate": -0.5, "mixX": 1.5, "mixY": -0.2, "mixScaleX": -0.4, "mixShearY": 1.2 }],
      "pin": [{ "mixRotate": 0.4, "mixShearY": 0.8 }, { "time": 1 }]
    },
    "path": {
      "follow": {
        "position": [{ "value": -0.3, "curve": 1 }, { "time": 0.5, "value": 0.6 }, { "time": 1, "value": 1.4 }],
        "spacing": [{ "time": 0.1, "value": 0.4 }, { "time": 0.6, "curve": "stepped" }, { "time": 0.9, "value": -0.2 }],
        "mix": [{ "mixRotate": 0.2, "mixY": 0, "curve": 3 }, { "time": 0.5, "mixX": 0.3 }, { "time": 1, "mixRotate": 0, "mixX": 0, "mixY": 0 }]
      },
      "orbit": { "position": [{ "value": -20 }, { "time": 1, "value": 90 }], "spacing": [{}, { "time": 0.5, "value": 12 }] },
      "chain": { "position": [{ "value": 0.2 }, { "time": 1, "value": 1.3 }],
        "mix": [{ "time": 0.3, "mixX": 0.5, "mixY": 0.5 }, { "time": 0.9, "mixRotate": 0.3 }] }
    },
    "physics": { "wobble": { "inertia": [{ "value": 0.2 }, { "time": 0.5, "value": 0.9 }], "reset": [{ "time": 0.3 }] } },
    "attachments": { "default": { "track": { "line": {
      "deform": [{ "time": 0.1 }, { "time": 0.6, "offset": 2, "vertices": [4, -7, 2, 9, -5, 3] }, { "time": 1 }] } } } }
  },
  "rest": {
    "bones": { "t": { "translate": [{ "x": 15, "y": 40 }, { "time": 0.6, "x": 90, "y": -5 }] } },
    "ik": { "reach": [{ "mix": 0.6, "bendPositive": false, "stretch": true }, { "time": 0.6, "compress": true }],
      "leg": [{ "time": 0.3, "mix": 0.7, "softness": 3 }] },
    "transform": { "hold": [{ "time": 0.2, "mixRotate": 0.5, "mixX": 0.5 }, { "time": 0.6, "mixRotate": 0.7, "mixScaleX": 0.3 }] },
    "path": { "follow": { "position": [{ "time": 0.3, "value": 0.9 }], "mix": [{ "time": 0.1, "mixRotate": 0.5, "mixX": 0.5, "mixY": 0.5 }] },
      "orbit": { "spacing": [{ "value": -6 }] } }
  },
  "still": { "bones": { "t": { "translate": [{ "x": 1, "y": 1 }] } } }
}
}`;
}

interface Ordered {
    order: number;
}

/**
 * The rig as JSON text. Each Bezier curve gets its own handle numbers. 4.1 has no physics: the
 * constraint and its timelines are left out, and the constraints after it move up one place.
 */
function rigJson(version: Version): string {
    let curves = 0;
    const handles = (values: number): number[] =>
        Array.from({ length: values * 4 }, (_, i) => 0.37 + Math.sin(++curves + i * 1.3) * 0.31 + i * 0.011);
    const rig = JSON.parse(rigText(version), (key, value) =>
        key === 'curve' && typeof value === 'number' ? handles(value) : value,
    );

    if (version === '4.1') {
        const others: Ordered[] = [...rig.ik, ...rig.transform, ...rig.path];

        for (const constraint of others) if (constraint.order > 3 && constraint.order < 40) constraint.order--;
        delete rig.physics;
        delete rig.animations.move.physics;
    }

    return JSON.stringify(rig);
}

const [MOVE, REST, STILL] = [0, 1, 2];

const scripts: PoseScript[] = [
    script('constraint values keyed, looped, once and reversed', (s) => {
        s.set(0, MOVE, true);
        s.update(DT, 40);
        s.update(ODD, 25);
        s.set(0, MOVE, false, { reverse: true });
        s.update(0.07, 17);
        s.set(0, REST, false);
        s.update(0.07, 12);
    }),
    script('constraint values mix in, mix out, hold and add', (s) => {
        s.defaultMix(0.3);
        s.set(0, MOVE, true);
        s.update(DT, 8);
        s.set(0, REST, true);
        s.update(DT, 6);
        s.set(0, STILL, true);
        s.update(DT, 5);
        s.set(0, MOVE, true, { holdPrevious: true });
        s.update(DT, 12);
        s.set(1, REST, true, { alpha: 0.4 });
        s.set(2, MOVE, true, { mixBlend: 'add', alpha: 0.5, timeScale: 0.6 });
        s.update(DT, 20);
        s.setEmpty(1, 0.2);
        s.setEmpty(0, 0.2);
        s.update(DT, 10);
    }),
    script('setup pose calls put the constraint values back', (s) => {
        s.set(0, MOVE, false);
        s.update(DT, 14);
        // without tracks the values stay where the animation left them
        s.clearTracks();
        s.update(DT, 2);
        s.setupPoseBones();
        s.update(DT, 2);
        s.set(0, REST, false);
        s.update(DT, 9);
        s.clearTracks();
        s.setupPoseSlots();
        s.update(DT);
        s.setupPose();
        s.update(DT);
    }),
    script('a skin turns bones, a constraint and a weighted path on and off', (s) => {
        s.set(0, MOVE, true);
        s.update(DT, 6);
        s.skin(1);
        s.update(DT, 14);
        s.setupPoseSlots();
        s.update(DT, 10);
        s.skin(0);
        s.update(DT, 6);
        s.skin(-1);
        s.update(DT, 6);
    }),
];

/** The world transforms the official core gives the setup pose, with the skeleton placed, and with physics switched off. */
function officialWorld(version: Version, text: string, [x, y, scaleX, scaleY]: readonly number[]): number[] {
    const json41 = new core41.SkeletonJson(new core41.AtlasAttachmentLoader(new core41.TextureAtlas('')));
    const json42 = new core42.SkeletonJson(new core42.AtlasAttachmentLoader(new core42.TextureAtlas('')));
    const official =
        version === '4.1'
            ? new core41.Skeleton(json41.readSkeletonData(text))
            : new core42.Skeleton(json42.readSkeletonData(text));

    Object.assign(official, { x, y, scaleX, scaleY });
    if (official instanceof core41.Skeleton) official.updateWorldTransform();
    else official.updateWorldTransform(core42.Physics.none);

    return official.bones.flatMap((bone) =>
        bone.active ? [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY] : [0, 0, 0, 0, 0, 0],
    );
}

describe.each(['4.1', '4.2'] as const)('constraints of the legacy engine on a hand-written %s skeleton', (version) => {
    const files = { skeleton: rigJson(version), atlas: ATLAS };
    const official = loadPoseRig(version, files);
    const create = async (): Promise<{ model: SkeletonModel; engine: PoseEngine }> => {
        const model = await importSkeleton(files.skeleton);

        return { model, engine: await createPoseEngine(model, { constraints: 'ignore' }) };
    };

    it.each(scripts)('poses like the official core: $name', async (each) => {
        const { model, engine } = await create();
        const labels = attachmentLabels(model);
        const reference = officialSubject(official.createDriver(), labels.ofRef);

        expect(runScript(each, engineSubject(engine, labels.ofObject), reference)).toBeNull();
    });

    it.each([
        [0, 0, 1, 1],
        [7, -4, 2, 0.5],
        [1, 1, -1.5, 1],
        [0, 0, 1, -2],
        [5, 5, -0.5, -3],
    ])('solves the setup pose like the official core at position %d, %d and scale %d, %d', async (...placing) => {
        const { engine } = await create();

        Object.assign(engine.state, { x: placing[0], y: placing[1], scaleX: placing[2], scaleY: placing[3] });
        engine.update(0);
        expect(Array.from(engine.state.world)).toEqual(officialWorld(version, files.skeleton, placing));
    });

    it('leaves the animated local pose alone and changes the world transforms', async () => {
        const { model, engine } = await create();
        const bare = await createPoseEngine({ ...model, constraints: [], animations: [] });

        engine.update(0);
        bare.update(0);
        expect(engine.state.local).toEqual(model.bones.setup);
        // the constrained root bone moved, and every bone below it with it
        expect(Array.from(engine.state.world.subarray(0, 6))).not.toEqual(Array.from(bare.state.world.subarray(0, 6)));
        expect(engine.state.world.every((value) => Number.isFinite(value))).toBe(true);
        expect(engine.state.local.length).toBe(model.bones.count * LOCAL_STRIDE);
    });
});
