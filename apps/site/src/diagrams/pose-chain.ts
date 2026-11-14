import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Local and world on a two-bone arm. The upper bone sways. The lower bone keeps its local
 * rotation of 30 degrees, or turns on its own too. Its world rotation is always the world
 * rotation of its parent plus its own local rotation, and the readout adds them up.
 */

const MODES = ['lower bone holds 30', 'lower bone turns too'] as const;

type Mode = (typeof MODES)[number];

const ROOT: [number, number] = [200, 170];

/** A point at a distance along an angle in degrees, y up on the screen. */
const along = (from: [number, number], length: number, degrees: number): [number, number] => [
    from[0] + length * Math.cos((degrees * Math.PI) / 180),
    from[1] - length * Math.sin((degrees * Math.PI) / 180),
];

export default defineDiagram({
    setup({ svg, onFrame, pick, readout }) {
        const upper = svgElement('line', { stroke: COLORS.first, 'stroke-width': 10, 'stroke-linecap': 'round' }, svg);
        const lower = svgElement('line', { stroke: COLORS.second, 'stroke-width': 10, 'stroke-linecap': 'round' }, svg);
        const ghost = svgElement(
            'line',
            { stroke: COLORS.second, 'stroke-width': 2, 'stroke-dasharray': '4 4', opacity: 0.6 },
            svg,
        );
        const joints = [0, 1].map(() => svgElement('circle', { r: 7, fill: COLORS.result }, svg));
        const showUpper = readout('Upper bone', 60);
        const showLower = readout('Lower bone', 60);
        let mode: Mode = 'lower bone holds 30';
        let time = 0;

        svgElement(
            'text',
            { x: 430, y: 60, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'dashed: where the lower bone would point';
        svgElement(
            'text',
            { x: 430, y: 78, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'with its local rotation alone';
        pick(
            'Lower bone',
            MODES,
            (next) => {
                mode = next;
            },
            'lower bone holds 30',
        );
        onFrame((seconds) => {
            time += seconds;
            const parent = 20 + 35 * Math.sin(time * 1.3);
            const local = mode === 'lower bone holds 30' ? 30 : 30 + 40 * Math.sin(time * 2.1);
            const elbow = along(ROOT, 120, parent);
            const hand = along(elbow, 100, parent + local);
            const alone = along(elbow, 100, local);

            upper.setAttribute('x1', String(ROOT[0]));
            upper.setAttribute('y1', String(ROOT[1]));
            upper.setAttribute('x2', String(elbow[0]));
            upper.setAttribute('y2', String(elbow[1]));
            lower.setAttribute('x1', String(elbow[0]));
            lower.setAttribute('y1', String(elbow[1]));
            lower.setAttribute('x2', String(hand[0]));
            lower.setAttribute('y2', String(hand[1]));
            ghost.setAttribute('x1', String(elbow[0]));
            ghost.setAttribute('y1', String(elbow[1]));
            ghost.setAttribute('x2', String(alone[0]));
            ghost.setAttribute('y2', String(alone[1]));
            for (const [index, point] of [ROOT, elbow].entries()) {
                joints[index]?.setAttribute('cx', String(point[0]));
                joints[index]?.setAttribute('cy', String(point[1]));
            }
            showUpper(`local ${parent.toFixed(1)}, world ${parent.toFixed(1)}: it has no parent bone here`);
            showLower(
                `local ${local.toFixed(1)}, world ${parent.toFixed(1)} + ${local.toFixed(1)} = ${(parent + local).toFixed(1)}`,
            );
        });
    },
});
