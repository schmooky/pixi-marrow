import * as core41 from 'spine-core-4.1';
import * as core42 from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import {
    createPoseEngine,
    importSkeleton,
    MarrowError,
    type PoseEngine,
    type SkeletonModel,
    type TimelineData,
    type TrackEntry,
    type TrackFields,
} from '../../src/core';
import { createLegacyEngine } from '../../src/pose/legacy/index';
import { loadPoseRig } from '../parity/pose-official';
import { attachmentLabels, engineSubject, officialSubject, runScript } from '../parity/pose-run';
import { DT, ODD, type PoseScript, script, thresholds } from '../parity/pose-script';
import type { PoseRigInfo } from '../parity/pose-shared';

type Version = '4.1' | '4.2';

/** The regions the rig below draws: one image and the frames of a sequence. */
const ATLAS = [
    'page.png',
    'size: 64, 64',
    'filter: Linear, Linear',
    ...['img', 'seq01', 'seq02', 'seq03'].flatMap((name, i) => [name, `bounds: ${i * 8}, 0, 8, 8`]),
    '',
].join('\n');

const QUAD = '"uvs": [0, 0, 1, 0, 1, 1, 0, 1], "triangles": [0, 1, 2, 2, 3, 0], "hull": 4';
const SEQUENCE = '"sequence": { "count": 3, "digits": 2 }';

/**
 * A hand-written skeleton with what the official example exports lack: every timeline kind with
 * linear, stepped and Bezier keys, every inherit mode, negative scales, bones that need a skin
 * above one that does not, linked meshes with and without their parent's timelines, a mesh with
 * weights, a mesh with a sequence, and a rotation key half a turn away. `"curve": 3` stands for
 * the Bezier handles of three values.
 */
