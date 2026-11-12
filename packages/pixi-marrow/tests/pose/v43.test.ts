import { AtlasAttachmentLoader, Physics, Skeleton, SkeletonJson, Texture, TextureAtlas } from 'spine-core-4.3';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    type AttachmentData,
    createPoseEngine,
    importSkeleton,
    MarrowError,
    type PoseEngine,
    type PoseEvent,
    type SkeletonModel,
    type TimelineData,
    type TimelineKind,
    WORLD_STRIDE,
} from '../../src/core';
import { setClock } from '../../src/pose/v43/curves';
import { prepareRig } from '../../src/pose/v43/rig';
import { createSolve } from '../../src/pose/v43/solver';
import { applyTimeline } from '../../src/pose/v43/timelines';
import { CURRENT, SETUP } from '../../src/pose/v43/types';
import { loadPoseRig } from '../parity/pose-official';
import { attachmentLabels, engineSubject, officialSubject, runScript } from '../parity/pose-run';
import { DT, type PoseScript, script } from '../parity/pose-script';
import { SCRIPT_FAMILIES } from '../parity/pose-scripts';
import type { OfficialPoseRig } from '../parity/pose-shared';

/** An atlas with every region of the skeleton below. The official core needs it to load the file. */
const REGIONS = 'quad alt dot tool mesh mesh2 weighted echo film/f1 film/f2 film/f3 film/f4'.split(' ');
const TRIANGLE = '"type": "mesh", "uvs": [0, 0, 1, 0, 1, 1], "triangles": [0, 1, 2], "hull": 3';
const DOT = '"dot": { "width": 1, "height": 1 }';
const ATLAS = ['page.png', '\tsize: 8, 8', ...REGIONS.flatMap((name) => [name, '\tbounds: 0, 0, 8, 8'])].join('\n');

/**
 * A skeleton with what the official example exports lack: every inherit mode, a bone below a bone that needs
 * a skin, single axis scale, inherit, two color, sequence and folder timelines, late first keys, a constraint timeline.
 */
