import { defineDiagram, svgElement } from './runtime';

/*
 * Overdraw. Three pictures overlap. Each is a rectangle with a round shape in it, and the rest
 * of the rectangle is transparent. Drawn as rectangles, the GPU paints every pixel of every
 * rectangle, also the transparent ones. Each pixel shows how many times it was painted. Cut to
 * the shapes, the transparent pixels are no longer painted, and the counts drop where nothing
 * shows. The picture is the same in both.
 */

const MODES = ['whole rectangles', 'cut to the shapes'] as const;

type Mode = (typeof MODES)[number];

const PICTURES = [
    { x: 4, y: 3, w: 14, h: 12 },
    { x: 11, y: 6, w: 14, h: 12 },
    { x: 18, y: 2, w: 12, h: 12 },
];
const COLUMNS = 34;
const ROWS = 20;
const CELL = 19;

/** Whether a cell lies in the round shape of a picture, the part that is not transparent. */
const inShape = (picture: (typeof PICTURES)[number], column: number, row: number): boolean => {
    const cx = picture.x + picture.w / 2;
    const cy = picture.y + picture.h / 2;

    return ((column + 0.5 - cx) / (picture.w * 0.38)) ** 2 + ((row + 0.5 - cy) / (picture.h * 0.38)) ** 2 <= 1;
};
const inRect = (picture: (typeof PICTURES)[number], column: number, row: number): boolean =>
    column >= picture.x && column < picture.x + picture.w && row >= picture.y && row < picture.y + picture.h;
const HEAT = ['#18181c', '#2f4b6e', '#5fa8ff', '#ff8a4c', '#ff4d4d'];

export default defineDiagram({
    setup({ svg, pick, readout }) {
        const cells = svgElement('g', {}, svg);
        const show = readout('Painted', 60);
        const draw = (mode: Mode): void => {
            cells.replaceChildren();
            let total = 0;

            for (let row = 0; row < ROWS; row++) {
                for (let column = 0; column < COLUMNS; column++) {
                    const count = PICTURES.filter((picture) =>
                        mode === 'cut to the shapes' ? inShape(picture, column, row) : inRect(picture, column, row),
                    ).length;

                    total += count;
                    svgElement(
                        'rect',
                        {
                            x: 20 + column * CELL,
                            y: 10 + row * CELL,
                            width: CELL - 1,
                            height: CELL - 1,
                            fill: HEAT[Math.min(count, HEAT.length - 1)] ?? '#ff4d4d',
                        },
                        cells,
                    );
                    if (count > 0) {
                        svgElement(
                            'text',
                            {
                                x: 20 + column * CELL + CELL / 2,
                                y: 10 + row * CELL + 13,
                                fill: '#111113',
                                'font-size': 10,
                                'text-anchor': 'middle',
                                'font-family': 'ui-monospace, monospace',
                            },
                            cells,
                        ).textContent = String(count);
                    }
                }
            }
            show(
                `${total} pixels painted for one picture: ${mode === 'whole rectangles' ? 'transparent pixels are painted too' : 'only pixels that show are painted'}`,
            );
        };

        pick('Draw', MODES, draw, 'whole rectangles');
        draw('whole rectangles');
    },
});
