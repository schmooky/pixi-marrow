import { MarrowError } from '../../base/errors';
import type { PathAttachmentData } from '../../model/attachments';
import { computeWorldVertices } from '../shared/vertices';
import {
    CONSTRAINT_STRIDE,
    type LegacyConstraint,
    PATH_POSITION,
    POSITION_PERCENT,
    SPACING_PERCENT,
    SPACING_PROPORTIONAL,
} from './constraints';
import {
    addAfterPosition,
    addBeforePosition,
    addCurvePosition,
    findCurve,
    measureCurves,
    measureSegments,
} from './path-curves';
import { CURVE_LENGTH, MULTIPLIER, num, PATH_LENGTH, PLACE, pathScratch, sizeWorld } from './path-scratch';
import type { Solver } from './solver';

/*
 * The official `PathConstraint.computeWorldPositions`: where the bones go along the path. The
 * arrays it fills are in `pathScratch`.
 */

const NONE = -1;
const BEFORE = -2;
const AFTER = -3;

const NO_DEFORM = new Float64Array(0);

function badPath(constraint: LegacyConstraint, path: PathAttachmentData): MarrowError {
    // the official runtime crashes here, on an array with a length that is not a count
    return new MarrowError(
        'invalid-data',
        `The path constraint "${constraint.name}" follows the path "${path.name}", which has ${path.worldVerticesLength / 2} vertices.`,
        { fix: 'A path needs three vertices for every point: the handle before, the point and the handle after.' },
    );
}

/** Writes world vertices of the path into `world`: the official `path.computeWorldVertices(target, ...)`. */
function worldVertices(
    solver: Solver,
    constraint: LegacyConstraint,
    path: PathAttachmentData,
    world: Float64Array,
    start: number,
    count: number,
    offset: number,
): void {
    const pose = solver.pose;
    const slot = constraint.target;
    const deform = pose.deform[slot] ?? NO_DEFORM;

    computeWorldVertices(
        path,
        pose.world,
        constraint.targetBone,
        deform,
        pose.deformLengths[slot] ?? 0,
        world,
        offset,
        2,
        start,
        count,
    );
}

/**
 * The start of both kinds of path, once `num[PATH_LENGTH]` is known. The official `multiplier`
 * of the spacing mode goes to `num[MULTIPLIER]`. The position of the constraint goes to
 * `num[PLACE]`, as a length along the path.
 */
function startPositions(solver: Solver, constraint: LegacyConstraint, spacesCount: number): void {
    const pathLength = Number(num[PATH_LENGTH]);
    const position = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + PATH_POSITION]);

    num[PLACE] = constraint.positionMode === POSITION_PERCENT ? position * pathLength : position;
    if (constraint.spacingMode === SPACING_PERCENT) num[MULTIPLIER] = pathLength;
    else if (constraint.spacingMode === SPACING_PROPORTIONAL) num[MULTIPLIER] = pathLength / spacesCount;
    else num[MULTIPLIER] = 1;
}

/** Reads the world vertices of one curve of a path without constant speed into `world`. */
function loadCurve(
    solver: Solver,
    constraint: LegacyConstraint,
    path: PathAttachmentData,
    world: Float64Array,
    curve: number,
    curveCount: number,
): void {
    const verticesLength = path.worldVerticesLength;

    if (path.closed && curve === curveCount) {
        worldVertices(solver, constraint, path, world, verticesLength - 4, 4, 0);
        worldVertices(solver, constraint, path, world, 0, 4, 4);
    } else {
        worldVertices(solver, constraint, path, world, curve * 6 + 2, 8, 0);
    }
}

/**
 * A place before the start or after the end of an open path without constant speed, which lies
 * on the line through the handle at that end. The place is `num[PLACE]`. Returns `BEFORE` or
 * `AFTER`, the end whose vertices `world` now holds, or `NONE` for a place on the path.
 */
