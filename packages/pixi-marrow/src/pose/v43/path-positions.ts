import type { PathAttachmentData } from '../../model/attachments';
import { computeWorldVertices } from '../shared/vertices';
import { PATH_POSITION, type PathPlan } from './solver-types';
import type { Pose43 } from './types';

/*
 * The official `PathConstraint.computeWorldPositions`: the points on a path where the bones of a
 * path constraint go. Every point takes three numbers in `positions`: x, y and the angle of the
 * path there in radians.
 *
 * A position on its way to a point is kept in the first number of the point. The numbers a loop
 * carries from point to point stay in the variables of one function. Typed arrays are read in
 * place, as `Number(array[i])`. solve.ts gives the reasons.
 */

/** No curve is loaded or measured yet. */
const NONE = -1;
/** The first tangent of an open path is loaded. */
const BEFORE = -2;
/** The last tangent of an open path is loaded. */
const AFTER = -3;
const SPACING_PERCENT = 2;
const SPACING_PROPORTIONAL = 3;

/** Stands in for the deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

/**
 * The official `VertexAttachment.computeWorldVertices` for the path in the slot of a constraint.
 * Writes `count` numbers from the vertex number `start` on to the world scratch at `offset`.
 */
function pathVertices(
    pose: Pose43,
    plan: PathPlan,
    path: PathAttachmentData,
    start: number,
    count: number,
    offset: number,
): void {
    const { state } = pose;
    const deform = state.deform[plan.slot] ?? NO_DEFORM;
    const length = Math.min(state.deformLengths[plan.slot] ?? 0, deform.length);

    computeWorldVertices(
        path,
        state.world,
        plan.slotBone,
        deform,
        length,
        pose.rig.solver.scratch.world,
        offset,
        2,
        start,
        count,
    );
}

/**
 * The official `addBeforePosition`: a point before the start of an open path, on its first
 * tangent. `out[o]` holds how far the point is from the start, which is a negative number.
 */
function addBeforePosition(temp: Float64Array, i: number, out: Float64Array, o: number): void {
    const p = Number(out[o]);
    const x1 = Number(temp[i]);
    const y1 = Number(temp[i + 1]);
    const dx = Number(temp[i + 2]) - x1;
    const dy = Number(temp[i + 3]) - y1;
    const r = Math.atan2(dy, dx);

    out[o] = x1 + p * Math.cos(r);
    out[o + 1] = y1 + p * Math.sin(r);
    out[o + 2] = r;
}

/**
 * The official `addAfterPosition`: a point after the end of an open path, on its last tangent.
 * `out[o]` holds how far the point is past the end.
 */
function addAfterPosition(temp: Float64Array, i: number, out: Float64Array, o: number): void {
    const p = Number(out[o]);
    const x1 = Number(temp[i + 2]);
    const y1 = Number(temp[i + 3]);
    const dx = x1 - Number(temp[i]);
    const dy = y1 - Number(temp[i + 1]);
    const r = Math.atan2(dy, dx);

    out[o] = x1 + p * Math.cos(r);
    out[o + 1] = y1 + p * Math.sin(r);
    out[o + 2] = r;
}

/**
 * The official `addCurvePosition`: a point on the curve whose eight numbers start at `w` in
 * `world`. `out[o]` holds where on the curve the point is, from 0 to 1. The angle is written only
 * when `tangents` is true.
 */
function addCurvePosition(world: Float64Array, w: number, out: Float64Array, o: number, tangents: boolean): void {
    const p = Number(out[o]);
    const x1 = Number(world[w]);
    const y1 = Number(world[w + 1]);
    const cx1 = Number(world[w + 2]);
    const cy1 = Number(world[w + 3]);

    if (p === 0 || Number.isNaN(p)) {
        out[o] = x1;
        out[o + 1] = y1;
        out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);

        return;
    }
    const cx2 = Number(world[w + 4]);
    const cy2 = Number(world[w + 5]);
    const x2 = Number(world[w + 6]);
    const y2 = Number(world[w + 7]);
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
    if (!tangents) return;
    if (p < 0.001) out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
    else out[o + 2] = Math.atan2(y - (y1 * uu + cy1 * ut * 2 + cy2 * tt), x - (x1 * uu + cx1 * ut * 2 + cx2 * tt));
}

/** Loads the vertices of the curve a position is on into the first eight numbers of the world scratch. */
function loadCurve(pose: Pose43, plan: PathPlan, path: PathAttachmentData, curve: number, last: number): void {
    const verticesLength = path.worldVerticesLength;

    if (path.closed && curve === last) {
        pathVertices(pose, plan, path, verticesLength - 4, 4, 0);
        pathVertices(pose, plan, path, 0, 4, 4);
    } else pathVertices(pose, plan, path, curve * 6 + 2, 8, 0);
}

/**
 * The positions on a path that is not at constant speed. The lengths the editor stored tell which
 * curve a position is on. The position on the curve is linear in the curve parameter.
 */
