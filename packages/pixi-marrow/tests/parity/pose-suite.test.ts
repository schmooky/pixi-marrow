import { Physics, SequenceTimeline, Skeleton, Slider } from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import { importSkeleton, type SpineVersion, type TrackEntry, WORLD_STRIDE } from '../../src/core';
import { differences } from './compare';
import { officialModel } from './model-official';
import type { RigFiles } from './official';
import { loadPoseRig } from './pose-official';
import { readData43, shieldTimelineSlots } from './pose-official43';
import { NO_SCRIPT_ENTRY, officialSubject, runScript, type Subject } from './pose-run';
import { DT, type PoseScript, script } from './pose-script';
import { SCRIPT_FAMILIES } from './pose-scripts';
import { createAudit, type PoseDriver } from './pose-shared';
import { next, numbers, oneUnitOff, parts, withEvents, withoutConstraints, withPose } from './pose-suite-kit';
import { listPoseRigs, type PoseRigSource } from './pose-synthetic';

/*
 * The pose parity suite checks itself here, without our engine. Every script runs on two official
 * drivers and must give the same poses, a wrong value on one side must be reported, the world
 * reference must hold what it says, and the constraints of the official skeleton must leave alone
 * what the suite compares.
 */

const sources = listPoseRigs();
/** One skeleton per rig and version. The JSON and the binary export of a rig pose alike. */
const rigs = sources.filter(
    (source, i) => sources.findIndex((other) => other.version === source.version && other.rig === source.rig) === i,
);
const seedOf = (source: PoseRigSource): string => `${source.version}/${source.rig}`;

/*
 * The world reference comes from a second skeleton that is given what the constraints read. Here
 * it runs against the played skeleton itself. For a rig without physics and sliders that is the
 * plain official skeleton with every constraint on. For a rig with them it is a skeleton played
 * with its physics and sliders switched off. A value the second skeleton is not given shows as a
 * difference.
 */
describe.each(rigs)('$version/$rig', (source) => {
    it('gives the same poses both ways, and its constraints leave the animated pose alone', { timeout: 30_000 }, () => {
        const rig = loadPoseRig(source.version, source.read());
        const world = rig.info.ignored > 0 ? 'direct' : 'full';
        const scripts = SCRIPT_FAMILIES.flatMap((family) => family.scripts(rig.info, seedOf(source)));
        const updates = scripts
            .flatMap((each) => each.ops)
            .reduce((sum, op) => sum + (op.op === 'update' ? op.times : 0), 0);

        for (const each of scripts) {
            const audited = rig.createDriver({ audit: true });
            const failure = runScript(each, officialSubject(audited), officialSubject(rig.createDriver({ world })));

            if (failure !== null) expect.fail(`${source.id}, ${failure}`);
            expect(audited.leaks, `${source.id}, script "${each.name}"`).toEqual([]);
        }
        // every family ran
        expect(updates).toBeGreaterThan(SCRIPT_FAMILIES.length * 10);
    });
});

