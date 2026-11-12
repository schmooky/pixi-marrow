import { describe, expect, it } from 'vitest';
import {
    type ConstraintData,
    createPoseEngine,
    importSkeleton,
    MarrowError,
    type PoseEngine,
    type SkeletonModel,
    type TimelineData,
    WORLD_STRIDE,
} from '../../src/core';

/** A small skeleton with every kind of constraint. The tests change it to damage it. */
const RIG = `{
"skeleton": { "spine": "4.3.39-beta" },
"bones": [
    { "name": "root" }, { "name": "hip", "parent": "root", "x": 10, "y": 20, "rotation": 30 },
    { "name": "arm1", "parent": "hip", "length": 30, "rotation": 20 }, { "name": "arm2", "parent": "arm1", "length": 25, "x": 30 },
    { "name": "goal", "parent": "root", "x": 62, "y": 44 }, { "name": "leg", "parent": "hip", "length": 40, "rotation": -80 },
    { "name": "src", "parent": "root", "x": -30, "rotation": 45 }, { "name": "c1", "parent": "root", "length": 18, "x": 4, "y": 6 },
    { "name": "gated", "parent": "hip", "length": 14, "skin": true }
],
"slots": [{ "name": "track", "bone": "hip", "attachment": "line" }],
"constraints": [
    { "type": "ik", "name": "reach", "bones": ["arm1", "arm2"], "target": "goal" },
    { "type": "ik", "name": "stand", "bones": ["leg"], "target": "goal" },
    { "type": "transform", "name": "copy", "bones": ["leg"], "source": "src", "properties": { "rotate": { "to": { "rotate": {} } } } },
    { "type": "path", "name": "ride", "bones": ["c1"], "slot": "track", "positionMode": "fixed", "position": 20 },
    { "type": "ik", "name": "gatedIk", "bones": ["gated"], "target": "goal", "skin": true },
    { "type": "physics", "name": "sway", "bone": "arm2", "x": 1 },
    { "type": "slider", "name": "slide", "animation": "wave" }
],
"skins": [
    { "name": "default", "attachments": { "track": {
        "line": { "type": "path", "lengths": [30, 60], "vertexCount": 6, "vertices": [-10, 0, 0, 0, 10, 5, 30, 25, 40, 30, 50, 35] },
        "bent": { "type": "path", "lengths": [30, 60], "vertexCount": 6,
                  "vertices": [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 10, 5, 1, 1, 5, 30, 25, 1, 1, 5, 40, 30, 1, 1, 5, 50, 35, 1] }
    } } },
    { "name": "armed", "bones": ["gated"], "ik": ["gatedIk"] }
],
"animations": {
    "wave": { "bones": { "hip": { "rotate": [{ "value": 0 }, { "time": 1, "value": 40 }] } } },
    "aim": { "ik": { "reach": [{ "mix": 0.5 }, { "time": 1 }] }, "path": { "ride": { "position": [{ "value": 0 }, { "time": 1, "value": 50 }] } } }
}
}`;
const AIM = 1;
const TRACK = 0;

type Damage = (model: SkeletonModel) => unknown;

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

/** A constraint of a model by name. It must be of the type that is asked for. */
function constraint<T extends ConstraintData['type']>(
    model: SkeletonModel,
    name: string,
    type: T,
): Extract<ConstraintData, { type: T }> {
    const matches = (each: ConstraintData): each is Extract<ConstraintData, { type: T }> =>
        each.name === name && each.type === type;
    const found = model.constraints.find(matches);

    if (found === undefined) throw new Error(`The rig has no ${type} constraint ${name}`);

    return found;
}

function timelineOf(model: SkeletonModel, kind: string): TimelineData {
    const timeline = model.animations[AIM]?.timelines.find((each) => each.kind === kind);

    if (timeline === undefined) throw new Error(`The animation has no ${kind} timeline`);

    return timeline;
}

const play = (model: SkeletonModel): Promise<PoseEngine> => createPoseEngine(model);

/** The error of creating an engine after `damage` changed the model, as text. */
async function createError(damage: Damage): Promise<string> {
    const model = await importSkeleton(RIG);

    damage(model);

    return String(await play(model).catch((reason: unknown) => reason));
}

/** The error of the first update after `damage` changed the model and `pose` the engine. */
async function updateError(damage: Damage, pose?: (engine: PoseEngine) => unknown): Promise<MarrowError> {
    const model = await importSkeleton(RIG);

    damage(model);
    const engine = await play(model);

    pose?.(engine);

    return errorOf(() => engine.update(0.1));
}

