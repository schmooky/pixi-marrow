import { SETUP } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lane, timeline } from './shapes';

/*
 * Speed and part of an animation. The animation moves a square right in one second and loops.
 * At speed 1 it takes one second, at speed 0.5 two. With `start: 0.25` and `end: 0.75` only the
 * middle half plays, and the loop repeats that half.
 */

const SPAN = 2;

export default defineDiagram({
    setup({ svg, onFrame }) {
        const normal = lane(svg, { x: 20, y: 10, label: 'speed 1', color: COLORS.first, solid: true });
        const half = lane(svg, { x: 260, y: 10, label: 'speed 0.5', color: COLORS.second, solid: true });
        const part = lane(svg, { x: 500, y: 10, label: 'start 0.25, end 0.75', color: COLORS.result, solid: true });
        const line = timeline(svg, 20, 200, 680, SPAN);
        let time = 0;

        line.draw([
            { from: 0, to: 1, color: COLORS.first, label: 'speed 1' },
            { from: 1, to: 2, color: COLORS.first, label: 'again' },
            { from: 0, to: 2, color: COLORS.second, label: 'speed 0.5' },
        ]);
        onFrame((seconds) => {
            time = (time + seconds) % SPAN;
            normal.show({ ...SETUP, x: 140 * (time % 1) });
            half.show({ ...SETUP, x: 140 * ((time * 0.5) % 1) });
            part.show({ ...SETUP, x: 140 * (0.25 + (time % 0.5)) });
            line.show(time);
        });
    },
});
