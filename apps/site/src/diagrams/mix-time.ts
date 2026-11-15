import { mix, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lanes } from './shapes';

/*
 * A mix on one track. Animation A moves the square right, animation B scales it up. Every two
 * seconds the track plays the other one from its start, with the mix that is picked. Each is
 * replaced at its far end, A with the square at the right and B with the square grown, so with
 * no mix the square jumps. During a mix the square blends from one to the other. What the new
 * animation does not key goes back to the setup pose over the mix: the square slides home as
 * B starts to scale it.
 */

const MIXES = { '0 s': 0, '0.25 s': 0.25, '0.5 s': 0.5, '1 s': 1 } as const;

type MixName = keyof typeof MIXES;

/** Seconds each animation plays before the track plays the other one. */
const TURN = 2;

/**
 * Seconds of one loop of A and of B. Each reaches its far end after `TURN` seconds, where the
 * track replaces it, and is back at the setup pose after this many.
 */
const LOOP = TURN * 2;

export default defineDiagram({
    setup({ svg, narrow, onFrame, pick, say }) {
        const {
            lanes: [first, second, result],
            timeline: drawTimeline,
        } = lanes(
            svg,
            [
                { label: 'A: moves right', color: COLORS.first, solid: false },
                { label: 'B: scales up', color: COLORS.second, solid: false },
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
            // A starts with the track and B two seconds later, so each is at its own time here
            const a = { x: 140 * wave(time, LOOP) };
            const b = { scale: 1 + 0.7 * wave(time - TURN, LOOP) };
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
                show(
                    intoB
                        ? '{second:B} alone. With no mix, the square jumped home from the right in one frame.'
                        : '{first:A} alone. With no mix, the grown square jumped back to its own size in one frame.',
                );
            } else {
                show(
                    intoB
                        ? '{second:B} alone: it scales the square up, and keys no position.'
                        : '{first:A} alone: it moves the square right.',
                );
            }
        });
    },
});
