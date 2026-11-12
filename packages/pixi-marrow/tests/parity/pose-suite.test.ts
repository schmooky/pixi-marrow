import { describe, expect, it } from 'vitest';
import type { TrackEntry } from '../../src/core';
import { loadPoseRig, officialYDown } from './pose-official';
import { NO_SCRIPT_ENTRY, officialSubject, runScript, type Subject } from './pose-run';
import { DT, script } from './pose-script';
import { SCRIPT_FAMILIES } from './pose-scripts';
import { type OfficialPoseRig, type PoseDriver, yDownKeeper } from './pose-shared';
import { countingNotFinite, next, numbers, parts, withEvents, withPose } from './pose-suite-kit';
import { listPoseRigs, type PoseRigSource } from './pose-synthetic';

/*
 * The pose parity suite checks itself here, without our engine. Every script of every family runs
 * on two official drivers of every rig and must give the same poses: the official core has to be
 * its own equal before it can judge an engine. Then one side is made wrong on purpose and the
 * comparison must report it.
 *
 * `pose-reference.test.ts` checks what the reference holds, and that a number that is off by the
 * smallest step is reported wherever a constraint wrote it.
 */

const sources = listPoseRigs();
/** One skeleton per rig and version. The JSON and the binary export of a rig pose alike. */
const rigs = sources.filter(
    (source, i) => sources.findIndex((other) => other.version === source.version && other.rig === source.rig) === i,
);
const seedOf = (source: PoseRigSource): string => `${source.version}/${source.rig}`;

describe.each(rigs)('$version/$rig', (source) => {
    it('gives the same poses on two official drivers, in every family', { timeout: 30_000 }, () => {
        const rig = loadPoseRig(source.version, source.read());
        const made = source.rig.startsWith('made-');
        let reads = 0;

        for (const family of SCRIPT_FAMILIES) {
            const scripts = family.scripts(rig.info, seedOf(source));

            // every family has something to run on every rig
            expect(scripts.length, family.name).toBeGreaterThan(0);
            for (const each of scripts) {
                const counted = countingNotFinite(officialSubject(rig.createDriver()));
                const failure = runScript(each, counted, officialSubject(rig.createDriver()));

                if (failure !== null) expect.fail(`${source.id}, ${failure}`);
                // a driver turns the static of the official core on for its own update only
                expect(officialYDown(), `${source.id}, script "${each.name}"`).toBe(false);
                reads += counted.reads;
                // a number that is not finite equals any other that is not: it would compare nothing
                if (made) expect(counted.notFinite, `${source.id}, script "${each.name}"`).toBe(0);
            }
        }
        expect(reads).toBeGreaterThan(SCRIPT_FAMILIES.length * 10);
    });
});

/** The rig with this id. The rigs made here are always there. */
function rigOf(id: string): OfficialPoseRig {
    const source = sources.find((candidate) => candidate.id === id);

    if (source === undefined) throw new Error(`There is no rig ${id}`);

    return loadPoseRig(source.version, source.read());
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

    it('reports a call for physics that one side does not make', () => {
        const physics = rigOf('4.2/made-physics.json');
        const pair = () => ({
            actual: officialSubject(physics.createDriver()),
            expected: officialSubject(physics.createDriver()),
        });
        // a driver that takes the call and does nothing
        const deaf = (subject: Subject, call: string): Subject => {
            const driver: PoseDriver = new Proxy(subject.driver, {
                get: (target, key) => (key === call ? () => {} : Reflect.get(target, key)),
                set: (target, key, value) => key === call || Reflect.set(target, key, value),
            });

            return { ...subject, driver };
        };
        const moved = script('moved', (s) => {
            s.set(0, 0, true);
            s.update(DT, 4);
            s.physicsTranslate(25, -10);
            s.update(DT, 2);
            s.physicsRotate(5, 5, 40);
            s.update(DT, 2);
            s.physics('pose');
            s.update(DT, 2);
        });

        expect(runScript(moved, pair().actual, pair().expected)).toBeNull();
        for (const call of ['physicsTranslate', 'physicsRotate', 'physics']) {
            expect(parts(runScript(moved, deaf(pair().actual, call), pair().expected)), call).toEqual(['world']);
        }
    });

    it('reports a y axis that one side does not turn down, and only where gravity pulls', () => {
        const pixi = script('as Pixi plays', (s) => {
            s.yDown(true);
            s.place(0, 0, 1, -1);
            s.set(0, 0, true);
            s.update(DT, 6);
        });

        for (const id of ['4.2/made-physics.json', '4.3/made-physics.json']) {
            const physics = rigOf(id);
            const deaf: Subject = { ...officialSubject(physics.createDriver()), yDown() {} };

            expect(parts(runScript(pixi, deaf, officialSubject(physics.createDriver()))), id).toEqual(['world']);
        }
        // without physics the flag changes nothing: the scale is the one that was placed
        for (const id of ['4.1/made-ik.json', '4.2/made-transform.json', '4.3/made-path.json']) {
            const plain = rigOf(id);
            const deaf: Subject = { ...officialSubject(plain.createDriver()), yDown() {} };

            expect(runScript(pixi, deaf, officialSubject(plain.createDriver())), id).toBeNull();
        }
        expect(officialYDown()).toBe(false);
    });

    it('gives the official setter the negated scale while y is down, and turns the static off after a throw', () => {
        const flag = { yDown: false };
        const skeleton = { scaleY: 1 };
        const keeper = yDownKeeper(skeleton, flag);
        let seen = false;

        keeper.set(true);
        keeper.place(-1);
        // the official getter negates this while the static is on: the effective scale is -1
        expect(skeleton.scaleY).toBe(1);
        expect(() =>
            keeper.solve(() => {
                seen = flag.yDown;
                throw new Error('the update failed');
            }),
        ).toThrow('the update failed');
        expect(seen).toBe(true);
        expect(flag.yDown).toBe(false);
        keeper.set(false);
        expect(skeleton.scaleY).toBe(-1);
        keeper.solve(() => {
            seen = flag.yDown;
        });
        expect(seen).toBe(false);
    });

    it('reports wind and gravity that one side does not turn', () => {
        const physics = rigOf('4.3/made-physics.json');
        const windy = script('windy', (s) => {
            s.forces(0, 1, -1, 0);
            s.set(0, 0, true);
            s.update(DT, 4);
        });
        const still: Subject = { ...officialSubject(physics.createDriver()), forces() {} };

        expect(parts(runScript(windy, still, officialSubject(physics.createDriver())))).toEqual(['world']);
    });
});