describe('constraint data the official 4.3 core fails on', () => {
    it('names the constraint that points at a bone, a slot or an animation the skeleton does not have', async () => {
        const errors = await Promise.all([
            createError((model) => Object.assign(constraint(model, 'reach', 'ik'), { target: 99 })),
            createError((model) => constraint(model, 'stand', 'ik').bones.fill(-1)),
            createError((model) => Object.assign(constraint(model, 'copy', 'transform'), { source: 9 })),
            createError((model) => constraint(model, 'copy', 'transform').bones.fill(40)),
            createError((model) => Object.assign(constraint(model, 'ride', 'path'), { slot: 2 })),
            createError((model) => constraint(model, 'ride', 'path').bones.fill(-3)),
            createError((model) => Object.assign(constraint(model, 'sway', 'physics'), { bone: 300 })),
            createError((model) => Object.assign(constraint(model, 'slide', 'slider'), { animation: 9 })),
            createError((model) => Object.assign(constraint(model, 'slide', 'slider'), { bone: 20 })),
        ]);

        expect(errors).toEqual([
            expect.stringContaining(
                'invalid-data] The IK constraint "reach" points at target bone 99, but the skeleton has 9 bones.',
            ),
            expect.stringContaining('The IK constraint "stand" points at bone -1, but the skeleton has 9 bones.'),
            expect.stringContaining(
                'The transform constraint "copy" points at source bone 9, but the skeleton has 9 bones.',
            ),
            expect.stringContaining('The transform constraint "copy" points at bone 40, but the skeleton has 9 bones.'),
            expect.stringContaining('The path constraint "ride" points at slot 2, but the skeleton has 1 slot.'),
            expect.stringContaining('The path constraint "ride" points at bone -3, but the skeleton has 9 bones.'),
            expect.stringContaining('The physics constraint "sway" points at bone 300, but the skeleton has 9 bones.'),
            expect.stringContaining(
                'The slider constraint "slide" plays animation 9, which the skeleton does not have.',
            ),
            expect.stringContaining('The slider constraint "slide" points at bone 20, but the skeleton has 9 bones.'),
        ]);
    });

    it('names the animation whose timeline is for a constraint of another kind, or for none', async () => {
        const errors = await Promise.all([
            // constraint 3 is the path constraint
            createError((model) => Object.assign(timelineOf(model, 'ikConstraint'), { target: 3 })),
            createError((model) => Object.assign(timelineOf(model, 'pathConstraintPosition'), { target: 44 })),
        ]);

        expect(errors).toEqual([
            expect.stringContaining(
                'Animation "aim" has a ikConstraint timeline for constraint 3, which is no ik constraint.',
            ),
            expect.stringContaining(
                'Animation "aim" has a pathConstraintPosition timeline for constraint 44, which is no path constraint.',
            ),
        ]);
    });

    it('names the path constraint whose path has weights for a bone the skeleton does not have', async () => {
        const error = await createError((model) => {
            const bent = model.skins[0]?.attachments.find(({ name }) => name === 'bent')?.attachment;

            // the first vertex follows bone 55
            if (bent?.type === 'path') bent.bones?.fill(55, 1, 2);
        });

        expect(error).toContain('The path constraint "ride" has the path "bent" with weights for bone 55.');
    });

    it('names the IK constraint that moves a bone without a parent, when an update solves it', async () => {
        const single = await updateError((model) => constraint(model, 'stand', 'ik').bones.fill(0));
        const pair = await updateError((model) => constraint(model, 'reach', 'ik').bones.set([0, 1]));

        expect(single).toMatchObject({
            code: 'invalid-data',
            fix: expect.stringContaining('Export the skeleton again'),
        });
        expect(single.message).toContain('The IK constraint "stand" moves the bone "root", which has no parent.');
        // the first of two bones is placed in the space of its parent too
        expect(pair.message).toContain('The IK constraint "reach" moves the bone "root", which has no parent.');
    });

    it('names the path constraint that follows a path without a curve', async () => {
        const error = await updateError(
            () => {},
            ({ state }) => {
                const line = state.attachments[TRACK];

                // ten vertices are not whole curves
                if (line?.type === 'path') state.attachments[TRACK] = Object.assign(line, { worldVerticesLength: 20 });
            },
        );

        expect(error.message).toContain(
            'The path constraint "ride" follows the path "line", whose 10 vertices make no curve.',
        );
    });

    it('fails only when the official core would: a constraint without bones that is not active is fine', async () => {
        const model = await importSkeleton(RIG);

        Object.assign(constraint(model, 'gatedIk', 'ik'), { bones: new Int16Array(0) });
        const engine = await play(model);

        engine.update(0.1);
        // the skin turns the constraint on: the official updateCache fails with a TypeError here
        expect(errorOf(() => engine.setSkin(1)).message).toContain('The IK constraint "gatedIk" has no bones.');
    });

    it('leaves a path constraint alone whose slot shows no path, as the official core does', async () => {
        const model = await importSkeleton(RIG);
        const engine = await play(model);
        const c1 = model.bones.names.indexOf('c1') * WORLD_STRIDE;

        engine.update(0);
        const placed = engine.state.world[c1 + 4];

        engine.state.attachments[TRACK] = null;
        engine.update(0);
        // c1 is back where its local pose puts it
        expect(placed).not.toBeCloseTo(4, 3);
        expect(engine.state.world[c1 + 4]).toBeCloseTo(4, 5);
    });
});
