import { MarrowError } from '../base/errors';
import { f64 } from './read';

/*
 * Convex polygons for tight outlines: the hull of a point set, and the cheapest polygon with few
 * vertices around a hull. Points are x, y pairs. A polygon lists its vertices so that the
 * shoelace sum is positive: clockwise on a page, where y points down.
 */

/** Outline vertices lie on a grid of this many steps per pixel. 32-bit floats hold such numbers exactly. */
const GRID = 16;
/** A coordinate this close to a grid line, in grid steps, counts as on it. */
const GRID_SLACK = 1e-9;
/** The fewest vertices {@link reduceConvexPolygon} can reduce to: the bounding box. */
const MIN_VERTICES = 4;

/**
 * The area of a polygon, of either winding.
 *
 * @example
 * polygonArea(Float64Array.of(0, 0, 4, 0, 4, 3, 0, 3), 4); // 12
 */
export function polygonArea(points: ArrayLike<number>, count: number): number {
    let sum = 0;

    for (let i = 0; i < count; i++) {
        const next = i + 1 === count ? 0 : i + 1;

        sum += (points[i * 2] ?? 0) * (points[next * 2 + 1] ?? 0) - (points[next * 2] ?? 0) * (points[i * 2 + 1] ?? 0);
    }

    return Math.abs(sum) / 2;
}

/**
 * Writes the convex hull of `count` points to `out` and returns its vertex count. The hull starts
 * at the leftmost point and has a positive shoelace sum. Points on an edge are left out. Fewer
 * than 3 vertices come back when all points lie on one line. `out` needs room for `count` points.
 *
 * @example
 * const hull = new Float64Array(8);
 * const count = convexHull(Float64Array.of(0, 0, 2, 0, 1, 1, 2, 2, 0, 2), 5, hull); // 4
 */
export function convexHull(points: Float64Array, count: number, out: Float64Array): number {
    const order = new Uint32Array(count);
    const stack = new Uint32Array(count + 1);
    let size = 0;

    for (let i = 0; i < count; i++) order[i] = i;
    order.sort((a, b) => f64(points, a * 2) - f64(points, b * 2) || f64(points, a * 2 + 1) - f64(points, b * 2 + 1));
    /** Adds a point, after it removed the points that would make a right turn or none. */
    const push = (point: number, floor: number): void => {
        const x = f64(points, point * 2);
        const y = f64(points, point * 2 + 1);

        while (size >= floor) {
            const a = (stack[size - 2] ?? 0) * 2;
            const b = (stack[size - 1] ?? 0) * 2;
            const ax = f64(points, a);
            const ay = f64(points, a + 1);

            if ((f64(points, b) - ax) * (y - ay) - (f64(points, b + 1) - ay) * (x - ax) > 0) break;
            size--;
        }
        stack[size++] = point;
    };

    for (let i = 0; i < count; i++) push(order[i] ?? 0, 2);
    const floor = size + 1;

    for (let i = count - 2; i >= 0; i--) push(order[i] ?? 0, floor);
    // the last point is the first one again
    size = Math.max(size - 1, Math.min(count, 1));
    for (let i = 0; i < size; i++) {
        const point = (stack[i] ?? 0) * 2;

        out[i * 2] = f64(points, point);
        out[i * 2 + 1] = f64(points, point + 1);
    }

    return size;
}

/**
 * The lines a reduced polygon can keep, in the order of their direction. Every hull edge is one.
 * The four sides of the bounding box are always kept: a side the hull touches in one point only
 * is a line without length. Positions are relative to the top left corner of the bounding box.
 */
interface Lines {
    count: number;
    /** The vertex count of the hull. Vertex `hull` is vertex 0 again. */
    hull: number;
    /** Per hull vertex, from the first line on and once around: x, then y. One vertex more closes the chain. */
    vx: Float64Array;
    vy: Float64Array;
    /** Per vertex: the shoelace sum of the chain up to it. */
    sums: Float64Array;
    /** Per line: the vertex where it meets the hull first, and last. */
    from: Int32Array;
    to: Int32Array;
    /** Per line: its direction. */
    dx: Float64Array;
    dy: Float64Array;
    /** The lines of the four sides: top, right, bottom, left. A fifth item closes the round. */
    sides: Int32Array;
}

