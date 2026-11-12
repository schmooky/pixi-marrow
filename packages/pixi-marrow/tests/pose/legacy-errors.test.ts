import * as core41 from 'spine-core-4.1';
import * as core42 from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import {
    type ConstraintData,
    importSkeleton,
    MarrowError,
    type PoseEngine,
    type SkeletonModel,
    type TimelineData,
} from '../../src/core';
import { createLegacyEngine } from '../../src/pose/legacy/index';

/*
 * What the legacy engine refuses: constraint data that points nowhere, and skeletons the official
 * runtime crashes on. Every error names the constraint. And one thing it must not refuse: the
 * official skeleton finds the bones of a constraint by name, so two bones with one name are legal.
 */

type Version = '4.1' | '4.2';
type Json = Record<string, unknown>;

const PATH = { type: 'path', lengths: [10, 20], vertexCount: 6, vertices: [-5, 0, 0, 0, 5, 0, 15, 0, 20, 0, 25, 0] };

/** A small skeleton with one constraint of every kind the version has. `more` replaces parts of it. */
function rigJson(version: Version, more: Json = {}): string {
    return JSON.stringify({
        skeleton: { spine: `${version}.24` },
        bones: [
            { name: 'root', rotation: 5 },
            { name: 'a', parent: 'root', x: 10, y: 4, rotation: 20, length: 10 },
            { name: 'b', parent: 'a', x: 10, rotation: -30, length: 10 },
            { name: 't', parent: 'root', x: 25, y: 15 },
        ],
        slots: [{ name: 'rail', bone: 't', attachment: 'line' }],
        ik: [{ name: 'reach', order: 0, bones: ['b'], target: 't' }],
        transform: [{ name: 'copy', order: 1, bones: ['a'], target: 't', mixRotate: 0.5 }],
        path: [{ name: 'follow', order: 2, bones: ['b'], target: 'rail' }],
        ...(version === '4.2' ? { physics: [{ name: 'wobble', order: 3, bone: 'b', x: 1 }] } : {}),
        skins: [{ name: 'default', attachments: { rail: { line: PATH } } }],
        animations: { still: {} },
        ...more,
    });
}

/** The error a call throws, or a note that it threw none. */
function errorOf(call: () => unknown): { code: string; message: string } {
    try {
        call();
    } catch (error) {
        if (error instanceof MarrowError) return { code: error.code, message: error.message };
        throw error;
    }

    return { code: 'nothing thrown', message: '' };
}

/** A copy of a model with one constraint changed. */
function withConstraint(
    model: SkeletonModel,
    name: string,
    change: (data: ConstraintData) => ConstraintData,
): SkeletonModel {
    return { ...model, constraints: model.constraints.map((data) => (data.name === name ? change(data) : data)) };
}

/** A copy of a model with one more animation, made of timelines no importer would give. */
function withAnimation(model: SkeletonModel, timeline: Partial<TimelineData>): SkeletonModel {
    const base: TimelineData = {
        kind: 'ikConstraint',
        target: 0,
        frames: new Float32Array(14),
        curves: new Float32Array(2),
    };

    return {
        ...model,
        animations: [...model.animations, { name: 'made up', duration: 1, timelines: [{ ...base, ...timeline }] }],
    };
}

const world = (engine: PoseEngine): number[] => Array.from(engine.state.world);