describe('the comparison', () => {
    const source = sources[0];

    if (source === undefined) throw new Error('There are no fixtures');
    const rig = loadPoseRig(source.version, source.read());
    const sides = () => ({
        actual: officialSubject(rig.createDriver()),
        expected: officialSubject(rig.createDriver()),
    });
    const loop = script('loop the first animation', (s) => {
        s.set(0, 0, true);
        s.update(DT, 6);
    });

    it('passes when both sides are equal', () => {
        const { actual, expected } = sides();

        expect(runScript(loop, actual, expected)).toBeNull();
    });

    it('reports the smallest difference of one number, with the script, the step and the path', () => {
        const { actual, expected } = sides();
        const wrong = withPose(actual, 3, (pose) => {
            const local = numbers(pose.local).slice();

            local[9] = next(local[9] ?? 0);

            return { local };
        });
        const failure = runScript(loop, wrong, expected);

        expect(failure).toContain('script "loop the first animation", step 2 of 2, update 3 of 6');
        expect(failure).toMatch(/\n {4}local\[9\]: \S+, expected \S+$/);
    });

    it('reports a wrong world transform, color, deform length and draw order', () => {
        for (const field of ['world', 'colors']) {
            const { actual, expected } = sides();
            const wrong = withPose(actual, 1, (pose) => ({ [field]: numbers(pose[field]).map((value) => value + 1) }));

            expect(runScript(loop, wrong, expected)).toContain(`\n    ${field}[0]: `);
        }
        const { actual, expected } = sides();
        const longer = withPose(actual, 2, () => ({ deform: [new Float64Array(2)] }));
        const swapped = withPose(sides().actual, 2, () => ({ drawOrder: new Int16Array(rig.info.slots).fill(1) }));

        expect(runScript(loop, longer, expected)).toContain('deform: length 1, expected');
        expect(runScript(loop, swapped, sides().expected)).toContain('\n    drawOrder[0]: 1, expected 0');
    });

    it('reports a skeleton that is moved and scaled on one side only', () => {
        const placed = script('placed', (s) => {
            s.place(3, -2, -1.5, 0.75);
            s.set(0, 0, true);
            s.update(DT, 2);
        });
        const { actual, expected } = sides();

        expect(runScript(placed, actual, expected)).toBeNull();
        expect(parts(runScript(placed, { ...sides().actual, place() {} }, sides().expected))).toEqual(['world']);
    });

    it('reports another attachment in a slot', () => {
        const { actual, expected } = sides();
        const wrong = withPose(actual, 4, (pose) => ({
            attachments: Array.isArray(pose.attachments) ? pose.attachments.map(() => 'another object') : [],
        }));

        expect(runScript(loop, wrong, expected)).toMatch(
            /update 4 of 6.*\n {4}attachments\[0\]: "another object", expected /,
        );
    });

    it('reports a missing event and an event out of order', () => {
        const first = sides();
        const second = sides();
        const none = withEvents(first.actual, () => []);
        // the runner takes the events after every call. Clearing two tracks reports four in one go.
        const reversed = withEvents(second.actual, (events) => events.reverse());
        const twoTracks = script('two tracks', (s) => {
            s.set(0, 0, false);
            s.set(1, 0, false);
            s.update(DT);
            s.clearTracks();
            s.update(DT);
        });

        // the first update reports at least the start of the entry
        expect(runScript(loop, none, first.expected)).toMatch(/update 1 of 6.*\n {4}events: length 0, expected [1-9]$/);
        expect(runScript(twoTracks, reversed, second.expected)).toMatch(/\n {4}events\[\d\]\.track: 1, expected 0/);
    });

    it('reports an event that names another entry, and one that names an entry no call made', () => {
        const plain = sides();
        const first = sides();
        const second = sides();
        const replace = script('replace', (s) => {
            s.set(0, 0, true);
            s.update(DT, 2);
            // reports the interrupt of the first entry, then the start of the second
            s.set(0, 0, false);
            s.update(DT, 2);
        });
        // the interrupt names the entry that starts
        const swapped = withEvents(first.actual, (events) => {
            const started = events.find((event) => event.type === 'start');

            return events.map((event) =>
                event.type === 'interrupt' && started ? { ...event, entry: started.entry } : event,
            );
        });
        // the interrupt names a copy of its entry: an object no call returned
        const copied = withEvents(second.actual, (events) =>
            events.map((event) => (event.type === 'interrupt' ? { ...event, entry: { ...event.entry } } : event)),
        );

        expect(runScript(replace, plain.actual, plain.expected)).toBeNull();
        expect(runScript(replace, swapped, first.expected)).toMatch(
            /step 4 of 4, update 1 of 2.*\n {4}events\[0\]\.entry: 1, expected 0$/,
        );
        expect(runScript(replace, copied, second.expected)).toMatch(
            new RegExp(`update 1 of 2.*\\n {4}events\\[0\\]\\.entry: "${NO_SCRIPT_ENTRY}", expected 0$`),
        );
    });

    it('gives an entry object a new number when an engine hands it out again', () => {
        const { actual, expected } = sides();
        // every entry of this side is the same object, as from an engine with a pool of one
        let pooled: TrackEntry | undefined;
        const reuse = (made: TrackEntry): TrackEntry => {
            pooled = pooled === undefined ? { ...made } : Object.assign(pooled, { ...made });

            return pooled;
        };
        const driver: PoseDriver = new Proxy(actual.driver, {
            get(target, key) {
                if (key === 'setAnimation') {
                    return (track: number, animation: number, isLoop: boolean) =>
                        reuse(target.setAnimation(track, animation, isLoop));
                }
                if (key === 'takeEvents') {
                    return () => target.takeEvents().map((event) => ({ ...event, entry: pooled ?? event.entry }));
                }

                return Reflect.get(target, key);
            },
        });
        // one entry at a time: each is disposed before the next call makes one
        const turns = script('one entry after another', (s) => {
            s.set(0, 0, false);
            s.update(DT);
            s.clearTracks();
            s.set(0, 0, false);
            s.update(DT);
            s.clearTracks();
            s.set(0, 0, true);
            s.update(DT, 2);
        });

        expect(runScript(turns, { ...actual, driver }, expected)).toBeNull();
    });

    it('reports a wrong field of a new track entry at the call that made it', () => {
        const { actual, expected } = sides();
        const queue = script('queue', (s) => {
            s.set(0, 0, true);
            s.add(0, 0, false, 0.5);
        });
        const late: PoseDriver = new Proxy(actual.driver, {
            get: (target, key) =>
                key === 'addAnimation'
                    ? (track: number, animation: number, isLoop: boolean, delay: number) =>
                          target.addAnimation(track, animation, isLoop, delay + 0.25)
                    : Reflect.get(target, key),
        });
        const failure = runScript(queue, { ...actual, driver: late }, expected);

        expect(failure).toContain('step 2 of 2, add track 0 animation 0 loop false delay 0.5');
        expect(failure).toContain('entry.delay: 0.75, expected 0.5');
    });
});

