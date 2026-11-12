import { AnimationState, AnimationStateData, Physics, Skeleton, type SkeletonData, Slider } from 'spine-core-4.3';
import { expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type PoseEngine, WORLD_STRIDE } from '../../src/core';
import { readData43 } from '../parity/pose-official43';

/*
 * Skeletons made from random numbers, with IK, transform, path, physics and slider constraints in
 * every mode and in any order, on bones with every inherit mode. Animations key the bones, the
 * constraint poses, the paths and their deforms, and skins turn bones and constraints on and off.
 * After every update and every skin change the world transform of every bone must be that of the
 * official core, bit for bit, also for a bone that is not active. The numbers come from a seed, so
 * a failure names a skeleton that can be made again.
 */

type Json = Record<string, unknown>;

/** A random number source from a seed. */
function random(seed: number) {
    let state = seed >>> 0;
    const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

        return state / 4294967296;
    };
    const int = (n: number): number => Math.floor(next() * n);

    return {
        next,
        int,
        /** A number between `low` and `high` with two decimals. */
        range: (low: number, high: number): number => Math.round((low + next() * (high - low)) * 100) / 100,
        chance: (p: number): boolean => next() < p,
        pick: <T>(list: readonly T[]): T => {
            const item = list[int(list.length)];

            if (item === undefined) throw new Error('Nothing to pick from');

            return item;
        },
    };
}

type Random = ReturnType<typeof random>;

const ATLAS = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');
const INHERIT = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];
const SIX = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];
const SCALES = [1, 1, 1, 1.4, 0.6, -1, -0.7, 0];
const ANIMATIONS = 3;
const SKINS = 3;

/** What the parts of a rig need to know about each other while it is made. */
interface Draft {
    r: Random;
    bones: Json[];
    /** The parent of each bone. */
    parents: number[];
    /** The bones that need a skin. */
    gated: number[];
    slots: number;
    /** Per slot and path name: how many numbers a deform of the path has. */
    deforms: number[][];
    constraints: Json[];
}

/** Bones in a random tree, some of which need a skin. */
function randomBones(draft: Draft, count: number): void {
    const { r } = draft;

    draft.bones.push({ name: 'b0', rotation: r.range(-30, 30), scaleX: r.range(0.8, 1.2) });
    draft.parents.push(-1);
    for (let i = 1; i < count; i++) {
        const parent = r.int(i);

        if (r.chance(0.12)) draft.gated.push(i);
        draft.parents.push(parent);
        draft.bones.push({
            name: `b${i}`,
            parent: `b${parent}`,
            x: r.range(-40, 40),
            y: r.range(-40, 40),
            rotation: r.range(-180, 180),
            scaleX: r.pick(SCALES),
            scaleY: r.pick(SCALES),
            shearX: r.chance(0.2) ? r.range(-30, 30) : 0,
            shearY: r.chance(0.2) ? r.range(-30, 30) : 0,
            length: r.chance(0.15) ? 0 : r.range(5, 40),
            inherit: r.chance(0.65) ? 'normal' : r.pick(INHERIT),
            skin: draft.gated.includes(i),
        });
    }
}

/** A path attachment with random points: open or closed, at constant speed or not, sometimes with weights. */
function randomPath(draft: Draft): { path: Json; deform: number } {
    const { r } = draft;
    const closed = r.chance(0.4);
    const knots = (closed ? 1 : 2) + r.int(3);
    const weighted = r.chance(0.4);
    const vertices: number[] = [];
    let total = 0;
    let deform = 0;

    for (let v = 0; v < knots * 3; v++) {
        const count = weighted ? 1 + r.int(2) : 0;
        const [x, y] = [r.range(-80, 80), r.range(-80, 80)];

        deform += weighted ? count * 2 : 2;
        if (!weighted) vertices.push(x, y);
        else
            vertices.push(
                count,
                ...Array.from({ length: count }, () => [r.int(draft.bones.length), x, y, 1 / count]).flat(),
            );
    }
    const lengths = Array.from({ length: knots }, () => {
        total += r.range(5, 60);

        return Math.round(total * 100) / 100;
    });

    return {
        path: { type: 'path', closed, constantSpeed: r.chance(0.5), lengths, vertexCount: knots * 3, vertices },
        deform,
    };
}

