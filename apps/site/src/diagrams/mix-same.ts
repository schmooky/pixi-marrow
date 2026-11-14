import { layer, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lane } from './shapes';

/*
 * Two tracks that key the same value. Track 0 scales the square up, track 1 scales it down.
 * Which one shows depends on how track 1 applies: it replaces, it replaces half way at alpha
 * 0.5, or it adds its change to what track 0 gives.
 */

const MODES = ['replace', 'alpha 0.5', 'additive'] as const;

type Mode = (typeof MODES)[number];

export default defineDiagram({
    setup({ svg, onFrame, pick, readout }) {
        const first = lane(svg, { x: 20, y: 10, label: 'Track 0: scales up', color: COLORS.first, solid: false });
        const second = lane(svg, { x: 260, y: 10, label: 'Track 1: scales down', color: COLORS.second, solid: false });
        const result = lane(svg, { x: 500, y: 10, label: 'What you see', color: COLORS.result, solid: true });
        const show = readout('Scale', 52);
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
            show(`track 0 ${base.scale.toFixed(2)}, track 1 ${down.scale.toFixed(2)}, result ${pose.scale.toFixed(2)}`);
        });
    },
});
