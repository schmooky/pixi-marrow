import { type Application, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { MarrowAsset, type MarrowSpineOptions } from 'pixi-marrow';
import { type ReelSet, ReelSetBuilder, SpeedPresets, WinPresenter } from 'pixi-reels';
import { type LineWin, lineWins, nextGrid, REELS, ROWS, SYMBOL_IDS, SYMBOLS } from './reel-round';
import { MarrowReelSymbol } from './reel-symbol';
import { definePreview } from './runtime';

/*
 * The reels of the slot game Bzzz, spun by pixi-reels and drawn by pixi-marrow. A round spins,
 * lands with the blur and landing animations of the symbols, and shows its line wins: the
 * winners play `win`, and every other symbol plays `disable`. The panel switches the perf
 * preset and the skinning, and counts the draw calls of a frame.
 */

/** The size of a cell. The Bzzz symbols are drawn for it. */
const CELL = 140;
/** Room around the grid. */
const MARGIN = 30;
/** Milliseconds between the start of a spin and its result, as a server would answer. */
const ANSWER = { normal: 500, turbo: 120 } as const;
/** Milliseconds between two rounds of the auto spin. */
const PAUSE = 700;

type Speed = keyof typeof ANSWER;
type Preset = 'exact' | 'balanced' | 'fast';
type Skinning = 'cpu' | 'gpu';

/** Resolves after `ms` milliseconds. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Counts the draw calls of a WebGL renderer, frame by frame. Returns the count of the last
 * frame. A renderer of another kind counts none.
 */
function drawCounter(app: Application): () => number {
    const gl: unknown = Reflect.get(app.renderer, 'gl');
    let count = 0;
    let last = 0;

    if (!(gl instanceof WebGL2RenderingContext)) return () => -1;
    for (const name of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced'] as const) {
        const draw = gl[name] as (...args: unknown[]) => void;

        Reflect.set(gl, name, (...args: unknown[]) => {
            count++;
            draw.apply(gl, args);
        });
    }
    // the render runs late in a tick: the count is taken at the start of the next one
    app.ticker.add(
        () => {
            last = count;
            count = 0;
        },
        undefined,
        UPDATE_PRIORITY.HIGH,
    );

    return () => last;
}

export default definePreview({
    // the grid of cells with the margin around it, as numbers: the page reads them from this file
    size: [760, 480],
    async setup(context) {
        const { app, pick, toggle, readout } = context;
        const entries = await Promise.all(
            SYMBOL_IDS.map(
                async (id) =>
                    [
                        id,
                        await MarrowAsset.load({
                            skeleton: `/rigs/${SYMBOLS[id].file}.skel`,
                            atlas: '/rigs/symbols.atlas',
                        }),
                    ] as const,
            ),
        );
        const assets = Object.fromEntries(entries);
        /**
         * The ticker of the reels, driven by the one of the app, so that it stops with the
         * preview. It is the preview's own: the app destroys its ticker before its stage, and a
         * reel set takes itself off its ticker when it is destroyed.
         */
        const reelTicker = new Ticker();

        reelTicker.autoStart = false;
        app.ticker.add(() => reelTicker.update(performance.now()));
        let preset: Preset = 'balanced';
        let skinning: Skinning = 'cpu';
        let speed: Speed = 'normal';
        let auto = true;
        /** Raised by every rebuild: a round of an older reel set stops at its next step. */
        let generation = 0;
        let reelSet: ReelSet | null = null;
        let presenter: WinPresenter | null = null;
        /** The generation whose loop of rounds runs, or -1. */
        let running = -1;
        let showWin: (text: string) => void = () => {};

        /** The symbol of a cell, as the reel set shows it. */
        const symbolAt = (set: ReelSet, reel: number, row: number): MarrowReelSymbol | null => {
            const symbol = set.reels[reel]?.getSymbolAt(row);

            return symbol instanceof MarrowReelSymbol ? symbol : null;
        };
        /** Names the win that shows. */
        const nameWin = (win: LineWin): void => showWin(`line ${Number(win.id) + 1}: ${win.count}x ${win.symbol}`);

        const build = (): ReelSet => {
            const spine: MarrowSpineOptions =
                skinning === 'gpu' ? { perf: preset, skinning: 'gpu', renderMode: 'mesh' } : { perf: preset };
            const set = new ReelSetBuilder()
                .reels(REELS)
                .visibleCells(ROWS)
                .symbolSize(CELL, CELL)
                .symbols((registry) => {
                    for (const id of SYMBOL_IDS) registry.register(id, MarrowReelSymbol, { assets, spine });
                })
                .weights(Object.fromEntries(SYMBOL_IDS.map((id) => [id, SYMBOLS[id].weight])))
                .speed('normal', SpeedPresets.NORMAL)
                .speed('turbo', SpeedPresets.TURBO)
                .ticker(reelTicker)
                .build();
            const shown = new WinPresenter(set, { dimLosers: false, cycleGap: 350 });

            set.position.set(MARGIN, MARGIN);
            // the wins show one after another: each lights up its own line and dims every other symbol
            set.events.on('win:group', (win) => {
                const line = new Set(win.cells.map((cell) => `${cell.reelIndex}:${cell.cellIndex}`));

                nameWin(win as LineWin);
                for (let reel = 0; reel < REELS; reel++) {
                    for (let row = 0; row < ROWS; row++) {
                        if (!line.has(`${reel}:${row}`)) symbolAt(set, reel, row)?.disable();
                    }
                }
            });
            set.events.on('win:end', () => {
                for (let reel = 0; reel < REELS; reel++) {
                    for (let row = 0; row < ROWS; row++) symbolAt(set, reel, row)?.stopAnimation();
                }
            });
            set.events.on('spin:start', () => {
                shown.abort();
                showWin('spinning');
            });
            app.stage.addChildAt(set, 0);
            presenter = shown;

            return set;
        };

        /** One round on the reel set of this generation: spin, land, show the wins. */
        const round = async (set: ReelSet, mine: number): Promise<void> => {
            const grid = nextGrid(Math.random);

            set.setSpeed(speed);
            const spun = set.spin();

            await wait(ANSWER[speed]);
            if (mine !== generation) return;
            set.setResult(grid.map((visible) => ({ visible })));
            await spun;
            if (mine !== generation) return;
            const wins = lineWins(grid);

            if (wins.length === 0) {
                showWin('no win');

                return;
            }
            await presenter?.show(wins);
        };

        /**
         * Spins round after round while the auto spin is on, on the reel set of the generation it
         * started in. A rebuild starts a loop of its own: a spin of a destroyed reel set never
         * ends, so the loop of the old one stays where it was and is let go.
         */
        const loop = async (): Promise<void> => {
            const mine = generation;

            if (running === mine) return;
            running = mine;
            try {
                while (auto && mine === generation && reelSet !== null && !reelSet.destroyed) {
                    try {
                        await round(reelSet, mine);
                    } catch (error) {
                        // a reel set that a rebuild destroyed in the middle of its round
                        if (mine === generation) throw error;
                    }
                    await wait(PAUSE);
                }
            } finally {
                if (running === mine) running = -1;
            }
        };

        const rebuild = (): void => {
            generation++;
            presenter?.abort();
            presenter?.destroy();
            reelSet?.destroy();
            reelSet = build();
            void loop();
        };

        reelSet = build();
        const draws = drawCounter(app);
        const showDraws = readout('Draw calls', 6);
        let frames = 0;

        app.ticker.add(() => {
            frames++;
            if (frames % 20 === 0) showDraws(String(draws()));
        });
        toggle('Spin', 'auto', auto, (on) => {
            auto = on;
            if (on) void loop();
        });
        pick(
            'Speed',
            ['normal', 'turbo'],
            (option) => {
                speed = option;
            },
            speed,
        );
        pick(
            'Perf',
            ['exact', 'balanced', 'fast'],
            (option) => {
                preset = option;
                rebuild();
            },
            preset,
        );
        pick(
            'Skinning',
            ['cpu', 'gpu'],
            (option) => {
                skinning = option;
                rebuild();
            },
            skinning,
        );
        showWin = readout('Win', 22);
        showWin('none yet');
        void loop();
    },
});