describe.each(['4.1', '4.2'] as const)('what the legacy engine refuses in a %s skeleton', (version) => {
    it('refuses a constraint that points at a bone or a slot the skeleton does not have, by name', async () => {
        const model = await importSkeleton(rigJson(version));
        const cases: [string, (data: ConstraintData) => ConstraintData][] = [
            ['reach', (data) => (data.type === 'ik' ? { ...data, bones: Int16Array.of(99) } : data)],
            ['reach', (data) => (data.type === 'ik' ? { ...data, bones: Int16Array.of(-1) } : data)],
            ['reach', (data) => (data.type === 'ik' ? { ...data, target: 4 } : data)],
            // the official update cache reads the children of the first IK bone
            ['reach', (data) => (data.type === 'ik' ? { ...data, bones: new Int16Array(0) } : data)],
            ['copy', (data) => (data.type === 'transform' ? { ...data, bones: Int16Array.of(1, 7) } : data)],
            ['copy', (data) => (data.type === 'transform' ? { ...data, source: -2 } : data)],
            ['follow', (data) => (data.type === 'path' ? { ...data, bones: Int16Array.of(40) } : data)],
            ['follow', (data) => (data.type === 'path' ? { ...data, slot: 1 } : data)],
            ['wobble', (data) => (data.type === 'physics' ? { ...data, bone: 4 } : data)],
        ];

        for (const [name, change] of cases) {
            if (!model.constraints.some((data) => data.name === name)) continue;
            const { code, message } = errorOf(() => createLegacyEngine(withConstraint(model, name, change)));

            expect(code, name).toBe('invalid-data');
            expect(message, name).toContain(`constraint "${name}"`);
        }
        // a slot on a bone that does not exist takes the path constraint with it
        const lost = { ...model, slots: { ...model.slots, bones: Int16Array.of(9) } };

        expect(errorOf(() => createLegacyEngine(lost)).message).toContain('constraint "follow"');
        expect(errorOf(() => createLegacyEngine(model)).code).toBe('nothing thrown');
    });

    it('refuses IK on bones without the parents it turns them in, when it solves, as the official core does', async () => {
        const onRoot = await importSkeleton(
            rigJson(version, { ik: [{ name: 'reach', order: 0, bones: ['root'], target: 't' }] }),
        );
        const underRoot = await importSkeleton(
            rigJson(version, { ik: [{ name: 'reach', order: 0, bones: ['root', 'a'], target: 't' }] }),
        );

        for (const model of [onRoot, underRoot]) {
            const engine = createLegacyEngine(model);
            const { code, message } = errorOf(() => engine.update(0));

            expect(code).toBe('invalid-data');
            expect(message).toContain('IK constraint "reach"');
            // without a mix the constraint does not solve, and the official core does not throw
            const idle = createLegacyEngine(withConstraint(model, 'reach', (data) => ({ ...data, mix: 0 })));

            expect(errorOf(() => idle.update(0)).code).toBe('nothing thrown');
        }
    });

    it('refuses a path whose vertices are not three for every point', async () => {
        // the importers refuse such a path. A model made by hand can still hold one.
        for (const [constantSpeed, worldVerticesLength] of [
            [true, 8],
            [false, 10],
            [true, 0],
        ] as const) {
            const model = await importSkeleton(rigJson(version));
            const entry = model.skins[0]?.attachments[0];

            if (entry?.attachment.type !== 'path') throw new Error('The rig has no path');
            Object.assign(entry.attachment, { constantSpeed, worldVerticesLength });
            const engine = createLegacyEngine(model);
            const { code, message } = errorOf(() => engine.update(0));

            expect(code).toBe('invalid-data');
            expect(message).toContain('path constraint "follow"');
            expect(message).toContain('path "line"');
        }
    });

    it('does nothing for a path constraint while its slot shows no path, like the official core', async () => {
        const box = { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 4, 0, 0, 4] };
        const shown = await importSkeleton(rigJson(version));
        const hidden = await importSkeleton(
            rigJson(version, { skins: [{ name: 'default', attachments: { rail: { line: box } } }] }),
        );
        const without = await importSkeleton(rigJson(version, { path: [] }));
        const [path, other, none] = [shown, hidden, without].map((model) => createLegacyEngine(model));

        for (const engine of [path, other, none]) engine?.update(0);
        expect(other && world(other)).toEqual(none && world(none));
        expect(path && world(path)).not.toEqual(none && world(none));
    });

    it('refuses a timeline that animates a constraint the skeleton does not have, or one of another type', async () => {
        const model = await importSkeleton(rigJson(version));
        const [ik, transform, path] = [0, 1, 2];
        const cases: [string, Partial<TimelineData>][] = [
            ['nothing thrown', { kind: 'ikConstraint', target: ik }],
            ['invalid-data', { kind: 'ikConstraint', target: transform }],
            ['invalid-data', { kind: 'ikConstraint', target: 9 }],
            ['invalid-data', { kind: 'ikConstraint', target: -1 }],
            ['invalid-data', { kind: 'ikConstraint', target: ik, frames: new Float32Array(5) }],
            ['nothing thrown', { kind: 'transformConstraint', target: transform }],
            ['invalid-data', { kind: 'transformConstraint', target: path }],
            ['nothing thrown', { kind: 'pathConstraintMix', target: path }],
            ['invalid-data', { kind: 'pathConstraintPosition', target: ik }],
            ['invalid-data', { kind: 'pathConstraintSpacing', target: 3 }],
        ];

        for (const [code, timeline] of cases) {
            const engine = createLegacyEngine(withAnimation(model, timeline));
            const label = `${timeline.kind} ${timeline.target}`;

            expect(errorOf(() => engine.setAnimation(0, model.animations.length, true)).code, label).toBe(code);
        }
    });

    it('finds the bones of a constraint by name, as the official skeleton does', async () => {
        // two bones named b: the file can only name the first, a binary file can point at the second
        const twins = {
            bones: [
                { name: 'root', rotation: 5 },
                { name: 'a', parent: 'root', x: 10, y: 4, rotation: 20, length: 10 },
                { name: 'b', parent: 'a', x: 10, rotation: -30, length: 10 },
                { name: 't', parent: 'root', x: 25, y: 15 },
                { name: 'b', parent: 'root', x: -12, y: 9, rotation: 70, length: 6 },
            ],
        };
        const text = rigJson(version, twins);
        const model = await importSkeleton(text);
        const second = withConstraint(model, 'reach', (data) =>
            data.type === 'ik' ? { ...data, bones: Int16Array.of(4) } : data,
        );
        const engine = createLegacyEngine(
            withConstraint(second, 'copy', (data) => ({ ...data, bones: Int16Array.of(4) })),
        );
        const json41 = new core41.SkeletonJson(new core41.AtlasAttachmentLoader(new core41.TextureAtlas('')));
        const json42 = new core42.SkeletonJson(new core42.AtlasAttachmentLoader(new core42.TextureAtlas('')));
        const data = version === '4.1' ? json41.readSkeletonData(text) : json42.readSkeletonData(text);
        const twin = data.bones[4];

        if (twin === undefined) throw new Error('The official core read no fifth bone');
        // the official data points at the second bone too. Its skeleton looks the name up and finds the first.
        for (const constraint of [...data.ikConstraints, ...data.transformConstraints])
            Object.assign(constraint, { bones: [twin] });
        const official = data instanceof core41.SkeletonData ? new core41.Skeleton(data) : new core42.Skeleton(data);

        if (official instanceof core41.Skeleton) official.updateWorldTransform();
        else official.updateWorldTransform(core42.Physics.none);
        engine.update(0);
        expect(world(engine)).toEqual(
            official.bones.flatMap((bone) => [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY]),
        );
    });
});

it('refuses constraint kinds the legacy versions do not have', async () => {
    const model = await importSkeleton(rigJson('4.2'));
    const slider: ConstraintData = {
        type: 'slider',
        name: 'slide',
        skinRequired: false,
        animation: 0,
        additive: false,
        loop: false,
        mix: 1,
        time: 0,
        bone: -1,
        property: null,
        propertyOffset: 0,
        offset: 0,
        scale: 1,
        max: 0,
        local: false,
    };

    expect(errorOf(() => createLegacyEngine({ ...model, constraints: [slider] })).code).toBe('unsupported-feature');
});