describe('the world reference', () => {
    const loop = script('loop the first animation', (s) => {
        s.set(0, 0, true);
        s.update(DT, 6);
    });
    const made = (version: SpineVersion, name: string): PoseRigSource => {
        const source = sources.find((candidate) => candidate.version === version && candidate.rig === name);

        if (source === undefined) throw new Error(`There is no rig ${name}`);

        return source;
    };
    /** The world transforms a rig has after the third update of `loop`. */
    const worldOf = (files: RigFiles, version: SpineVersion): Float64Array => {
        const rig = loadPoseRig(version, files);
        let world = new Float64Array(0);
        const seen = withPose(officialSubject(rig.createDriver()), 3, (pose) => {
            world = numbers(pose.world).slice();

            return {};
        });

        expect(runScript(loop, seen, officialSubject(rig.createDriver()))).toBeNull();

        return world;
    };
    const versions: SpineVersion[] = ['4.1', '4.2', '4.3'];

    it.each(versions)('has the constraints of %s in it, and nothing else of the pose does', (version) => {
        for (const name of ['made-ik', 'made-transform', 'made-path', 'made-order']) {
            const files = made(version, name).read();
            const full = loadPoseRig(version, files);
            const bare = loadPoseRig(version, withoutConstraints(files));
            const failure = runScript(loop, officialSubject(bare.createDriver()), officialSubject(full.createDriver()));

            expect(parts(failure), name).toEqual(['world']);
        }
    });

    it.each(versions)('reports a constrained bone of %s that is off by one unit in the last place', async (version) => {
        const files = made(version, 'made-ik').read();
        const constraint = (await importSkeleton(files.skeleton)).constraints.find(({ type }) => type === 'ik');

        if (constraint?.type !== 'ik') throw new Error('The rig has no IK constraint');
        const at = (constraint.bones[0] ?? 0) * WORLD_STRIDE;
        const right = worldOf(files, version)[at] ?? 0;
        const rig = loadPoseRig(version, files);
        const wrong = withPose(officialSubject(rig.createDriver()), 3, (pose) => {
            const world = numbers(pose.world).slice();

            world[at] = oneUnitOff(right);

            return { world };
        });
        const failure = runScript(loop, wrong, officialSubject(rig.createDriver()));

        // the constraint turned the bone: without it the number is another one
        expect(worldOf(withoutConstraints(files), version)[at]).not.toBe(right);
        expect(Math.abs(oneUnitOff(right) - right)).toBeLessThanOrEqual(Math.abs(right) * Number.EPSILON);
        expect(failure).toContain('step 2 of 2, update 3 of 6');
        expect(failure?.split('\n').slice(1)).toEqual([`    world[${at}]: ${oneUnitOff(right)}, expected ${right}`]);
    });

    /*
     * A pose engine does not solve physics and sliders yet, so the reference has them switched off.
     * These rigs have such constraints above or among bones that IK, transform and path constraints
     * move. With every constraint on, the official skeleton poses them differently.
     */
    const ignoring = [
        '4.2/celestial-circus-pro.json',
        '4.3/diamond-pro.json',
        '4.2/made-order.json',
        '4.3/made-order.json',
    ];

    it.each(ignoring)('leaves out the physics and sliders of %s, which move its bones', (id) => {
        const source = sources.find((candidate) => candidate.id === id);

        // the rig is not in the manifest any more
        if (source === undefined) return;
        const rig = loadPoseRig(source.version, source.read());
        const failures = SCRIPT_FAMILIES.flatMap((family) =>
            family.name === 'loops' ? family.scripts(rig.info, id) : [],
        )
            .map((each) =>
                runScript(
                    each,
                    officialSubject(rig.createDriver()),
                    officialSubject(rig.createDriver({ world: 'full' })),
                ),
            )
            .filter((failure) => failure !== null);

        expect(rig.info.ignored).toBeGreaterThan(0);
        expect(failures.length).toBeGreaterThan(0);
        for (const failure of failures) expect(parts(failure)).toEqual(['world']);
    });
});

