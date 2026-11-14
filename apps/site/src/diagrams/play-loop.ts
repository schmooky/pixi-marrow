import { SETUP } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lane, timeline } from './shapes';

/*
 * Loop and hold. The same animation, which moves a square right in one second, plays three
 * ways. With `loop: true` it starts again at its end. With `loop: false` it stops at its end
 * and holds its last frame. An animation of 0 seconds is a pose: it holds from the start.
 */

const LENGTH = 1;
const SPAN = 3;

export default defineDiagram({
    setup({ svg, onFrame, readout }) {
        const looping = lane(svg, { x: 20, y: 10, label: 'loop: true', color: COLORS.first, solid: true });
        const once = lane(svg, { x: 260, y: 10, label: 'loop: false', color: COLORS.second, solid: true });
        const pose = lane(svg, { x: 500, y: 10, label: 'an animation of 0 s', color: COLORS.result, solid: true });
        const line = timeline(svg, 20, 200, 680, SPAN);
        const show = readout('Time', 60);
        let time = 0;

        line.draw([
            { from: 0, to: 1, color: COLORS.first, label: 'loop 1' },
            { from: 1, to: 2, color: COLORS.first, label: 'loop 2' },
            { from: 2, to: 3, color: COLORS.first, label: 'loop 3' },
            { from: 0, to: LENGTH, color: COLORS.second, label: 'once' },
        ]);
        onFrame((seconds) => {
            time = (time + seconds) % SPAN;
            const local = time % LENGTH;

            looping.show({ ...SETUP, x: 140 * local });
            once.show({ ...SETUP, x: (140 * Math.min(time, LENGTH)) / LENGTH });
            pose.show({ ...SETUP, x: 70, scale: 0.7 });
            line.show(time);
            show(
                time < LENGTH
                    ? `${time.toFixed(2)} s: both play the move`
                    : `${time.toFixed(2)} s: the loop plays it again, the other holds its last frame`,
            );
        });
    },
});
