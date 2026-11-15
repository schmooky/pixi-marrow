import { fadeOut, layer, type Pose, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lanes } from './shapes';

/*
 * Two tracks that key different values. Track 0 moves the square right, track 1 scales it. The
 * result does both, because a higher track changes only what it keys. Stopping track 1 does not
 * put the scale back by itself: with no mix the scale stays where track 1 left it, because no
 * track keys it any more. With a mix it fades back to the setup pose, because track 0 keys none.
 */

const ACTIONS = ['plays', 'stop()', 'stop, mix 0.5'] as const;

type Action = (typeof ACTIONS)[number];

/** Seconds of the mix that fades track 1 out. */
const FADE = 0.5;

/** What track 1 does: plays, was stopped with no mix, mixes out, or has mixed out. */
type State = 'plays' | 'stopped' | 'fading' | 'faded';

/** What the line under the drawing says for a state of track 1, `share` of the way through its mix out. */
const SAYS: Record<State, (share: number) => string> = {
    plays: () =>
        '{first:Track 0} moves the square and {second:track 1} scales it. They key different values, so {result:what you see} does both.',
    stopped: () =>
        '{second:Track 1} stopped with no mix. No track keys the scale now, so {result:the square} keeps the scale track 1 gave it last.',
    fading: (share) =>
        `{second:Track 1} mixes out, ${Math.floor(share * 10) * 10} percent of the way. {first:Track 0} keys no scale, so the scale fades back to the setup pose.`,
    faded: () =>
        '{second:Track 1} mixed out. The scale is back at the setup pose, and {first:track 0} still moves the square.',
};

/** What the line says when a stop with a mix was picked while track 1 held nothing. */
const NOTHING = '{second:Track 1} holds no animation, so a stop has nothing to mix out. The scale stays where it was.';

export default defineDiagram({
    setup({ svg, narrow, onFrame, pick, say }) {
        const {
            lanes: [first, second, result],
        } = lanes(
            svg,
            [
                { label: 'Track 0: moves right', color: COLORS.first, solid: false },
                { label: 'Track 1: scales', color: COLORS.second, solid: false },
                { label: 'What you see', color: COLORS.result, solid: true },
            ],
            narrow,
            false,
        );
        const show = say;
        let state: State = 'plays';
        /** True when a stop with a mix was picked while track 1 held nothing to mix out. */
        let nothing = false;
        let time = 0;
        /** The time of the animation on track 1, which starts again when it plays again. */
        let upperTime = 0;
        let faded = 0;
        // the pose stays from one update to the next, as in the runtime
        let pose: Pose = { ...SETUP };

        pick(
            'Track 1',
            ACTIONS,
            (next: Action) => {
                nothing = false;
                if (next === 'plays' && state !== 'plays') {
                    state = 'plays';
                    upperTime = 0;
                } else if (next === 'stop()' && (state === 'plays' || state === 'fading')) state = 'stopped';
                else if (next === 'stop, mix 0.5' && state === 'plays') {
                    state = 'fading';
                    faded = 0;
                } else if (next === 'stop, mix 0.5' && state === 'stopped') nothing = true;
            },
            'plays',
        );
        onFrame((seconds) => {
            time += seconds;
            const moves = { x: 140 * wave(time, 2.4) };
            const keyed = state === 'plays' || state === 'fading';

            if (keyed) upperTime += seconds;
            const scales = { scale: 1 + 0.7 * wave(upperTime, 1.6) };

            if (state === 'fading') faded = Math.min(FADE, faded + seconds);
            const share = faded / FADE;

            pose = layer(pose, moves, 1, 'replace');
            if (state === 'plays') pose = layer(pose, scales, 1, 'replace');
            // track 0 keys no scale, so the mix out blends it from the setup pose
            else if (state === 'fading') pose = fadeOut(pose, scales, share);
            if (state === 'fading' && share >= 1) state = 'faded';
            first.show(layer(SETUP, moves, 1, 'replace'));
            // a stopped track holds no animation: its lane shows the setup pose
            second.show(keyed ? layer(SETUP, scales, 1, 'replace') : SETUP);
            result.show(pose);
            show(nothing ? NOTHING : SAYS[state](share));
        });
    },
});