function rigText(version: Version): string {
    const mode = version === '4.2' ? 'inherit' : 'transform';
    const inherit =
        version === '4.2'
            ? ', "inherit": [{ "inherit": "noScale" }, { "time": 0.4, "inherit": "onlyTranslation" }, { "time": 0.8 }]'
            : '';

    return `{
"skeleton": { "spine": "${version}.24" },
"bones": [
  { "name": "root", "rotation": 5, "scaleX": 1.1 },
  { "name": "a", "parent": "root", "x": 10, "y": 5, "rotation": 30, "scaleX": 1.5, "scaleY": 0.7, "shearX": 3, "shearY": 4 },
  { "name": "b", "parent": "a", "x": 20, "rotation": -40, "shearX": 7.3, "shearY": -2.1, "${mode}": "onlyTranslation" },
  { "name": "c", "parent": "a", "x": 5, "y": 7, "rotation": 100, "scaleX": -1.2, "${mode}": "noRotationOrReflection" },
  { "name": "d", "parent": "c", "x": 3, "rotation": 15, "shearX": 10, "${mode}": "noScale" },
  { "name": "e", "parent": "d", "y": 4, "rotation": -25, "scaleY": -0.8, "${mode}": "noScaleOrReflection" },
  { "name": "f", "parent": "root", "x": -4 },
  { "name": "s", "parent": "a", "x": 1, "skin": true },
  { "name": "t", "parent": "s", "x": 2, "rotation": 45 },
  { "name": "u", "parent": "s", "y": 3, "skin": true }
],
"slots": [
  { "name": "s0", "bone": "root", "attachment": "img", "color": "ff8040c0", "dark": "102030" },
  { "name": "s1", "bone": "a", "attachment": "mesh" },
  { "name": "s2", "bone": "b", "attachment": "seq", "dark": "ffffff" },
  { "name": "s3", "bone": "s", "attachment": "img" },
  { "name": "s4", "bone": "f", "attachment": "weighted" }
],
"ik": [{ "name": "ik0", "bones": ["d"], "target": "f" }],
"skins": [
  { "name": "default", "attachments": {
    "s0": { "img": { "width": 8, "height": 8 }, "seq": { "path": "seq", "width": 8, "height": 8, ${SEQUENCE} } },
    "s1": {
      "mesh": { "type": "mesh", "path": "seq", ${SEQUENCE}, ${QUAD}, "vertices": [0, 0, 8, 0, 8, 8, 0, 8] },
      "linked": { "type": "linkedmesh", "parent": "mesh", "path": "img" },
      "own": { "type": "linkedmesh", "parent": "mesh", "timelines": false, "path": "img" }
    },
    "s2": { "seq": { "path": "seq", "width": 8, "height": 8, ${SEQUENCE} }, "img": { "width": 8, "height": 8 } },
    "s3": { "img": { "width": 4, "height": 4 } },
    "s4": { "weighted": { "type": "mesh", "path": "img", ${QUAD},
      "vertices": [1, 6, 0, 0, 1, 2, 6, 8, 0, 0.5, 1, 1, 1, 0.5, 1, 1, 8, 8, 1, 1, 6, 0, 8, 1] } }
  } },
  { "name": "alt", "bones": ["s"], "attachments": {
    "s0": { "img": { "path": "seq01", "width": 2, "height": 2 } },
    "s1": { "mesh": { "type": "linkedmesh", "parent": "mesh", "skin": "default", "path": "img" } },
    "s3": { "img": { "path": "seq02", "width": 4, "height": 4 } }
  } },
  { "name": "deep", "bones": ["u"] }
],
"events": { "hit": { "int": 1 }, "step": { "string": "s" } },
"animations": {
  "all": {
    "bones": {
      "a": {
        "rotate": [{ "value": 10, "curve": 1 }, { "time": 0.5, "value": 100, "curve": "stepped" }, { "time": 1, "value": -200 }],
        "translate": [{ "x": 1, "y": -2, "curve": 2 }, { "time": 0.6, "x": -3, "y": 2.5 }, { "time": 1 }],
        "scale": [{ "x": 2, "curve": 2 }, { "time": 0.5, "x": -1.5, "y": 2.5 }, { "time": 1 }], "shear": [{ "x": 20, "curve": 2 }, { "time": 0.5, "y": 25 }, { "time": 1 }]
      },
      "b": {
        "translatex": [{ "value": 1, "curve": 1 }, { "time": 0.5, "value": -4 }, { "time": 0.9 }],
        "translatey": [{ "time": 0.2, "value": 3 }, { "time": 0.7, "value": -1, "curve": "stepped" }, { "time": 1 }],
        "scalex": [{ "value": 0.5, "curve": 1 }, { "time": 0.5, "value": -3 }, { "time": 1 }],
        "scaley": [{ "time": 0.1 }, { "time": 0.5, "value": 3 }], "shearx": [{ "curve": 1 }, { "time": 0.5, "value": 30 }],
        "sheary": [{ "time": 0.3, "value": -10 }, { "time": 0.8, "value": 30 }]
      },
      "c": { "rotate": [{ "time": 0.25, "value": 180 }, { "time": 0.75, "value": -180 }]${inherit} },
      "e": { "rotate": [{ "value": 45 }, { "time": 1, "value": 400 }] }
    },
    "slots": {
      "s0": {
        "attachment": [{ "time": 0.2, "name": "seq" }, { "time": 0.5, "name": null }, { "time": 0.8, "name": "img" }],
        "rgba2": [{ "light": "ff8800cc", "dark": "112233", "curve": 7 },
          { "time": 0.6, "light": "00ff0080", "dark": "445566", "curve": "stepped" }, { "time": 1, "light": "0000ff40", "dark": "778899" }]
      },
      "s1": {
        "rgba": [{ "time": 0.1, "color": "ff0000ff", "curve": 4 }, { "time": 0.4, "color": "00ff0080", "curve": "stepped" },
          { "time": 0.9, "color": "0000ff40" }],
        "attachment": [{ "time": 0.3, "name": "linked" }, { "time": 0.6, "name": "own" }, { "time": 0.9, "name": "mesh" }]
      },
      "s2": { "rgb2": [{ "light": "ff8800", "dark": "112233", "curve": 6 }, { "time": 0.6, "light": "00ff00", "dark": "445566" }] },
      "s3": {
        "rgb": [{ "color": "ff0000", "curve": 3 }, { "time": 0.7, "color": "00ff00" }], "alpha": [{ "time": 0.2, "value": 0.3, "curve": 1 }, { "time": 0.7 }, { "time": 1, "value": 1 }]
      }
    },
    "ik": { "ik0": [{ "mix": 0.5 }, { "time": 0.5, "mix": 1 }] },
    "attachments": { "default": {
      "s1": {
        "mesh": { "deform": [{ "time": 0.1, "curve": 1 }, { "time": 0.5, "offset": 2, "vertices": [1.5, 2.5, 3.5], "curve": "stepped" },
          { "time": 1, "vertices": [0.5, 0.25, 0.125, 1, 2, 3, 4, 5] }],
          "sequence": [{ "time": 0.2, "mode": "loop", "delay": 0.04 }, { "time": 0.7, "mode": "once", "index": 1, "delay": 0.1 }] },
        "own": { "deform": [{ "time": 0.5, "vertices": [3, 3] }, { "time": 0.8, "offset": 4, "vertices": [1, 1] }] }
      },
      "s2": { "seq": { "sequence": [{ "mode": "loop", "delay": 0.05 }, { "time": 0.3, "mode": "pingpong", "index": 1, "delay": 0.04 },
        { "time": 0.6, "mode": "onceReverse", "delay": 0.05 }, { "time": 0.8, "mode": "hold", "index": 2 }] } },
      "s4": { "weighted": { "deform": [{ "curve": 1 }, { "time": 0.5, "offset": 3, "vertices": [1.5, 2.5, 3.5] }, { "time": 1 }] } }
    } },
    "drawOrder": [{ "time": 0.2, "offsets": [{ "slot": "s0", "offset": 3 }] }, { "time": 0.5 }, { "time": 0.8, "offsets": [{ "slot": "s1", "offset": 2 }, { "slot": "s4", "offset": -4 }] }],
    "events": [{ "name": "hit" }, { "time": 0.25, "name": "step" }, { "time": 0.25, "name": "hit", "int": 7 }, { "time": 1, "name": "step" }]
  },
  "other": {
    "bones": {
      "a": { "rotate": [{ "time": 0.1, "value": -170 }, { "time": 0.6, "value": 170 }], "scale": [{ "x": -1 }, { "time": 0.5, "y": -2 }] },
      "b": {
        "translatex": [{ "value": 5 }, { "time": 0.4 }],
        "scalex": [{ "value": -1 }, { "time": 0.6, "value": 2 }],
        "shearx": [{ "value": 10 }, { "time": 0.5, "value": -10 }]
      },
      "c": { "rotate": [{ "value": 180 }, { "time": 0.6, "value": 180 }] }
    },
    "slots": {
      "s0": { "attachment": [{ "time": 0.1, "name": "seq" }], "rgba2": [{ "time": 0.3, "light": "ffffff80", "dark": "ffffff" }] },
      "s1": { "rgba": [{ "color": "ffffffff" }, { "time": 0.5, "color": "00000000" }], "attachment": [{ "name": "linked" }] },
      "s3": { "alpha": [{ "value": 1 }, { "time": 0.6, "value": 0 }] }
    },
    "attachments": { "default": {
      "s1": { "mesh": { "deform": [{ "vertices": [2, 2, 2, 2] }, { "time": 0.6, "offset": 4, "vertices": [-2, -2] }] } },
      "s2": { "seq": { "sequence": [{ "time": 0.1, "mode": "loopReverse", "delay": 0.03 },
        { "time": 0.4, "mode": "pingpongReverse", "delay": 0.03 }, { "time": 0.6, "mode": "once", "delay": 0.03 }] } },
      "s4": { "weighted": { "deform": [{ "time": 0.2, "vertices": [1, 1, 1, 1] }, { "time": 0.6 }] } }
    } },
    "drawOrder": [{ "offsets": [{ "slot": "s2", "offset": -2 }] }, { "time": 0.5 }], "events": [{ "time": 0.3, "name": "step" }]
  },
  "third": { "bones": { "e": { "rotate": [{ "value": 90 }] }, "a": { "translate": [{ "x": 3, "y": 3 }] } },
    "slots": { "s0": { "attachment": [{ "name": null }] } } }
}
}`;
}

