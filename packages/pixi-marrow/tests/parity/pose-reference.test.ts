import { AnimationState, AnimationStateData, Physics, Skeleton } from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import { importSkeleton, type PhysicsMode, type SpineVersion, WORLD_STRIDE } from '../../src/core';
import { differences } from './compare';
import { officialModel } from './model-official';
import type { RigFiles } from './official';
import { loadPoseRig } from './pose-official';
import { readData43 } from './pose-official43';
import { officialSubject, runScript, type Subject } from './pose-run';
import { DT, type PoseScript, script } from './pose-script';
import { SCRIPT_FAMILIES } from './pose-scripts';
import type { OfficialPoseRig } from './pose-shared';
import {
    indexOf,
    numbers,
    oneUnitOff,
    parts,
    physicsAndSliders,
    withEvents,
    withoutConstraint,
    withoutConstraints,
    withoutSliders,
    withPose,
} from './pose-suite-kit';
import { listPoseRigs, type PoseRigSource } from './pose-synthetic';

/*
 * What the reference of the pose parity suite holds. The reference is the played official
 * skeleton with every constraint on. These tests prove that the constraints are in it: the pose
 * differs from that of the rig without its constraints, from a run without physics and from the
 * rig without its sliders. They also prove that a number a constraint wrote is compared to the
 * last bit, on either side.
 */

const sources = listPoseRigs();
/** One skeleton per rig and version: the JSON one. */
const rigs = sources.filter(
    (source, i) => sources.findIndex((other) => other.version === source.version && other.rig === source.rig) === i,
);
const made = sources.filter((source) => source.rig.startsWith('made-'));

function sourceOf(id: string): PoseRigSource {
    const source = sources.find((candidate) => candidate.id === id);

    if (source === undefined) throw new Error(`There is no rig ${id}`);

    return source;
}

/** The scripts that loop every animation of a rig. */
const loopsOf = (rig: OfficialPoseRig, source: PoseRigSource): PoseScript[] =>
    SCRIPT_FAMILIES.flatMap((family) => (family.name === 'loops' ? family.scripts(rig.info, source.id) : []));

/** An official side in a physics mode. */
function inMode(rig: OfficialPoseRig, mode: PhysicsMode): Subject {
    const subject = officialSubject(rig.createDriver());

    subject.driver.physics = mode;

    return subject;
}

const failed = (failure: string | null): failure is string => failure !== null;

describe('the reference', () => {
    const versions: SpineVersion[] = ['4.1', '4.2', '4.3'];
    const loop = script('loop the first animation', (s) => {
        s.set(0, 0, true);
        s.update(DT, 6);
    });

    it.each(versions)('has the IK, transform and path constraints of %s in it, and they move bones only', (version) => {
        for (const name of ['made-ik', 'made-transform', 'made-path']) {
            const files = sourceOf(`${version}/${name}.json`).read();
            const full = loadPoseRig(version, files);
            const bare = loadPoseRig(version, withoutConstraints(files));
            const failure = runScript(loop, officialSubject(bare.createDriver()), officialSubject(full.createDriver()));

            expect(parts(failure), name).toEqual(['world']);
        }
    });

    it('has physics in it: a rig with physics constraints poses differently in the mode none', {
        timeout: 30_000,
    }, () => {
        const checked: string[] = [];

        for (const source of rigs) {
            const rig = loadPoseRig(source.version, source.read());

            if (rig.info.physics === 0) continue;
            const failures = loopsOf(rig, source)
                .map((each) => runScript(each, inMode(rig, 'none'), officialSubject(rig.createDriver())))
                .filter(failed);

            checked.push(source.id);
            expect(failures.length, source.id).toBeGreaterThan(0);
            // physics moves bones and nothing else
            for (const failure of failures) expect(parts(failure), source.id).toEqual(['world']);
        }
        expect(checked).toEqual(
            expect.arrayContaining(['4.2/made-physics.json', '4.3/made-physics.json', '4.3/made-physics-order.json']),
        );
    });

    it('has sliders in it: a rig with sliders poses differently without them', { timeout: 30_000 }, () => {
        const checked: string[] = [];

        for (const source of rigs.filter(({ version }) => version === '4.3')) {
            const files = source.read();
            const rig = loadPoseRig(source.version, files);

            if (rig.info.sliders === 0) continue;
            const bare = loadPoseRig(source.version, withoutSliders(files));
            const failures = loopsOf(rig, source)
                .map((each) =>
                    runScript(each, officialSubject(bare.createDriver()), officialSubject(rig.createDriver())),
                )
                .filter(failed);

            checked.push(source.id);
            expect(bare.info.sliders).toBe(0);
            expect(failures.length, source.id).toBeGreaterThan(0);
            // a slider writes the applied pose: the animated pose of the bones is the same without it
            for (const failure of failures) {
                expect(parts(failure), source.id).not.toEqual(expect.arrayContaining(['local']));
                expect(parts(failure), source.id).not.toEqual(expect.arrayContaining(['inherit']));
            }
        }
        expect(checked).toEqual(expect.arrayContaining(['4.3/made-slider.json', '4.3/made-slider-slots.json']));
    });

    /** `idle` of the physics rig has no property to move: it is there to do nothing. */
    const INERT = ['idle'];
    const lively = made.filter(({ rig }) =>
        ['made-order', 'made-physics', 'made-physics-order', 'made-slider', 'made-slider-slots'].includes(rig),
    );

    // a rig made here must do something that shows in numbers, or it proves nothing
    it.each(lively)('has every physics constraint and slider of $id in it', { timeout: 30_000 }, (source) => {
        const files = source.read();
        const rig = loadPoseRig(source.version, files);
        const skins = Array.from({ length: rig.info.skins + 1 }, (_, i) => i - 1);
        // every animation looped with every skin and with none
        const plays = skins.flatMap((skin) =>
            rig.info.animations.map(({ name }, animation) =>
                script(`${name} with skin ${skin}`, (s) => {
                    s.skin(skin);
                    s.set(0, animation, true);
                    s.update(DT, 30);
                }),
            ),
        );

        for (const { kind, name } of physicsAndSliders(files)) {
            const bare = loadPoseRig(source.version, withoutConstraint(files, kind, name));
            const differs = plays.some(
                (each) =>
                    runScript(each, officialSubject(bare.createDriver()), officialSubject(rig.createDriver())) !== null,
            );

            expect(differs, `${kind} ${name}`).toBe(!INERT.includes(name));
        }
    });
});