/** Slots with two paths each. Returns the attachments of the default skin and those of a second skin. */
function randomSlots(draft: Draft, count: number): { slots: Json[]; attachments: Json; other: Json } {
    const { r } = draft;
    const slots: Json[] = [];
    const attachments: Json = {};
    const other: Json = {};

    for (let s = 0; s < count; s++) {
        const [p0, p1] = [randomPath(draft), randomPath(draft)];

        slots.push({
            name: `s${s}`,
            bone: `b${r.int(draft.bones.length)}`,
            ...(r.chance(0.85) ? { attachment: 'p0' } : {}),
        });
        attachments[`s${s}`] = { p0: p0.path, p1: p1.path };
        if (r.chance(0.5)) other[`s${s}`] = { p0: randomPath(draft).path };
        draft.deforms.push([p0.deform, p1.deform]);
    }
    draft.slots = count;

    return { slots, attachments, other };
}

/** A bone that is not the root: IK moves bones in the space of their parent. */
const below = (draft: Draft): number => 1 + draft.r.int(draft.bones.length - 1);

function randomIk(draft: Draft, name: string): Json {
    const { r } = draft;
    const parent = below(draft);
    const kids = draft.parents.flatMap((p, i) => (p === parent ? [i] : []));
    // mostly a child of the first bone, now and then any bone or the first bone itself
    const child = r.chance(0.06) ? parent : kids.length > 0 && !r.chance(0.08) ? r.pick(kids) : below(draft);
    const two = r.chance(0.6);

    return {
        type: 'ik',
        name,
        bones: two ? [`b${parent}`, `b${child}`] : [`b${parent}`],
        target: `b${r.int(draft.bones.length)}`,
        mix: r.chance(0.15) ? 0 : r.range(0, 1),
        softness: r.chance(0.3) ? r.range(1, 30) : 0,
        bendPositive: r.chance(0.5),
        compress: r.chance(0.3),
        stretch: r.chance(0.4),
        scaleY: r.pick(['none', 'uniform', 'volume']),
    };
}

/** The properties a transform constraint copies: from each property to itself and sometimes to others. */
function randomProperties(r: Random): Json {
    const properties: Json = {};

    for (const from of SIX) {
        if (!r.chance(0.45)) continue;
        const to: Json = {};

        for (const target of SIX) {
            if (target !== from && !r.chance(0.15)) continue;
            to[target] = { offset: r.chance(0.5) ? r.range(-20, 20) : 0, max: r.range(-40, 40), scale: r.range(-2, 2) };
        }
        properties[from] = { offset: r.chance(0.5) ? r.range(-10, 10) : 0, to };
    }

    return properties;
}

function randomTransform(draft: Draft, name: string): Json {
    const { r } = draft;
    const bone = (): string => `b${r.int(draft.bones.length)}`;
    const constraint: Json = {
        type: 'transform',
        name,
        bones: Array.from({ length: 1 + r.int(3) }, bone),
        source: bone(),
        properties: randomProperties(r),
        rotation: r.chance(0.3) ? r.range(-20, 20) : 0,
        x: r.chance(0.3) ? r.range(-20, 20) : 0,
        y: r.chance(0.3) ? r.range(-20, 20) : 0,
        scaleX: r.chance(0.3) ? r.range(-0.5, 0.5) : 0,
        shearY: r.chance(0.3) ? r.range(-20, 20) : 0,
    };

    for (const flag of ['localSource', 'localTarget', 'additive', 'clamp']) constraint[flag] = r.chance(0.4);
    for (const mix of MIXES) if (r.chance(0.5)) constraint[mix] = r.chance(0.15) ? 0 : r.range(-0.5, 1.2);

    return constraint;
}

