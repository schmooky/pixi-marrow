import { mix, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lane, timeline } from './shapes';

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
    setup({ svg, onFrame, pick, readout }) {
        const first = lane(svg, { x: 20, y: 10, label: 'A: moves right', color: COLORS.first, solid: false });
        const second = lane(svg, { x: 260, y: 10, label: 'B: scales', color: COLORS.second, solid: false });
        const result = lane(svg, { x: 500, y: 10, label: 'Track 0', color: COLORS.result, solid: true });
        const line = timeline(svg, 20, 200, 680, TURN * 2);
        const show = readout('Now', 56);
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
            show(
                weight < 1
                    ? `${intoB ? 'A to B' : 'B to A'}, ${(weight * 100).toFixed(0)} percent of the way: x ${pose.x.toFixed(0)}, scale ${pose.scale.toFixed(2)}`
                    : `${intoB ? 'B' : 'A'} alone: x ${pose.x.toFixed(0)}, scale ${pose.scale.toFixed(2)}`,
            );
        });
    },
});
