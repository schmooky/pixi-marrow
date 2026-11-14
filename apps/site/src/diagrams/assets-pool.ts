import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * A pool. A reel shows three cells, and its symbols scroll down. A symbol that leaves at the
 * bottom goes into the pool, and a symbol that enters at the top comes from the pool when one
 * waits there. Without a pool every symbol that enters is made new. Watch the counters: with a
 * pool, making stops after a few symbols.
 */

const CELL = 56;
const SPEED = 140;
const LETTERS = ['A', 'K', 'Q', 'J'];

/** A symbol on the reel. */
interface Symbol {
    y: number;
    letter: string;
    node: SVGGElement;
}

export default defineDiagram({
    setup({ svg, onFrame, toggle, say }) {
        svgElement(
            'rect',
            {
                x: 60,
                y: 30,
                width: CELL + 16,
                height: CELL * 3,
                fill: 'none',
                stroke: COLORS.result,
                'stroke-width': 2,
                rx: 6,
            },
            svg,
        );
        svgElement(
            'text',
            { x: 60, y: 22, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'the reel';
        svgElement(
            'text',
            { x: 220, y: 22, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = 'the pool';
        const reel = svgElement('g', {}, svg);
        const shelf = svgElement('g', {}, svg);
        const show = say;
        const pool: string[] = [];
        const symbols: Symbol[] = [];
        let pooled = true;
        let made = 0;
        let reused = 0;
        let next = 0;
        /** Makes or takes a symbol for the top of the reel. */
        const enter = (y: number): void => {
            const letter = LETTERS[next++ % LETTERS.length] ?? 'A';
            const index = pool.indexOf(letter);

            if (pooled && index !== -1) {
                pool.splice(index, 1);
                reused++;
            } else made++;
            const node = svgElement('g', {}, reel);

            svgElement(
                'rect',
                { x: -CELL / 2 + 4, y: -CELL / 2 + 4, width: CELL - 8, height: CELL - 8, rx: 8, fill: COLORS.second },
                node,
            );
            svgElement(
                'text',
                {
                    y: 7,
                    fill: '#111113',
                    'font-size': 22,
                    'font-weight': 700,
                    'text-anchor': 'middle',
                    'font-family': 'ui-sans-serif, system-ui',
                },
                node,
            ).textContent = letter;
            symbols.push({ y, letter, node });
        };
        /** Draws the pool as a shelf of letters. */
        const drawPool = (): void => {
            shelf.replaceChildren();
            for (const [index, letter] of pool.entries()) {
                const x = 220 + (index % 8) * 34;
                const y = 40 + Math.floor(index / 8) * 34;

                svgElement(
                    'rect',
                    { x, y, width: 28, height: 28, rx: 5, fill: 'none', stroke: COLORS.second, 'stroke-width': 2 },
                    shelf,
                );
                svgElement(
                    'text',
                    {
                        x: x + 14,
                        y: y + 19,
                        fill: COLORS.second,
                        'font-size': 14,
                        'text-anchor': 'middle',
                        'font-family': 'ui-sans-serif, system-ui',
                    },
                    shelf,
                ).textContent = letter;
            }
        };

        for (let row = -1; row < 3; row++) enter(30 + CELL / 2 + row * CELL);
        toggle('Pool', 'reuse copies', true, (on) => {
            pooled = on;
            pool.length = 0;
            made = 0;
            reused = 0;
        });
        onFrame((seconds) => {
            for (const symbol of symbols) {
                symbol.y += SPEED * seconds;
                symbol.node.setAttribute('transform', `translate(${60 + 8 + CELL / 2} ${symbol.y})`);
                symbol.node.setAttribute('opacity', symbol.y < 30 || symbol.y > 30 + CELL * 3 ? '0.2' : '1');
            }
            const gone = symbols.filter((symbol) => symbol.y > 30 + CELL * 3 + CELL / 2);

            for (const symbol of gone) {
                symbols.splice(symbols.indexOf(symbol), 1);
                symbol.node.remove();
                if (pooled) pool.push(symbol.letter);
                enter(Math.min(...symbols.map((item) => item.y)) - CELL);
            }
            drawPool();
            show(
                pooled
                    ? `Made ${made} copies, and reused ${reused} from the pool.`
                    : `Made ${made} copies. Without a pool, every symbol that enters is made new.`,
            );
        });
    },
});
