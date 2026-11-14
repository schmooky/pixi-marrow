import { animate, stagger } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * What copies share. One asset holds the skeleton data, the atlas, the page textures and the
 * code that poses the skeleton. Each copy holds its own pose, tracks and draw buffers. Pick a
 * number of copies: the shared part stays the same, and only the small part of each copy adds.
 */

const COUNTS = { '1 copy': 1, '5 copies': 5, '20 copies': 20 } as const;

type Count = keyof typeof COUNTS;

/** Units of memory, only to compare: the shared part and the part of one copy. */
const SHARED = 220;
const PER_COPY = 14;

export default defineDiagram({
    setup({ svg, pick, readout }) {
        const text = (x: number, y: number, value: string, color = COLORS.text, size = 12): void => {
            svgElement(
                'text',
                { x, y, fill: color, 'font-size': size, 'font-family': 'ui-sans-serif, system-ui' },
                svg,
            ).textContent = value;
        };

        svgElement(
            'rect',
            { x: 20, y: 20, width: 220, height: 120, rx: 8, fill: 'none', stroke: COLORS.first, 'stroke-width': 2 },
            svg,
        );
        text(32, 42, 'The asset, loaded once', COLORS.result, 13);
        ['skeleton data', 'atlas', 'page textures', 'code that poses it'].forEach((part, index) =>
            text(32, 66 + index * 18, part),
        );
        text(270, 42, 'Copies: each has its own pose, tracks and buffers', COLORS.result, 13);
        const copies = svgElement('g', {}, svg);
        const bars = svgElement('g', {}, svg);
        const show = readout('Memory', 60);
        /** Shows a number of copies, and the memory of the shared part against the part of the copies. */
        const draw = (count: number): void => {
            copies.replaceChildren();
            bars.replaceChildren();
            const boxes = Array.from({ length: count }, (_, index) =>
                svgElement(
                    'rect',
                    {
                        x: 270 + (index % 10) * 44,
                        y: 56 + Math.floor(index / 10) * 44,
                        width: 36,
                        height: 36,
                        rx: 6,
                        fill: COLORS.second,
                        opacity: 0,
                    },
                    copies,
                ),
            );

            animate(boxes, { opacity: [0, 1], duration: 300, delay: stagger(25) });
            svgElement('rect', { x: 20, y: 180, width: SHARED, height: 18, rx: 3, fill: COLORS.first }, bars);
            svgElement(
                'rect',
                { x: 20 + SHARED, y: 180, width: count * PER_COPY, height: 18, rx: 3, fill: COLORS.second },
                bars,
            );
            text(20, 172, 'memory: shared, then what the copies add');
            show(
                `${count} ${count === 1 ? 'copy adds' : 'copies add'} ${count * PER_COPY} to a shared part of ${SHARED}, in units to compare`,
            );
        };

        pick('Copies', Object.keys(COUNTS) as Count[], (next) => draw(COUNTS[next]), '1 copy');
        draw(1);
    },
});
