import { describe, expect, it } from 'vitest';
import {
    createPoseEngine,
    importSkeleton,
    MarrowError,
    type PoseEngine,
    type SkeletonModel,
    type TimelineData,
    type TrackFields,
} from '../../src/core';
import { createLegacyEngine } from '../../src/pose/legacy/index';

/*
 * The calls of the legacy engine that take names, numbers and fields: what they set, and what
 * they refuse. No official core is asked here. The poses are compared in the other test files.
 */

type Version = '4.1' | '4.2';

const QUAD = '"uvs": [0, 0, 1, 0, 1, 1, 0, 1], "triangles": [0, 1, 2, 2, 3, 0], "hull": 4';

/** A skeleton with five slots, two of them with a dark color, three skins and three animations. */
function rigJson(version: Version): string {
    return `{
"skeleton": { "spine": "${version}.24" },
"bones": [{ "name": "root" }, { "name": "a", "parent": "root", "x": 10 }],
"slots": [
  { "name": "s0", "bone": "root", "attachment": "img", "dark": "102030" },
  { "name": "s1", "bone": "a", "attachment": "mesh" },
  { "name": "s2", "bone": "a", "dark": "ffffff" },
  { "name": "s3", "bone": "a" },
  { "name": "s4", "bone": "root" }
],
"skins": [
  { "name": "default", "attachments": {
    "s0": { "img": { "width": 8, "height": 8 } },
    "s1": { "mesh": { "type": "mesh", "path": "img", ${QUAD}, "vertices": [0, 0, 8, 0, 8, 8, 0, 8] } }
  } },
  { "name": "alt" },
  { "name": "deep" }
],
"animations": {
  "all": { "bones": { "a": { "rotate": [{ "value": 10 }, { "time": 1, "value": 100 }] } } },
  "other": { "bones": { "a": { "translate": [{ "x": 1 }, { "time": 0.5, "x": 4 }] } } },
  "third": { "slots": { "s0": { "attachment": [{ "name": null }] } } }
}
}`;
}

const ALL = 0;

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

describe.each(['4.1', '4.2'] as const)('the calls of the legacy engine on a %s skeleton', (version) => {
    const create = async (): Promise<{ model: SkeletonModel; engine: PoseEngine }> => {
        const model = await importSkeleton(rigJson(version));

        return { model, engine: await createPoseEngine(model, { constraints: 'ignore' }) };
    };

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