function addOffPathPosition(
    solver: Solver,
    constraint: LegacyConstraint,
    path: PathAttachmentData,
    world: Float64Array,
    prevCurve: number,
    o: number,
): number {
    const p = Number(num[PLACE]);
    const pathLength = Number(num[PATH_LENGTH]);

    if (p < 0) {
        if (prevCurve !== BEFORE) worldVertices(solver, constraint, path, world, 2, 4, 0);
        addBeforePosition(world, 0, pathScratch.positions, o);

        return BEFORE;
    }
    if (p > pathLength) {
        if (prevCurve !== AFTER) worldVertices(solver, constraint, path, world, path.worldVerticesLength - 6, 4, 0);
        num[PLACE] = p - pathLength;
        addAfterPosition(world, 0, pathScratch.positions, o);

        return AFTER;
    }

    return NONE;
}

/**
 * The positions along a path that is not at constant speed: the editor stored the length of each
 * curve, and a place is spread evenly over the curve parameter.
 */
function positionsByStoredLengths(
    solver: Solver,
    constraint: LegacyConstraint,
    path: PathAttachmentData,
    spacesCount: number,
    tangents: boolean,
): void {
    const { closed, lengths } = path;
    const verticesLength = path.worldVerticesLength;
    const curveCount = verticesLength / 6 - (closed ? 1 : 2);
    const pathLength = Number(lengths[curveCount]);
    const world = sizeWorld(8);
    const { spaces, positions: out } = pathScratch;
    let prevCurve = NONE;

    num[PATH_LENGTH] = pathLength;
    startPositions(solver, constraint, spacesCount);
    const multiplier = Number(num[MULTIPLIER]);
    let position = Number(num[PLACE]);

    for (let i = 0, o = 0, curve = 0; i < spacesCount; i++, o += 3) {
        const space = Number(spaces[i]) * multiplier;

        position += space;
        let p = position;

        if (closed) {
            p %= pathLength;
            if (p < 0) p += pathLength;
            curve = 0;
            num[PLACE] = p;
        } else {
            num[PLACE] = p;
            const end = addOffPathPosition(solver, constraint, path, world, prevCurve, o);

            if (end !== NONE) {
                prevCurve = end;
                continue;
            }
        }
        curve = findCurve(lengths, curve);
        if (curve !== prevCurve) {
            prevCurve = curve;
            loadCurve(solver, constraint, path, world, curve, curveCount);
        }
        addCurvePosition(world, 0, out, o, tangents || (i > 0 && space === 0));
    }
}

/**
 * Reads every world vertex of a path at constant speed into `world`, from the first point to the
 * last. A closed path ends with its first point again. Returns the official `verticesLength`.
 */
function loadPath(solver: Solver, constraint: LegacyConstraint, path: PathAttachmentData): number {
    let verticesLength = path.worldVerticesLength;

    if (path.closed) {
        verticesLength += 2;
        const world = sizeWorld(verticesLength);

        worldVertices(solver, constraint, path, world, 2, verticesLength - 4, 0);
        worldVertices(solver, constraint, path, world, 0, 2, verticesLength - 4);
        world[verticesLength - 2] = Number(world[0]);
        world[verticesLength - 1] = Number(world[1]);
    } else {
        verticesLength -= 4;
        worldVertices(solver, constraint, path, sizeWorld(verticesLength), 2, verticesLength, 0);
    }

    return verticesLength;
}

/**
 * The positions along a path at constant speed: the curves are measured in world space, and a
 * place is spread over a curve by the lengths of its ten segments.
 */