describe('the rigs made here', () => {
    const made = sources.filter((source) => source.rig.startsWith('made-'));

    // an importer that reads a rig wrong would show as a pose that differs
    it.each(made)('$id is imported like the official reader reads it', async (source) => {
        const files = source.read();

        expect(differences(await importSkeleton(files.skeleton), officialModel(source.version, files))).toEqual([]);
    });

    // a number that is not finite equals any other that is not: it would compare nothing
    it.each(made)('$id poses with finite numbers', (source) => {
        const rig = loadPoseRig(source.version, source.read());
        let reads = 0;
        const finite = (subject: Subject): Subject => ({
            ...subject,
            read() {
                const pose = subject.read();

                reads++;
                expect(numbers(pose.world).every(Number.isFinite)).toBe(true);

                return pose;
            },
        });

        for (const family of SCRIPT_FAMILIES.filter(({ name }) => ['loops', 'mixes', 'skins'].includes(name))) {
            for (const each of family.scripts(rig.info, seedOf(source))) {
                runScript(each, finite(officialSubject(rig.createDriver())), officialSubject(rig.createDriver()));
            }
        }
        expect(reads).toBeGreaterThan(100);
    });
});

describe('the audit of the official constraints', () => {
    it('reports a constraint that writes the animated pose', () => {
        let rotation = 10;
        const audit = createAudit(1, 0, (out) => {
            out.local[2] = rotation;
        });

        audit.before();
        audit.after();
        expect(audit.leaks).toEqual([]);
        audit.before();
        rotation = 11;
        audit.after();
        expect(audit.leaks).toEqual(['update 2: local[2]: 11, expected 10']);
    });
});