const LAB = `{
"skeleton": { "spine": "4.3.39-beta" }, "constraints": [{ "type": "ik", "name": "reach", "bones": ["only"], "target": "flatkid" }],
"bones": [
    { "name": "root" }, { "name": "hip", "parent": "root", "x": 10, "y": 20, "rotation": 30, "scaleX": 1.5, "scaleY": 0.8, "shearX": 5 },
    { "name": "only", "parent": "hip", "x": 5, "rotation": 45, "inherit": "onlyTranslation" },
    { "name": "norot", "parent": "hip", "rotation": 20, "scaleX": -1.2, "inherit": "noRotationOrReflection" },
    { "name": "noscale", "parent": "hip", "rotation": 10, "shearY": 15, "inherit": "noScale" },
    { "name": "noref", "parent": "hip", "y": 3, "rotation": -25, "inherit": "noScaleOrReflection" },
    { "name": "flat", "parent": "root", "scaleX": 0, "scaleY": 0 }, { "name": "flatkid", "parent": "flat", "rotation": 15, "inherit": "noRotationOrReflection" },
    { "name": "mirror", "parent": "root", "scaleX": -1 }, { "name": "mirrorkid", "parent": "mirror", "rotation": 40, "inherit": "noScale" },
    { "name": "gated", "parent": "hip", "x": 2, "skin": true }, { "name": "gatedkid", "parent": "gated", "y": 4, "skin": true },
    { "name": "orphan", "parent": "gated", "x": 1, "rotation": 5 }
],
"slots": [
    { "name": "body", "bone": "hip", "color": "ff8040c0", "attachment": "quad" }, { "name": "tint", "bone": "only", "color": "80ff80ff", "dark": "102030", "attachment": "quad" },
    { "name": "cloth", "bone": "norot", "attachment": "mesh" }, { "name": "cape", "bone": "noscale", "attachment": "weighted" },
    { "name": "copy", "bone": "noref", "attachment": "echo" }, { "name": "film", "bone": "hip", "attachment": "frames" },
    { "name": "gear", "bone": "gatedkid", "attachment": "tool" }, { "name": "a", "bone": "root", "attachment": "dot" },
    { "name": "b", "bone": "root", "attachment": "dot" },
    { "name": "c", "bone": "mirrorkid", "attachment": "dot" }, { "name": "plain", "bone": "orphan", "attachment": "dot" }
],
"skins": [
    { "name": "default", "attachments": {
        "body": { "quad": { "width": 4, "height": 4 }, "alt": { "width": 2, "height": 2 } }, "tint": { "quad": { "width": 4, "height": 4 } },
        "cloth": { "mesh": { ${TRIANGLE}, "vertices": [0, 0, 10, 0, 10, 10], "path": "film/f", "sequence": { "count": 3 } },
                   "mesh2": { ${TRIANGLE}, "vertices": [1, 1, 8, 0, 8, 8] } },
        "cape": { "weighted": { ${TRIANGLE}, "vertices": [2, 1, 1, 1, 0.5, 4, 0, 0, 0.5, 2, 1, 5, 0, 0.6, 4, 3, 1, 0.4, 1, 4, 2, 2, 1] } },
        "copy": { "echo": { "type": "linkedmesh", "source": "mesh", "slot": "cloth" } }, "a": { ${DOT} }, "b": { ${DOT} }, "c": { ${DOT} },
        "film": { "frames": { "path": "film/f", "width": 2, "height": 2, "sequence": { "count": 4, "setup": 1 } } },
        "plain": { ${DOT}, "box": { "type": "boundingbox", "vertexCount": 3, "vertices": [0, 0, 1, 0, 1, 1] } }
    } },
    { "name": "one", "bones": ["gatedkid"], "attachments": {
        "gear": { "tool": { "width": 3, "height": 3 } }, "body": { "quad": { "path": "alt", "width": 5, "height": 5 } },
        "cloth": { "mesh": { "type": "linkedmesh", "source": "mesh", "skin": "default" } }
    } },
    { "name": "two", "bones": ["gated"], "attachments": {
        "gear": { "tool": { "path": "dot", "width": 3, "height": 3 } }, "film": { "frames": { "path": "film/f", "width": 2, "height": 2, "sequence": { "count": 2 } } },
        "copy": { "echo": { "type": "linkedmesh", "source": "mesh2", "slot": "cloth", "skin": "default", "timelines": false } }
    } }
],
"events": { "step": {}, "bang": { "int": 2, "float": 1.5, "string": "loud", "audio": "bang.wav", "volume": 0.5 } },
"animations": {
    "move": {
        "bones": {
            "hip": { "rotate": [{ "value": 10, "curve": [0.25, 10, 0.75, 60] }, { "time": 1, "value": 80 }],
                     "translate": [{ "x": 1, "curve": [0.1, 1, 0.3, 4, 0.1, 0, 0.3, -3] }, { "time": 0.5, "x": 5, "y": -4 }, { "time": 1, "y": 2 }],
                     "scale": [{ "x": 2, "curve": "stepped" }, { "time": 0.5, "x": -1, "y": 0.5 }, { "time": 1 }],
                     "shear": [{ "x": 5 }, { "time": 1, "x": -10, "y": 20 }] },
            "only": { "translatex": [{ "value": 1 }, { "time": 1, "value": 9 }], "translatey": [{ "time": 0.2, "value": -3 }] },
            "norot": { "scalex": [{ "value": -1 }, { "time": 1, "value": 2 }], "scaley": [{ "value": 0.5 }, { "time": 0.7, "value": -2 }] },
            "noscale": { "shearx": [{ "value": 10 }, { "time": 1, "value": -30 }], "sheary": [{ "time": 0.3, "value": 12 }],
                         "inherit": [{ "inherit": "normal" }, { "time": 0.5, "inherit": "onlyTranslation" }, { "time": 0.8, "inherit": "noScale" }] },
            "noref": { "rotate": [{ "value": 0 }, { "time": 0.5, "value": 200 }, { "time": 1, "value": 400 }] },
            "flat": { "scale": [{ "x": 0, "y": 0 }, { "time": 1, "x": 1, "y": 1 }] }, "mirror": { "scale": [{ "x": 1 }, { "time": 0.5, "x": -2, "y": -1 }, { "time": 1 }] },
            "gated": { "rotate": [{ "value": 0 }, { "time": 1, "value": 90 }] }, "orphan": { "translate": [{ "x": 3 }, { "time": 1, "y": 3 }] }
        },
        "slots": {
            "body": { "attachment": [{ "name": "alt" }, { "time": 0.4, "name": null }, { "time": 0.8, "name": "quad" }],
                      "rgba": [{ "color": "ff000080" }, { "time": 1, "color": "00ff00ff" }] },
            "tint": { "rgba2": [{ "light": "ffffff80", "dark": "400000" }, { "time": 1, "light": "000000ff", "dark": "ffff00" }] }
        },
        "events": [{ "name": "step" }, { "time": 0.5, "name": "bang", "int": 7 }, { "time": 0.5, "name": "step" }, { "time": 1, "name": "bang" }]
    },
    "colors": {
        "bones": { "hip": { "rotate": [{ "time": 0.2, "value": -40 }, { "time": 0.9, "value": 300 }] }, "noref": { "rotate": [{ "value": 170 }, { "time": 0.6, "value": -170 }] } },
        "slots": {
            "body": { "rgb": [{ "color": "0000ff", "curve": [0.1, 0, 0.2, 1, 0.1, 0, 0.2, 1, 0.1, 1, 0.2, 2] }, { "time": 0.8, "color": "ffff00" }],
                      "alpha": [{ "time": 0.1, "value": 0.2 }, { "time": 0.9, "value": 1 }] },
            "tint": { "rgb2": [{ "time": 0.3, "light": "ff00ff", "dark": "00ff00" }, { "time": 0.8, "light": "00ffff", "dark": "0000ff" }] },
            "cloth": { "attachment": [{ "time": 0.25, "name": "mesh2" }, { "time": 0.75, "name": "mesh" }] }, "film": { "attachment": [{ "time": 0.5, "name": null }] }
        }
    },
    "bend": {
        "attachments": { "default": {
            "cloth": { "mesh": {
                "deform": [{ "time": 0.1, "vertices": [1, 2, 3, 4, 5, 6] },
                           { "time": 0.5, "offset": 2, "vertices": [-4, 4], "curve": [0.6, 0.2, 0.8, 0.9] }, { "time": 1 }],
                "sequence": [{ "time": 0.2, "mode": "pingpong", "delay": 0.07 }, { "time": 0.9, "index": 2 }] } },
            "cape": { "weighted": { "deform": [{ "vertices": [1, 1, -1, -1, 2, 2, -2, -2, 3, 3], "curve": "stepped" },
                                               { "time": 0.4, "offset": 4, "vertices": [5, 5] }, { "time": 0.9 }] } },
            "film": { "frames": { "sequence": [{ "mode": "loop", "delay": 0.05 }, { "time": 0.4, "mode": "pingpong", "index": 1, "delay": 0.04 },
                                               { "time": 0.8, "mode": "onceReverse", "delay": 0.03 }] } }
        } },
        "slots": { "cloth": { "attachment": [{ "time": 0.6, "name": "mesh2" }, { "time": 0.7, "name": "mesh" }] } }, "events": [{ "time": 0.3, "name": "step" }]
    },
    "order": {
        "drawOrder": [{ "time": 0.1, "offsets": [{ "slot": "body", "offset": 3 }, { "slot": "plain", "offset": -5 }] }, { "time": 0.5 },
                      { "time": 0.8, "offsets": [{ "slot": "tint", "offset": 1 }] }],
        "drawOrderFolder": [
            { "slots": ["a", "b", "c"], "keys": [{ "offsets": [{ "slot": "a", "offset": 2 }] }, { "time": 0.4 },
                                                 { "time": 0.7, "offsets": [{ "slot": "b", "offset": 1 }] }] },
            { "slots": ["body", "film"], "keys": [{ "time": 0.3, "offsets": [{ "slot": "body", "offset": 1 }] }] }
        ],
        "attachments": { "default": { "film": { "frames": { "sequence": [
            { "time": 0.1, "mode": "once", "delay": 0.05 }, { "time": 0.4, "mode": "loopReverse", "index": 2, "delay": 0.02 },
            { "time": 0.6, "mode": "pingpongReverse", "delay": 0.03 }, { "time": 0.9, "mode": "hold", "index": 3 }] } } } },
        "events": [{ "time": 0.2, "name": "bang" }, { "time": 0.95, "name": "step" }]
    },
    "late": {
        "bones": {
            "hip": { "rotate": [{ "time": 0.5, "value": 45 }], "translate": [{ "time": 0.5, "x": 3 }], "scale": [{ "time": 0.5, "x": 2 }], "shear": [{ "time": 0.5, "y": 9 }] },
            "norot": { "scalex": [{ "time": 0.5, "value": 3 }] }, "noscale": { "inherit": [{ "time": 0.5, "inherit": "noRotationOrReflection" }] }
        },
        "slots": {
            "body": { "rgba": [{ "time": 0.5, "color": "10203040" }], "attachment": [{ "time": 0.5, "name": "alt" }] },
            "tint": { "rgba2": [{ "time": 0.5, "light": "ffffff40", "dark": "808080" }] }, "film": { "alpha": [{ "time": 0.5, "value": 0.25 }], "rgb": [{ "time": 0.5, "color": "804020" }] }
        },
        "attachments": { "default": {
            "cloth": { "mesh": { "deform": [{ "time": 0.5, "vertices": [2, 2, 2, 2, 2, 2] }, { "time": 0.9, "vertices": [0, 1] }] } },
            "cape": { "weighted": { "deform": [{ "time": 0.5, "vertices": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }] } }, "film": { "frames": { "sequence": [{ "time": 0.5, "mode": "loop", "index": 1, "delay": 0.1 }] } }
        } },
        "drawOrder": [{ "time": 0.5, "offsets": [{ "slot": "a", "offset": 1 }] }], "events": [{ "time": 0.5, "name": "bang", "string": "late" }],
        "drawOrderFolder": [{ "slots": ["tint", "cloth"], "keys": [{ "time": 0.5, "offsets": [{ "slot": "tint", "offset": 1 }] }] }]
    },
    "still": {}, "aim": { "ik": { "reach": [{ "mix": 0.5 }, { "time": 0.6, "mix": 1, "softness": 2 }] } }
}
}`;

