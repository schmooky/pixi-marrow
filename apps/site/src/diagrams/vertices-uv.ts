import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * How a picture is stretched over triangles. A square picture with a grid on it is drawn as two
 * triangles. One corner moves. Each triangle maps its part of the picture onto its new shape,
 * so the grid stretches, and where the two triangles meet the lines bend: each triangle is
 * mapped on its own, as the GPU maps it.
 */

const SIZE = 120;
/** The corners of the picture, as places on it from 0 to 1. */
const UV: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
];
const TRIANGLES = [
    [0, 1, 2],
    [0, 2, 3],
] as const;

/** The affine matrix that takes three points of the picture to three points on the screen. */
function matrixFor(from: [number, number][], to: [number, number][]): string {
    const [[x0, y0], [x1, y1], [x2, y2]] = from as [[number, number], [number, number], [number, number]];
    const [[u0, v0], [u1, v1], [u2, v2]] = to as [[number, number], [number, number], [number, number]];
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
    const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
    const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
    const d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;

    return `matrix(${a} ${b} ${c} ${d} ${u0 - a * x0 - c * y0} ${v0 - b * x0 - d * y0})`;
}

export default defineDiagram({
    setup({ svg, onFrame, readout }) {
        const defs = svgElement('defs', {}, svg);
        const picture = svgElement('g', { id: 'uv-picture' }, defs);

        svgElement('rect', { width: SIZE, height: SIZE, fill: COLORS.first }, picture);
        for (let i = 0; i <= 6; i++) {
            svgElement(
                'line',
                { x1: (i * SIZE) / 6, y1: 0, x2: (i * SIZE) / 6, y2: SIZE, stroke: COLORS.result, 'stroke-width': 1.5 },
                picture,
            );
            svgElement(
                'line',
                { x1: 0, y1: (i * SIZE) / 6, x2: SIZE, y2: (i * SIZE) / 6, stroke: COLORS.result, 'stroke-width': 1.5 },
                picture,
            );
        }
        svgElement(
            'circle',
            { cx: SIZE * 0.5, cy: SIZE * 0.5, r: SIZE * 0.3, fill: 'none', stroke: COLORS.second, 'stroke-width': 4 },
            picture,
        );
        svgElement(
            'text',
            { x: 40, y: 24, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'the picture on the atlas page';
        svgElement('use', { href: '#uv-picture', x: 40, y: 40 }, svg);
        svgElement(
            'text',
            { x: 300, y: 24, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'drawn as two triangles, one corner moved';
        const pieces = TRIANGLES.map((_, index) => {
            const clip = svgElement('clipPath', { id: `uv-clip-${index}` }, defs);
            const shape = svgElement('polygon', {}, clip);
            const use = svgElement('use', { href: '#uv-picture', 'clip-path': `url(#uv-clip-${index})` }, svg);

            return { shape, use };
        });
        const edges = svgElement('g', {}, svg);
        const show = readout('Watch', 60);
        let time = 0;

        onFrame((seconds) => {
            time += seconds;
            const pull = 0.5 - 0.5 * Math.cos(time * 1.2);
            const corners: [number, number][] = [
                [320, 50],
                [470, 50],
                [470 + 90 * pull, 180 + 30 * pull],
                [320, 180],
            ];

            edges.replaceChildren();
            for (const [index, triangle] of TRIANGLES.entries()) {
                const from = triangle.map(
                    (corner) => (UV[corner] ?? [0, 0]).map((value) => value * SIZE) as [number, number],
                );
                const to = triangle.map((corner) => (corners[corner] ?? [0, 0]) as [number, number]);
                const piece = pieces[index];

                piece?.shape.setAttribute('points', from.map((point) => point.join(' ')).join(' '));
                piece?.use.setAttribute('transform', matrixFor(from, to));
                svgElement(
                    'polygon',
                    {
                        points: to.map((point) => point.join(' ')).join(' '),
                        fill: 'none',
                        stroke: COLORS.second,
                        'stroke-width': 1.5,
                    },
                    edges,
                );
            }
            show(
                pull > 0.5
                    ? 'the grid bends where the triangles meet: each one is mapped on its own'
                    : 'the corner moves: each triangle stretches its part of the picture',
            );
        });
    },
});