/*
 * The one place where an official constraint writes the animated pose: a 4.3 slider whose
 * animation has a deform or sequence timeline for an attachment with `timelineSlots`. No official
 * example has such an attachment, so this test adds one to the diamond rig.
 */
describe('a 4.3 slider and the extra slots of a timeline', () => {
    /** The sequence index a slider leaves in the animated pose of an extra slot. -1 is the setup value. */
    function sequenceIndexAfterSlider(source: PoseRigSource, shield: boolean): number {
        const skeleton = new Skeleton(readData43(source.read()));
        const slider = skeleton.constraints.find((constraint) => constraint instanceof Slider);

        if (!(slider instanceof Slider) || slider.bone === null) throw new Error('The rig has no slider on a bone');
        const timelines = slider.data.animation.timelines;
        const timeline = timelines.find((each) => each instanceof SequenceTimeline && (each.frames[0] ?? 9) < 1);
        const extra = skeleton.slots.find(
            (slot) => !timelines.some((each) => 'slotIndex' in each && each.slotIndex === slot.data.index),
        );

        if (!(timeline instanceof SequenceTimeline) || extra === undefined) throw new Error('The slider fits no more');
        timeline.attachment.timelineSlots.push(extra.data.index);
        extra.pose.setAttachment(timeline.attachment);
        if (shield) shieldTimelineSlots(skeleton);
        // moves the slider to a time after the first key of the timeline
        slider.bone.pose.rotation = 24;
        skeleton.updateWorldTransform(Physics.update);

        return extra.pose.sequenceIndex;
    }

    it('writes the animated pose of the extra slot, and the driver keeps it from that', () => {
        const source = sources.find((candidate) => candidate.id === '4.3/diamond-pro.json');

        // the rig is not in the manifest any more
        if (source === undefined) return;
        expect(sequenceIndexAfterSlider(source, false)).toBeGreaterThanOrEqual(0);
        expect(sequenceIndexAfterSlider(source, true)).toBe(-1);
    });
});

/*
 * A pose engine does not apply the timelines that animate physics and sliders, but it must still
 * count them when it mixes. The official core sums the alpha of every timeline of an entry that
 * mixes out, and keeps the entry while the sum is not zero. These rigs end an entry at another
 * update, or pose differently, once those timelines are gone. `loud` is what differs first, `quiet`
 * what differs first when the events are left out.
 */
describe('timelines that animate physics and sliders', () => {
    const cases = [
        { id: '4.2/cloud-pot.json', family: 'default mix', name: 'default mix chain', loud: 'events', quiet: 'local' },
        // the mixes of its IK and transform constraints end up different
        { id: '4.2/made-order.json', family: 'default mix', name: 'default mix chain', loud: 'world', quiet: 'world' },
    ];
    const silent = (subject: Subject): Subject => withEvents(subject, () => []);

    it.each(cases)('change what $id does in "$name"', ({ id, family, name, loud, quiet }) => {
        const source = sources.find((candidate) => candidate.id === id);

        // the rig is not in the manifest any more
        if (source === undefined) return;
        const files = source.read();
        const full = loadPoseRig(source.version, files);
        const stripped = loadPoseRig(source.version, files, { stripIgnoredTimelines: true });
        const found: PoseScript | undefined = SCRIPT_FAMILIES.find((candidate) => candidate.name === family)
            ?.scripts(full.info, seedOf(source))
            .find((candidate) => candidate.name === name);

        if (found === undefined) throw new Error(`There is no script "${name}"`);
        const run = (wrap: (subject: Subject) => Subject): string | null =>
            runScript(
                found,
                wrap(officialSubject(stripped.createDriver())),
                wrap(officialSubject(full.createDriver())),
            );

        expect(parts(run((subject) => subject))[0]).toBe(loud);
        expect(parts(run(silent))[0]).toBe(quiet);
    });
});