const [MOVE, COLORS, BEND, ORDER, LATE, AIM] = [0, 1, 2, 3, 4, 6];
const ALL_THRESHOLDS = { eventThreshold: 1, mixAttachmentThreshold: 1, mixDrawOrderThreshold: 1 };

/** Scripts for what the families of the parity suite do not reach on this skeleton. */
const LAB_SCRIPTS: PoseScript[] = [
    script('timelines that start late, and additive layers', (s) => {
        s.defaultMix(0.3);
        s.set(0, BEND, true);
        s.update(DT, 5);
        // before its first keys, late mixes what bend left back to the setup pose
        s.set(0, LATE, true);
        s.set(1, LATE, true, { alpha: 0.5 });
        s.set(2, ORDER, false, { alpha: 0.5, ...ALL_THRESHOLDS });
        s.set(3, BEND, true, { additive: true, alpha: 0.7, timeScale: 0.5 });
        s.update(DT, 30);
        s.set(0, MOVE, true);
        s.set(1, BEND, false, { alpha: 0.75, alphaAttachmentThreshold: 0.6 });
        s.set(3, LATE, true, { additive: true });
        s.update(DT, 14);
        s.set(2, LATE, true, ALL_THRESHOLDS);
        s.set(0, ORDER, true, ALL_THRESHOLDS);
        s.set(1, MOVE, true, { additive: true, alpha: 0.4 });
        s.setEmpty(3, 0.3);
        s.update(DT, 24);
    }),
    script('reversed loops with events', (s) => {
        s.set(0, MOVE, true, { reverse: true });
        // steps that pass the loop point, the last ones by more than a loop
        s.update(0.3, 8);
        s.update(1.7, 2);
        s.set(1, ORDER, true, { reverse: true, alpha: 0.7 });
        s.update(0.27, 6);
        s.defaultMix(0.4);
        s.set(0, LATE, false, { reverse: true, eventThreshold: 1 });
        s.set(1, BEND, true, { reverse: true, eventThreshold: 1 });
        s.update(0.11, 12);
    }),
    script('an animation that animates a constraint only', (s) => {
        s.defaultMix(0.2);
        s.set(0, AIM, true);
        s.update(DT, 4);
        // the second entry of aim holds the constraint timeline of the first
        s.set(0, AIM, false);
        s.update(DT, 3);
        // the first entry stays until this mix is over, though it changes nothing in the pose
        s.set(0, MOVE, true);
        s.update(DT, 12);
    }),
];

