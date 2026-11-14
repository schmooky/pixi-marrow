import { animate } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS, timeline } from './shapes';

/*
 * The life of a track. A looping idle of 1 second starts, completes once per loop, and at 2.4
 * seconds a win replaces it with a mix of 0.4 seconds. The idle is interrupted when the win
 * starts, ends when the mix is over, and is disposed right after. The marks appear on the
 * time line as the playhead reaches them.
 */

const SPAN = 3.6;
const REPLACE = 2.4;
const MIX = 0.4;
const MARKS = [
    { at: 0, name: 'start', of: 'idle' },
    { at: 1, name: 'complete', of: 'idle' },
    { at: 2, name: 'complete', of: 'idle' },
    { at: REPLACE, name: 'interrupt', of: 'idle' },
    { at: REPLACE, name: 'start', of: 'win' },
    { at: REPLACE + MIX, name: 'end', of: 'idle' },
    { at: REPLACE + MIX + 0.02, name: 'dispose', of: 'idle' },
] as const;

export default defineDiagram({
    setup({ svg, onFrame, readout }) {
        const line = timeline(svg, 20, 150, 680, SPAN);
        const marks = svgElement('g', {}, svg);
        const show = readout('Last', 60);
        const xOf = (seconds: number): number => 20 + (seconds / SPAN) * 680;
        let time = 0;

        line.draw([
            { from: 0, to: REPLACE + MIX, color: COLORS.first, label: 'idle, loops' },
            { from: REPLACE, to: SPAN, color: COLORS.second, label: 'win', mixIn: MIX },
        ]);
        onFrame((seconds) => {
            const before = time;

            time = (time + seconds) % SPAN;
            if (time < before) marks.replaceChildren();
            for (const [index, mark] of MARKS.entries()) {
                if (!(before < mark.at && mark.at <= time) && !(mark.at === 0 && time < before)) continue;
                const x = xOf(mark.at);
                const y = 30 + (index % 4) * 26;
                const group = svgElement('g', { opacity: 0 }, marks);

                svgElement(
                    'line',
                    {
                        x1: x,
                        y1: y + 6,
                        x2: x,
                        y2: 146,
                        stroke: mark.of === 'idle' ? COLORS.first : COLORS.second,
                        'stroke-dasharray': '2 3',
                    },
                    group,
                );
                svgElement(
                    'text',
                    { x: x + 4, y, fill: COLORS.result, 'font-size': 12, 'font-family': 'ui-monospace, monospace' },
                    group,
                ).textContent = `${mark.name} (${mark.of})`;
                animate(group, { opacity: [0, 1], duration: 250 });
                show(`${mark.name} of ${mark.of} at ${mark.at.toFixed(1)} s`);
            }
            line.show(time);
        });
    },
});
