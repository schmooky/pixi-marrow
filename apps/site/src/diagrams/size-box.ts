import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Why to fit by the setup pose. A square plays an animation that grows it and lifts it. On the
 * left it is fitted to its cell by its box in the current frame. That box hugs the square, so
 * the fit shrinks the growth away and centres the lift away, and the animation disappears. On
 * the right it is fitted once by the box of its setup pose, and the animation plays as made.
 */

const CELL = 150;
const SIDE = 60;

/** The scale and the lift of the animation at a time. */
function poseAt(time: number): { scale: number; lift: number } {
    const wave = 0.5 - 0.5 * Math.cos(time * Math.PI * 1.4);

    return { scale: 1 + 0.5 * wave, lift: 26 * wave };
}

export default defineDiagram({
    setup({ svg, onFrame, readout }) {
        const cell = (x: number, label: string): { square: SVGRectElement; box: SVGRectElement } => {
            svgElement(
                'text',
                { x, y: 18, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
                svg,
            ).textContent = label;
            svgElement(
                'rect',
                { x, y: 30, width: CELL, height: CELL, fill: 'none', stroke: COLORS.line, 'stroke-width': 1.5 },
                svg,
            );

            return {
                box: svgElement('rect', { fill: 'none', stroke: COLORS.result, 'stroke-dasharray': '4 3' }, svg),
                square: svgElement('rect', { rx: 6, fill: COLORS.second }, svg),
            };
        };
        const live = cell(60, 'fitted by the box of each frame');
        const setup = cell(400, 'fitted once by the setup box');
        const show = readout('Watch', 60);
        let time = 0;
        /** Places the square of a cell: its size and lift scaled by `fit`, and its dashed box. */
        const place = (
            target: { square: SVGRectElement; box: SVGRectElement },
            x: number,
            fit: number,
            pose: { scale: number; lift: number },
        ): void => {
            const side = SIDE * pose.scale * fit;
            const left = x + CELL / 2 - side / 2;
            const top = 30 + CELL / 2 - side / 2 - pose.lift * fit;

            for (const node of [target.square, target.box]) {
                node.setAttribute('x', String(left));
                node.setAttribute('y', String(top));
                node.setAttribute('width', String(side));
                node.setAttribute('height', String(side));
            }
        };

        onFrame((seconds) => {
            time += seconds;
            const pose = poseAt(time);
            // the box of the frame is the square itself: fitting to it undoes the growth and the lift
            place(live, 60, (CELL * 0.6) / (SIDE * pose.scale), { scale: pose.scale, lift: 0 });
            place(setup, 400, (CELL * 0.6) / SIDE, pose);
            show('left: the fit undoes the animation in every frame. Right: it grows and lifts as made');
        });
    },
});
