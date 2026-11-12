import type { ClipCase, ClipSlot } from './clip-check';

/*
 * Seeded random cases for the CPU clip kernel: a clip polygon and the triangles of a slot. The
 * polygons are convex, concave, crossing themselves or without area, in both windings, tiny and
 * huge. The triangles are inside, outside, across one or several edges, on an edge or a corner of
 * the polygon, without area, and sometimes hold a number that is none.
 */

/** A generator of the same numbers on every run, 0 to 1. */
export function random(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Next = () => number;

/** One item of a list that is not empty. */
const pick = <T>(next: Next, items: readonly [T, ...T[]]): T => items[Math.floor(next() * items.length)] ?? items[0];

/** A convex polygon: corners on a circle at random angles. */
function convex(next: Next): number[] {
    const corners = 3 + Math.floor(next() * 10);
    const turn = next() * Math.PI * 2;
    const angles = Array.from({ length: corners }, (_, i) => turn - (2 * Math.PI * (i + next() * 0.9)) / corners);

    return angles.flatMap((angle) => [Math.cos(angle) * 10, Math.sin(angle) * 10]);
}

/** A rectangle with whole numbers, so that points can be on its edges exactly. */
function rectangle(next: Next): number[] {
    const x = Math.round(next() * 8) - 12;
    const y = Math.round(next() * 8) - 12;
    const w = 1 + Math.round(next() * 16);
    const h = 1 + Math.round(next() * 16);

    return [x, y, x, y + h, x + w, y + h, x + w, y];
}

/** A polygon around the origin with a random radius per corner: simple, and concave in many corners. */
function star(next: Next): number[] {
    const corners = 4 + Math.floor(next() * 20);

    return Array.from({ length: corners }, (_, i) => {
        const angle = (-2 * Math.PI * (i + next() * 0.8)) / corners;
        const radius = 2 + next() * 12;

        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }).flat();
}

const L_SHAPE = [0, 0, 0, 12, 6, 12, 6, 6, 12, 6, 12, 0];
const COMB = [0, 0, 0, 10, 2, 10, 2, 4, 4, 4, 4, 10, 6, 10, 6, 4, 8, 4, 8, 10, 10, 10, 10, 0];

/** Points in no order: the polygon crosses itself. */
const scattered = (next: Next): number[] =>
    Array.from({ length: (3 + Math.floor(next() * 8)) * 2 }, () => Math.round(next() * 24) - 12);

/** A polygon without area: its corners on one line, some of them twice. */
function flat(next: Next): number[] {
    const corners = 3 + Math.floor(next() * 5);
    const dx = Math.round(next() * 6) - 3;
    const dy = Math.round(next() * 6) - 3;

    return Array.from({ length: corners }, () => Math.round(next() * 4)).flatMap((step) => [step * dx, step * dy]);
}

/** One of the polygon shapes, around the origin and about 24 wide. */
function shape(next: Next): { kind: string; polygon: number[] } {
    const roll = next();

    if (roll < 0.25) return { kind: 'convex', polygon: convex(next) };
    if (roll < 0.4) return { kind: 'rectangle', polygon: rectangle(next) };
    if (roll < 0.7) return { kind: 'star', polygon: star(next) };
    if (roll < 0.8) return { kind: 'fixed', polygon: [...pick(next, [L_SHAPE, COMB])] };
    if (roll < 0.93) return { kind: 'scattered', polygon: scattered(next) };

    return { kind: 'flat', polygon: flat(next) };
}

/** Turns the order of the vertices around. */
function reversed(polygon: number[]): number[] {
    const out: number[] = [];

    for (let i = polygon.length - 2; i >= 0; i -= 2) out.push(polygon[i] ?? 0, polygon[i + 1] ?? 0);

    return out;
}

/** The sizes a case is scaled to. Most cases have the size of a skeleton. */
const SCALES = [1, 1, 1, 1, 37.5, 1e-6, 1e-3, 1e4, 1e9, 1e-30, 1e30] as const;

/** Where the triangles of a case are made: the polygon, its middle and half its size. */
interface Ground {
    polygon: readonly number[];
    x: number;
    y: number;
    box: number;
}

/** The corners of one triangle of a kind. */
function corners(next: Next, kind: string, { polygon, x, y, box }: Ground): number[] {
    const at = Math.floor((next() * polygon.length) / 2) * 2;
    const ax = polygon[at] ?? 0;
    const ay = polygon[at + 1] ?? 0;
    const bx = polygon[(at + 2) % polygon.length] ?? 0;
    const by = polygon[(at + 3) % polygon.length] ?? 0;
    const point = (spread: number): number[] => [x + (next() * 2 - 1) * spread, y + (next() * 2 - 1) * spread];
    const far = (): number[] => point(box).map((value) => value + box * 5);

    switch (kind) {
        case 'inside':
            return [...point(box * 0.1), ...point(box * 0.1), ...point(box * 0.1)];
        case 'outside':
            return [...far(), ...far(), ...far()];
        case 'cover':
            return [x - box * 9, y - box * 7, x + box * 9, y - box * 8, x + next() * box, y + box * 11];
        case 'corner':
            return [ax, ay, ...point(box * 1.5), ...point(box * 1.5)];
        case 'edge':
            return [ax, ay, bx, by, ...point(box * 1.5)];
        case 'on-edge':
            return [(ax + bx) / 2, (ay + by) / 2, ax + (bx - ax) / 4, ay + (by - ay) / 4, ...point(box * 1.5)];
        case 'line':
            return [ax, ay, (ax + bx) / 2, (ay + by) / 2, bx, by];
        case 'point':
            return [ax, ay, ax, ay, ax, ay];
        case 'level':
            // without area and along an axis, where the weights of a new vertex divide by a zero
            return next() < 0.5
                ? [ax, ay, ax + box * (next() - 0.3), ay, ax + box * (next() - 0.3), ay]
                : [ax, ay, ax, ay + box * (next() - 0.3), ax, ay + box * (next() - 0.3)];
        case 'sliver':
            return [ax, ay, bx, by, ax + (bx - ax) * next() * 1.5, ay + (by - ay) * next() * 1.5 + box * 1e-7];
        default:
            return [...point(box * 1.5), ...point(box * 1.5), ...point(box * 1.5)];
    }
}

const KINDS = [
    'inside',
    'outside',
    'cover',
    'corner',
    'edge',
    'on-edge',
    'line',
    'point',
    'sliver',
    'level',
    'across',
    'across',
    'across',
] as const;
const ODD = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 0] as const;

