import type { PoseEvent } from '../../src/core';
import type { RigFiles } from './official';
import type { Subject } from './pose-run';
import type { PoseDriver } from './pose-shared';

/*
 * What the self-check of the pose parity suite needs to make one side wrong on purpose, to take
 * the constraints out of a rig and to read a failure.
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

/** The JSON of a rig without its constraints, the keys that animate them and the skin lists that name them. */
export function withoutConstraints(files: RigFiles): RigFiles {
    if (typeof files.skeleton !== 'string') throw new Error('The rig is not JSON');
    const kinds = ['ik', 'transform', 'path', 'physics', 'slider', 'constraints'];
    const strip = (value: unknown): Record<string, unknown> =>
        Object.fromEntries(Object.entries(record(value)).filter(([key]) => !kinds.includes(key)));
    const json = record(JSON.parse(files.skeleton));
    const animations = Object.fromEntries(
        Object.entries(record(json.animations)).map(([name, keys]) => [name, strip(keys)]),
    );
    const skins = Array.isArray(json.skins) ? json.skins.map(strip) : [];

    return { ...files, skeleton: JSON.stringify({ ...strip(json), animations, skins }) };
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
