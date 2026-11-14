import { SETUP } from './mixing';
import { defineDiagram } from './runtime';
import { COLORS, lane, timeline } from './shapes';

/*
 * When `finished` resolves. A win of 1.2 seconds grows a square. On the left it plays to its
 * end. On the right another animation replaces it at 0.6 seconds. `finished` resolves in both,
 * and only the right one was cut short, which an `interrupt` listener tells apart.
 */

const WIN = 1.2;
const CUT = 0.6;
const SPAN = 2;

export default defineDiagram({
    setup({ svg, onFrame, readout }) {
        const whole = lane(svg, { x: 20, y: 10, label: 'win plays to its end', color: COLORS.first, solid: true });
        const cut = lane(svg, { x: 260, y: 10, label: 'win replaced at 0.6 s', color: COLORS.second, solid: true });
        const line = timeline(svg, 20, 200, 680, SPAN);
        const showWhole = readout('Left', 60);
        const showCut = readout('Right', 60);
        let time = 0;

        line.draw([
            { from: 0, to: WIN, color: COLORS.first, label: 'win' },
            { from: 0, to: CUT, color: COLORS.second, label: 'win' },
        ]);
        onFrame((seconds) => {
            time = (time + seconds) % SPAN;
            const grow = (at: number): number => 1 + 0.8 * Math.sin((Math.PI * Math.min(at, WIN)) / WIN);

            whole.show({ ...SETUP, scale: time < WIN ? grow(time) : 1 });
            cut.show({ ...SETUP, scale: time < CUT ? grow(time) : 1, x: time < CUT ? 0 : 60 });
            line.show(time);
            showWhole(time < WIN ? 'playing' : `finished resolved at ${WIN} s, no interrupt: it played whole`);
            showCut(time < CUT ? 'playing' : `finished resolved at ${CUT} s, after an interrupt: it was cut short`);
        });
    },
});