/** 0, 2, 4, 6 for an edge along the top, right, bottom and left side. The odd numbers are the corners between. */
function sectorOf(dx: number, dy: number): number {
    if (dy === 0) return dx > 0 ? 0 : 4;
    if (dx === 0) return dy > 0 ? 2 : 6;
    if (dy > 0) return dx > 0 ? 1 : 3;

    return dx < 0 ? 5 : 7;
}

/** The directions of the four sides, by sector / 2. */
const SIDE_DX: readonly number[] = [1, 0, -1, 0];
const SIDE_DY: readonly number[] = [0, 1, 0, -1];

/** The hull edge after which the sectors start again at their lowest. */
function firstEdge(hull: Float64Array, count: number): number {
    let last = -1;

    for (let i = 0; i <= count; i++) {
        const a = (i % count) * 2;
        const b = ((i + 1) % count) * 2;
        const sector = sectorOf(f64(hull, b) - f64(hull, a), f64(hull, b + 1) - f64(hull, a + 1));

        if (sector < last) return i % count;
        last = sector;
    }

    return 0;
}

function buildLines(hull: Float64Array, count: number, minX: number, minY: number): Lines {
    const start = firstEdge(hull, count);
    const lines: Lines = {
        count: 0,
        hull: count,
        vx: new Float64Array(count + 1),
        vy: new Float64Array(count + 1),
        sums: new Float64Array(count + 1),
        from: new Int32Array(count + 4),
        to: new Int32Array(count + 4),
        dx: new Float64Array(count + 4),
        dy: new Float64Array(count + 4),
        sides: new Int32Array(5),
    };
    const { vx, vy, sums } = lines;
    const add = (from: number, to: number, dx: number, dy: number): void => {
        lines.from[lines.count] = from;
        lines.to[lines.count] = to;
        lines.dx[lines.count] = dx;
        lines.dy[lines.count++] = dy;
    };
    let side = 0;
    /** Adds the sides up to a sector as lines without length at a vertex. */
    const addSides = (before: number, vertex: number): void => {
        for (; side * 2 < before; side++) {
            lines.sides[side] = lines.count;
            add(vertex, vertex, SIDE_DX[side] ?? 0, SIDE_DY[side] ?? 0);
        }
    };

    for (let i = 0; i <= count; i++) {
        const at = ((start + i) % count) * 2;

        vx[i] = f64(hull, at) - minX;
        vy[i] = f64(hull, at + 1) - minY;
        if (i > 0) sums[i] = f64(sums, i - 1) + f64(vx, i - 1) * f64(vy, i) - f64(vx, i) * f64(vy, i - 1);
    }
    for (let i = 0; i < count; i++) {
        const dx = f64(vx, i + 1) - f64(vx, i);
        const dy = f64(vy, i + 1) - f64(vy, i);
        const sector = sectorOf(dx, dy);

        addSides(sector, i);
        if (sector === side * 2) lines.sides[side++] = lines.count;
        add(i, i + 1, dx, dy);
    }
    addSides(8, count);
    lines.sides[4] = lines.count;

    return lines;
}

/** Where two kept lines that follow each other meet, and the area between them and the hull. */
interface Corner {
    x: number;
    y: number;
    area: number;
    /** True for a vertex of the hull, which needs no rounding. */
    exact: boolean;
}

/**
 * The corner between line `i` and a later line `j` when no line between them is kept. Line
 * `lines.count` is line 0 after one round. `corner` is filled and returned.
 */