/** The rig as JSON text. Each Bezier curve gets its own handle numbers. */
function rigJson(version: Version): string {
    let curves = 0;
    const handles = (values: number): number[] =>
        Array.from({ length: values * 4 }, (_, i) => 0.41 + Math.sin(++curves + i * 1.7) * 0.37 + i * 0.013);

    return JSON.stringify(
        JSON.parse(rigText(version), (key, value) =>
            key === 'curve' && typeof value === 'number' ? handles(value) : value,
        ),
    );
}

const [ALL, OTHER, THIRD] = [0, 1, 2];

/** Scripts for the branches of the engine that the official example exports do not reach. */
function scripts(rig: PoseRigInfo): PoseScript[] {
    return [
        script('every timeline kind, looped, once and reversed', (s) => {
            s.set(0, ALL, true);
            s.update(DT, 34);
            s.update(ODD, 20);
            s.set(0, ALL, false, { reverse: true });
            s.update(0.07, 18);
            s.set(0, OTHER, false);
            s.update(0.07, 12);
        }),
        script('mixes of every timeline kind', (s) => {
            s.defaultMix(0.3);
            s.set(0, ALL, true);
            s.update(DT, 9);
            s.set(0, OTHER, true);
            s.update(DT, 5);
            s.set(0, THIRD, true);
            s.update(DT, 4);
            s.set(0, ALL, true, thresholds(rig, 0.6));
            s.update(DT, 14);
            s.set(0, OTHER, false, { holdPrevious: true });
            s.update(DT, 7);
            s.setEmpty(0, 0.2);
            s.update(DT, 10);
        }),
        script('thresholds of an entry that mixes out', (s) => {
            s.defaultMix(0.3);
            s.set(0, ALL, true, thresholds(rig, 0.6));
            s.update(DT, 8);
            // the draw order and the attachments of the old entry stay for the first part of the mix
            s.set(0, THIRD, true);
            s.update(DT, 7);
        }),
        script('layers with alpha, additive blend and alpha outside 0 to 1', (s) => {
            s.set(0, OTHER, true);
            const upper = s.set(1, ALL, true, { alpha: 0.5 });

            s.set(2, ALL, true, { mixBlend: 'add', timeScale: 0.7 });
            s.set(3, OTHER, true, { mixBlend: 'add', alpha: 0.6 });
            s.update(DT, 20);
            // colors leave the range 0 to 1 and are clamped where the official runtime clamps
            s.configure(upper, { alpha: 2 });
            s.update(DT, 10);
            s.configure(upper, { alpha: -0.5 });
            s.update(DT, 5);
            s.defaultMix(0.25);
            s.set(1, OTHER, true, { holdPrevious: true, alpha: 0.7 });
            s.set(2, THIRD, false);
            s.set(3, ALL, false, { mixBlend: 'add', reverse: true });
            s.update(DT, 12);
        }),
        script('rotation half a turn away, direction kept', (s) => {
            s.set(0, THIRD, true);
            const upper = s.set(1, OTHER, true);

            s.update(DT, 3);
            // bone c is now mixed to a rotation exactly 180 degrees from its own
            s.configure(upper, { alpha: 0.5 });
            s.update(DT, 30);
            s.set(1, ALL, true, { alpha: 0.5, shortestRotation: true });
            s.update(DT, 10);
            s.set(1, ALL, true, { alpha: 0.25, mixDuration: 0.2 });
            s.update(DT, 40);
        }),
        script('skins: a bone that needs a skin, linked meshes keep their deform', (s) => {
            s.set(0, ALL, true);
            s.update(DT, 4);
            s.skin(1);
            s.update(DT, 20);
            s.setupPoseSlots();
            s.update(DT, 12);
            s.skin(0);
            s.update(DT, 6);
            // the skin lists a bone whose parent needs a skin too
            s.skin(2);
            s.update(DT, 3);
            s.skin(-1);
            s.setupPose();
            s.update(DT, 6);
        }),
        script('animationLast skips the events before it', (s) => {
            s.set(0, ALL, false, { animationLast: 0.5 });
            s.update(DT, 4);
            s.set(1, OTHER, true, { animationLast: 0.3, alpha: 0.5 });
            s.update(DT, 30);
        }),
        ...(rig.version === '4.1'
            ? []
            : [
                  script('alpha attachment threshold while mixing out', (s) => {
                      s.defaultMix(0.4);
                      s.set(0, THIRD, true);
                      s.set(1, ALL, true, { alpha: 0.5, alphaAttachmentThreshold: 0.3, mixAttachmentThreshold: 1 });
                      s.update(DT, 8);
                      // the alpha of the entry that mixes out falls below its threshold on the way
                      s.set(1, THIRD, true, { alpha: 0.5 });
                      s.update(DT, 14);
                  }),
              ]),
    ];
}

