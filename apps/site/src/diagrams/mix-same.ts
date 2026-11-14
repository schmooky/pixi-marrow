import { layer, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lanes } from './shapes';

/*
 * Two tracks that key the same value. Track 0 scales the square up, track 1 scales it down.
 * Which one shows depends on how track 1 applies: it replaces, it replaces half way at alpha
 * 0.5, or it adds its change to what track 0 gives.
 */

const MODES = ['replace', 'alpha 0.5', 'additive'] as const;

type Mode = (typeof MODES)[number];

/** A change with its sign, and no sign for none. */
const signed = (change: number): string =>
    Math.abs(change) < 0.005 ? '0.00' : `${change < 0 ? '-' : '+'}${Math.abs(change).toFixed(2)}`;

export default defineDiagram({
    setup({ svg, narrow, onFrame, pick, say }) {
        const {
            lanes: [first, second, result],
        } = lanes(
            svg,
            [
                { label: 'Track 0: scales up', color: COLORS.first, solid: false },
                { label: 'Track 1: scales down', color: COLORS.second, solid: false },
                { label: 'What you see', color: COLORS.result, solid: true },
            ],
            narrow,
            false,
        );
        const show = say;
        let mode: Mode = 'replace';
        let time = 0;

        pick(
            'Track 1',
            MODES,
            (next) => {
                mode = next;
            },
            'replace',
        );
        onFrame((seconds) => {
            time += seconds;
            const up = { scale: 1 + 0.8 * wave(time, 2) };
            const down = { scale: 1 - 0.5 * wave(time, 2) };
            const base = layer(SETUP, up, 1, 'replace');
            const pose = layer(base, down, mode === 'alpha 0.5' ? 0.5 : 1, mode === 'additive' ? 'add' : 'replace');

            first.show(base);
            second.show(layer(SETUP, down, 1, 'replace'));
            result.show(pose);
            const [a, b, seen] = [base.scale, down.scale, pose.scale].map((value) => value.toFixed(2));

            if (mode === 'replace')
                show(
                    `Replace: {second:track 1} wins with ${b}, and {first:track 0}'s ${a} does not count. {result:Scale ${seen}}.`,
                );
            else if (mode === 'alpha 0.5')
                show(
                    `Alpha 0.5: halfway from {first:track 0}'s ${a} to {second:track 1}'s ${b}. {result:Scale ${seen}}.`,
                );
            else
                show(
                    `Additive: {second:track 1} adds its change from the setup pose, ${signed(down.scale - 1)}, to {first:track 0}'s ${a}. {result:Scale ${seen}}.`,
                );
        });
    },
});
