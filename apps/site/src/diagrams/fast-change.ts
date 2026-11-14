import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Work follows change. Twenty-four skeletons stand on a grid. In each frame a skeleton that
 * moves is posed, placed and uploaded, and lights up. One at rest is asked whether anything
 * changed, and skipped. Pick how many move and watch the work of the frame.
 */

const SCENES = { 'all move': 1, 'a few move': 0.15, 'all rest': 0 } as const;

type Scene = keyof typeof SCENES;

const COLUMNS = 8;
const COUNT = 24;

export default defineDiagram({
    setup({ svg, onFrame, pick, say }) {
        const cells = Array.from({ length: COUNT }, (_, index) =>
            svgElement(
                'rect',
                {
                    x: 40 + (index % COLUMNS) * 80,
                    y: 30 + Math.floor(index / COLUMNS) * 56,
                    width: 64,
                    height: 44,
                    rx: 8,
                    fill: '#26262c',
                },
                svg,
            ),
        );
        const show = say;
        let share = 1;
        let clock = 0;

        pick(
            'Scene',
            Object.keys(SCENES) as Scene[],
            (next) => {
                share = SCENES[next];
            },
            'all move',
        );
        onFrame((seconds) => {
            clock += seconds;
            if (clock < 0.25) return;
            clock = 0;
            let moved = 0;

            for (const [index, cell] of cells.entries()) {
                // the same skeletons keep moving: the first share of them by a fixed order
                const moves = (index * 7) % COUNT < share * COUNT;

                cell.setAttribute('fill', moves ? COLORS.second : '#26262c');
                if (moves) moved++;
            }
            show(
                `${moved} moved, so they were posed, placed and uploaded. The other ${COUNT - moved} were asked, and skipped.`,
            );
        });
    },
});
