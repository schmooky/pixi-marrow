import { Container, Text, type Ticker } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';
import { definePreview } from './runtime';

/*
 * Draw calls on a grid of 5 by 3 symbols of the slot game Bzzz, counted on the WebGL context of
 * this preview. The symbols lie in one container, so the batched mode draws them all in one
 * call. Every two seconds one of them wins and moves to the end of the container, on top of
 * its neighbours, and the call stays one. The switches put the things in that end a batch.
 */

const RIGS = [
    'animation_a',
    'animation_coin',
    'animation_j',
    'animation_bee',
    'animation_k',
    'animation_rose_flower',
    'animation_q',
    'animation_wild',
    'animation_blue_flower',
    'animation_a',
    'animation_purple_flower',
    'animation_k',
    'animation_coin',
    'animation_q',
    'animation_j',
] as const;
const COLUMNS = 5;
const CELL = 140;
/** Where the grid starts, in design units. */
const LEFT = 30;
const TOP = 20;
/** Seconds between two wins, and how much a winning symbol grows. */
const WIN_EVERY = 2;
const WIN_SCALE = 1.18;
/** The symbol that multiplies when its switch is on, and the place of the text in the container. */
const MULTIPLIED = 6;
const TEXT_AFTER = 7;

/** The draw methods of WebGL2 that the preview counts. */
const DRAWS = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const;

/** Counts the draw calls of one WebGL context, by wrapping its methods. */
function countDraws(gl: WebGL2RenderingContext): { count: number } {
    const counter = { count: 0 };

    for (const name of DRAWS) {
        const original = gl[name].bind(gl) as (...args: unknown[]) => void;

        Reflect.set(gl, name, (...args: unknown[]) => {
            counter.count++;
            original(...args);
        });
    }

    return counter;
}

/** A symbol in its cell, with the scale that fits it. */
interface Cell {
    symbol: MarrowSpine;
    scale: number;
}

export default definePreview({
    size: [760, 460],
    async setup(context) {
        const { app, toggle, readout } = context;
        const showDraws = readout('Draw calls', 56);
        const showWhy = readout('Why', 56);
        const reels = new Container();
        const label = new Text({
            text: 'x2',
            style: { fontFamily: 'ui-monospace, monospace', fontSize: 34, fontWeight: '700', fill: 0xffd84a },
            resolution: 2,
        });
        const gl: unknown = Reflect.get(app.renderer, 'gl');
        const counter = gl instanceof WebGL2RenderingContext ? countDraws(gl) : null;
        const assets = new Map<string, MarrowAsset>();
        const breaks = { text: false, multiply: false, meshes: false };
        let clock = 0;
        let winner = 0;
        let shown = -1;

        await Promise.all(
            [...new Set(RIGS)].map(async (rig) => {
                assets.set(
                    rig,
                    await MarrowAsset.load({ skeleton: `/rigs/${rig}.skel`, atlas: '/rigs/symbols.atlas' }),
                );
            }),
        );
        const cells: Cell[] = RIGS.map((rig, index) => {
            const asset = assets.get(rig);

            if (asset === undefined) throw new Error(`no rig ${rig}`);
            const symbol = new MarrowSpine(asset);

            symbol.update(0);
            const box = symbol.getLocalBounds();
            const scale = (CELL / Math.max(box.width, box.height)) * 0.82;

            symbol.scale.set(scale);
            symbol.pivot.set(box.x + box.width / 2, box.y + box.height / 2);
            symbol.position.set(
                LEFT + (index % COLUMNS) * CELL + CELL / 2,
                TOP + Math.floor(index / COLUMNS) * CELL + CELL / 2,
            );
            symbol.play('idle', { loop: true });
            symbol.update((index * 0.618) % 1.3);
            reels.addChild(symbol);

            return { symbol, scale };
        });

        label.anchor.set(0.5);
        label.position.set(
            LEFT + (TEXT_AFTER % COLUMNS) * CELL + CELL / 2,
            TOP + Math.floor(TEXT_AFTER / COLUMNS) * CELL + CELL * 0.85,
        );
        app.stage.addChild(reels);
        /** Puts the text between the symbols, or takes it out. */
        const placeText = (): void => {
            label.removeFromParent();
            if (breaks.text) reels.addChildAt(label, TEXT_AFTER + 1);
        };
        /** Says why the frame takes the draw calls it takes. */
        const explain = (): string => {
            const reasons: string[] = [];

            if (breaks.meshes) reasons.push('every symbol draws its own meshes');
            if (breaks.multiply) reasons.push('one symbol multiplies, a blend state of its own');
            if (breaks.text) reasons.push('a Pixi text lies between two symbols');

            return reasons.length === 0 ? 'all symbols follow each other and share one batch' : reasons.join(', and ');
        };

        toggle('Break it', 'text between', false, (on) => {
            breaks.text = on;
            placeText();
        });
        toggle('Break it', 'multiply', false, (on) => {
            breaks.multiply = on;
            const cell = cells[MULTIPLIED];

            if (cell !== undefined) cell.symbol.blendMode = on ? 'multiply' : 'normal';
        });
        toggle('Break it', 'meshes', false, (on) => {
            breaks.meshes = on;
            for (const { symbol } of cells) symbol.renderMode = on ? 'mesh' : 'batched';
        });
        app.ticker.add((ticker: Ticker) => {
            clock += ticker.deltaMS / 1000;
            if (clock >= WIN_EVERY) {
                clock = 0;
                const last = cells[winner];

                last?.symbol.scale.set(last.scale);
                winner = (winner + 7) % cells.length;
                const next = cells[winner];

                if (next !== undefined) {
                    next.symbol.play('win');
                    next.symbol.queue('idle', { loop: true });
                    next.symbol.scale.set(next.scale * WIN_SCALE);
                    // on top of its neighbours: the end of the container draws last
                    reels.addChild(next.symbol);
                    placeText();
                }
            }
            if (counter === null) {
                showDraws('not counted: this browser draws the preview without WebGL2');
            } else if (counter.count !== shown || clock === 0) {
                shown = counter.count;
                showDraws(`${shown} per frame for ${cells.length} symbols`);
            }
            if (counter !== null) counter.count = 0;
            showWhy(explain());
        });
    },
});