function randomPathConstraint(draft: Draft, name: string): Json {
    const { r } = draft;
    const positionMode = r.pick(['fixed', 'percent']);
    const spacingMode = r.pick(['length', 'fixed', 'percent', 'proportional']);
    const constraint: Json = {
        type: 'path',
        name,
        // the root now and then: a path moves a bone in the world, so it may have no parent
        bones: Array.from(
            { length: 1 + r.int(3) },
            () => `b${r.chance(0.1) ? r.int(draft.bones.length) : below(draft)}`,
        ),
        slot: `s${r.int(draft.slots)}`,
        positionMode,
        spacingMode,
        rotateMode: r.pick(['tangent', 'chain', 'chainScale']),
        rotation: r.chance(0.4) ? r.range(-90, 90) : 0,
        position: positionMode === 'percent' ? r.range(-0.5, 1.5) : r.range(-40, 150),
        spacing: spacingMode === 'percent' ? r.range(-0.2, 0.5) : r.chance(0.15) ? 0 : r.range(-10, 40),
    };

    for (const mix of ['mixRotate', 'mixX', 'mixY'])
        if (r.chance(0.5)) constraint[mix] = r.chance(0.15) ? 0 : r.range(-0.3, 1);

    return constraint;
}

/** One constraint of a random kind. Physics and sliders are in the update order, but they are not solved. */
function randomConstraint(draft: Draft, name: string): Json {
    const { r } = draft;
    const roll = r.next();
    const skin = r.chance(0.2);

    if (roll < 0.3) return { ...randomIk(draft, name), skin };
    if (roll < 0.6) return { ...randomTransform(draft, name), skin };
    if (roll < 0.86) return { ...randomPathConstraint(draft, name), skin };
    if (roll < 0.94) return { type: 'physics', name, bone: `b${below(draft)}`, x: 1, y: 1, rotate: 1, scaleX: 1, skin };
    const driven = r.chance(0.6)
        ? { bone: `b${r.int(draft.bones.length)}`, property: r.pick(SIX), local: r.chance(0.5) }
        : {};

    return { type: 'slider', name, animation: 'a0', ...driven, skin };
}

/** Key times that grow, and now and then a first key after time 0. */
const times = (r: Random, count: number): number[] =>
    Array.from(
        { length: count },
        (_, i) => Math.round((i * 0.35 + (i > 0 || r.chance(0.3) ? r.next() * 0.3 : 0)) * 100) / 100,
    );

/** A linear, stepped or bezier curve for a key of `count` values. */
function curve(r: Random, count: number): Json {
    if (r.chance(0.3)) return { curve: 'stepped' };

    return r.chance(0.4) ? { curve: Array.from({ length: count * 4 }, () => r.range(0, 1)) } : {};
}

/** `count` keys with the values `values` makes, each with a curve for `curves` values. */
const keys = (r: Random, count: number, curves: number, values: () => Json): Json[] =>
    times(r, count).map((time) => ({ time, ...values(), ...(curves > 0 ? curve(r, curves) : {}) }));

function boneTimelines(r: Random): Json {
    const timelines: Json = {};
    const pair = (low: number, high: number) => (): Json => ({ x: r.range(low, high), y: r.range(low, high) });

    if (r.chance(0.7)) timelines.rotate = keys(r, 3, 1, () => ({ value: r.range(-120, 120) }));
    if (r.chance(0.4)) timelines.translate = keys(r, 3, 2, pair(-20, 20));
    if (r.chance(0.3)) timelines.scale = keys(r, 2, 0, pair(-1.5, 1.5));
    if (r.chance(0.15)) timelines.shear = keys(r, 2, 0, pair(-20, 20));
    if (r.chance(0.1)) timelines.inherit = keys(r, 2, 0, () => ({ inherit: r.pick(INHERIT) }));

    return timelines;
}

