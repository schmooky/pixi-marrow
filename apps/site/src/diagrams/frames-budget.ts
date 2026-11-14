import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * The budget of a frame. A screen at 60 Hz shows a new picture every 16.7 milliseconds. Each
 * frame of the game must do its work in that time: the logic of the game, the skeletons, and
 * the render. A frame that takes longer misses its turn, the screen shows the old picture again,
 * and the motion stutters. Pick how much work a frame has and watch the frames go by.
 */

const LOADS = { light: [3, 2, 3], full: [6, 5, 4.5], 'too much': [8, 7, 5] } as const;

type Load = keyof typeof LOADS;

const BUDGET = 1000 / 60;
const SLOT = 64;
const SCALE = 3.2;

export default defineDiagram({
    setup({ svg, pick, readout }) {
        const parts = ['game', 'skeletons', 'render'];
        const colors = [COLORS.first, COLORS.second, '#6fd08c'];
        const lane = svgElement('g', {}, svg);
        const show = readout('Frames', 60);

        svgElement(
            'text',
            { x: 20, y: 22, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'each box is one screen refresh, 16.7 ms. The bars are the work of a frame';
        for (const [index, name] of parts.entries()) {
            svgElement(
                'rect',
                { x: 20 + index * 110, y: 200, width: 12, height: 12, rx: 2, fill: colors[index] ?? COLORS.result },
                svg,
            );
            svgElement(
                'text',
                {
                    x: 38 + index * 110,
                    y: 210,
                    fill: COLORS.text,
                    'font-size': 12,
                    'font-family': 'ui-sans-serif, system-ui',
                },
                svg,
            ).textContent = name;
        }
        let load: readonly number[] = LOADS.light;
        /** Draws ten refreshes and the frames that fit into them. */
        const draw = (): void => {
            lane.replaceChildren();
            const total = load.reduce((sum, part) => sum + part, 0);
            const refreshes = Math.ceil(total / BUDGET);

            for (let slot = 0; slot < 10; slot++) {
                const x = 20 + slot * (SLOT + 6);

                svgElement(
                    'rect',
                    { x, y: 40, width: SLOT, height: BUDGET * SCALE, rx: 4, fill: 'none', stroke: COLORS.line },
                    lane,
                );
                if (slot % refreshes !== 0) {
                    svgElement(
                        'text',
                        {
                            x: x + SLOT / 2,
                            y: 40 + (BUDGET * SCALE) / 2,
                            fill: '#ff6b6b',
                            'font-size': 11,
                            'text-anchor': 'middle',
                            'font-family': 'ui-monospace, monospace',
                        },
                        lane,
                    ).textContent = 'old picture';
                    continue;
                }
                let y = 40;

                for (const [index, part] of load.entries()) {
                    const height = Math.min(part * SCALE, 40 + BUDGET * SCALE * refreshes - y);

                    svgElement(
                        'rect',
                        {
                            x: x + 6,
                            y,
                            width: SLOT - 12,
                            height: Math.max(0, height),
                            fill: colors[index] ?? COLORS.result,
                            opacity: 0.85,
                        },
                        lane,
                    );
                    y += part * SCALE;
                }
            }
        };

        /** Says how many new pictures a second the work allows. */
        const explain = (): void => {
            const total = load.reduce((sum, part) => sum + part, 0);
            const refreshes = Math.ceil(total / BUDGET);

            show(
                refreshes === 1
                    ? `${total.toFixed(1)} ms of work fits into 16.7 ms: a new picture at every refresh, 60 a second`
                    : `${total.toFixed(1)} ms of work takes ${refreshes} refreshes: a new picture ${60 / refreshes} times a second, and the motion stutters`,
            );
        };

        pick(
            'Work',
            Object.keys(LOADS) as Load[],
            (next) => {
                load = LOADS[next];
                draw();
                explain();
            },
            'light',
        );
        draw();
        explain();
    },
});