/** A slot of 1 to 12 triangles of random kinds, and some more between the vertices that are there. */
function slot(next: Next, ground: Ground): ClipSlot {
    const positions: number[] = [];
    const triangles: number[] = [];
    const count = 1 + Math.floor(next() * 12);

    for (let i = 0; i < count; i++) {
        const first = positions.length / 2;

        positions.push(...corners(next, pick(next, KINDS), ground));
        triangles.push(first, first + 1, first + 2);
    }
    for (let i = Math.floor(next() * 4); i > 0; i--) {
        for (let corner = 0; corner < 3; corner++) triangles.push(Math.floor((next() * positions.length) / 2));
    }
    // seldom a number no renderer should hand over
    if (next() < 0.03) positions[Math.floor(next() * positions.length)] = pick(next, ODD);

    // some texture coordinates leave 0 to 1, as those of a repeating texture do
    const wide = next() < 0.3 ? 3 : 1;

    return {
        positions: Float32Array.from(positions),
        uvs: Float32Array.from(positions, () => (next() - 0.5) * wide + 0.5),
        triangles: Uint16Array.from(triangles),
    };
}

/** A polygon of a random shape, size and place, in a random winding. */
function placedPolygon(next: Next): { kind: string; scale: number; polygon: number[]; ground: Ground } {
    const { kind, polygon: unit } = shape(next);
    const scale = pick(next, SCALES);
    const x = next() < 0.5 ? 0 : (next() * 200 - 100) * scale;
    const y = next() < 0.5 ? 0 : (next() * 200 - 100) * scale;
    // half of the polygons hold numbers a 32-bit position can hit exactly
    const round = next() < 0.5 ? Math.fround : (value: number): number => value;
    const placed = unit.map((value, i) => round(value * scale + (i % 2 === 0 ? x : y)));
    const polygon = next() < 0.5 ? placed : reversed(placed);

    return { kind, scale, polygon, ground: { polygon: [...polygon], x, y, box: 12 * scale } };
}