/** Keys for the pose of one constraint, in the words of its kind. */
function constraintKeys(r: Random, constraint: Json): unknown {
    const mixes = (names: string[], low: number) => (): Json =>
        Object.fromEntries(names.map((name) => [name, r.range(low, 1)]));

    if (constraint.type === 'ik') {
        const flags = (): Json => ({ bendPositive: r.chance(0.5), compress: r.chance(0.3), stretch: r.chance(0.3) });
        const softness = (): number => (r.chance(0.5) ? 0 : r.range(0, 20));

        return keys(r, 3, 2, () => ({ mix: r.chance(0.15) ? 0 : r.range(0, 1), softness: softness(), ...flags() }));
    }
    if (constraint.type === 'transform') return keys(r, 3, 6, mixes(MIXES, -0.5));
    const [low, high] = constraint.positionMode === 'percent' ? [-0.5, 1.5] : [-50, 200];

    return {
        position: keys(r, 3, 1, () => ({ value: r.range(low ?? 0, high ?? 1) })),
        spacing: keys(r, 2, 1, () => ({ value: r.range(-5, 30) })),
        ...(r.chance(0.5) ? { mix: keys(r, 3, 3, mixes(['mixRotate', 'mixX', 'mixY'], 0)) } : {}),
    };
}

/** An animation that keys bones, constraint poses, the paths the slots show and their deforms. */
function randomAnimation(draft: Draft): Json {
    const { r } = draft;
    const bones: Json = {};
    const keyed: Record<string, Json> = { ik: {}, transform: {}, path: {} };
    const slots: Json = {};
    const deforms: Json = {};

    draft.bones.forEach((bone) => {
        if (r.chance(0.5)) bones[String(bone.name)] = boneTimelines(r);
    });
    for (const constraint of draft.constraints) {
        const section = keyed[String(constraint.type)];

        if (section !== undefined && r.chance(0.6)) section[String(constraint.name)] = constraintKeys(r, constraint);
    }
    draft.deforms.forEach((lengths, s) => {
        const which = r.int(lengths.length);
        const vertices = (): number[] => Array.from({ length: lengths[which] ?? 0 }, () => r.range(-15, 15));
        const name = (): string | null => (r.chance(0.25) ? null : `p${r.int(lengths.length)}`);

        if (r.chance(0.4)) slots[`s${s}`] = { attachment: keys(r, 3, 0, () => ({ name: name() })) };
        if (r.chance(0.5))
            deforms[`s${s}`] = { [`p${which}`]: { deform: keys(r, 3, 1, () => ({ vertices: vertices() })) } };
    });

    return { bones, ...keyed, slots, attachments: { default: deforms } };
}

/** A skin that turns some of the bones and constraints on that need a skin. */
function randomSkin(draft: Draft, name: string, attachments: Json): Json {
    const { r } = draft;
    const listed = (type: string): string[] =>
        draft.constraints.flatMap((each) =>
            each.type === type && each.skin === true && r.chance(0.6) ? [String(each.name)] : [],
        );

    return {
        name,
        bones: draft.gated.filter(() => r.chance(0.6)).map((i) => `b${i}`),
        ik: listed('ik'),
        transform: listed('transform'),
        path: listed('path'),
        physics: listed('physics'),
        slider: listed('slider'),
        attachments,
    };
}

/** The JSON of a random skeleton. */
function randomRig(seed: number): string {
    const draft: Draft = { r: random(seed), bones: [], parents: [], gated: [], slots: 0, deforms: [], constraints: [] };

    randomBones(draft, 8 + draft.r.int(8));
    const { slots, attachments, other } = randomSlots(draft, 2 + draft.r.int(2));
    const count = 3 + draft.r.int(6);

    for (let c = 0; c < count; c++) draft.constraints.push(randomConstraint(draft, `c${c}`));
    const animations = Object.fromEntries(
        Array.from({ length: ANIMATIONS }, (_, a) => [`a${a}`, randomAnimation(draft)]),
    );

    return JSON.stringify({
        skeleton: { spine: '4.3.39-beta' },
        bones: draft.bones,
        slots,
        constraints: draft.constraints,
        skins: [{ name: 'default', attachments }, randomSkin(draft, 'one', other), randomSkin(draft, 'two', {})],
        animations,
    });
}