function positionsByStoredLengths(
    pose: Pose43,
    plan: PathPlan,
    path: PathAttachmentData,
    spacesCount: number,
    tangents: boolean,
): void {
    const { spaces, positions: out, world } = pose.rig.solver.scratch;
    const { lengths, closed } = path;
    const last = path.worldVerticesLength / 6 - (closed ? 1 : 2);
    const pathLength = Number(lengths[last]);
    let position = Number(pose.solve.applied[plan.at + PATH_POSITION]);
    let multiplier = 1;
    // the curve the last point was on, and what is loaded: a curve, `NONE`, `BEFORE` or `AFTER`
    let curve = 0;
    let loaded = NONE;

    if (plan.percentPosition) position *= pathLength;
    if (plan.spacingMode === SPACING_PERCENT) multiplier = pathLength;
    else if (plan.spacingMode === SPACING_PROPORTIONAL) multiplier = pathLength / spacesCount;
    for (let i = 0, o = 0; i < spacesCount; i++, o += 3) {
        const space = Number(spaces[i]) * multiplier;
        const angle = tangents || (i > 0 && space === 0);

        position += space;
        let p = position;

        if (closed) {
            p %= pathLength;
            if (p < 0) p += pathLength;
            curve = 0;
        } else if (p < 0) {
            if (loaded !== BEFORE) pathVertices(pose, plan, path, 2, 4, 0);
            loaded = BEFORE;
            out[o] = p;
            addBeforePosition(world, 0, out, o);
            continue;
        } else if (p > pathLength) {
            if (loaded !== AFTER) pathVertices(pose, plan, path, path.worldVerticesLength - 6, 4, 0);
            loaded = AFTER;
            out[o] = p - pathLength;
            addAfterPosition(world, 0, out, o);
            continue;
        }
        // the curve the position is on. Past the end of the lengths the comparison is false, as in the official loop.
        while (p > Number(lengths[curve])) curve++;
        const prev = curve === 0 ? 0 : Number(lengths[curve - 1]);

        out[o] = curve === 0 ? p / Number(lengths[curve]) : (p - prev) / (Number(lengths[curve]) - prev);
        if (curve !== loaded) loadCurve(pose, plan, path, curve, last);
        loaded = curve;
        addCurvePosition(world, 0, out, o, angle);
    }
}

/** Loads the vertices of the whole path into the world scratch. Returns how many numbers that is. */
function loadPath(pose: Pose43, plan: PathPlan, path: PathAttachmentData): number {
    const { world } = pose.rig.solver.scratch;
    let verticesLength = path.worldVerticesLength;

    if (path.closed) {
        verticesLength += 2;
        pathVertices(pose, plan, path, 2, verticesLength - 4, 0);
        pathVertices(pose, plan, path, 0, 2, verticesLength - 4);
        world[verticesLength - 2] = Number(world[0]);
        world[verticesLength - 1] = Number(world[1]);
    } else {
        verticesLength -= 4;
        pathVertices(pose, plan, path, 2, verticesLength, 0);
    }

    return verticesLength;
}

/**
 * Measures every curve of the path in the world scratch. Each entry of `curves` is the length up
 * to the end of a curve.
 */
function measureCurves(world: Float64Array, curveCount: number, curves: Float64Array): void {
    let pathLength = 0;
    let x1 = Number(world[0]);
    let y1 = Number(world[1]);

    for (let i = 0, w = 2; i < curveCount; i++, w += 6) {
        const cx1 = Number(world[w]);
        const cy1 = Number(world[w + 1]);
        const cx2 = Number(world[w + 2]);
        const cy2 = Number(world[w + 3]);
        const x2 = Number(world[w + 4]);
        const y2 = Number(world[w + 5]);
        const tmpx = (x1 - cx1 * 2 + cx2) * 0.1875;
        const tmpy = (y1 - cy1 * 2 + cy2) * 0.1875;
        const dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 0.09375;
        const dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 0.09375;
        let ddfx = tmpx * 2 + dddfx;
        let ddfy = tmpy * 2 + dddfy;
        let dfx = (cx1 - x1) * 0.75 + tmpx + dddfx * 0.16666667;
        let dfy = (cy1 - y1) * 0.75 + tmpy + dddfy * 0.16666667;

        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        dfx += ddfx;
        dfy += ddfy;
        ddfx += dddfx;
        ddfy += dddfy;
        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        dfx += ddfx;
        dfy += ddfy;
        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        dfx += ddfx + dddfx;
        dfy += ddfy + dddfy;
        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        curves[i] = pathLength;
        x1 = x2;
        y1 = y2;
    }
}

/**
 * Measures the curve whose eight numbers start at `w` in ten segments. Each entry of `segments`
 * is the length up to the end of one segment, so the last one is the length of the curve.
 */