function positionsAtConstantSpeed(
    solver: Solver,
    constraint: LegacyConstraint,
    path: PathAttachmentData,
    spacesCount: number,
    tangents: boolean,
): void {
    const closed = path.closed;
    const verticesLength = loadPath(solver, constraint, path);

    measureCurves(path.worldVerticesLength / 6 - (closed ? 0 : 1));
    startPositions(solver, constraint, spacesCount);
    const { spaces, positions: out, world, curves, segments } = pathScratch;
    const pathLength = Number(num[PATH_LENGTH]);
    const multiplier = Number(num[MULTIPLIER]);
    let position = Number(num[PLACE]);
    let prevCurve = NONE;
    let curveLength = 0;
    // the eight numbers of the curve whose segments are measured
    let x1 = 0;
    let y1 = 0;
    let cx1 = 0;
    let cy1 = 0;
    let cx2 = 0;
    let cy2 = 0;
    let x2 = 0;
    let y2 = 0;

    // one loop holds the official steps, so that the place it works on stays in a register
    for (let i = 0, o = 0, curve = 0, segment = 0; i < spacesCount; i++, o += 3) {
        const space = Number(spaces[i]) * multiplier;

        position += space;
        let p = position;

        if (closed) {
            p %= pathLength;
            if (p < 0) p += pathLength;
            curve = 0;
        } else if (p < 0) {
            num[PLACE] = p;
            addBeforePosition(world, 0, out, o);
            continue;
        } else if (p > pathLength) {
            num[PLACE] = p - pathLength;
            addAfterPosition(world, verticesLength - 4, out, o);
            continue;
        }
        // the curve that holds the place, and how far the place is along it
        while (p > Number(curves[curve])) curve++;
        if (curve === 0) p /= Number(curves[curve]);
        else {
            const prev = Number(curves[curve - 1]);

            p = (p - prev) / (Number(curves[curve]) - prev);
        }
        if (curve !== prevCurve) {
            const w = curve * 6;

            prevCurve = curve;
            measureSegments(world, w);
            curveLength = Number(num[CURVE_LENGTH]);
            segment = 0;
            x1 = Number(world[w]);
            y1 = Number(world[w + 1]);
            cx1 = Number(world[w + 2]);
            cy1 = Number(world[w + 3]);
            cx2 = Number(world[w + 4]);
            cy2 = Number(world[w + 5]);
            x2 = Number(world[w + 6]);
            y2 = Number(world[w + 7]);
        }
        // the place as a length along the curve, then as the curve parameter by the lengths of the ten segments
        p *= curveLength;
        while (p > Number(segments[segment])) segment++;
        if (segment === 0) p /= Number(segments[segment]);
        else {
            const prev = Number(segments[segment - 1]);

            p = segment + (p - prev) / (Number(segments[segment]) - prev);
        }
        p *= 0.1;
        // the official addCurvePosition
        if (p === 0 || Number.isNaN(p)) {
            out[o] = x1;
            out[o + 1] = y1;
            out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
            continue;
        }
        const tt = p * p;
        const ttt = tt * p;
        const u = 1 - p;
        const uu = u * u;
        const uuu = uu * u;
        const ut = u * p;
        const ut3 = ut * 3;
        const uut3 = u * ut3;
        const utt3 = ut3 * p;
        const x = x1 * uuu + cx1 * uut3 + cx2 * utt3 + x2 * ttt;
        const y = y1 * uuu + cy1 * uut3 + cy2 * utt3 + y2 * ttt;

        out[o] = x;
        out[o + 1] = y;
        if (!(tangents || (i > 0 && space === 0))) continue;
        if (p < 0.001) out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
        else out[o + 2] = Math.atan2(y - (y1 * uu + cy1 * ut * 2 + cy2 * tt), x - (x1 * uu + cx1 * ut * 2 + cx2 * tt));
    }
}

/**
 * The official `computeWorldPositions`: fills `pathScratch.positions` with x, y and rotation for
 * each of the `spacesCount` entries of `pathScratch.spaces`.
 *
 * Throws a {@link MarrowError} for a path whose vertices are not three per point. The official
 * runtime crashes on some of those and computes with numbers from outside the path on the others.
 */
export function computeWorldPositions(
    solver: Solver,
    constraint: LegacyConstraint,
    path: PathAttachmentData,
    spacesCount: number,
    tangents: boolean,
): void {
    const points = path.worldVerticesLength / 6;

    if (!Number.isInteger(points) || points < 1) throw badPath(constraint, path);
    if (path.constantSpeed) positionsAtConstantSpeed(solver, constraint, path, spacesCount, tangents);
    else positionsByStoredLengths(solver, constraint, path, spacesCount, tangents);
}