describe('the 4.3 pose engine on a skeleton the official examples do not cover', () => {
    let rig: OfficialPoseRig;
    let model: SkeletonModel;
    let labels: ReturnType<typeof attachmentLabels>;
    const run = async (script: PoseScript): Promise<void> => {
        const engine = await createPoseEngine(model, { constraints: 'ignore' });
        const official = officialSubject(rig.createDriver(), labels.ofRef);
        const failure = runScript(script, engineSubject(engine, labels.ofObject), official);

        if (failure !== null) expect.fail(failure);
    };

    beforeAll(async () => {
        rig = loadPoseRig('4.3', { skeleton: LAB, atlas: ATLAS });
        model = await importSkeleton(LAB);
        labels = attachmentLabels(model);
    });

    it.each(SCRIPT_FAMILIES)('poses like the official core: $name', async (family) => {
        for (const script of family.scripts(rig.info, 'lab')) await run(script);
    });

    it.each(LAB_SCRIPTS)('poses like the official core: $name', run);
});

class FakeTexture extends Texture {
    setFilters(): void {}
    setWraps(): void {}
    dispose(): void {}
}

/** An official skeleton of the lab file, in the setup pose. */
function officialSkeleton(): Skeleton {
    const atlas = new TextureAtlas(ATLAS);

    for (const page of atlas.pages) page.setTexture(new FakeTexture({ width: 8, height: 8, close() {} }));

    return new Skeleton(new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(LAB));
}