/** Where a number of a pose is, by the names of the rig: `n` counts inside the bone or the slot. */
interface Where {
    part: 'world' | 'colors' | 'darkColors' | 'deform';
    of: string;
    n: number;
}

/** A number of a pose: an index into a field, or into the row of a slot for the deform. */
interface Place {
    field: string;
    row?: number;
    index: number;
}

function placeOf(files: RigFiles, { part, of, n }: Where): Place {
    if (part === 'world') return { field: part, index: indexOf(files, 'bones', of) * WORLD_STRIDE + n };
    const slot = indexOf(files, 'slots', of);

    if (part === 'deform') return { field: part, row: slot, index: n };

    return { field: part, index: slot * (part === 'colors' ? 4 : 3) + n };
}

const pathOf = ({ field, row, index }: Place): string =>
    row === undefined ? `${field}[${index}]` : `${field}[${row}][${index}]`;

function valuesAt(pose: Record<string, unknown>, { field, row }: Place): Float64Array {
    const held = pose[field];

    return numbers(row === undefined || !Array.isArray(held) ? held : held[row]);
}

/** The part of a pose around a place, with the number there replaced. */
function replaced(pose: Record<string, unknown>, place: Place, value: number): object {
    const values = valuesAt(pose, place).slice();
    const held = pose[place.field];

    values[place.index] = value;
    if (place.row === undefined || !Array.isArray(held)) return { [place.field]: values };

    return { [place.field]: held.map((each, row) => (row === place.row ? values : each)) };
}