/** The world transforms the official core gives the setup pose of the bones, for a skeleton position and scale. */
function officialWorld(version: Version, text: string, [x, y, scaleX, scaleY]: readonly number[]): number[] {
    const { skeleton, bones } = JSON.parse(text);
    const bonesOnly = JSON.stringify({ skeleton, bones });
    const json41 = new core41.SkeletonJson(new core41.AtlasAttachmentLoader(new core41.TextureAtlas('')));
    const json42 = new core42.SkeletonJson(new core42.AtlasAttachmentLoader(new core42.TextureAtlas('')));
    const official =
        version === '4.1'
            ? new core41.Skeleton(json41.readSkeletonData(bonesOnly))
            : new core42.Skeleton(json42.readSkeletonData(bonesOnly));

    Object.assign(official, { x, y, scaleX, scaleY });
    if (official instanceof core41.Skeleton) official.updateWorldTransform();
    else official.updateWorldTransform(core42.Physics.update);

    return official.bones.flatMap((bone) => [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY]);
}

/** The code of the `MarrowError` a call throws. */
function codeOf(call: () => unknown): string {
    try {
        call();
    } catch (error) {
        if (error instanceof MarrowError) return error.code;
        throw error;
    }

    return 'nothing thrown';
}

/** A copy of a model with one more animation, made of timelines no importer would give. */
function withAnimation(model: SkeletonModel, ...timelines: Partial<TimelineData>[]): SkeletonModel {
    const base: TimelineData = { kind: 'rotate', target: 0, frames: new Float32Array(8), curves: null };
    const full = timelines.map((timeline) => ({ ...base, ...timeline }));

    return { ...model, animations: [...model.animations, { name: 'made up', duration: 1, timelines: full }] };
}

