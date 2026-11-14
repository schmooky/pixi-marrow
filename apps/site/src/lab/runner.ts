import { Application, Container, type Rectangle, type Renderer } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';
import { type CardActions, showFailure, showResult, status } from './card';
import { describeDevice } from './device';
import { type BuiltScene, type LabSide, type LabTest, readSettings } from './lab';
import {
    type BlockTimes,
    type Clock,
    countDraws,
    HiddenError,
    readPixelWait,
    refreshRate,
    timeBlock,
    timeEmpty,
    warmUp,
} from './measure';
import { type LabResult, summarize } from './report';

/*
 * Runs a test of the lab on the page that opened it: makes the app over the whole page, loads
 * the rigs, measures an empty stage, then runs every side once per round. The order of the
 * sides turns with each round, so the heat of a phone and the clocks of its chips weigh on
 * every side alike. At the end the page shows the result and sends it to the server that
 * serves the page. The lab server of the site, `scripts/lab-serve.mjs`, keeps it.
 */

/** The canvas colour of the lab, the card colour of the site. */
const BACKGROUND = 0x111113;
/** Frames of an empty stage that are timed before the first block. */
const EMPTY_FRAMES = 120;
/** Where the lab server of the site takes results. Any other host answers with an error, which is fine. */
const RESULTS = '/lab-results';

/** The test modules by name. Each is a chunk of its own. */
const TESTS: Record<string, () => Promise<{ default: LabTest }>> = {
    grid: () => import('./tests/grid'),
    crowd: () => import('./tests/crowd'),
    rest: () => import('./tests/rest'),
    fill: () => import('./tests/fill'),
};

/** The elements of a lab page. */
export interface LabPage {
    canvas: HTMLElement;
    /** The line that says what the scene shows. The address can change the number of skeletons. */
    scene: HTMLElement;
    status: HTMLElement;
    result: HTMLElement;
}

/** The draw counter of the page: it wraps prototypes, so it is made once. */
let draws: { count: number } | null = null;

/** Waits until the page is visible. */
function visible(): Promise<void> {
    if (!document.hidden) return Promise.resolve();

    return new Promise((done) => {
        const seen = (): void => {
            if (document.hidden) return;
            document.removeEventListener('visibilitychange', seen);
            done();
        };

        document.addEventListener('visibilitychange', seen);
    });
}

/** How the page waits for the GPU to finish a frame. */
function gpuWait(renderer: Renderer): () => Promise<void> | void {
    const gl: unknown = Reflect.get(renderer, 'gl');

    if (gl instanceof WebGL2RenderingContext) return readPixelWait(gl);
    const device: unknown = Reflect.get(Reflect.get(renderer, 'gpu') ?? {}, 'device');

    const queue: unknown = typeof device === 'object' && device !== null ? Reflect.get(device, 'queue') : null;

    if (typeof queue === 'object' && queue !== null && 'onSubmittedWorkDone' in queue) {
        const submitted = queue as { onSubmittedWorkDone(): Promise<void> };

        return () => submitted.onSubmittedWorkDone();
    }
    throw new Error('the renderer is neither WebGL2 nor WebGPU');
}

/** The box of the setup pose of a rig, from an instance that is made and destroyed. */
function frameOf(asset: MarrowAsset): Rectangle {
    const probe = new MarrowSpine(asset, { autoUpdate: false });

    probe.update(0);
    const frame = probe.getLocalBounds().rectangle.clone();

    probe.destroy();

    return frame;
}

/** Sends a result to the server of the page. Says what became of it, or null where nothing takes it. */
async function send(result: LabResult): Promise<string | null> {
    try {
        const answer = await fetch(RESULTS, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(result),
        });

        return answer.ok ? 'The result was also saved on the computer that serves this page.' : null;
    } catch {
        return null;
    }
}

/** Keeps the screen on while a run goes, where the browser allows it. */
async function keepAwake(): Promise<() => void> {
    try {
        const lock = await navigator.wakeLock.request('screen');

        return () => {
            void lock.release();
        };
    } catch {
        return () => {};
    }
}

/**
 * Runs the test with a name on a lab page.
 *
 * @example
 * void runLab('crowd', { canvas, status, result });
 */