describe('a number that is off by one unit in the last place', () => {
    const versions: SpineVersion[] = ['4.1', '4.2', '4.3'];
    const sides = ['actual', 'expected'] as const;
    /** `by` names what wrote the number: physics, a slider, or neither. */
    const cases: { id: string; animation: string; where: Where; by?: 'physics' | 'sliders' }[] = [
        { id: '4.2/made-for-pose.json', animation: 'kinds', where: { part: 'colors', of: 's0', n: 1 } },
        { id: '4.2/made-for-pose.json', animation: 'kinds', where: { part: 'darkColors', of: 's1', n: 0 } },
        { id: '4.3/made-for-pose.json', animation: 'kinds', where: { part: 'deform', of: 's3', n: 0 } },
        { id: '4.2/made-physics.json', animation: 'shake', where: { part: 'world', of: 'all', n: 0 }, by: 'physics' },
        { id: '4.3/made-physics.json', animation: 'jolt', where: { part: 'world', of: 'volume', n: 3 }, by: 'physics' },
        // a bone a transform constraint placed from a physics bone
        {
            id: '4.2/made-physics-order.json',
            animation: 'swing',
            where: { part: 'world', of: 'probe', n: 4 },
            by: 'physics',
        },
        {
            id: '4.3/made-physics-order.json',
            animation: 'whip',
            where: { part: 'world', of: 'rope5', n: 1 },
            by: 'physics',
        },
        { id: '4.3/made-slider.json', animation: 'main', where: { part: 'world', of: 't1', n: 0 }, by: 'sliders' },
        // a bone IK placed with a mix that a slider keyed
        { id: '4.3/made-slider.json', animation: 'main', where: { part: 'world', of: 'leg2', n: 2 }, by: 'sliders' },
        {
            id: '4.3/made-slider-slots.json',
            animation: 'main',
            where: { part: 'colors', of: 's0', n: 0 },
            by: 'sliders',
        },
        {
            id: '4.3/made-slider-slots.json',
            animation: 'other',
            where: { part: 'darkColors', of: 's1', n: 2 },
            by: 'sliders',
        },
        // the animated pose of a slot, which a slider wrote
        {
            id: '4.3/made-slider-slots.json',
            animation: 'other',
            where: { part: 'deform', of: 's4', n: 0 },
            by: 'sliders',
        },
    ];
    const table = cases.flatMap((each) => sides.map((side) => ({ ...each, side, what: pathName(each.where) })));

    function pathName({ part, of }: Where): string {
        return `${part} of ${of}`;
    }

    it.each(table)('is reported on the $side side: $what of $id', ({ id, animation, where, by, side }) => {
        const source = sourceOf(id);
        const files = source.read();
        const rig = loadPoseRig(source.version, files);
        const place = placeOf(files, where);
        const at = 20;
        const play = script(`loop ${animation}`, (s) => {
            s.set(
                0,
                rig.info.animations.findIndex(({ name }) => name === animation),
                true,
            );
            s.update(DT, at);
        });
        /** The number at the place after the last update. */
        const seen = (target: OfficialPoseRig, mode: PhysicsMode = 'update'): number => {
            let value = Number.NaN;
            const spy = withPose(inMode(target, mode), at, (pose) => {
                value = valuesAt(pose, place)[place.index] ?? Number.NaN;

                return {};
            });

            expect(runScript(play, spy, inMode(target, mode))).toBeNull();

            return value;
        };
        const right = seen(rig);
        const wrong = oneUnitOff(right);
        const off = (subject: Subject): Subject => withPose(subject, at, (pose) => replaced(pose, place, wrong));
        const [actual, expected] = [officialSubject(rig.createDriver()), officialSubject(rig.createDriver())];
        const failure =
            side === 'actual' ? runScript(play, off(actual), expected) : runScript(play, actual, off(expected));
        const line = side === 'actual' ? `${wrong}, expected ${right}` : `${right}, expected ${wrong}`;

        // the constraint wrote the number: without it the number is another one
        if (by === 'physics') expect(seen(rig, 'none')).not.toBe(right);
        if (by === 'sliders') expect(seen(loadPoseRig(source.version, withoutSliders(files)))).not.toBe(right);
        expect(right).not.toBe(0);
        expect(Math.abs(wrong - right)).toBeLessThanOrEqual(Math.abs(right) * Number.EPSILON);
        expect(failure).toContain(`update ${at} of ${at}`);
        expect(failure?.split('\n').slice(1)).toEqual([`    ${pathOf(place)}: ${line}`]);
    });

    it.each(versions)('is reported for a bone that IK turned in %s', async (version) => {
        const files = sourceOf(`${version}/made-ik.json`).read();
        const constraint = (await importSkeleton(files.skeleton)).constraints.find(({ type }) => type === 'ik');

        if (constraint?.type !== 'ik') throw new Error('The rig has no IK constraint');
        const at = (constraint.bones[0] ?? 0) * WORLD_STRIDE;
        const loop = script('loop the first animation', (s) => {
            s.set(0, 0, true);
            s.update(DT, 6);
        });
        /** The number after the third update. */
        const seen = (target: OfficialPoseRig): number => {
            let value = Number.NaN;
            const spy = withPose(officialSubject(target.createDriver()), 3, (pose) => {
                value = numbers(pose.world)[at] ?? Number.NaN;

                return {};
            });

            expect(runScript(loop, spy, officialSubject(target.createDriver()))).toBeNull();

            return value;
        };
        const rig = loadPoseRig(version, files);
        const right = seen(rig);
        const wrong = withPose(officialSubject(rig.createDriver()), 3, (pose) => {
            const world = numbers(pose.world).slice();

            world[at] = oneUnitOff(right);

            return { world };
        });
        const failure = runScript(loop, wrong, officialSubject(rig.createDriver()));

        // the constraint turned the bone: without it the number is another one
        expect(seen(loadPoseRig(version, withoutConstraints(files)))).not.toBe(right);
        expect(Math.abs(oneUnitOff(right) - right)).toBeLessThanOrEqual(Math.abs(right) * Number.EPSILON);
        expect(failure).toContain('step 2 of 2, update 3 of 6');
        expect(failure?.split('\n').slice(1)).toEqual([`    world[${at}]: ${oneUnitOff(right)}, expected ${right}`]);
    });

    it.each(sides)('is reported for a value of an event on the %s side', (side) => {
        const rig = loadPoseRig('4.2', sourceOf('4.2/made-for-pose.json').read());
        // the first animation fires an event with the float 2.5 at its start
        const play = script('events', (s) => {
            s.set(0, 0, true);
            s.update(DT, 3);
        });
        const off = (subject: Subject): Subject =>
            withEvents(subject, (events) =>
                events.map((event) =>
                    event.key ? { ...event, key: { ...event.key, float: oneUnitOff(event.key.float) } } : event,
                ),
            );
        const [actual, expected] = [officialSubject(rig.createDriver()), officialSubject(rig.createDriver())];
        const failure =
            side === 'actual' ? runScript(play, off(actual), expected) : runScript(play, actual, off(expected));
        const line = side === 'actual' ? '2.5000000000000004, expected 2.5' : '2.5, expected 2.5000000000000004';

        expect(failure).toContain('update 1 of 3');
        expect(failure?.split('\n').slice(1)).toEqual([`    events[1].key.float: ${line}`]);
    });
});

