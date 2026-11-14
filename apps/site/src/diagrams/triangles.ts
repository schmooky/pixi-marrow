import { animate, stagger } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Everything is triangles. The GPU draws only triangles, so every shape is cut into them first.
 * A star outline appears, then the triangles that fill it come in one by one: a fan from its
 * centre makes 10 triangles. A picture of a rectangle needs 2, and a smooth curve needs many.
 */

const POINTS = 5;

export default defineDiagram({
    setup({ svg, own, say }) {
        const corners: [number, number][] = [];

        for (let i = 0; i < POINTS * 2; i++) {
            const radius = i % 2 === 0 ? 110 : 48;
            const angle = -Math.PI / 2 + (i * Math.PI) / POINTS;

            corners.push([360 + Math.cos(angle) * radius, 135 + Math.sin(angle) * radius]);
        }
        svgElement(
            'polygon',
            {
                points: corners.map((point) => point.join(' ')).join(' '),
                fill: 'none',
                stroke: COLORS.result,
                'stroke-width': 2,
            },
            svg,
        );
        // a fan from the centre: each pair of neighbouring corners and the centre make one triangle
        const triangles = corners.map((corner, i) => {
            const next = corners[(i + 1) % corners.length] ?? corner;

            return svgElement(
                'polygon',
                {
                    points: `360 135 ${corner.join(' ')} ${next.join(' ')}`,
                    fill: i % 2 === 0 ? COLORS.second : COLORS.first,
                    stroke: '#111113',
                    'stroke-width': 1.5,
                    opacity: 0,
                },
                svg,
            );
        });

        for (const corner of corners)
            svgElement('circle', { cx: corner[0], cy: corner[1], r: 4, fill: COLORS.result }, svg);
        svgElement('circle', { cx: 360, cy: 135, r: 4, fill: COLORS.result }, svg);
        say(`${corners.length} corners and the centre: ${triangles.length} triangles of 3 vertices each`);
        own(
            animate(triangles, {
                opacity: [0, 0.9],
                duration: 350,
                delay: stagger(220),
                loop: true,
                loopDelay: 1500,
                alternate: true,
                autoplay: false,
            }),
        );
    },
});
