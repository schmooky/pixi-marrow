import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Weights at a joint. A strip of picture lies along two bones and bends at the elbow. Its
 * vertices sit in pairs along the strip. Rigid: each vertex follows the one bone it is
 * closest to, so the strip creases at the joint. Weighted: the vertices near the joint follow
 * both bones, mixed by their weights, so the bend spreads over them. The color of a vertex
 * shows its weights, blue for the upper bone and orange for the lower.
 */

const MODES = ['rigid', 'weighted'] as const;

type Mode = (typeof MODES)[number];

const ROOT: [number, number] = [140, 140];
const LENGTH = 160;
/** Where the pairs of vertices lie along the strip, from 0 at the shoulder to 2 at the hand. */
const STATIONS = [0, 0.3, 0.6, 0.85, 1, 1.15, 1.4, 1.7, 2];
const HALF = 22;

/** The weight of the lower bone for a vertex at a station. */
function weightOf(station: number, mode: Mode): number {
    if (mode === 'rigid') return station < 1 ? 0 : 1;

    return Math.min(1, Math.max(0, (station - 0.6) / 0.8));
}

/** A point moved by a bone that starts at `origin` and points along `degrees`, given in the bone's frame. */
function byBone(origin: [number, number], degrees: number, along: number, side: number): [number, number] {
    const angle = (degrees * Math.PI) / 180;

    return [
        origin[0] + along * Math.cos(angle) + side * Math.sin(angle),
        origin[1] - along * Math.sin(angle) + side * Math.cos(angle),
    ];
}

const mixColor = (weight: number): string =>
    `rgb(${Math.round(95 + (255 - 95) * weight)} ${Math.round(168 + (138 - 168) * weight)} ${Math.round(255 + (76 - 255) * weight)})`;

export default defineDiagram({
    setup({ svg, onFrame, pick, say }) {
        const strip = svgElement('polygon', { fill: COLORS.second, opacity: 0.25, stroke: COLORS.second }, svg);
        const bones = svgElement('polyline', { fill: 'none', stroke: COLORS.result, 'stroke-width': 3 }, svg);
        const dots = svgElement('g', {}, svg);
        const show = say;
        let mode: Mode = 'rigid';
        let time = 0;

        pick(
            'Vertices',
            MODES,
            (next) => {
                mode = next;
            },
            'rigid',
        );
        onFrame((seconds) => {
            time += seconds;
            const bend = 55 * (0.5 - 0.5 * Math.cos(time * 1.4));
            const elbow = byBone(ROOT, 0, LENGTH, 0);
            const top: [number, number][] = [];
            const bottom: [number, number][] = [];

            dots.replaceChildren();
            for (const station of STATIONS) {
                const weight = weightOf(station, mode);

                for (const [side, list] of [
                    [-HALF, top],
                    [HALF, bottom],
                ] as const) {
                    // where each bone would put the vertex, mixed by the weights
                    const byUpper = byBone(ROOT, 0, station * LENGTH, side);
                    const byLower = byBone(elbow, bend, (station - 1) * LENGTH, side);
                    const point: [number, number] = [
                        byUpper[0] + (byLower[0] - byUpper[0]) * weight,
                        byUpper[1] + (byLower[1] - byUpper[1]) * weight,
                    ];

                    list.push(point);
                    svgElement('circle', { cx: point[0], cy: point[1], r: 4.5, fill: mixColor(weight) }, dots);
                }
            }
            const hand = byBone(elbow, bend, LENGTH, 0);

            strip.setAttribute('points', [...top, ...bottom.reverse()].map((point) => point.join(' ')).join(' '));
            bones.setAttribute('points', [ROOT, elbow, hand].map((point) => point.join(' ')).join(' '));
            show(
                `bent ${bend.toFixed(0)} degrees: ${mode === 'rigid' ? 'the vertices jump from one bone to the other, and the strip creases' : 'the vertices near the joint mix both bones, and the strip bends'}`,
            );
        });
    },
});
