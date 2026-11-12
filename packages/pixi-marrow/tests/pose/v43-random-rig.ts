/*
 * Skeletons made from random numbers for the 4.3 pose engine, as the JSON of Spine 4.3. They have
 * IK, transform, path and physics constraints and sliders in every mode and in any order, on bones
 * with every inherit mode. Animations key the bones, the colors and the attachments of the slots,
 * the draw order, the constraint poses, the paths and their deforms. Sliders play the first two
 * animations, so every kind of timeline also runs inside a slider. Skins turn bones and
 * constraints on and off.
 */
import { constraintKeys, physicsKeys, randomConstraint } from './v43-random-constraints';
import {
    ANIMATIONS,
    type Draft,
    HEX,
    INHERIT,
    type Json,
    keys,
    type Random,
    random,
    SCALES,
    times,
} from './v43-random-kit';

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

/** A color as `digits` hex digits. */
const hex = (r: Random, digits: number): string => Array.from({ length: digits }, () => r.pick([...HEX])).join('');

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
            ...(r.chance(0.5) ? { color: hex(r, 8) } : {}),
            ...(r.chance(0.5) ? { dark: hex(r, 6) } : {}),
        });
        draft.dark.push(slots[s]?.dark !== undefined);
        attachments[`s${s}`] = { p0: p0.path, p1: p1.path };
        if (r.chance(0.5)) other[`s${s}`] = { p0: randomPath(draft).path };
        draft.deforms.push([p0.deform, p1.deform]);
    }
    draft.slots = count;

    return { slots, attachments, other };
}

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

/** One color timeline of a slot, or none: a light color, its parts, or a light and a dark color. */
function colorTimelines(r: Random, dark: boolean): Json {
    const roll = r.next();

    if (roll < 0.15) return { rgba: keys(r, 3, 4, () => ({ color: hex(r, 8) })) };
    if (roll < 0.25) return { rgb: keys(r, 2, 3, () => ({ color: hex(r, 6) })) };
    if (roll < 0.35) return { alpha: keys(r, 2, 1, () => ({ value: r.range(0, 1) })) };
    if (roll < 0.45 && dark) return { rgba2: keys(r, 2, 7, () => ({ light: hex(r, 8), dark: hex(r, 6) })) };
    if (roll < 0.55 && dark) return { rgb2: keys(r, 2, 6, () => ({ light: hex(r, 6), dark: hex(r, 6) })) };

    return {};
}

/** Draw order keys that swap two slots, or put the setup order back. */
function drawOrderKeys(r: Random, slots: number): Json[] {
    return times(r, 3).map((time) => {
        const first = r.int(slots - 1);
        const second = first + 1 + r.int(slots - first - 1);

        if (r.chance(0.25)) return { time };

        return {
            time,
            offsets: [
                { slot: `s${first}`, offset: second - first },
                { slot: `s${second}`, offset: first - second },
            ],
        };
    });
}

/** An animation that keys bones, slots, constraint poses, the draw order, the paths the slots show and their deforms. */
function randomAnimation(draft: Draft): Json {
    const { r } = draft;
    const bones: Json = {};
    const keyed: Record<string, Json> = { ik: {}, transform: {}, path: {}, physics: {}, slider: {} };
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

        slots[`s${s}`] = {
            ...(r.chance(0.4) ? { attachment: keys(r, 3, 0, () => ({ name: name() })) } : {}),
            ...colorTimelines(r, draft.dark[s] === true),
        };
        if (r.chance(0.5))
            deforms[`s${s}`] = { [`p${which}`]: { deform: keys(r, 3, 1, () => ({ vertices: vertices() })) } };
    });
    // keys for every physics constraint at once: they move those whose data has the global flag
    if (keyed.physics && r.chance(0.4) && draft.constraints.some((each) => each.type === 'physics'))
        keyed.physics[''] = physicsKeys(r);

    return {
        bones,
        ...keyed,
        slots,
        attachments: { default: deforms },
        ...(r.chance(0.4) ? { drawOrder: drawOrderKeys(r, draft.slots) } : {}),
    };
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

/** The JSON of a random 4.3 skeleton. The same seed makes the same skeleton. */
export function randomRig(seed: number): string {
    const draft: Draft = {
        r: random(seed),
        bones: [],
        parents: [],
        gated: [],
        slots: 0,
        dark: [],
        deforms: [],
        constraints: [],
    };

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
