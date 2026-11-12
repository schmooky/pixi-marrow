import type { SpineVersion } from '../../src/core';
import type { PoseRigSource } from './pose-synthetic';

/*
 * What the rigs made for constraints share: the words each Spine version has for the same thing,
 * path attachments, keys and the file around them. A rig is written once and comes out as the
 * JSON of each version.
 */

export type Json = Record<string, unknown>;

const VERSIONS: readonly SpineVersion[] = ['4.1', '4.2', '4.3'];
const EDITOR_VERSIONS: Record<SpineVersion, string> = { '4.1': '4.1.24', '4.2': '4.2.43', '4.3': '4.3.39' };

/** One page without regions. The rigs made for constraints show paths only. */
const ATLAS = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');

/** The inherit mode of a bone. 4.1 calls it the transform mode. */
export const inherit = (version: SpineVersion, mode: string): Json =>
    version === '4.1' ? { transform: mode } : { inherit: mode };

/** A constraint of a rig, in update order: its type and its JSON in the words of the version. */
export interface Constraint extends Json {
    type: 'ik' | 'transform' | 'path' | 'physics' | 'slider';
    name: string;
}

/**
 * An IK constraint. `uniform` and `volume` name how scaleY follows a stretch: 4.1 and 4.2 know
 * uniform only, as a flag, 4.3 has a mode for each.
 */
export function ik(version: SpineVersion, name: string, bones: string[], target: string, more: Json = {}): Constraint {
    const { uniform, volume, ...rest } = more;
    const scaleY = volume ? 'volume' : 'uniform';
    const mode = version === '4.3' ? { scaleY } : { uniform: true };

    return { type: 'ik', name, bones, target, ...rest, ...(uniform || (volume && version === '4.3') ? mode : {}) };
}

/** A path constraint. 4.3 names the slot `slot`, the others `target`. */
export function path(version: SpineVersion, name: string, bones: string[], slot: string, more: Json = {}): Constraint {
    return { type: 'path', name, bones, ...(version === '4.3' ? { slot } : { target: slot }), ...more };
}

/**
 * The constraint part of a skeleton file. 4.3 has one list, and its order is the update order.
 * 4.1 and 4.2 have a list per type and a number for the place of each constraint in the update
 * order. The numbers run over all types together. With `reversed` each list is written last
 * constraint first, so that the numbers and not the list places decide.
 */
export function constraintLists(version: SpineVersion, list: readonly Constraint[], reversed = false): Json {
    if (version === '4.3') return { constraints: list };
    const lists: Record<string, Json[]> = {};

    list.forEach(({ type, ...rest }, order) => {
        const entries = lists[type] ?? [];

        lists[type] = entries;
        entries.push({ ...rest, order });
    });
    if (reversed) for (const entries of Object.values(lists)) entries.reverse();

    return lists;
}

/** A bone of a path with weights: its index in the bone list and its setup position in the space of the knots. */
export interface PathBone {
    index: number;
    x: number;
    y: number;
}

/** Cuts a flat list of numbers into rows of `width`. */
function rowsOf(flat: readonly number[], width: number): number[][] {
    return Array.from({ length: flat.length / width }, (_, i) => flat.slice(i * width, (i + 1) * width));
}

/**
 * A path attachment through knots, given as x, y of each in one list. The handles of a knot lie a
 * third of the way to its neighbours. With `bones` every vertex is weighted to these bones in
 * equal parts.
 */
