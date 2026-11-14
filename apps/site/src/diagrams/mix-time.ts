import { mix, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lanes } from './shapes';

/*
 * A mix on one track. Animation A moves the square right, animation B scales it. Every two
 * seconds the track plays the other one, with the mix that is picked. During the mix the
 * square blends from one to the other. What the new animation does not key goes back to the
 * setup pose over the mix: the square slides home as it starts to scale.
 */

const MIXES = { '0 s': 0, '0.25 s': 0.25, '0.5 s': 0.5, '1 s': 1 } as const;

type MixName = keyof typeof MIXES;

/** Seconds each animation plays before the track plays the other one. */
const TURN = 2;

export default defineDiagram({
    setup({ svg, narrow, onFrame, pick, say }) {
        const {
            lanes: [first, second, result],
            timeline: drawTimeline,
        } = lanes(
            svg,
            [
                { label: 'A: moves right', color: COLORS.first, solid: false },
                { label: 'B: scales', color: COLORS.second, solid: false },
                { label: 'Track 0', color: COLORS.result, solid: true },
            ],
            narrow,
            true,
        );
        const line = drawTimeline(TURN * 2);
        const show = say;
        let duration = 0.5;
        let time = 0;
        /** Draws the bars of the two animations with the mix into each. */
        const drawBars = (): void => {
            line.draw([
                { from: 0, to: TURN, color: COLORS.first, label: 'A', mixIn: duration },
                { from: TURN, to: TURN * 2, color: COLORS.second, label: 'B', mixIn: duration },
            ]);
        };

        pick(
            'Mix',
            Object.keys(MIXES) as MixName[],
            (next) => {
                duration = MIXES[next];
                drawBars();
            },
            '0.5 s',
        );
        drawBars();
        onFrame((seconds) => {
            time = (time + seconds) % (TURN * 2);
            const a = { x: 140 * wave(time, 2) };
            const b = { scale: 1 + 0.7 * wave(time, 1) };
            const intoB = time >= TURN;
            const since = intoB ? time - TURN : time;
            const weight = duration === 0 ? 1 : Math.min(1, since / duration);
            const pose = intoB ? mix(a, b, weight) : mix(b, a, weight);

            first.show({ ...SETUP, ...a });
            second.show({ ...SETUP, ...b });
            result.show(pose);
            line.show(time);
            const share = `${Math.floor(weight * 10) * 10} percent of the way`;

            if (weight < 1 && intoB) {
                show(
                    `Mix from {first:A} into {second:B}, ${share}. B keys no position, so the square slides home as B's scale grows.`,
                );
            } else if (weight < 1) {
                show(
                    `Mix from {second:B} into {first:A}, ${share}. B's scale fades back to the setup pose as A moves the square right.`,
                );
            } else if (duration === 0) {
                show(`{${intoB ? 'second:B' : 'first:A'}} alone. With no mix, the square jumped to it in one frame.`);
            } else {
                show(
                    intoB
                        ? '{second:B} alone: it scales the square, and keys no position.'
                        : '{first:A} alone: it moves the square right.',
                );
            }
        });
    },
});