function cornerOf(lines: Lines, i: number, j: number, corner: Corner): Corner {
    const { vx, vy } = lines;
    const wrapped = j === lines.count;
    const line = wrapped ? 0 : j;
    const b = lines.to[i] ?? 0;
    const a = (lines.from[line] ?? 0) + (wrapped ? lines.hull : 0);
    const bx = f64(vx, b);
    const by = f64(vy, b);

    corner.exact = a === b;
    corner.area = 0;
    corner.x = bx;
    corner.y = by;
    if (corner.exact) return corner;
    const ax = f64(vx, a);
    const ay = f64(vy, a);
    const dx = f64(lines.dx, i);
    const dy = f64(lines.dy, i);
    const ex = f64(lines.dx, line);
    const ey = f64(lines.dy, line);
    // the two lines turn by 90 degrees at most, so they meet
    const t = ((ax - bx) * ey - (ay - by) * ex) / (dx * ey - dy * ex);

    corner.x = bx + t * dx;
    corner.y = by + t * dy;
    const triangle = Math.abs((corner.x - bx) * (ay - by) - (corner.y - by) * (ax - bx));
    const cap = f64(lines.sums, a) - f64(lines.sums, b) + ax * by - bx * ay;

    corner.area = Math.max(0, (triangle - cap) / 2);

    return corner;
}

/** The best choice of lines inside one corner of the bounding box, for every number of lines. */
interface CornerPlan {
    /** The side the corner starts at, and the number of lines between it and the next side. */
    first: number;
    lines: number;
    /** Per number of kept lines: the least area added. */
    best: Float64Array;
    /** Per number of kept lines: the last kept line. Lines count from 1. */
    last: Int32Array;
    /** Per number of kept lines and per line: the kept line before it, or 0. */
    before: Int32Array;
}

/**
 * Finds, for one corner of the bounding box and every budget up to `most`, the lines to keep so
 * that the least area is added. Exact: it tries every choice through dynamic programming.
 */
function planCorner(lines: Lines, first: number, end: number, most: number, corner: Corner): CornerPlan {
    const candidates = end - first - 1;
    const kMax = Math.min(most, candidates);
    const width = candidates + 2;
    const cost = new Float64Array((kMax + 1) * width).fill(Number.POSITIVE_INFINITY);
    const plan: CornerPlan = {
        first,
        lines: candidates,
        best: new Float64Array(kMax + 1).fill(Number.POSITIVE_INFINITY),
        last: new Int32Array(kMax + 1),
        before: new Int32Array((kMax + 1) * width),
    };

    plan.best[0] = cornerOf(lines, first, end, corner).area;
    for (let k = 1; k <= kMax; k++) {
        for (let j = k; j <= candidates; j++) {
            let least = k === 1 ? cornerOf(lines, first, first + j, corner).area : Number.POSITIVE_INFINITY;
            let from = 0;

            for (let i = k - 1; k > 1 && i < j; i++) {
                const area = f64(cost, (k - 1) * width + i) + cornerOf(lines, first + i, first + j, corner).area;

                if (area < least) {
                    least = area;
                    from = i;
                }
            }
            cost[k * width + j] = least;
            plan.before[k * width + j] = from;
            const total = least + cornerOf(lines, first + j, end, corner).area;

            if (total < f64(plan.best, k)) {
                plan.best[k] = total;
                plan.last[k] = j;
            }
        }
    }

    return plan;
}

/** How many lines each corner keeps so that the four corners together add the least area. */
function shareBudget(plans: readonly CornerPlan[], budget: number): Int32Array {
    const width = budget + 1;
    const least = new Float64Array((plans.length + 1) * width);
    const pick = new Int32Array(plans.length * width);
    const kept = new Int32Array(plans.length);

    plans.forEach((plan, q) => {
        for (let k = 0; k <= budget; k++) {
            let best = Number.POSITIVE_INFINITY;

            for (let own = 0; own <= Math.min(k, plan.best.length - 1); own++) {
                const area = f64(least, q * width + k - own) + f64(plan.best, own);

                if (area < best) {
                    best = area;
                    pick[q * width + k] = own;
                }
            }
            least[(q + 1) * width + k] = best;
        }
    });
    for (let q = plans.length - 1, left = budget; q >= 0; q--) {
        kept[q] = pick[q * width + left] ?? 0;
        left -= kept[q] ?? 0;
    }

    return kept;
}

