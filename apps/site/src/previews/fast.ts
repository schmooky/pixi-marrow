import { Container, type Ticker } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';
import { countDraws } from './draws';
import { definePreview } from './runtime';

/*
 * What a frame costs as the scene changes, on 60 symbols of the slot game Bzzz. The preview
 * updates the skeletons itself and times that update. It counts the skeletons that wrote new
 * vertex positions in the frame and the draw calls. In `all play` every skeleton loops, in
 * `few play` they rest and five a second play a win, and in `all rest` nothing moves.
 */

const RIGS = [
    'animation_a',
    'animation_j',
    'animation_k',
    'animation_q',
    'animation_coin',
    'animation_bee',
    'animation_wild',
    'animation_rose_flower',
    'animation_blue_flower',
    'animation_purple_flower',
] as const;
const COUNT = 60;
const COLUMNS = 10;
const CELL = 76;
const SCENES = ['all play', 'few play', 'all rest'] as const;

type Scene = (typeof SCENES)[number];

/** Seconds between two wins in `few play`, and frames the shown numbers average over. */
const WIN_EVERY = 0.2;
const AVERAGE = 30;

export default definePreview({
    size: [760, 470],
    async setup(context) {
        const { app, pick, readout } = context;
        const showUpdate = readout('Update', 52);
        const showMoved = readout('Moved', 52);
        const showDraws = readout('Draw calls', 52);
        const grid = new Container();
        const gl: unknown = Reflect.get(app.renderer, 'gl');
        const counter = gl instanceof WebGL2RenderingContext ? countDraws(gl) : null;
        const assets = new Map<string, MarrowAsset>();
        const times: number[] = [];
        let scene: Scene = 'all play';
        let clock = 0;
        let wins = 0;

        await Promise.all(
            RIGS.map(async (rig) => {
                assets.set(
                    rig,
                    await MarrowAsset.load({ skeleton: `/rigs/${rig}.skel`, atlas: '/rigs/symbols.atlas' }),
                );
            }),
        );
        const skeletons = Array.from({ length: COUNT }, (_, index) => {
            const asset = assets.get(RIGS[index % RIGS.length] ?? 'animation_a');

            if (asset === undefined) throw new Error('a rig did not load');
            // this preview updates the skeletons itself, to time the update
            const hero = new MarrowSpine(asset, { autoUpdate: false });

            hero.update(0);
            const box = hero.getLocalBounds();
            const scale = (CELL / Math.max(box.width, box.height)) * 0.82;

            hero.scale.set(scale);
            hero.pivot.set(box.x + box.width / 2, box.y + box.height / 2);
            hero.position.set(
                (index % COLUMNS) * CELL + CELL / 2 + 0.5 * (760 - COLUMNS * CELL),
                Math.floor(index / COLUMNS) * CELL + CELL / 2 + 0.5 * (470 - (COUNT / COLUMNS) * CELL),
            );
            grid.addChild(hero);

            return hero;
        });
        const uploads = skeletons.map((hero) => hero.stats.positionUploads);
        /** Starts a scene: every skeleton loops, or lands and then rests. */
        const start = (next: Scene): void => {
            scene = next;
            times.length = 0;
            clock = 0;
            wins = 0;
            for (const [index, hero] of skeletons.entries()) {
                if (next === 'all play') {
                    hero.play('idle', { loop: true });
                    hero.update((index * 0.37) % 1.3);
                } else {
                    // a landing that ended holds its last frame, and the skeleton rests
                    hero.play('landing');
                    hero.update(1);
                }
            }
        };

        app.stage.addChild(grid);
        app.ticker.add((ticker: Ticker) => {
            const seconds = ticker.deltaMS / 1000;

            clock += seconds;
            if (scene === 'few play') {
                for (; wins * WIN_EVERY <= clock; wins++) skeletons[(wins * 7) % COUNT]?.play('win');
            }
            const begin = performance.now();

            for (const hero of skeletons) hero.update(seconds);
            times.push(performance.now() - begin);
            if (times.length > AVERAGE) times.shift();
            const moved = skeletons.filter((hero, i) => hero.stats.positionUploads !== uploads[i]).length;

            for (const [i, hero] of skeletons.entries()) uploads[i] = hero.stats.positionUploads;
            const mean = times.reduce((sum, time) => sum + time, 0) / times.length;

            showUpdate(`${mean.toFixed(3)} ms a frame for ${COUNT} skeletons`);
            showMoved(`${moved} of ${COUNT} wrote new vertices in the last frame`);
            showDraws(counter === null ? 'not counted without WebGL2' : `${counter.count} in the last frame`);
            if (counter !== null) counter.count = 0;
        });
        pick('Scene', SCENES, start, 'all play');
        start('all play');
    },
});