export function pathAttachment(
    flat: readonly number[],
    options: { closed?: boolean; constantSpeed?: boolean; bones?: readonly PathBone[] } = {},
): Json {
    const { closed = false, constantSpeed = true, bones } = options;
    const knots = rowsOf(flat, 2);
    const count = knots.length;
    const at = (i: number): [number, number] => {
        const [x, y] = knots[closed ? (i + count) % count : Math.min(count - 1, Math.max(0, i))] ?? [];

        if (x === undefined || y === undefined) throw new Error('A path needs knots');

        return [x, y];
    };
    const points: [number, number][] = [];
    const lengths: number[] = [];
    let length = 0;

    for (let i = 0; i < count; i++) {
        const [x, y] = at(i);
        const [px, py] = at(i - 1);
        const [nx, ny] = at(i + 1);

        points.push([x + (px - x) / 3, y + (py - y) / 3], [x, y], [x + (nx - x) / 3, y + (ny - y) / 3]);
        // a little more than the chord: only a path without constant speed reads the lengths
        length += Math.hypot(nx - x, ny - y) * 1.04;
        lengths.push(Math.round(length * 100) / 100);
    }
    const vertices = points.flatMap(([x, y]) =>
        bones
            ? [bones.length, ...bones.flatMap((bone) => [bone.index, x - bone.x, y - bone.y, 1 / bones.length])]
            : [x, y],
    );

    return {
        type: 'path',
        ...(closed ? { closed } : {}),
        ...(constantSpeed ? {} : { constantSpeed }),
        lengths,
        vertexCount: points.length,
        vertices,
    };
}

/**
 * Keys of several values at even steps over `duration`. `flat` holds the values of one key after
 * the other, each in the order of `names`. A last key equal to the first is added, so that a loop
 * is smooth. Every second key has a curve for each value that leaves the range of its two keys,
 * every fourth is stepped.
 */
export function keysOf(names: readonly string[], flat: readonly number[], duration: number): Json[] {
    const rows = rowsOf(flat, names.length);
    const step = duration / rows.length;
    const all = [...rows, rows[0] ?? []];

    return all.map((row, i) => {
        const time = Math.round(i * step * 1000) / 1000;
        const next = all[i + 1];
        const values = Object.fromEntries(names.map((name, n) => [name, row[n] ?? 0]));
        const key: Json = { ...(i > 0 ? { time } : {}), ...values };

        if (next === undefined || i % 2 === 1) return i % 4 === 3 && next ? { ...key, curve: 'stepped' } : key;
        const curve = names.flatMap((_, n) => {
            const from = row[n] ?? 0;
            const to = next[n] ?? 0;
            const spread = (to - from) * 0.6 + 0.3;

            return [time + step * 0.3, from - spread, time + step * 0.7, to + spread];
        });

        return { ...key, curve };
    });
}

/** Keys of one value, as `keysOf` makes them. */
export const keys = (values: readonly number[], duration: number, name = 'value'): Json[] =>
    keysOf([name], values, duration);

/**
 * Keys of x and y for a translate, scale or shear timeline, given as x, y of each key in one
 * list, at even steps, the last equal to the first.
 */
export function keysXY(flat: readonly number[], duration: number): Json[] {
    const points = rowsOf(flat, 2);
    const step = duration / points.length;

    return [...points, points[0] ?? []].map(([x, y], i) => ({
        ...(i > 0 ? { time: Math.round(i * step * 1000) / 1000 } : {}),
        x,
        y,
    }));
}

/** What a rig is made of. Each part is the JSON of the version it is asked for. */
export interface RigParts {
    bones: Json[];
    slots: Json[];
    constraints: Json;
    skins: Json[];
    animations: Record<string, Json>;
}

/** A rig made here, once for each version. */
export function madeRig(name: string, parts: (version: SpineVersion) => RigParts): PoseRigSource[] {
    return VERSIONS.map((version) => ({
        id: `${version}/${name}.json`,
        rig: name,
        version,
        read() {
            const { bones, slots, constraints, skins, animations } = parts(version);
            const skeleton = { hash: name, spine: EDITOR_VERSIONS[version], x: -200, y: -200, width: 400, height: 400 };

            return {
                skeleton: JSON.stringify({ skeleton, bones, slots, ...constraints, skins, animations }),
                atlas: ATLAS,
            };
        },
    }));
}