const play = (model: SkeletonModel): Promise<PoseEngine> => createPoseEngine(model, { constraints: 'ignore' });

/** The first timeline of a kind in an animation of a model. The tests change it to damage the model. */
function timelineOf(model: SkeletonModel, animation: number, kind: TimelineKind): TimelineData {
    const timeline = model.animations[animation]?.timelines.find((candidate) => candidate.kind === kind);

    if (timeline === undefined) throw new Error(`The animation has no ${kind} timeline`);

    return timeline;
}

function attachmentOf(model: SkeletonModel, slot: string, name: string): AttachmentData {
    const index = model.slots.names.indexOf(slot);
    const entry = model.skins[0]?.attachments.find((candidate) => candidate.slot === index && candidate.name === name);

    if (entry === undefined) throw new Error(`The default skin has no ${name} in ${slot}`);

    return entry.attachment;
}

/** The error a call throws, which must be a MarrowError. */
function errorOf(call: () => unknown): MarrowError {
    try {
        call();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('The call did not throw');
}

describe('createEngine43', () => {
    it('starts in the setup pose of a new official skeleton', async () => {
        const model = await importSkeleton(LAB);
        const { state } = await play(model);

        expect([state.local, state.inherit]).toEqual([model.bones.setup, model.bones.inherit]);
        // the two bones that need a skin are off. The bone below them is on.
        expect(Array.from(state.active)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1]);
        expect(state.world.every((value) => value === 0)).toBe(true);
        expect(state.colors).toEqual(model.slots.colors);
        expect(Array.from(state.darkColors.subarray(3, 6))).toEqual([0x10 / 255, 0x20 / 255, 0x30 / 255]);
        expect(Array.from(state.drawOrder)).toEqual(model.slots.names.map((_, slot) => slot));
        // the default skin has nothing for the gear slot, which is slot 6
        expect([state.attachments[0], state.attachments[6]]).toEqual([attachmentOf(model, 'body', 'quad'), null]);
        expect(Array.from(state.sequenceIndices)).toEqual([-1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1]);
        expect(Array.from(state.deformLengths)).toEqual(model.slots.names.map(() => 0));
        expect([state.skin, state.time]).toEqual([-1, 0]);
    });

    it('applies the position and the scale of the skeleton like the official core', async () => {
        const engine = await play(await importSkeleton(LAB));
        const skeleton = officialSkeleton();

        Object.assign(engine.state, { x: 3, y: -2, scaleX: -1.5, scaleY: 0.75 });
        Object.assign(skeleton, { x: 3, y: -2, scaleX: -1.5, scaleY: 0.75 });
        engine.setSkin(2);
        skeleton.setSkin('two');
        // the time of the skeleton does not follow the time scale
        engine.timeScale = 2;
        engine.update(0.25);
        expect(engine.state.time).toBe(0.25);
        skeleton.updateWorldTransform(Physics.update);
        skeleton.bones.forEach((bone, index) => {
            const { a, b, c, d, worldX, worldY } = bone.appliedPose;
            const world = engine.state.world.subarray(index * WORLD_STRIDE, (index + 1) * WORLD_STRIDE);

            // a bone that is not active is not posed: its numbers stay zero on both sides
            expect([engine.state.active[index], ...world]).toEqual([bone.active ? 1 : 0, a, b, c, d, worldX, worldY]);
        });
    });

    it('gives every event the entry it is about, also for two entries of one animation on one track', async () => {
        const engine = await play(await importSkeleton(LAB));
        const older = engine.setAnimation(0, MOVE, true);
        const told = (): string[] =>
            engine
                .takeEvents()
                .map(({ type, entry, key }) => `${entry === older ? 'A' : 'B'} ${type} ${key?.time ?? ''}`);

        engine.defaultMix = 0.3;
        engine.configure(older, { eventThreshold: 1 });
        engine.update(0.45);
        // the same animation again: the older entry A mixes out below the newer entry B and still fires events
        expect(engine.setAnimation(0, MOVE, true)).not.toBe(older);
        engine.update(0.1);
        expect(told().join()).toBe('A start ,A event 0,A interrupt ,B start ,A event 0.5,A event 0.5,B event 0');
        engine.update(0.3);
        engine.update(0.2);
        expect(told().join()).toBe('A end ,A dispose ,B event 0.5,B event 0.5');
    });

    it('keeps what an event says when the pool hands its entry out again', async () => {
        const engine = await play(await importSkeleton(LAB));
        const first = engine.setAnimation(0, MOVE, true);
        const told = (events: PoseEvent[]): string =>
            events.map((event) => `${event.type} ${event.animation} ${event.entry === first}`).join();

        engine.clearTrack(0);
        const taken = engine.takeEvents();

        // the pool hands the object of the entry that ended out again, like the official core
        expect(engine.setAnimation(0, COLORS, false)).toBe(first);
        engine.clearTrack(0);
        expect(engine.setEmptyAnimation(0, 0.1)).toBe(first);
        expect(told(taken)).toBe('start 0 true,end 0 true,dispose 0 true');
        // events that were not taken before the object was reused still say what they were about
        expect(told(engine.takeEvents())).toBe('start 1 true,end 1 true,dispose 1 true,start -1 true');
        expect([first.animation, engine.takeEvents()]).toEqual([-1, []]);
    });
});

