import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Where a pixel takes its color. A triangle on the screen has three vertices, and each vertex
 * names a place on the picture, its texture coordinate. For a pixel inside the triangle the GPU
 * mixes the three places by how close the pixel is to each vertex, and reads the picture there.
 * A dot wanders inside the triangle, and its twin on the picture shows the place it reads.
 */

const PICTURE = { x: 30, y: 30, size: 180 };
/** The three vertices on the screen, and the places on the picture they name, from 0 to 1. */
const SCREEN: [number, number][] = [
    [330, 40],
    [690, 110],
    [400, 240],
];
const UV: [number, number][] = [
    [0.1, 0.1],
    [0.9, 0.3],
    [0.3, 0.9],
];

export default defineDiagram({
    setup({ svg, onFrame, say }) {
        // the picture: four colored quarters, so a place on it is easy to read
        const colors = [COLORS.first, COLORS.second, '#6fd08c', '#b48cff'];

        for (let quarter = 0; quarter < 4; quarter++) {
            svgElement(
                'rect',
                {
                    x: PICTURE.x + (quarter % 2) * (PICTURE.size / 2),
                    y: PICTURE.y + Math.floor(quarter / 2) * (PICTURE.size / 2),
                    width: PICTURE.size / 2,
                    height: PICTURE.size / 2,
                    fill: colors[quarter] ?? COLORS.first,
                },
                svg,
            );
        }
        const onPicture = UV.map(
            ([u, v]) => [PICTURE.x + u * PICTURE.size, PICTURE.y + v * PICTURE.size] as [number, number],
        );

        svgElement(
            'polygon',
            {
                points: onPicture.map((point) => point.join(' ')).join(' '),
                fill: 'none',
                stroke: COLORS.result,
                'stroke-width': 2,
            },
            svg,
        );
        svgElement(
            'polygon',
            {
                points: SCREEN.map((point) => point.join(' ')).join(' '),
                fill: '#26262c',
                stroke: COLORS.result,
                'stroke-width': 2,
            },
            svg,
        );
        for (const [index, point] of SCREEN.entries()) {
            svgElement(
                'text',
                {
                    x: point[0] + 6,
                    y: point[1] - 6,
                    fill: COLORS.text,
                    'font-size': 12,
                    'font-family': 'ui-monospace, monospace',
                },
                svg,
            ).textContent = `uv ${UV[index]?.join(', ')}`;
        }
        svgElement(
            'text',
            { x: PICTURE.x, y: 24, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'the picture';
        const link = svgElement('line', { stroke: COLORS.result, 'stroke-dasharray': '3 4', opacity: 0.6 }, svg);
        const pixel = svgElement('rect', { width: 18, height: 18, stroke: COLORS.result, 'stroke-width': 2 }, svg);
        const place = svgElement('circle', { r: 6, fill: 'none', stroke: COLORS.result, 'stroke-width': 2.5 }, svg);
        const show = say;
        let time = 0;

        onFrame((seconds) => {
            time += seconds;
            // weights of the three vertices for a point that wanders inside the triangle
            const raw = [1.2 + Math.sin(time * 0.9), 1.2 + Math.sin(time * 1.3 + 2), 1.2 + Math.sin(time * 0.7 + 4)];
            const sum = raw.reduce((total, value) => total + value, 0);
            const weights = raw.map((value) => value / sum);
            const mix = (points: [number, number][]): [number, number] => [
                points.reduce((total, point, i) => total + point[0] * (weights[i] ?? 0), 0),
                points.reduce((total, point, i) => total + point[1] * (weights[i] ?? 0), 0),
            ];
            const [sx, sy] = mix(SCREEN);
            const [px, py] = mix(onPicture);
            const u = (px - PICTURE.x) / PICTURE.size;
            const v = (py - PICTURE.y) / PICTURE.size;
            const color = colors[(u < 0.5 ? 0 : 1) + (v < 0.5 ? 0 : 2)] ?? COLORS.first;

            pixel.setAttribute('x', String(sx - 9));
            pixel.setAttribute('y', String(sy - 9));
            pixel.setAttribute('fill', color);
            place.setAttribute('cx', String(px));
            place.setAttribute('cy', String(py));
            link.setAttribute('x1', String(px));
            link.setAttribute('y1', String(py));
            link.setAttribute('x2', String(sx));
            link.setAttribute('y2', String(sy));
            show(
                `weights ${weights.map((w) => w.toFixed(2)).join(', ')}: reads the picture at ${u.toFixed(2)}, ${v.toFixed(2)}`,
            );
        });
    },
});
