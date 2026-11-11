import { Physics, SequenceTimeline, Skeleton, Slider } from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import type { PoseEvent, TrackEntry } from '../../src/core';
import { loadPoseRig } from './pose-official';
import { readData43, shieldTimelineSlots } from './pose-official43';
import { NO_SCRIPT_ENTRY, officialSubject, runScript, type Subject } from './pose-run';
import { DT, type PoseScript, script } from './pose-script';
import { SCRIPT_FAMILIES } from './pose-scripts';
import { createAudit, type PoseDriver } from './pose-shared';
import { listPoseRigs, type PoseRigSource } from './pose-synthetic';

/*
 * The pose parity suite checks itself here, without our engine. Every script runs on two official
 * drivers and must give the same poses, a wrong value on one side must be reported, and the
 * constraints of the official skeleton must leave alone what the suite compares.
 */

const sources = listPoseRigs();
/** One skeleton per rig and version. The JSON and the binary export of a rig pose alike. */
const rigs = sources.filter(
    (source, i) => sources.findIndex((other) => other.version === source.version && other.rig === source.rig) === i,
);
const seedOf = (source: PoseRigSource): string => `${source.version}/${source.rig}`;

describe.each(rigs)('$version/$rig', (source) => {
    it('gives the same poses twice, and its constraints leave the animated pose alone', { timeout: 30_000 }, () => {
        const rig = loadPoseRig(source.version, source.read());
        let updates = 0;

        for (const family of SCRIPT_FAMILIES) {
            for (const each of family.scripts(rig.info, seedOf(source))) {
                const audited = rig.createDriver({ audit: true });
                const failure = runScript(each, officialSubject(audited), officialSubject(rig.createDriver()));

                if (failure !== null) expect.fail(`${source.id}, ${failure}`);
                expect(audited.leaks, `${source.id}, script "${each.name}"`).toEqual([]);
                for (const op of each.ops) updates += op.op === 'update' ? op.times : 0;
            }
        }
        // every family ran
        expect(updates).toBeGreaterThan(SCRIPT_FAMILIES.length * 10);
    });
});

/** A side whose pose is changed at one read, counted from 1. */
function withPose(subject: Subject, at: number, change: (pose: Record<string, unknown>) => object): Subject {
    let reads = 0;

    return {
        driver: subject.driver,
        read() {
            const pose = subject.read();

            return ++reads === at ? { ...pose, ...change(pose) } : pose;
        },
    };
}

/** A side whose events go through `change`. */
function withEvents(subject: Subject, change: (events: PoseEvent[]) => PoseEvent[]): Subject {
    const driver: PoseDriver = new Proxy(subject.driver, {
        get: (target, key) => (key === 'takeEvents' ? () => change(target.takeEvents()) : Reflect.get(target, key)),
    });

    return { driver, read: subject.read };
}

/** The next number after a value: the smallest difference there is. */
const next = (value: number): number => (value === 0 ? Number.MIN_VALUE : value + Math.abs(value) * Number.EPSILON);

function numbers(values: unknown): Float64Array {
    if (!(values instanceof Float64Array)) throw new Error('The pose holds no such numbers');

    return values;
}

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

        expect(runScript(turns, { driver, read: actual.read }, expected)).toBeNull();
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
        const failure = runScript(queue, { driver: late, read: actual.read }, expected);

        expect(failure).toContain('step 2 of 2, add track 0 animation 0 loop false delay 0.5');
        expect(failure).toContain('entry.delay: 0.75, expected 0.5');
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
 * A pose engine that ignores constraints must still count the timelines that animate them when it
 * mixes. The official core sums the alpha of every timeline of an entry that mixes out, and keeps
 * the entry while the sum is not zero. These rigs pose differently, or end an entry at another
 * update, once the constraint timelines are gone.
 */
describe('timelines that animate constraints', () => {
    const cases = [
        { id: '4.2/cloud-pot.json', family: 'default mix', name: 'default mix chain', bones: true },
        { id: '4.3/raptor-pro.json', family: 'dialect', name: 'additive', bones: false },
    ];
    const silent = (subject: Subject): Subject => withEvents(subject, () => []);

    it.each(cases)('change what $id does in "$name"', ({ id, family, name, bones }) => {
        const source = sources.find((candidate) => candidate.id === id);

        // the rig is not in the manifest any more
        if (source === undefined) return;
        const files = source.read();
        const full = loadPoseRig(source.version, files);
        const stripped = loadPoseRig(source.version, files, { stripConstraintTimelines: true });
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

        // an entry ends at another update
        expect(run((subject) => subject)).toMatch(/\n {4}events: length \d+, expected \d+/);
        // and for the first rig the bones differ too
        if (bones) expect(run(silent)).toMatch(/\n {4}local\[\d+\]: /);
        else expect(run(silent)).toBeNull();
    });
});
