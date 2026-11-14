import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Pacing: how often a skeleton is posed. Four lanes over one second of a screen at 60 frames.
 * A tick marks each frame in which the skeleton is posed, and a square moves with the time it
 * was posed at. On the screen it is posed every frame. Off the screen with `throttle` it is
 * posed 4 times a second with the time that passed, so the square steps, and an event key at
 * 0.4 s fires at 0.5 s. With `pause` its time stands still. With `updateRate: 30` it is posed
 * every other frame.
 */

const LANES = [
    { label: 'on the screen', every: 1, color: COLORS.result },
    { label: "offscreen: 'throttle'", every: 15, color: COLORS.first },
    { label: "offscreen: 'pause'", every: 0, color: COLORS.line },
    { label: 'updateRate: 30', every: 2, color: COLORS.second },
] as const;
const FRAMES = 60;
const LEFT = 190;
const WIDTH = 500;

/** The time a lane posed the skeleton at, for a frame of the second. */
function posedAt(frame: number, every: number): number {
    if (every === 0) return 0;

    return (Math.floor(frame / every) * every) / FRAMES;
}

export default defineDiagram({
    setup({ svg, onFrame, readout }) {
        const squares = LANES.map((lane, index) => {
            const y = 30 + index * 48;

            svgElement(
                'text',
                { x: 20, y: y + 16, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-monospace, monospace' },
                svg,
            ).textContent = lane.label;
            for (let frame = 0; frame < FRAMES; frame++) {
                const posed = lane.every !== 0 && frame % lane.every === 0;

                svgElement(
                    'line',
                    {
                        x1: LEFT + (frame / FRAMES) * WIDTH,
                        y1: y + 22,
                        x2: LEFT + (frame / FRAMES) * WIDTH,
                        y2: y + (posed ? 4 : 18),
                        stroke: posed ? lane.color : '#2a2a30',
                        'stroke-width': 2,
                    },
                    svg,
                );
            }

            return svgElement('rect', { y: y + 26, width: 14, height: 14, rx: 3, fill: lane.color }, svg);
        });
        const keyX = LEFT + 0.4 * WIDTH;

        svgElement(
            'polygon',
            {
                points: `${keyX},${30 + 48 + 26} ${keyX + 6},${30 + 48 + 33} ${keyX},${30 + 48 + 40} ${keyX - 6},${30 + 48 + 33}`,
                fill: '#ffd84a',
            },
            svg,
        );
        const head = svgElement(
            'line',
            { y1: 24, y2: 30 + LANES.length * 48, stroke: COLORS.result, 'stroke-width': 1.5 },
            svg,
        );
        const show = readout('Frame', 60);
        let time = 0;

        onFrame((seconds) => {
            time = (time + seconds * 0.5) % 1;
            const frame = Math.floor(time * FRAMES);

            for (const [index, lane] of LANES.entries()) {
                squares[index]?.setAttribute('x', String(LEFT + posedAt(frame, lane.every) * WIDTH - 7));
            }
            head.setAttribute('x1', String(LEFT + time * WIDTH));
            head.setAttribute('x2', String(LEFT + time * WIDTH));
            show(`frame ${frame + 1} of 60, shown at half speed. The diamond is an event key at 0.4 s`);
        });
    },
});