describe('the rigs made here', () => {
    // an importer that reads a rig wrong would show as a pose that differs
    it.each(made)('$id is imported like the official reader reads it', async (source) => {
        const files = source.read();

        expect(differences(await importSkeleton(files.skeleton), officialModel(source.version, files))).toEqual([]);
    });
});

/*
 * The one place where a slider writes the animated pose. `Slider.sort` gives the slot of every
 * slot timeline of its animation a pose of its own. It leaves out the slots a deform or sequence
 * timeline writes besides its own: those that show a mesh which follows the timelines of the mesh
 * in the slot of the timeline. The reference has this in it, and a pose engine must do the same.
 */
describe('a 4.3 slider and the extra slots of a timeline', () => {
    /** The deform of three slots after four updates of an animation that keys no deform. */
    function deforms(files: RigFiles) {
        const data = readData43(files);
        const skeleton = new Skeleton(data);
        const state = new AnimationState(new AnimationStateData(data));
        const other = data.findAnimation('other');

        if (other === null) throw new Error('The rig has no such animation');
        state.setAnimation(0, other, true);
        for (let i = 0; i < 4; i++) {
            state.update(DT);
            skeleton.update(DT);
            state.apply(skeleton);
            skeleton.updateWorldTransform(Physics.update);
        }

        return ['s3', 's4', 's5'].map((name) => {
            const slot = skeleton.findSlot(name);

            if (slot === null) throw new Error(`The rig has no slot ${name}`);

            return {
                ownPose: slot.pose !== slot.appliedPose,
                animated: Array.from(slot.pose.deform),
                applied: Array.from(slot.appliedPose.deform),
            };
        });
    }

    it('writes the animated pose of a slot that has no slot timeline in the animation of the slider', () => {
        const files = sourceOf('4.3/made-slider-slots.json').read();
        const [source, follower, colored] = deforms(files);
        const [, plain] = deforms(withoutSliders(files));

        // without sliders nothing writes a deform
        expect(plain?.animated).toEqual([]);
        // the slot of the timeline and a follower with a color timeline have a pose of their own
        expect(source).toMatchObject({ ownPose: true, animated: [] });
        expect(colored).toMatchObject({ ownPose: true, animated: [] });
        expect(colored?.applied).toHaveLength(8);
        expect(colored?.applied).toEqual(source?.applied);
        // the other follower has none: the slider wrote its animated pose
        expect(follower?.ownPose).toBe(false);
        expect(follower?.animated).toHaveLength(8);
        // what the slider wrote stayed for the next update, so the numbers are not those of a fresh pose
        expect(follower?.animated).not.toEqual(colored?.applied);
    });
});
