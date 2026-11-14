import { SETUP } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lanes } from './shapes';

/*
 * Loop and hold. The same animation, which moves a square right in one second, plays three
 * ways. With `loop: true` it starts again at its end. With `loop: false` it stops at its end
 * and holds its last frame. An animation of 0 seconds is a pose: it holds from the start.
 */

const LENGTH = 1;
const SPAN = 3;

export default defineDiagram({
    setup({ svg, narrow, onFrame, say }) {
        const {
            lanes: [looping, once, pose],
            timeline: drawTimeline,
        } = lanes(
            svg,
            [
                { label: 'loop: true', color: COLORS.first, solid: true },
                { label: 'loop: false', color: COLORS.second, solid: true },
                { label: 'an animation of 0 s', color: COLORS.result, solid: true },
            ],
            narrow,
            true,
        );
        const line = drawTimeline(SPAN);
        const show = say;
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
                    ? 'The first second: {first:loop: true} and {second:loop: false} both play the move. {result:The 0 s animation} has only one frame, so it holds it.'
                    : '{first:loop: true} jumps back to the start and plays again. {second:loop: false} stops and holds its last frame. It does not go back.',
            );
        });
    },
});
