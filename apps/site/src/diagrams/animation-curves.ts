import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Keys and curves. An animation keys one value, the height of a square, at three times: 0 at
 * 0 s, 100 at 0.5 s and 0 at 1 s. Between two keys the curve decides the value. Linear moves
 * at an even speed, stepped holds and jumps, bezier eases in and out. The playhead samples the
 * curve, and the square takes the value.
 */

const CURVES = ['linear', 'stepped', 'bezier'] as const;

type Curve = (typeof CURVES)[number];

const KEYS: [number, number][] = [
    [0, 0],
    [0.5, 100],
    [1, 0],
];
const GRAPH = { x: 40, y: 30, w: 420, h: 150 };

/** The value at a time between keys, by the curve. */
function valueAt(time: number, curve: Curve): number {
    for (let i = 0; i < KEYS.length - 1; i++) {
        const [t0, v0] = KEYS[i] ?? [0, 0];
        const [t1, v1] = KEYS[i + 1] ?? [1, 0];

        if (time < t0 || time > t1) continue;
        const share = (time - t0) / (t1 - t0);

        if (curve === 'stepped') return v0;
        // a bezier that eases in and out, as animators often draw it
        const eased = curve === 'bezier' ? share * share * (3 - 2 * share) : share;

        return v0 + (v1 - v0) * eased;
    }

    return KEYS[KEYS.length - 1]?.[1] ?? 0;
}

const xOf = (time: number): number => GRAPH.x + time * GRAPH.w;
const yOf = (value: number): number => GRAPH.y + GRAPH.h - (value / 100) * GRAPH.h;

export default defineDiagram({
    setup({ svg, onFrame, pick, readout }) {
        svgElement(
            'rect',
            { x: GRAPH.x, y: GRAPH.y, width: GRAPH.w, height: GRAPH.h, fill: 'none', stroke: COLORS.line },
            svg,
        );
        const path = svgElement('path', { fill: 'none', stroke: COLORS.first, 'stroke-width': 2.5 }, svg);

        for (const [time, value] of KEYS)
            svgElement('circle', { cx: xOf(time), cy: yOf(value), r: 6, fill: COLORS.first }, svg);
        const head = svgElement('line', { y1: GRAPH.y, y2: GRAPH.y + GRAPH.h, stroke: COLORS.result }, svg);
        const dot = svgElement('circle', { r: 5, fill: COLORS.result }, svg);
        const square = svgElement('rect', { x: 560, width: 50, height: 50, rx: 6, fill: COLORS.second }, svg);

        svgElement(
            'line',
            { x1: 540, y1: GRAPH.y + GRAPH.h, x2: 630, y2: GRAPH.y + GRAPH.h, stroke: COLORS.line },
            svg,
        );
        const show = readout('Value', 60);
        let curve: Curve = 'linear';
        let time = 0;
        const drawCurve = (): void => {
            let d = '';

            for (let step = 0; step <= 100; step++)
                d += `${step === 0 ? 'M' : 'L'}${xOf(step / 100)} ${yOf(valueAt(step / 100, curve))}`;
            path.setAttribute('d', d);
        };

        pick(
            'Curve',
            CURVES,
            (next) => {
                curve = next;
                drawCurve();
            },
            'linear',
        );
        drawCurve();
        onFrame((seconds) => {
            time = (time + seconds * 0.5) % 1;
            const value = valueAt(time, curve);

            head.setAttribute('x1', String(xOf(time)));
            head.setAttribute('x2', String(xOf(time)));
            dot.setAttribute('cx', String(xOf(time)));
            dot.setAttribute('cy', String(yOf(value)));
            square.setAttribute('y', String(yOf(value) - 50 + 0));
            show(`at ${time.toFixed(2)} s the ${curve} curve gives ${value.toFixed(1)}`);
        });
    },
});