describe('the calls of the 4.3 pose engine', () => {
    let engine: PoseEngine;

    beforeAll(async () => {
        engine = await play(await importSkeleton(LAB));
    });

    it('refuses the fields Spine 4.3 does not have', () => {
        for (const field of ['holdPrevious', 'mixBlend', 'attachmentThreshold', 'drawOrderThreshold'] as const) {
            const error = errorOf(() => engine.configure(engine.setAnimation(0, MOVE, true), { [field]: 1 }));

            expect(error).toMatchObject({ code: 'unsupported-feature', message: expect.stringContaining(field) });
            expect(error.validNames).toContain('mixDrawOrderThreshold');
        }
    });

    it('refuses fields no version has and values of the wrong type', () => {
        const entry = engine.setAnimation(0, MOVE, true);

        expect(errorOf(() => engine.configure(entry, { nothing: 1 } as object)).code).toBe('invalid-data');
        expect(errorOf(() => engine.configure(entry, { alpha: true })).message).toContain('takes a number');
        expect(errorOf(() => engine.configure(entry, { loop: 1 })).message).toContain('takes a boolean');
        expect(errorOf(() => engine.configure(entry, { animationLast: 'now' })).message).toContain('takes a number');
        expect(errorOf(() => engine.configure({ ...entry }, { alpha: 1 })).message).toContain('not from this pose');
    });

    it('refuses tracks, animations and skins that do not exist', () => {
        expect(errorOf(() => engine.setAnimation(-1, MOVE, true)).message).toContain('-1 is not a track index');
        expect(errorOf(() => engine.addAnimation(1.5, MOVE, true, 0)).code).toBe('invalid-data');
        expect(errorOf(() => engine.addEmptyAnimation(Number.NaN, 0, 0)).code).toBe('invalid-data');
        expect(errorOf(() => engine.setAnimation(0, 99, true)).message).toContain('no animation 99');
        // the empty animation has its own calls
        expect(errorOf(() => engine.addAnimation(0, -1, true, 0)).fix).toContain('setEmptyAnimation');
        expect(errorOf(() => engine.setMix(MOVE, 7, 0.2)).code).toBe('invalid-data');
        expect(errorOf(() => engine.setSkin(3)).message).toContain('no skin 3');
    });
});

