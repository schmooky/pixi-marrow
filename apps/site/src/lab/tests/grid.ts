import type { MarrowSpine } from 'pixi-marrow';
import { SYMBOL_IDS, SYMBOLS, type SymbolId } from '../../previews/reel-round';
import { testInfo } from '../catalog';
import { defineTest } from '../lab';
import { fitCell, phase } from '../place';
import { durationOf, frameOf, makeSkeleton, updateAll } from '../skeletons';

/*
 * The grid of a slot game, with the beats of the Reels page but no reel that moves: every
 * symbol stays in its cell, so the test times pixi-marrow and not the reels. A cycle of 4
 * seconds spins every symbol, lands the reels one after another and shows two line wins.
 * Symbols that did not win stand still, dimmed, which is where the idle cache of `balanced`
 * takes its images. The grid is drawn from fixed numbers, so every side sees the same symbols.
 */

const COLUMNS = 5;
/** Frames of one cycle, at 60 a second. */
const CYCLE = 240;
/** The frames of the cycle where the beats start. A reel lands `LAND_GAP` frames after the one before. */
const LAND = 40;
const LAND_GAP = 10;
const FIRST_WIN = 130;
const SECOND_WIN = 190;
/** The row of the second win line on each reel of a block of three rows. */
const V_LINE = [0, 1, 2, 1, 0];
/** The seed of the grid. */
const SEED = 7;

/** A random number generator from a seed: the same seed gives the same numbers. */
function seeded(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/** A symbol drawn by the weights of the Reels page. */
function drawSymbol(random: () => number): SymbolId {
    const total = SYMBOL_IDS.reduce((sum, id) => sum + SYMBOLS[id].weight, 0);
    let left = random() * total;

    for (const id of SYMBOL_IDS) {
        left -= SYMBOLS[id].weight;
        if (left < 0) return id;
    }

    return 'a';
}

/** A cell of the grid: its skeleton, reel and row. */
interface Cell {
    symbol: MarrowSpine;
    reel: number;
    row: number;
}

export default defineTest({
    ...testInfo('grid'),
    rigs: SYMBOL_IDS.map((id) => SYMBOLS[id].file),
    sides: [
        { name: 'exact', options: {} },
        { name: 'balanced', options: { perf: 'balanced' } },
        { name: 'fast', options: { perf: 'fast' } },
        { name: 'GPU skinning', options: { renderMode: 'mesh', skinning: 'gpu' } },
    ],
    // half a cycle to warm up, then a whole cycle of 240 frames, 4 to a sample
    timing: { warmup: CYCLE / 2, samples: CYCLE / 4 },
    build(context) {
        const { width, height, count } = context;
        const rows = Math.ceil(count / COLUMNS);
        const size = Math.min(width / COLUMNS, height / rows);
        const left = (width - size * COLUMNS) / 2;
        const top = (height - size * rows) / 2;
        const random = seeded(SEED);
        const cells: Cell[] = Array.from({ length: count }, (_, index) => {
            const rig = SYMBOLS[drawSymbol(random)].file;
            const symbol = makeSkeleton(context, rig);
            const reel = index % COLUMNS;
            const row = Math.floor(index / COLUMNS);
            symbol.play('idle', { loop: true });
            symbol.update(phase(index) * durationOf(symbol, 'idle'));
            fitCell(symbol, frameOf(context, rig), left + reel * size, top + row * size, size, size);

            return { symbol, reel, row };
        });
        const symbols = cells.map((cell) => cell.symbol);
        /** Plays a win on the cells of a line and dims the others. */
        const win = (onLine: (cell: Cell) => boolean): void => {
            for (const cell of cells) {
                if (onLine(cell)) {
                    cell.symbol.play('win');
                    cell.symbol.queue('idle', { loop: true });
                } else cell.symbol.play('disable');
            }
        };
        let frame = 0;

        return {
            step(seconds) {
                const at = frame % CYCLE;

                if (at === 0) for (const symbol of symbols) symbol.play('blur_in');
                for (const cell of cells) {
                    if (at !== LAND + cell.reel * LAND_GAP) continue;
                    cell.symbol.play('blur_out');
                    cell.symbol.queue('landing');
                    cell.symbol.queue('idle', { loop: true });
                }
                if (at === FIRST_WIN) win((cell) => cell.row % 3 === 1);
                if (at === SECOND_WIN) win((cell) => cell.row % 3 === V_LINE[cell.reel]);
                frame++;
                updateAll(symbols, seconds);
            },
        };
    },
});