/** Moves a coordinate to the grid, away from the polygon: up for a positive direction. */
function snap(value: number, direction: number): number {
    const steps = value * GRID;

    return (direction > 0 ? Math.ceil(steps - GRID_SLACK) : Math.floor(steps + GRID_SLACK)) / GRID;
}

/**
 * Writes a convex polygon with at most `maxVertices` vertices that contains the convex polygon
 * `hull`, and returns its vertex count. The result never leaves the bounding box of the hull.
 *
 * The result keeps the four sides of the bounding box and the lines of up to `maxVertices - 4`
 * hull edges. Dropping a line only grows the polygon. Of all choices of lines the one with the
 * least area is taken: every choice is weighed, not the next cheapest edge at each step. New
 * vertices are then moved outward to a grid of 1/16 pixel. A hull that is small enough comes
 * back unchanged.
 *
 * `hull` is a polygon as {@link convexHull} writes it. `out` needs room for `maxVertices` points,
 * or for the hull when that has fewer. Throws a {@link MarrowError} for a `maxVertices` below 4.
 *
 * @example
 * const octagon = new Float64Array(16);
 * const count = reduceConvexPolygon(hull, hullCount, 8, octagon);
 */
export function reduceConvexPolygon(hull: Float64Array, count: number, maxVertices: number, out: Float64Array): number {
    if (!Number.isInteger(maxVertices) || maxVertices < MIN_VERTICES) {
        throw new MarrowError('invalid-data', `An outline cannot be reduced to ${maxVertices} vertices.`, {
            fix: `Pass a whole number of at least ${MIN_VERTICES} as maxVertices.`,
        });
    }
    if (count <= maxVertices || count < 3) {
        out.set(hull.subarray(0, count * 2));

        return count;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < count; i++) {
        minX = Math.min(minX, f64(hull, i * 2));
        maxX = Math.max(maxX, f64(hull, i * 2));
        minY = Math.min(minY, f64(hull, i * 2 + 1));
        maxY = Math.max(maxY, f64(hull, i * 2 + 1));
    }
    const lines = buildLines(hull, count, minX, minY);
    const corner: Corner = { x: 0, y: 0, area: 0, exact: true };
    const plans = [0, 1, 2, 3].map((q) =>
        planCorner(lines, lines.sides[q] ?? 0, lines.sides[q + 1] ?? 0, maxVertices - MIN_VERTICES, corner),
    );
    const kept = shareBudget(plans, maxVertices - MIN_VERTICES);
    const points = new Float64Array(maxVertices * 2);
    let size = 0;

    plans.forEach((plan, q) => {
        // the corner of the bounding box the lines of this plan cut off: right first, then down
        const towardX = q < 2 ? 1 : -1;
        const towardY = q === 1 || q === 2 ? 1 : -1;
        const width = plan.lines + 2;
        const chosen: number[] = [plan.lines + 1];

        for (let k = kept[q] ?? 0, j = plan.last[k] ?? 0; k > 0; j = plan.before[k * width + j] ?? 0, k--) {
            chosen.push(j);
        }
        chosen.push(0);
        for (let i = chosen.length - 1; i > 0; i--) {
            cornerOf(lines, plan.first + (chosen[i] ?? 0), plan.first + (chosen[i - 1] ?? 0), corner);
            const x = corner.exact ? corner.x + minX : snap(corner.x + minX, towardX);
            const y = corner.exact ? corner.y + minY : snap(corner.y + minY, towardY);

            points[size++] = Math.min(maxX, Math.max(minX, x));
            points[size++] = Math.min(maxY, Math.max(minY, y));
        }
    });

    // rounding can bend an edge inward by a hair: the hull of the vertices is convex again
    return convexHull(points, size / 2, out);
}