export async function runLab(name: string, page: LabPage): Promise<void> {
    const actions: CardActions = { again: () => window.location.reload() };
    const progress = status(page.status);
    const load = TESTS[name];

    if (load === undefined) {
        showFailure(page.result, `There is no test named "${name}".`, actions);

        return;
    }
    progress.show('Loading. Keep the screen on and the phone still.', 0);
    const release = await keepAwake();

    try {
        const result = await run((await load()).default, page, progress.show);

        progress.show('Done.', 1);
        showResult(page.result, result, await send(result), actions);
    } catch (error) {
        showFailure(page.result, error instanceof Error ? error.message : String(error), actions);
    } finally {
        release();
    }
}

/** The whole run of a test. */
async function run(test: LabTest, page: LabPage, show: (text: string, done: number) => void): Promise<LabResult> {
    const settings = readSettings(new URLSearchParams(window.location.search));
    const count = settings.count ?? test.count;
    const app = new Application();

    page.scene.textContent = test.scene(count);
    let lost = false;

    await app.init({
        resizeTo: page.canvas,
        background: BACKGROUND,
        preference: settings.renderer,
        antialias: false,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        autoStart: false,
        sharedTicker: false,
    });
    app.ticker.stop();
    page.canvas.append(app.canvas);
    app.canvas.addEventListener('webglcontextlost', () => {
        lost = true;
    });
    draws ??= countDraws();
    const clock: Clock = {
        renderer: app.renderer,
        stage: app.stage,
        wait: gpuWait(app.renderer),
        draws,
        hidden: false,
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clock.hidden = true;
    });
    const mesh = test.sides.some((side) => side.options.renderMode === 'mesh');
    const loaded = await Promise.all(
        test.rigs.map(async (rig) => {
            const asset = await MarrowAsset.load({
                skeleton: `/rigs/${rig}.skel`,
                atlas: '/rigs/symbols.atlas',
                ...(mesh ? { renderMode: 'mesh' as const } : {}),
            });

            // the outlines of the atlas pages are read in idle time after the load. Tight meshes need them
            await asset.optimized;

            return [rig, asset] as const;
        }),
    );
    const assets = new Map(loaded);
    const frames = new Map(loaded.map(([rig, asset]) => [rig, frameOf(asset)] as const));
    const device = await describeDevice(app.renderer, await refreshRate());
    const empty = await timeEmpty(clock, EMPTY_FRAMES);
    const started = performance.now();
    const blocks = new Map<string, BlockTimes[]>(test.sides.map((side) => [side.name, []]));
    const total = settings.rounds * test.sides.length;
    let done = 0;

    for (let round = 0; round < settings.rounds; round++) {
        // the order turns with each round: the first side of one round is the last but one of the next
        const order = test.sides.map((_, i) => test.sides[(i + round) % test.sides.length] as LabSide);

        for (const side of order) {
            show(`Round ${round + 1} of ${settings.rounds}: ${side.name}`, done / total);
            for (;;) {
                const times = await block(clock, test, side, { assets, frames, count, settings, app });

                if (lost) throw new Error('The browser took the WebGL context away during the run.');
                if (times !== null) {
                    blocks.get(side.name)?.push(times);
                    break;
                }
                show('Paused while the page was hidden.', done / total);
                await visible();
            }
            done++;
        }
    }
    const seconds = (performance.now() - started) / 1000;

    app.destroy({ removeView: true }, { children: true });

    return {
        test: test.name,
        title: test.title,
        question: test.question,
        scene: test.scene(count),
        settings,
        count,
        device,
        empty,
        seconds,
        sides: test.sides.map((side) => summarize(side.name, blocks.get(side.name) ?? [])),
    };
}

/** What a block needs besides the clock, the test and the side. */
interface BlockSetup {
    assets: ReadonlyMap<string, MarrowAsset>;
    frames: ReadonlyMap<string, Rectangle>;
    count: number;
    settings: ReturnType<typeof readSettings>;
    app: Application;
}

/**
 * One block: builds the scene for a side, warms up, times the frames and takes the scene away.
 * Null when the page was hidden during the block, which must then run again.
 */
async function block(clock: Clock, test: LabTest, side: LabSide, setup: BlockSetup): Promise<BlockTimes | null> {
    const { app, settings } = setup;
    const stage = app.stage.addChild(new Container());
    let scene: BuiltScene;

    try {
        scene = test.build({
            stage,
            assets: setup.assets,
            frames: setup.frames,
            side,
            width: app.screen.width,
            height: app.screen.height,
            count: setup.count,
        });
        await warmUp(clock, scene, test.timing?.warmup ?? settings.warmup);

        return await timeBlock(clock, scene, test.timing?.samples ?? settings.samples, settings.group);
    } catch (error) {
        if (error instanceof HiddenError) return null;
        throw error;
    } finally {
        stage.destroy({ children: true });
    }
}
