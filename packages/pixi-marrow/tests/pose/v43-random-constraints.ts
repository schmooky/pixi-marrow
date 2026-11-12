import { type Draft, type Json, keys, MIXES, type Random, SIX, times } from './v43-random-kit';

/*
 * The constraints of the random 4.3 skeletons, and the keys that animate their poses.
 */

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

const PHYSICS_VALUES = ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'];

/** A physics constraint that moves, turns, scales and shears its bone, each now and then not at all. */
function randomPhysics(draft: Draft, name: string): Json {
    const { r } = draft;
    const part = (): number => r.pick([0, 1, 1, 0.5]);
    const constraint: Json = {
        type: 'physics',
        name,
        bone: `b${r.chance(0.1) ? 0 : below(draft)}`,
        x: part(),
        y: part(),
        rotate: part(),
        scaleX: part(),
        shearX: r.chance(0.3) ? r.range(0.1, 1) : 0,
        scaleY: r.pick(['none', 'uniform', 'volume']),
        limit: r.chance(0.5) ? r.range(20, 600) : 5000,
        fps: r.pick([60, 60, 30, 100]),
        inertia: r.range(0, 1),
        strength: r.range(0, 200),
        damping: r.range(0.5, 1),
        mass: r.range(0.5, 4),
        wind: r.chance(0.5) ? r.range(-20, 20) : 0,
        gravity: r.chance(0.5) ? r.range(-20, 20) : 0,
        mix: r.chance(0.1) ? 0 : r.range(0.2, 1),
    };

    for (const value of PHYSICS_VALUES) constraint[`${value}Global`] = r.chance(0.4);

    return constraint;
}

/** A slider that plays one of the first two animations, by its own time or by a property of a bone. */
function randomSlider(draft: Draft, name: string): Json {
    const { r } = draft;
    const driven = r.chance(0.6)
        ? {
              bone: `b${r.int(draft.bones.length)}`,
              property: r.pick(SIX),
              local: r.chance(0.5),
              from: r.chance(0.5) ? r.range(-20, 20) : 0,
              to: r.chance(0.5) ? r.range(0, 0.6) : 0,
              scale: r.pick([1, 0.01, -0.02, 0.3]),
          }
        : { time: r.range(0, 1.2) };

    return {
        type: 'slider',
        name,
        animation: `a${r.int(2)}`,
        loop: r.chance(0.4),
        additive: r.chance(0.3),
        mix: r.chance(0.1) ? 0 : r.range(0.2, 1),
        ...driven,
    };
}

/** One constraint of a random kind. */
export function randomConstraint(draft: Draft, name: string): Json {
    const { r } = draft;
    const roll = r.next();
    const skin = r.chance(0.2);

    if (roll < 0.25) return { ...randomIk(draft, name), skin };
    if (roll < 0.5) return { ...randomTransform(draft, name), skin };
    if (roll < 0.7) return { ...randomPathConstraint(draft, name), skin };
    if (roll < 0.85) return { ...randomPhysics(draft, name), skin };

    return { ...randomSlider(draft, name), skin };
}

/** Keys for some of the numbers of the pose of a physics constraint, and now and then keys that reset it. */
export function physicsKeys(r: Random): Json {
    const timelines: Json = {};

    for (const value of PHYSICS_VALUES) {
        if (!r.chance(0.35)) continue;
        // a mass is above 0. A damping and a mix are up to 1
        const [low, high] = value === 'mass' ? [0.5, 4] : value === 'damping' || value === 'mix' ? [0, 1] : [-30, 60];

        timelines[value] = keys(r, 3, 1, () => ({ value: r.range(low, high) }));
    }
    if (r.chance(0.3)) timelines.reset = times(r, 2).map((time) => ({ time }));

    return timelines;
}

/** Keys for the pose of one constraint, in the words of its kind. */
export function constraintKeys(r: Random, constraint: Json): unknown {
    const mixes = (names: string[], low: number) => (): Json =>
        Object.fromEntries(names.map((name) => [name, r.range(low, 1)]));

    if (constraint.type === 'ik') {
        const flags = (): Json => ({ bendPositive: r.chance(0.5), compress: r.chance(0.3), stretch: r.chance(0.3) });
        const softness = (): number => (r.chance(0.5) ? 0 : r.range(0, 20));

        return keys(r, 3, 2, () => ({ mix: r.chance(0.15) ? 0 : r.range(0, 1), softness: softness(), ...flags() }));
    }
    if (constraint.type === 'transform') return keys(r, 3, 6, mixes(MIXES, -0.5));
    if (constraint.type === 'physics') return physicsKeys(r);
    if (constraint.type === 'slider') {
        return {
            ...(r.chance(0.7) ? { time: keys(r, 3, 1, () => ({ value: r.range(0, 1.2) })) } : {}),
            ...(r.chance(0.7) ? { mix: keys(r, 2, 1, () => ({ value: r.range(0, 1) })) } : {}),
        };
    }
    const [low, high] = constraint.positionMode === 'percent' ? [-0.5, 1.5] : [-50, 200];

    return {
        position: keys(r, 3, 1, () => ({ value: r.range(low ?? 0, high ?? 1) })),
        spacing: keys(r, 2, 1, () => ({ value: r.range(-5, 30) })),
        ...(r.chance(0.5) ? { mix: keys(r, 3, 3, mixes(['mixRotate', 'mixX', 'mixY'], 0)) } : {}),
    };
}
