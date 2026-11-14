import { layer, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lane } from './shapes';

/*
 * Two tracks that key different values. Track 0 moves the square right, track 1 scales it. The
 * result does both, because a higher track changes only what it keys.
 */

export default defineDiagram({
    setup({ svg, onFrame, toggle, say }) {
        const first = lane(svg, { x: 20, y: 10, label: 'Track 0: moves right', color: COLORS.first, solid: false });
        const second = lane(svg, { x: 260, y: 10, label: 'Track 1: scales', color: COLORS.second, solid: false });
        const result = lane(svg, { x: 500, y: 10, label: 'What you see', color: COLORS.result, solid: true });
        const show = say;
        let upper = true;
        let time = 0;

        toggle('Tracks', 'track 1 plays', true, (on) => {
            upper = on;
        });
        onFrame((seconds) => {
            time += seconds;
            const moves = { x: 140 * wave(time, 2.4) };
            const scales = { scale: 1 + 0.7 * wave(time, 1.6) };
            const base = layer(SETUP, moves, 1, 'replace');
            const pose = upper ? layer(base, scales, 1, 'replace') : base;

            first.show(base);
            second.show(layer(SETUP, scales, 1, 'replace'));
            result.show(pose);
            show(
                upper
                    ? '{first:Track 0} moves the square and {second:track 1} scales it. They key different values, so {result:what you see} does both.'
                    : '{second:Track 1} is off. {first:Track 0} keys no scale, so the scale comes from the setup pose.',
            );
        });
    },
});
