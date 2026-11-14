import { mix, SETUP, wave } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lane, timeline } from './shapes';

/*
 * A queue. A landing bounces the square up once in 0.6 seconds, and an idle loop that pulses
 * its scale is queued after it with a mix of 0.2 seconds. The delay decides when the idle loop
 * starts: at 0 the mix ends where the landing ends, below 0 it starts earlier, and above 0 it
 * counts from the start of the landing.
 */

const LANDING = 0.6;
const MIX = 0.2;
const SPAN = 2.4;
const DELAYS = { 'delay 0': 0, 'delay -0.2': -0.2, 'delay 0.15': 0.15 } as const;

type DelayName = keyof typeof DELAYS;

/** When the queued animation starts, as the official runtime puts it. */
const startOf = (delay: number): number => (delay > 0 ? delay : LANDING - MIX + delay);

export default defineDiagram({
    setup({ svg, onFrame, pick, say }) {
        const first = lane(svg, { x: 20, y: 10, label: 'landing: bounces once', color: COLORS.first, solid: false });
        const second = lane(svg, { x: 260, y: 10, label: 'idle: pulses, loops', color: COLORS.second, solid: false });
        const result = lane(svg, { x: 500, y: 10, label: 'Track 0', color: COLORS.result, solid: true });
        const line = timeline(svg, 20, 200, 680, SPAN);
        const show = say;
        let delay = 0;
        let time = 0;
        /** Draws the landing and the idle loop where the delay puts it. */
        const drawBars = (): void => {
            const start = startOf(delay);

            line.draw([
                { from: 0, to: LANDING, color: COLORS.first, label: 'landing' },
                { from: start, to: SPAN, color: COLORS.second, label: 'idle', mixIn: MIX },
            ]);
        };

        pick(
            'Queue',
            Object.keys(DELAYS) as DelayName[],
            (next) => {
                delay = DELAYS[next];
                drawBars();
            },
            'delay 0',
        );
        drawBars();
        onFrame((seconds) => {
            time = (time + seconds) % SPAN;
            const start = startOf(delay);
            const landing = { y: time < LANDING ? 70 * Math.sin((Math.PI * time) / LANDING) : 0 };
            const idle = { scale: 1 + 0.35 * wave(Math.max(0, time - start), 1) };
            const weight = time < start ? 0 : Math.min(1, (time - start) / MIX);

            first.show({ ...SETUP, ...landing });
            second.show({ ...SETUP, ...idle });
            result.show(mix(landing, idle, weight));
            line.show(time);
            if (time < start) show('{first:The landing} bounces. {second:Idle} waits in the queue until its turn.');
            else if (weight < 1) {
                show(
                    `Mix: {result:the track} turns from {first:the landing} into {second:idle}, ${Math.round(weight * 10) * 10} percent of the way.${time < LANDING ? ' The landing is still in the air.' : ''}`,
                );
            } else {
                show(
                    delay < 0
                        ? '{second:Idle} alone. It started early, so the bounce never landed.'
                        : '{second:Idle} alone: the queue handed over, and it loops from here.',
                );
            }
        });
    },
});