describe('data the official 4.3 core fails on', () => {
    type Damage = (model: SkeletonModel) => unknown;
    const BODY = 0;
    const PLAIN = 10;
    const lost = { skin: 0, slot: BODY, name: 'nothing' };
    /** The message of the error the first update throws, after `damage` changed the model and `pose` the engine. */
    const updateError = async (animation: number, damage: Damage, pose?: (engine: PoseEngine) => unknown) => {
        const model = await importSkeleton(LAB);

        damage(model);
        const engine = await play(model);

        pose?.(engine);
        engine.setAnimation(0, animation, true);

        return errorOf(() => engine.update(0.2)).message;
    };
    /** The error of creating an engine after `damage` changed the model, as text. */
    const createError = async (damage: Damage): Promise<string> => {
        const model = await importSkeleton(LAB);

        damage(model);

        return String(await play(model).catch((reason: unknown) => reason));
    };

    it('names what is wrong when an update meets it', async () => {
        const quad = { ...lost, name: 'quad' };
        const box = { skin: 0, slot: PLAIN, name: 'box' };
        const messages = await Promise.all([
            updateError(MOVE, (model) => Object.assign(timelineOf(model, MOVE, 'rgba2'), { target: BODY })),
            updateError(MOVE, (model) =>
                Object.assign(timelineOf(model, MOVE, 'attachment'), { attachmentNames: [''] }),
            ),
            updateError(BEND, (model) =>
                Object.assign(timelineOf(model, BEND, 'deform'), { target: BODY, attachment: quad }),
            ),
            updateError(
                ORDER,
                (model) => Object.assign(timelineOf(model, ORDER, 'sequence'), { target: PLAIN, attachment: box }),
                ({ state }) => state.attachments.fill(attachmentOf(state.model, 'plain', 'box'), PLAIN),
            ),
            updateError(
                ORDER,
                (model) => Object.assign(timelineOf(model, ORDER, 'drawOrder'), { kind: 'event', events: [] }),
                ({ state }) => state.drawOrder.fill(BODY),
            ),
            updateError(
                MOVE,
                () => {},
                ({ state }) => state.attachments.fill({ ...attachmentOf(state.model, 'body', 'quad') }, BODY, BODY + 1),
            ),
        ]);

        expect(messages).toEqual([
            expect.stringContaining('A rgba2 timeline animates the slot "body", which has no dark color.'),
            expect.stringContaining('The slot "body" is given an attachment with an empty name.'),
            expect.stringContaining('A deform timeline animates the slot "body", whose attachment has no vertices.'),
            expect.stringContaining('A sequence timeline animates the slot "plain", whose attachment has no sequence.'),
            expect.stringContaining('A draw order folder timeline has slots that the draw order does not hold.'),
            expect.stringContaining('The attachment "quad" is not from a skin of the skeleton.'),
        ]);
    });

    it('refuses a model it cannot prepare', async () => {
        const errors = await Promise.all([
            createError((model) => Object.assign(timelineOf(model, MOVE, 'rotate'), { kind: 'warp' })),
            createError((model) => Object.assign(timelineOf(model, BEND, 'deform'), { attachment: lost })),
            createError((model) => Object.assign(attachmentOf(model, 'copy', 'echo'), { timelineAttachment: lost })),
        ]);

        expect(errors).toEqual([
            expect.stringContaining('unsupported-feature] Animation "move" has a timeline of the kind "warp".'),
            expect.stringContaining('invalid-data] Animation "bend" animates an attachment that no skin has.'),
            expect.stringContaining('invalid-data] The mesh "echo" follows the timelines of a mesh that no skin has.'),
        ]);
    });
});