/** A random case with a label that names what it is made of. */
export function randomCase(next: Next): { label: string; clipCase: ClipCase } {
    const { kind, scale, polygon, ground } = placedPolygon(next);
    const slots = Array.from({ length: 1 + Math.floor(next() * 2) }, () => slot(next, ground));
    const inverse = next() < 0.25;
    const convexFlag = next() < 0.25;

    if (next() < 0.01) polygon[Math.floor(next() * polygon.length)] = pick(next, ODD);

    return {
        label: `${kind} of ${polygon.length / 2} at scale ${scale}${inverse ? ' inverse' : ''}${convexFlag ? ' convex' : ''}`,
        clipCase: { polygon, inverse, convex: convexFlag, slots },
    };
}

/** How wide a cluster is, as a share of the size of the polygon. */
const SPREADS = [0.0001, 0.01, 0.05, 0.2, 0.2, 0.5, 1, 2] as const;

/**
 * A slot whose triangles are close together: 1 to 8 of them in a box of a random size at a
 * random place, near the polygon or far from it. Some boxes start at a corner of the polygon,
 * and some hold whole numbers only, so that they touch the edges of a rectangle exactly.
 */
function cluster(next: Next, { polygon, x, y, box }: Ground): ClipSlot {
    const reach = next() < 0.3 ? 6 : 1.5;
    const corner = Math.floor((next() * polygon.length) / 2) * 2;
    const atCorner = next() < 0.15;
    const centerX = atCorner ? (polygon[corner] ?? 0) : x + (next() * 2 - 1) * box * reach;
    const centerY = atCorner ? (polygon[corner + 1] ?? 0) : y + (next() * 2 - 1) * box * reach;
    const size = box * pick(next, SPREADS);
    const whole = next() < 0.2 ? Math.round : (value: number): number => value;
    const positions: number[] = [];
    const count = (1 + Math.floor(next() * 8)) * 3;

    for (let i = 0; i < count; i++) {
        // a corner of the box, or a point in it
        const stepX = next() < 0.2 ? Math.round(next()) : next();
        const stepY = next() < 0.2 ? Math.round(next()) : next();

        positions.push(whole(centerX + (stepX - (atCorner ? 0 : 0.5)) * size));
        positions.push(whole(centerY + (stepY - (atCorner ? 0 : 0.5)) * size));
    }

    return {
        positions: Float32Array.from(positions),
        uvs: Float32Array.from(positions, () => next()),
        triangles: Uint16Array.from({ length: count }, (_, i) => i),
    };
}

/**
 * A random case for the verdict of the kernel: slots of triangles that are close together, so
 * that many of them are inside of one part of the polygon, or outside of all of it.
 */
export function clusterCase(next: Next): { label: string; clipCase: ClipCase } {
    const { kind, scale, polygon, ground } = placedPolygon(next);
    const slots = Array.from({ length: 4 }, () => cluster(next, ground));
    const inverse = next() < 0.25;
    const convexFlag = next() < 0.25;

    return {
        label: `clusters at a ${kind} of ${polygon.length / 2} at scale ${scale}${inverse ? ' inverse' : ''}${convexFlag ? ' convex' : ''}`,
        clipCase: { polygon, inverse, convex: convexFlag, slots },
    };
}

/**
 * The same polygon turned, scaled and put elsewhere, not mirrored. It moves a few times its own
 * size at most: far from the origin a small polygon would lose its shape to rounding.
 */
export function movedPolygon(next: Next, polygon: ArrayLike<number>): number[] {
    const angle = next() * Math.PI * 2;
    const scale = 0.25 + next() * 4;
    const cos = Math.cos(angle) * scale;
    const sin = Math.sin(angle) * scale;
    const reach = Array.from(polygon).reduce((most, value) => Math.max(most, Math.abs(value)), 0) * 5;
    const x = (next() * 2 - 1) * reach;
    const y = (next() * 2 - 1) * reach;
    const out: number[] = [];

    for (let i = 0; i < polygon.length; i += 2) {
        const px = polygon[i] ?? 0;
        const py = polygon[i + 1] ?? 0;

        out.push(px * cos - py * sin + x, px * sin + py * cos + y);
    }

    return out;
}

/** A case as text that can be pasted into a test. */
export function describeCase({ polygon, inverse, convex: convexFlag, slots }: ClipCase): string {
    const list = (values: ArrayLike<number>): string => `[${Array.from(values).join(', ')}]`;
    const lines = slots.map(
        (made) => `positions ${list(made.positions)} uvs ${list(made.uvs)} triangles ${list(made.triangles)}`,
    );

    return `polygon ${list(polygon)} inverse ${inverse} convex ${convexFlag} ${lines.join(' and ')}`;
}