/** Our engine and the official skeleton of one rig, which take the same calls. */
interface Pair {
    engine: PoseEngine;
    data: SkeletonData;
    skeleton: Skeleton;
    state: AnimationState;
}

async function createPair(json: string): Promise<Pair> {
    const data = readData43({ skeleton: json, atlas: ATLAS });
    const engine = await createPoseEngine(await importSkeleton(json), { constraints: 'ignore' });
    const skeleton = new Skeleton(data);

    // a slider that does nothing, and below physics that are not updated: what the engine leaves out
    for (const constraint of skeleton.constraints) if (constraint instanceof Slider) constraint.update = () => {};

    return { engine, data, skeleton, state: new AnimationState(new AnimationStateData(data)) };
}

/** Where the world transforms of the two sides differ, as lines that start with `where`. */
function differences({ engine, skeleton }: Pair, where: string): string[] {
    return skeleton.bones.flatMap((bone, i) => {
        const { a, b, c, d, worldX, worldY } = bone.appliedPose;
        const mine = Array.from(engine.state.world.subarray(i * WORLD_STRIDE, (i + 1) * WORLD_STRIDE));
        const same = [a, b, c, d, worldX, worldY].every((value, k) => Object.is(value, mine[k]));

        return same
            ? []
            : [`${where}: bone ${i}, active ${bone.active}: ${mine} is not ${[a, b, c, d, worldX, worldY]}`];
    });
}

function play(r: Random, { engine, data, state }: Pair): void {
    const animation = r.int(ANIMATIONS);
    const [track, loop] = [r.int(3), r.chance(0.6)];
    const mine = engine.setAnimation(track, animation, loop);
    const theirs = state.setAnimation(track, data.animations[animation]?.name ?? '', loop);

    if (track === 0 || r.chance(0.5)) return;
    const [alpha, additive] = [r.range(0, 1), r.chance(0.4)];

    engine.configure(mine, { alpha, additive });
    Object.assign(theirs, { alpha, additive });
}

/** One random call on both sides. Returns where the poses differ after it. */
function step(r: Random, pair: Pair, where: string): string[] {
    const { engine, data, skeleton, state } = pair;
    const roll = r.next();

    if (roll < 0.1) {
        const skin = r.int(SKINS + 1) - 1;

        engine.setSkin(skin);
        skeleton.setSkin(data.skins[skin] ?? null);

        return differences(pair, `${where} after skin ${skin}`);
    }
    if (roll < 0.3) play(r, pair);
    else if (roll < 0.33) {
        engine.setupPose();
        skeleton.setupPose();
    } else if (roll < 0.36) {
        const placing = { scaleX: r.chance(0.5) ? -1.25 : 0.75, scaleY: r.chance(0.3) ? -0.8 : 1.5, x: 12.5, y: -7.25 };

        Object.assign(engine.state, placing);
        Object.assign(skeleton, placing);
    } else {
        const dt = r.next() * 0.12;

        engine.update(dt);
        state.update(dt);
        skeleton.update(dt);
        state.apply(skeleton);
        skeleton.updateWorldTransform(Physics.none);

        return differences(pair, `${where} after an update`);
    }

    return [];
}

it('poses random skeletons with constraints like the official core', async () => {
    const problems: string[] = [];

    for (let seed = 1; seed <= 150 && problems.length === 0; seed++) {
        const pair = await createPair(randomRig(seed));
        const r = random(seed * 31 + 7);

        pair.engine.defaultMix = 0.25;
        pair.state.data.defaultMix = 0.25;
        problems.push(...differences(pair, `seed ${seed}, new`));
        for (let i = 0; i < 70 && problems.length === 0; i++)
            problems.push(...step(r, pair, `seed ${seed}, step ${i}`));
    }
    expect(problems.slice(0, 5)).toEqual([]);
});
