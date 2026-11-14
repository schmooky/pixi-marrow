import { animate } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS, timeline } from './shapes';

/*
 * Event keys. An animation of 1.33 seconds holds two keys, `step` at 0.33 and `hit` at 0.9.
 * The playhead moves through it, and each key fires as the playhead passes it: a line appears
 * in the log. In the second pass the animation mixes out from 0.7 seconds, and the key after
 * that does not fire, because an animation that mixes out fires no event by default.
 */

const LENGTH = 1.33;
const KEYS = [
    { name: 'step', at: 0.33 },
    { name: 'hit', at: 0.9 },
] as const;
const MIX_OUT = 0.7;

export default defineDiagram({
    setup({ svg, onFrame, say }) {
        const line = timeline(svg, 20, 60, 680, LENGTH * 2);
        const log = svgElement('g', {}, svg);
        const show = say;
        const xOf = (seconds: number): number => 20 + (seconds / (LENGTH * 2)) * 680;
        let time = 0;
        let lines = 0;

        line.draw([
            { from: 0, to: LENGTH, color: COLORS.first, label: 'plays' },
            { from: LENGTH, to: LENGTH + MIX_OUT, color: COLORS.first, label: 'plays' },
            { from: LENGTH + MIX_OUT, to: LENGTH * 2, color: COLORS.line, label: 'mixes out' },
        ]);
        for (const pass of [0, LENGTH]) {
            for (const key of KEYS) {
                const x = xOf(pass + key.at);

                svgElement('polygon', { points: `${x},40 ${x + 7},48 ${x},56 ${x - 7},48`, fill: '#ffd84a' }, svg);
                svgElement(
                    'text',
                    {
                        x,
                        y: 32,
                        fill: COLORS.text,
                        'font-size': 12,
                        'text-anchor': 'middle',
                        'font-family': 'ui-monospace, monospace',
                    },
                    svg,
                ).textContent = key.name;
            }
        }
        /** Adds a line to the log and lets it fade in. */
        const write = (text: string, fired: boolean): void => {
            const entry = svgElement(
                'text',
                {
                    x: 24,
                    y: 136 + (lines % 5) * 20,
                    fill: fired ? '#ffd84a' : COLORS.text,
                    'font-size': 13,
                    'font-family': 'ui-monospace, monospace',
                    opacity: 0,
                },
                log,
            );

            entry.textContent = text;
            animate(entry, { opacity: [0, 1], duration: 300 });
            lines++;
            if (lines % 5 === 0) log.replaceChildren();
        };

        onFrame((seconds) => {
            const before = time;

            time = (time + seconds) % (LENGTH * 2);
            if (time < before) {
                log.replaceChildren();
                lines = 0;
            }
            for (const [pass, mixing] of [
                [0, false],
                [LENGTH, true],
            ] as const) {
                for (const key of KEYS) {
                    const at = pass + key.at;

                    if (before < at && at <= time) {
                        if (mixing && key.at > MIX_OUT)
                            write(`${key.name} at ${key.at} s: not fired, the animation mixes out`, false);
                        else write(`${key.name} at ${key.at} s: fired, the listener runs`, true);
                    }
                }
            }
            line.show(time);
            show(
                time < LENGTH
                    ? 'first pass: the animation plays'
                    : 'second pass: from 0.7 s another animation takes over',
            );
        });
    },
});
