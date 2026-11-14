import type { Win } from 'pixi-reels';

/*
 * The rounds of the reels preview: a grid of Bzzz symbols, and the wins on its paylines. It is
 * no game math. Most rounds get a line win planted into a random grid, so that the preview shows
 * its win animations often.
 */

/** Reels and rows of the grid. */
export const REELS = 5;
export const ROWS = 3;

/** The symbol ids of the reels, with the skeleton file of each and how often it shows. */
export const SYMBOLS = {
    a: { file: 'animation_a', weight: 12 },
    j: { file: 'animation_j', weight: 12 },
    k: { file: 'animation_k', weight: 12 },
    q: { file: 'animation_q', weight: 12 },
    blue: { file: 'animation_blue_flower', weight: 8 },
    purple: { file: 'animation_purple_flower', weight: 8 },
    rose: { file: 'animation_rose_flower', weight: 7 },
    bee: { file: 'animation_bee', weight: 5 },
    wild: { file: 'animation_wild', weight: 3 },
    coin: { file: 'animation_coin', weight: 3 },
} as const;

export type SymbolId = keyof typeof SYMBOLS;

/** The ids in a fixed order. */
export const SYMBOL_IDS = Object.keys(SYMBOLS) as SymbolId[];

/** The symbols a line pays for: not the wild, which stands in for them, and not the coin. */
const PAYING: readonly SymbolId[] = SYMBOL_IDS.filter((id) => id !== 'wild' && id !== 'coin');

/** Ten paylines of a 5 by 3 grid: the row of each reel. */
const LINES: readonly (readonly number[])[] = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [0, 1, 1, 1, 0],
];

/** How often a round gets a planted win. */
const PLANTED = 0.7;

/** A grid: the symbol of every row of every reel, as `grid[reel][row]`. */
export type Grid = SymbolId[][];

/** A symbol drawn by the weights. */
function draw(random: () => number): SymbolId {
    const total = SYMBOL_IDS.reduce((sum, id) => sum + SYMBOLS[id].weight, 0);
    let left = random() * total;

    for (const id of SYMBOL_IDS) {
        left -= SYMBOLS[id].weight;
        if (left < 0) return id;
    }

    return 'a';
}

/** A pick from a list. */
const pickFrom = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)] as T;

/**
 * The grid of the next round. Most rounds get 3 to 5 of one symbol on a payline from the left,
 * with a wild among them now and then.
 *
 * @example
 * const grid = nextGrid(Math.random);
 */
export function nextGrid(random: () => number): Grid {
    const grid: Grid = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, () => draw(random)));

    if (random() < PLANTED) {
        const line = pickFrom(LINES, random);
        const symbol = pickFrom(PAYING, random);
        const length = 3 + Math.floor(random() * 3);
        const wild = random() < 0.3 ? Math.floor(random() * length) : -1;

        for (let reel = 0; reel < length; reel++) {
            const column = grid[reel];

            if (column !== undefined) column[line[reel] ?? 0] = reel === wild ? 'wild' : symbol;
        }
    }

    return grid;
}

/** A line win with what it is for, as the readout says it. */
export interface LineWin extends Win {
    /** The symbol the line pays for, and how many in a row. */
    readonly symbol: SymbolId;
    readonly count: number;
}

/**
 * The wins of a grid: each payline with 3 or more of one symbol from the left reel. A wild
 * stands in for any paying symbol.
 *
 * @example
 * const wins = lineWins(grid);
 */
export function lineWins(grid: Grid): LineWin[] {
    const wins: LineWin[] = [];

    LINES.forEach((line, id) => {
        const shown = line.map((row, reel) => grid[reel]?.[row] ?? 'a');
        const symbol = shown.find((id) => id !== 'wild') ?? 'wild';

        if (!PAYING.includes(symbol)) return;
        let count = 0;

        while (count < shown.length && (shown[count] === symbol || shown[count] === 'wild')) count++;
        if (count < 3) return;
        wins.push({
            id,
            symbol,
            count,
            value: count * (SYMBOLS[symbol].weight > 10 ? 1 : 3),
            cells: line.slice(0, count).map((row, reel) => ({ reelIndex: reel, cellIndex: row })),
        });
    });

    return wins;
}