function measureSegments(world: Float64Array, w: number, segments: Float64Array): void {
    const x1 = Number(world[w]);
    const y1 = Number(world[w + 1]);
    const cx1 = Number(world[w + 2]);
    const cy1 = Number(world[w + 3]);
    const cx2 = Number(world[w + 4]);
    const cy2 = Number(world[w + 5]);
    const x2 = Number(world[w + 6]);
    const y2 = Number(world[w + 7]);
    const tmpx = (x1 - cx1 * 2 + cx2) * 0.03;
    const tmpy = (y1 - cy1 * 2 + cy2) * 0.03;
    const dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 0.006;
    const dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 0.006;
    let ddfx = tmpx * 2 + dddfx;
    let ddfy = tmpy * 2 + dddfy;
    let dfx = (cx1 - x1) * 0.3 + tmpx + dddfx * 0.16666667;
    let dfy = (cy1 - y1) * 0.3 + tmpy + dddfy * 0.16666667;
    let curveLength = Math.sqrt(dfx * dfx + dfy * dfy);

    segments[0] = curveLength;
    for (let ii = 1; ii < 8; ii++) {
        dfx += ddfx;
        dfy += ddfy;
        ddfx += dddfx;
        ddfy += dddfy;
        curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
        segments[ii] = curveLength;
    }
    dfx += ddfx;
    dfy += ddfy;
    curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
    segments[8] = curveLength;
    dfx += ddfx + dddfx;
    dfy += ddfy + dddfy;
    curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
    segments[9] = curveLength;
}

/**
 * The positions on a path at constant speed. Every curve is measured in the world. A position on
 * a curve is found through the lengths of ten segments of it.
 */
function positionsByMeasuredLengths(
    pose: Pose43,
    plan: PathPlan,
    path: PathAttachmentData,
    spacesCount: number,
    tangents: boolean,
): void {
    const { spaces, positions: out, world, curves, segments } = pose.rig.solver.scratch;
    const closed = path.closed;
    const curveCount = path.worldVerticesLength / 6 - (closed ? 0 : 1);
    // how many numbers of the world scratch hold the path
    const verticesLength = loadPath(pose, plan, path);

    measureCurves(world, curveCount, curves);
    // the path has a curve, so the last entry is the length of the path
    const pathLength = Number(curves[curveCount - 1]);
    let position = Number(pose.solve.applied[plan.at + PATH_POSITION]);
    let multiplier = 1;
    // the curve and the segment the last point was on, the curve whose segments are measured, and its length
    let curve = 0;
    let segment = 0;
    let measured = NONE;
    let curveLength = 0;
    // the eight numbers of the measured curve
    let x1 = 0;
    let y1 = 0;
    let cx1 = 0;
    let cy1 = 0;
    let cx2 = 0;
    let cy2 = 0;
    let x2 = 0;
    let y2 = 0;

    if (plan.percentPosition) position *= pathLength;
    if (plan.spacingMode === SPACING_PERCENT) multiplier = pathLength;
    else if (plan.spacingMode === SPACING_PROPORTIONAL) multiplier = pathLength / spacesCount;
    for (let i = 0, o = 0; i < spacesCount; i++, o += 3) {
        const space = Number(spaces[i]) * multiplier;

        position += space;
        let p = position;

        if (closed) {
            p %= pathLength;
            if (p < 0) p += pathLength;
            curve = 0;
            segment = 0;
        } else if (p < 0) {
            out[o] = p;
            addBeforePosition(world, 0, out, o);
            continue;
        } else if (p > pathLength) {
            out[o] = p - pathLength;
            addAfterPosition(world, verticesLength - 4, out, o);
            continue;
        }
        // the curve the position is on. Past the end of the lengths the comparison is false, as in the official loop.
        while (p > Number(curves[curve])) curve++;
        if (curve === 0) p /= Number(curves[curve]);
        else {
            const prev = Number(curves[curve - 1]);

            p = (p - prev) / (Number(curves[curve]) - prev);
        }
        if (curve !== measured) {
            const w = curve * 6;

            measured = curve;
            measureSegments(world, w, segments);
            curveLength = Number(segments[9]);
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
        // weight by segment length, then find the segment the position is on
        p *= curveLength;
        while (p > Number(segments[segment])) segment++;
        if (segment === 0) p /= Number(segments[segment]);
        else {
            const prev = Number(segments[segment - 1]);

            p = segment + (p - prev) / (Number(segments[segment]) - prev);
        }
        // the position on the curve in tenths: the segment, plus how far the position is into it
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
 * The official `PathConstraint.computeWorldPositions`. Reads the spaces between the bones from
 * the scratch of the rig and writes `spacesCount` positions to it. `path` must have a curve.
 *
 * @param tangents True when every position needs the angle of the path.
 */
export function computeWorldPositions(
    pose: Pose43,
    plan: PathPlan,
    path: PathAttachmentData,
    spacesCount: number,
    tangents: boolean,
): void {
    if (path.constantSpeed) positionsByMeasuredLengths(pose, plan, path, spacesCount, tangents);
    else positionsByStoredLengths(pose, plan, path, spacesCount, tangents);
}