describe.each(['4.1', '4.2'] as const)('the legacy engine on a hand-written %s skeleton', (version) => {
    const files = { skeleton: rigJson(version), atlas: ATLAS };
    const official = loadPoseRig(version, files);
    const create = async (): Promise<{ model: SkeletonModel; engine: PoseEngine }> => {
        const model = await importSkeleton(files.skeleton);

        return { model, engine: await createPoseEngine(model, { constraints: 'ignore' }) };
    };

    it.each(scripts(official.info))('poses like the official core: $name', async (each) => {
        const { model, engine } = await create();
        const labels = attachmentLabels(model);
        const reference = officialSubject(official.createDriver(), labels.ofRef);

        expect(runScript(each, engineSubject(engine, labels.ofObject), reference)).toBeNull();
    });

    it('starts in the setup pose a new official skeleton holds', async () => {
        const { model, engine } = await create();
        const { state } = engine;

        expect(state.local).toEqual(model.bones.setup);
        expect(state.inherit).toEqual(model.bones.inherit);
        // s and u need a skin. t does not, though its parent does.
        expect(Array.from(state.active)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 1, 0]);
        expect(state.colors).toEqual(model.slots.colors);
        expect(Array.from(state.darkColors.subarray(0, 3))).toEqual(Array.from(model.slots.darkColors.subarray(0, 3)));
        expect(state.attachments.map((attachment) => attachment?.name).join()).toBe('img,mesh,seq,img,weighted');
        expect([...state.sequenceIndices, ...state.deformLengths]).toEqual([-1, -1, -1, -1, -1, 0, 0, 0, 0, 0]);
        expect(Array.from(state.drawOrder)).toEqual([0, 1, 2, 3, 4]);
        expect([state.skin, state.time, state.x, state.y, state.scaleX, state.scaleY]).toEqual([-1, 0, 0, 0, 1, 1]);
        expect(state.world.every((value) => value === 0)).toBe(true);
        expect([engine.timeScale, engine.defaultMix, engine.takeEvents().length]).toEqual([1, 0, 0]);
    });

    it.each([
        [0, 0, 1, 1],
        [3, -2, 2, 0.5],
        [1, 1, -1.5, 1],
        [0, 0, 1, -2],
        [5, 5, -0.5, -3],
    ])('computes world transforms like the official core at position %d, %d and scale %d, %d', async (...placing) => {
        const { engine } = await create();

        Object.assign(engine.state, { x: placing[0], y: placing[1], scaleX: placing[2], scaleY: placing[3] });
        engine.update(0);
        expect(Array.from(engine.state.world)).toEqual(officialWorld(version, files.skeleton, placing));
    });

    it('counts the skeleton time from 4.2 on and hands each event out once, with the entry it is about', async () => {
        const { engine } = await create();

        engine.defaultMix = 0.3;
        const first = engine.setAnimation(0, ALL, false);

        engine.configure(first, { eventThreshold: 1 });
        engine.update(0.125);
        // two live entries with the same animation on one track: both fire events in the next update
        const second = engine.setAnimation(0, ALL, false);

        engine.update(0.25);
        const empty = engine.setEmptyAnimation(0, 0);

        for (let i = 0; i < 3; i++) engine.update(0.25);
        expect(engine.state.time).toBe(version === '4.1' ? 0 : 1.125);
        const made: TrackEntry[] = [first, second, empty];
        const name = (entry: TrackEntry): string => ['first', 'second', 'empty'][made.indexOf(entry)] ?? 'unknown';
        const events = engine.takeEvents();
        const told = events.map((event) => `${event.type} ${name(event.entry)} ${event.key?.int ?? ''}`.trim());

        expect(told.join(', ')).toBe(
            'start first, event first 1, interrupt first, start second, event first 0, event first 7, ' +
                'event second 1, event second 0, event second 7, interrupt second, start empty, complete empty, ' +
                'end second, dispose second, end first, dispose first, end empty, dispose empty',
        );
        expect(events.every((event) => event.track === 0 && event.animation === event.entry.animation)).toBe(true);
        expect(engine.takeEvents()).toEqual([]);
        expect(engine.takeEvents()).not.toBe(engine.takeEvents());
    });

    it('sets the track entry fields of its version', async () => {
        const { engine } = await create();
        const entry = engine.setAnimation(0, ALL, false);
        const own: TrackFields =
            version === '4.1'
                ? { attachmentThreshold: 0.1, drawOrderThreshold: 0.2 }
                : { mixAttachmentThreshold: 0.1, alphaAttachmentThreshold: 0.3, mixDrawOrderThreshold: 0.2 };

        const times = { delay: 0.5, trackTime: 0.25, trackEnd: 9, timeScale: 2, mixTime: 0.1, mixDuration: 0.4 };
        const flags = { loop: true, reverse: true, shortestRotation: true };

        engine.configure(entry, { ...times, ...flags, alpha: 0.75, holdPrevious: true, ...own });
        engine.configure(entry, { eventThreshold: 0.5, animationStart: 0.1, animationEnd: 0.9, animationLast: 0.2 });
        for (const mixBlend of ['setup', 'first', 'replace', 'add']) engine.configure(entry, { mixBlend });
        expect(entry).toMatchObject({ trackIndex: 0, animation: ALL, alpha: 0.75, ...times, ...flags });
    });

    it('refuses fields of other versions and values of the wrong type, and then changes nothing', async () => {
        const { engine } = await create();
        const entry = engine.setAnimation(0, ALL, false);
        const foreign: TrackFields[] =
            version === '4.1'
                ? [{ mixAttachmentThreshold: 1 }, { alphaAttachmentThreshold: 1 }, { mixDrawOrderThreshold: 1 }]
                : [{ attachmentThreshold: 1 }, { drawOrderThreshold: 1 }];

        for (const fields of [...foreign, { additive: true }, { keepHold: true }, { alpha: 0.25, additive: true }]) {
            expect(codeOf(() => engine.configure(entry, fields))).toBe('unsupported-feature');
        }
        for (const fields of [
            { alpha: '1' },
            { loop: 1 },
            { mixBlend: 'multiply' },
            { mixBlend: 3 },
            { delay: true },
        ]) {
            expect(codeOf(() => engine.configure(entry, { timeScale: 3, ...fields }))).toBe('invalid-data');
        }
        expect([entry.alpha, entry.timeScale, entry.loop, entry.delay]).toEqual([1, 1, false, 0]);
        expect(codeOf(() => engine.configure({ ...entry }, { alpha: 0.5 }))).toBe('invalid-data');
    });

    it('refuses animations, tracks and skins that do not exist', async () => {
        const { engine } = await create();
        const calls = [
            () => engine.setAnimation(0, 3, true),
            () => engine.setAnimation(0, -1, true),
            () => engine.addAnimation(0, 0.5, true, 0),
            () => engine.setAnimation(-1, ALL, true),
            () => engine.addAnimation(0.5, ALL, true, 0),
            () => engine.addEmptyAnimation(Number.NaN, 0, 0),
            () => engine.setMix(ALL, 3, 0.2),
            () => engine.setSkin(3),
            () => engine.setSkin(-2),
        ];

        for (const call of calls) expect(codeOf(call)).toBe('invalid-data');
        // clearing a track that never held anything is not an error
        engine.clearTrack(-1);
        engine.clearTrack(7);
        engine.clearTracks();
        expect(engine.takeEvents()).toEqual([]);
    });

    it('refuses animations it cannot play when they are first played', async () => {
        const { model } = await create();
        const missing = { skin: 0, slot: 1, name: 'missing' };
        const cases: [string, Partial<TimelineData>][] = [
            ['unsupported-feature', { kind: 'slider' }],
            ['unsupported-feature', { kind: 'drawOrderFolder', target: -1 }],
            ['invalid-data', { kind: 'rotate', target: 99 }],
            ['invalid-data', { kind: 'rgba', target: -1 }],
            ['invalid-data', { kind: 'rgba2', target: 1 }],
            ['invalid-data', { kind: 'rgb2', target: 4 }],
            ['invalid-data', { kind: 'deform', target: 1, attachment: missing, vertices: [new Float32Array(8)] }],
            ['invalid-data', { kind: 'deform', target: 1, attachment: { ...missing, name: 'mesh' }, vertices: [] }],
            ['invalid-data', { kind: 'sequence', target: 1 }],
            ['invalid-data', { kind: 'translate', frames: new Float32Array(0) }],
            [version === '4.1' ? 'unsupported-feature' : 'nothing thrown', { kind: 'inherit' }],
            ['nothing thrown', { kind: 'physicsConstraintWind', target: -1 }],
        ];

        for (const [code, timeline] of cases) {
            const changed = withAnimation(model, timeline);
            // creating the engine reads no animation
            const engine = createLegacyEngine(changed);

            expect(
                codeOf(() => engine.setAnimation(0, model.animations.length, true)),
                timeline.kind,
            ).toBe(code);
        }
        expect(codeOf(() => createLegacyEngine({ ...model, version: '4.3' }))).toBe('unsupported-version');
    });
});
