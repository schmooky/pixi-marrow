import type { PoseEvent } from '../../src/core';
import type { RigFiles } from './official';
import type { Subject } from './pose-run';
import type { PoseDriver } from './pose-shared';

/*
 * What the self-check of the pose parity suite needs to make one side wrong on purpose, to take
 * constraints out of a rig and to read a failure.
 */

/** A side whose pose is changed at one read, counted from 1. */
export function withPose(subject: Subject, at: number, change: (pose: Record<string, unknown>) => object): Subject {
    let reads = 0;

    return {
        ...subject,
        read() {
            const pose = subject.read();

            return ++reads === at ? { ...pose, ...change(pose) } : pose;
        },
    };
}

/** A side whose events go through `change`. */
export function withEvents(subject: Subject, change: (events: PoseEvent[]) => PoseEvent[]): Subject {
    const driver: PoseDriver = new Proxy(subject.driver, {
        get: (target, key) => (key === 'takeEvents' ? () => change(target.takeEvents()) : Reflect.get(target, key)),
    });

    return { ...subject, driver };
}

/** A side that counts the numbers of its poses that are not finite. Such a number equals any other that is not. */
export function countingNotFinite(subject: Subject): Subject & { readonly reads: number; readonly notFinite: number } {
    let reads = 0;
    let notFinite = 0;
    const count = (values: unknown): void => {
        if (values instanceof Float64Array && !values.every(Number.isFinite)) notFinite++;
    };

    return {
        ...subject,
        get reads() {
            return reads;
        },
        get notFinite() {
            return notFinite;
        },
        read() {
            const pose = subject.read();

            reads++;
            for (const key of ['local', 'world', 'colors', 'darkColors']) count(pose[key]);
            if (Array.isArray(pose.deform)) pose.deform.forEach(count);

            return pose;
        },
    };
}

/** The next number after a value: the smallest difference there is. */
export const next = (value: number): number =>
    value === 0 ? Number.MIN_VALUE : value + Math.abs(value) * Number.EPSILON;

export function numbers(values: unknown): Float64Array {
    if (!(values instanceof Float64Array)) throw new Error('The pose holds no such numbers');

    return values;
}

/** The number one unit in the last place away from a value, toward a bigger magnitude. */
export function oneUnitOff(value: number): number {
    const float = new Float64Array([value]);
    const bits = new BigUint64Array(float.buffer);

    bits[0] = (bits[0] ?? 0n) + 1n;

    return float[0] ?? value;
}

function record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Not an object');

    return Object.fromEntries(Object.entries(value));
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The constraint kinds a file names: a list of the root in 4.1 and 4.2, a `type` in 4.3, and a key of animations and skins. */
const KINDS = ['ik', 'transform', 'path', 'physics', 'slider'];

/** The JSON of a rig after `edit` changed it. */
function edited(files: RigFiles, edit: (json: Record<string, unknown>) => Record<string, unknown>): RigFiles {
    if (typeof files.skeleton !== 'string') throw new Error('The rig is not JSON');

    return { ...files, skeleton: JSON.stringify(edit(record(JSON.parse(files.skeleton)))) };
}

/**
 * The constraint lists of a 4.1 or 4.2 file with the order numbers counted anew. The official
 * core looks for the numbers from 0 up to the count of constraints: one past a gap is never solved.
 */
function renumbered(lists: [kind: string, constraints: unknown[]][]): [string, unknown[]][] {
    const orders = lists.flatMap(([, constraints]) => constraints.map((each) => Number(record(each).order)));
    const sorted = [...orders].sort((a, b) => a - b);

    return lists.map(([kind, constraints]) => [
        kind,
        constraints.map((each) => {
            const { order, ...rest } = record(each);

            return typeof order === 'number' ? { ...rest, order: sorted.indexOf(order) } : each;
        }),
    ]);
}

/**
 * The JSON of a rig without the constraints `gone` picks by kind and name, the keys that animate
 * them and the skin entries that name them.
 */
function withoutSome(files: RigFiles, gone: (kind: string, name: unknown) => boolean): RigFiles {
    // a list of constraints of the root: every constraint has a name, and in 4.3 a type
    const kept = (kind: string, constraints: unknown): unknown[] =>
        list(constraints).filter((each) => {
            const { type, name } = record(each);

            return !gone(typeof type === 'string' ? type : kind, name);
        });
    // the keys of an animation or the lists of a skin, by kind
    const pruned = (holder: unknown): Record<string, unknown> =>
        Object.fromEntries(
            Object.entries(record(holder)).map(([kind, value]) => {
                if (!KINDS.includes(kind)) return [kind, value];
                if (Array.isArray(value)) return [kind, value.filter((name) => !gone(kind, name))];

                return [kind, Object.fromEntries(Object.entries(record(value)).filter(([name]) => !gone(kind, name)))];
            }),
        );

    return edited(files, (json) => ({
        ...json,
        ...Object.fromEntries(
            renumbered(
                [...KINDS, 'constraints'].filter((kind) => kind in json).map((kind) => [kind, kept(kind, json[kind])]),
            ),
        ),
        animations: Object.fromEntries(
            Object.entries(record(json.animations)).map(([name, keys]) => [name, pruned(keys)]),
        ),
        skins: list(json.skins).map(pruned),
    }));
}

/** The JSON of a rig without its constraints, the keys that animate them and the skin lists that name them. */
export const withoutConstraints = (files: RigFiles): RigFiles => withoutSome(files, () => true);

/** The JSON of a 4.3 rig without its sliders. The animations the sliders played stay. */
export const withoutSliders = (files: RigFiles): RigFiles => withoutSome(files, (kind) => kind === 'slider');

/** The JSON of a rig without one constraint. */
export const withoutConstraint = (files: RigFiles, kind: string, name: string): RigFiles =>
    withoutSome(files, (itsKind, itsName) => itsKind === kind && itsName === name);

/** The constraints of a JSON rig that are physics constraints or sliders, in file order. */
export function physicsAndSliders(files: RigFiles): { kind: string; name: string }[] {
    if (typeof files.skeleton !== 'string') throw new Error('The rig is not JSON');
    const json = record(JSON.parse(files.skeleton));
    const named = (kind: string, constraints: unknown): { kind: string; name: string }[] =>
        list(constraints).map((each) => {
            const { type, name } = record(each);

            return { kind: typeof type === 'string' ? type : kind, name: String(name) };
        });

    return [...named('physics', json.physics), ...named('', json.constraints)].filter(
        ({ kind }) => kind === 'physics' || kind === 'slider',
    );
}

/** The index of a bone or a slot of a JSON rig, by name. */
export function indexOf(files: RigFiles, part: 'bones' | 'slots', name: string): number {
    if (typeof files.skeleton !== 'string') throw new Error('The rig is not JSON');
    const index = list(record(JSON.parse(files.skeleton))[part]).findIndex((each) => record(each).name === name);

    if (index < 0) throw new Error(`The rig has no ${name} in its ${part}`);

    return index;
}

/** The lines of a failure that name a difference, by the part of the pose each is in. */
export const parts = (failure: string | null): string[] => [
    ...new Set(
        (failure ?? '')
            .split('\n')
            .slice(1)
            .map((line) => line.trim().replace(/[[.:].*/, '')),
    ),
];
