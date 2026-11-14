import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * A screen is a grid of pixels. A circle moves across a coarse screen, and in every frame each
 * pixel whose centre lies inside the circle is lit. Nothing stays drawn: the next frame starts
 * from an empty grid and lights the pixels again where the circle is now. Pick a finer grid to
 * see that more pixels make a smoother edge, and more work.
 */

const SIZES = { '12 by 8': 12, '24 by 16': 24, '48 by 32': 48 } as const;

type SizeName = keyof typeof SIZES;

const WIDTH = 480;
const HEIGHT = 320;
const LEFT = 20;
const TOP = 20;

export default defineDiagram({
    setup({ svg, onFrame, pick, say }) {
        const grid = svgElement('g', {}, svg);
        const outline = svgElement(
            'circle',
            { r: 70, fill: 'none', stroke: COLORS.result, 'stroke-dasharray': '4 4' },
            svg,
        );
        const counter = svgElement(
            'text',
            { x: 530, y: 60, fill: COLORS.result, 'font-size': 28, 'font-family': 'ui-monospace, monospace' },
            svg,
        );

        svgElement(
            'text',
            { x: 530, y: 30, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'frame';
        const show = say;
        let columns = 24;
        let cells: SVGRectElement[] = [];
        let frame = 0;
        let time = 0;
        /** Builds a grid of pixels, all dark. */
        const build = (count: number): void => {
            columns = count;
            const rows = (count * 2) / 3;
            const side = WIDTH / count;

            grid.replaceChildren();
            cells = [];
            for (let row = 0; row < rows; row++) {
                for (let column = 0; column < count; column++) {
                    cells.push(
                        svgElement(
                            'rect',
                            {
                                x: LEFT + column * side + 0.5,
                                y: TOP + row * side + 0.5,
                                width: side - 1,
                                height: side - 1,
                                fill: '#1d1d22',
                            },
                            grid,
                        ),
                    );
                }
            }
        };

        pick('Screen', Object.keys(SIZES) as SizeName[], (next) => build(SIZES[next]), '24 by 16');
        build(24);
        onFrame((seconds) => {
            time += seconds;
            frame++;
            const cx = LEFT + WIDTH / 2 + Math.cos(time * 0.9) * 150;
            const cy = TOP + HEIGHT / 2 + Math.sin(time * 1.3) * 70;
            const side = WIDTH / columns;
            let lit = 0;

            for (const [index, cell] of cells.entries()) {
                const x = LEFT + (index % columns) * side + side / 2;
                const y = TOP + Math.floor(index / columns) * side + side / 2;
                const on = (x - cx) ** 2 + (y - cy) ** 2 <= 70 * 70;

                cell.setAttribute('fill', on ? COLORS.second : '#1d1d22');
                if (on) lit++;
            }
            outline.setAttribute('cx', String(cx));
            outline.setAttribute('cy', String(cy));
            counter.textContent = String(frame);
            show(`${lit} of ${cells.length} pixels lit, all decided again in this frame`);
        });
    },
});