describe('the attachment timeline of the 4.3 pose engine', () => {
    it('applies like the official AttachmentTimeline when it is applied on its own', async () => {
        const model = await importSkeleton(LAB);
        const { state } = await play(model);
        const rig = prepareRig(model);
        const pose = { rig, state, solve: createSolve(rig) };
        const shown = (animation: number, time: number, from: number, out: boolean): string | undefined => {
            const timeline = pose.rig.clips[animation]?.timelines.find((candidate) => candidate.kind === 'attachment');

            if (timeline === undefined) throw new Error('The animation has no attachment timeline');
            setClock(-1, time, 1);
            applyTimeline(pose, timeline, null, from, false, out);

            return state.attachments[timeline.target]?.name;
        };

        expect([shown(MOVE, 0.1, SETUP, false), shown(MOVE, 0.5, SETUP, false)]).toEqual(['alt', undefined]);
        // mixing out gives the setup attachment back, unless a lower track owns the slot
        expect([shown(MOVE, 0.5, CURRENT, true), shown(MOVE, 0.5, SETUP, true)]).toEqual([undefined, 'quad']);
        expect(shown(COLORS, 0.5, SETUP, false)).toBe('mesh2');
        // so does a time before the first key
        expect([shown(COLORS, 0.1, CURRENT, false), shown(COLORS, 0.1, SETUP, false)]).toEqual(['mesh2', 'mesh']);
        state.active.fill(0);
        expect(shown(COLORS, 0.5, SETUP, false)).toBe('mesh');
    });
});
