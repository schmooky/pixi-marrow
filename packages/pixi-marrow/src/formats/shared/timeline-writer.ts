import { MarrowError } from '../../base/errors';

/** Floats one Bezier curve takes in a `curves` array: 9 points of x, y. */
export const BEZIER_SIZE = 18;
const LINEAR = 0;
const STEPPED = 1;
const BEZIER = 2;

/**
 * Builds the `frames` and `curves` arrays of one timeline with the layout and the arithmetic of
 * the official `CurveTimeline`, so the arrays come out bit for bit the same.
 *
 * `curves` starts with one entry per key: 0 for linear, 1 for stepped, or 2 plus the index where
 * the Bezier samples of that key start. The samples follow, 18 floats per curve.
 *
 * Importers write key times and values into `frames` themselves.
 */
export class TimelineWriter {
    readonly frameCount: number;
    readonly frames: Float32Array;
    curves: Float32Array | null;

    /**
     * @param frameCount The number of keys.
     * @param entries Floats per key in `frames`. That is the time plus the values.
     * @param bezierCount The most Bezier curves the timeline can need. Null for a timeline that
     * does not interpolate.
     */
    constructor(frameCount: number, entries: number, bezierCount: number | null) {
        this.frameCount = frameCount;
        this.frames = new Float32Array(frameCount * entries);
        this.curves = null;
        if (bezierCount !== null) {
            this.curves = new Float32Array(frameCount + bezierCount * BEZIER_SIZE);
            this.curves[frameCount - 1] = STEPPED;
        }
    }

    private curveArray(): Float32Array {
        if (this.curves === null) {
            throw new MarrowError('invalid-data', 'A curve was written to a timeline that has none.', {
                fix: 'This is a bug in the importer. Report it with the skeleton file.',
            });
        }

        return this.curves;
    }

    /** Marks the key at `frame` as linear. */
    setLinear(frame: number): void {
        this.curveArray()[frame] = LINEAR;
    }

    /** Marks the key at `frame` as stepped. */
    setStepped(frame: number): void {
        this.curveArray()[frame] = STEPPED;
    }

    /** Cuts `curves` down to the number of Bezier curves that were written. */
    shrink(bezierCount: number): void {
        const curves = this.curveArray();
        const size = this.frameCount + bezierCount * BEZIER_SIZE;

        if (curves.length > size) this.curves = curves.slice(0, size);
    }

    /**
     * Stores the samples of one Bezier curve.
     *
     * The `bezier` argument is the index of the curve among the curves of this timeline.
     * The `frame` argument is the key the curve starts at.
     * The `value` argument says which value of the key the curve is for, starting at 0.
     */
    setBezier(
        bezier: number,
        frame: number,
        value: number,
        time1: number,
        value1: number,
        cx1: number,
        cy1: number,
        cx2: number,
        cy2: number,
        time2: number,
        value2: number,
    ): void {
        const curves = this.curveArray();
        const i = this.frameCount + bezier * BEZIER_SIZE;

        if (value === 0) curves[frame] = BEZIER + i;
        const tmpx = (time1 - cx1 * 2 + cx2) * 0.03;
        const tmpy = (value1 - cy1 * 2 + cy2) * 0.03;
        const dddx = ((cx1 - cx2) * 3 - time1 + time2) * 0.006;
        const dddy = ((cy1 - cy2) * 3 - value1 + value2) * 0.006;
        const dx = (cx1 - time1) * 0.3 + tmpx + dddx * 0.16666667;
        const dy = (cy1 - value1) * 0.3 + tmpy + dddy * 0.16666667;

        sample(curves, i, time1 + dx, value1 + dy, dx, dy, tmpx * 2 + dddx, tmpy * 2 + dddy, dddx, dddy);
    }

    /**
     * Stores the samples of one Bezier curve of a deform timeline. A deform curve runs from 0 to 1
     * between two keys, and the official `DeformTimeline` packs it with its own arithmetic. The
     * generic {@link setBezier} with 0 and 1 gives slightly different floats.
     *
     * The `bezier` argument is the index of the curve among the curves of this timeline.
     * The `frame` argument is the key the curve starts at.
     * The `value` argument is always 0 for a deform timeline.
     */
    setDeformBezier(
        bezier: number,
        frame: number,
        value: number,
        time1: number,
        cx1: number,
        cy1: number,
        cx2: number,
        cy2: number,
        time2: number,
    ): void {
        const curves = this.curveArray();
        const i = this.frameCount + bezier * BEZIER_SIZE;

        if (value === 0) curves[frame] = BEZIER + i;
        const tmpx = (time1 - cx1 * 2 + cx2) * 0.03;
        const tmpy = cy2 * 0.03 - cy1 * 0.06;
        const dddx = ((cx1 - cx2) * 3 - time1 + time2) * 0.006;
        const dddy = (cy1 - cy2 + 0.33333333) * 0.018;
        const dx = (cx1 - time1) * 0.3 + tmpx + dddx * 0.16666667;
        const dy = cy1 * 0.3 + tmpy + dddy * 0.16666667;

        sample(curves, i, time1 + dx, dy, dx, dy, tmpx * 2 + dddx, tmpy * 2 + dddy, dddx, dddy);
    }
}

/** Writes the 9 points of one curve by forward differencing, as the official runtime does. */
function sample(
    curves: Float32Array,
    start: number,
    x0: number,
    y0: number,
    dx0: number,
    dy0: number,
    ddx0: number,
    ddy0: number,
    dddx: number,
    dddy: number,
): void {
    let x = x0;
    let y = y0;
    let dx = dx0;
    let dy = dy0;
    let ddx = ddx0;
    let ddy = ddy0;

    for (let i = start, n = start + BEZIER_SIZE; i < n; i += 2) {
        curves[i] = x;
        curves[i + 1] = y;
        dx += ddx;
        dy += ddy;
        ddx += dddx;
        ddy += dddy;
        x += dx;
        y += dy;
    }
}
