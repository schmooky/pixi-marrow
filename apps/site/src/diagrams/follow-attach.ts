import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Follow and attach. A skeleton draws three slots from the back to the front: back, middle and
 * front, which sway with a bone. A star goes with the bone. With `follow` the star stays where
 * it is in the display list, after the skeleton, so it draws over every slot. With `attach` to
 * the middle slot it becomes part of the draw order, after the middle and before the front, so
 * the front slot covers it.
 */

const MODES = ['follow', 'attach to middle'] as const;

type Mode = (typeof MODES)[number];

export default defineDiagram({
    setup({ svg, onFrame, pick, say }) {
        const scene = svgElement('g', {}, svg);
        const back = svgElement('rect', { width: 120, height: 120, rx: 10, fill: COLORS.first }, scene);
        const middle = svgElement('rect', { width: 100, height: 100, rx: 10, fill: COLORS.second }, scene);
        const star = svgElement(
            'polygon',
            { points: '0,-26 7,-8 26,-8 11,4 16,23 0,12 -16,23 -11,4 -26,-8 -7,-8', fill: '#ffd84a' },
            scene,
        );
        const front = svgElement('rect', { width: 90, height: 60, rx: 10, fill: COLORS.result }, scene);
        const show = say;
        let mode: Mode = 'follow';
        let time = 0;
        /** Puts the star into the draw order the mode gives it. */
        const order = (): void => {
            if (mode === 'follow') scene.append(star);
            else scene.insertBefore(star, front);
            show(
                mode === 'follow'
                    ? 'back, middle, front, then the star: it draws over everything'
                    : 'back, middle, the star, front: the front slot covers it',
            );
        };

        svgElement(
            'text',
            { x: 20, y: 22, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'a skeleton of three slots, back to front, and a star that goes with its bone';
        pick(
            'Star',
            MODES,
            (next) => {
                mode = next;
                order();
            },
            'follow',
        );
        order();
        onFrame((seconds) => {
            time += seconds;
            const sway = 30 * Math.sin(time * 1.6);

            back.setAttribute('x', String(230 + sway * 0.3));
            back.setAttribute('y', '50');
            middle.setAttribute('x', String(280 + sway * 0.6));
            middle.setAttribute('y', '80');
            front.setAttribute('x', String(330 + sway));
            front.setAttribute('y', '120');
            star.setAttribute('transform', `translate(${360 + sway * 0.8} 135)`);
        });
    },
});
