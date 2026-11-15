import { Application, Container, type Rectangle, RendererType } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';
import { type CardActions, type Status, showFailure, showResult, status } from './card';
import { describeDevice } from './device';
import { type BuiltScene, type LabTest, readSettings } from './lab';
import {
    type Clock,
    countDraws,
    type FrameTimes,
    formatMs,
    frameInterval,
    HiddenError,
    play,
    refreshRate,
    timerStep,
} from './measure';
import { atFullRate, type LabResult, type PlayResult, summarize } from './report';

/*
 * Runs a test of the lab on the page that opened it: makes the app over the whole page, loads
 * the rigs, builds the scene below the head of the page and plays it at the rate of the screen.
 * A test that grows adds skeletons until the frames drop. At the end the page shows the result
 * and sends it to the server that serves the page. The lab server of the site,
 * `scripts/lab-serve.mjs`, keeps it.
 *
 * The rate of the screen is measured twice: before the run while nothing plays, and from the
 * frames of the run, which is the one the result counts by. A phone in Low Power Mode or with an
 * adaptive refresh rate can change it under load, and the result says so.
 *
 * Every test is a page of its own, and a run frees its renderer and the images of its rigs when
 * it ends or the page is left. A page that the browser brings back from its cache of pages
 * loads again. So no run keeps the memory of another, which a phone with little memory needs.
 */

/** The canvas colour of the lab, the card colour of the site. */
const BACKGROUND = 0x111113;
/** Seconds a scene plays before its frames count: code compiles and buffers get their size. */
const WARM_UP = 2;
/** Seconds a scene plays for its result, where the test and the address name no other time. */
const PLAY = 10;
/** A test that grows: seconds a number of skeletons settles, then plays for the result. */
const GROW_SETTLE = 0.5;
const GROW_PLAY = 2;
/** A test that grows adds this share of the skeletons at each step, and stops at the most. */
const GROW_STEP = 0.3;
const GROW_MOST = 2000;
/**
 * A test that grows then narrows the number down between the last that played and the first
 * that did not, until they are this share of it apart, or the seconds after it are over.
 */
const GROW_PRECISION = 0.05;
const GROW_NARROW = 30;
/** Frames the run must have played before its own rate of the screen counts. */
const RATE_FRAMES = 30;
/** Milliseconds between two updates of the numbers that show while a scene plays. */
const READOUT = 500;
/** Where the lab server of the site takes results. Any other host answers with an error, which is fine. */
const RESULTS = '/lab-results';

/** The test modules by name. Each is a chunk of its own. */
const TESTS: Record<string, () => Promise<{ default: LabTest }>> = {
    grid: () => import('./tests/grid'),
    'how-many': () => import('./tests/how-many'),
    rest: () => import('./tests/rest'),
    crowd: () => import('./tests/crowd'),
};

/** The elements of a lab page. */
export interface LabPage {
    canvas: HTMLElement;
    /** The line that says what the scene shows. The address can change the number of skeletons. */
    scene: HTMLElement;
    status: HTMLElement;
    result: HTMLElement;
}

/** Says what runs now, and how much of the run is done, as a share. */
type Show = Status['show'];

/** The draw counter of the page: it wraps prototypes, so it is made once. */
let draws: { count: number } | null = null;
/** Frees what the run of the page holds. Set while a run goes. */
let free: (() => void) | null = null;

window.addEventListener('pagehide', () => free?.());
window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
});

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

        return answer.ok ? 'The lab also saved the result on the computer that serves this page.' : null;
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
 * void runLab('crowd', { canvas, scene, status, result });
 */
export async function runLab(name: string, page: LabPage): Promise<void> {
    const actions: CardActions = { again: () => window.location.reload() };
    const progress = status(page.status);
    const load = TESTS[name];

    if (load === undefined) {
        showFailure(page.result, `There is no test named "${name}".`, actions);

        return;
    }
    progress.show('Loading.', 0);
    progress.say('Loading the rigs.');
    const release = await keepAwake();

    try {
        const result = await run((await load()).default, page, progress);

        progress.show('Done.', 1);
        progress.say('Done.');
        showResult(page.result, result, await send(result), actions);
    } catch (error) {
        showFailure(page.result, error instanceof Error ? error.message : String(error), actions);
    } finally {
        // a run that failed frees what it holds too
        free?.();
        release();
    }
}

/** The numbers of the last half second while a scene plays, as a line of the status. */
function readout(times: FrameTimes, from: number, step: number): string {
    const gaps = times.gaps.slice(from);
    const played = gaps.reduce((sum, gap) => sum + gap, 0);
    const cpu = times.update.slice(from).reduce((sum, update, i) => sum + update + (times.render[from + i] ?? 0), 0);
    const fps = played > 0 ? Math.round((gaps.length * 1000) / played) : 0;

    return `${fps} fps, ${formatMs(cpu / Math.max(1, gaps.length), step)} ms a frame on the CPU`;
}

/**
 * Plays a scene and shows its numbers twice a second. Plays it again from the start when the
 * page was hidden.
 */
async function playShown(
    clock: Clock,
    scene: BuiltScene,
    seconds: number,
    show: (line: string, share: number) => void,
): Promise<FrameTimes> {
    for (;;) {
        let shown = 0;
        let from = 0;

        try {
            return await play(clock, scene, seconds * 1000, (times, played) => {
                if (played - shown < READOUT) return;
                show(readout(times, from, clock.step), played / (seconds * 1000));
                shown = played;
                from = times.gaps.length;
            });
        } catch (error) {
            if (!(error instanceof HiddenError)) throw error;
            show('Paused while the page was hidden.', 0);
            await visible();
        }
    }
}

/** What the scenes of a run play with: the clock, the rate of the screen and the ways to tell the page. */
interface Run {
    clock: Clock;
    /** The rate of the screen in Hz: from the frames of the run once there are enough, else from before it. */
    rate(): number;
    show: Show;
    say(text: string): void;
}

/** The whole run of a test. */
async function run(test: LabTest, page: LabPage, progress: Status): Promise<LabResult> {
    const settings = readSettings(new URLSearchParams(window.location.search));
    const start = settings.count ?? test.count;
    const app = new Application();
    const assets: MarrowAsset[] = [];
    let freed = false;
    const freeRun = (): void => {
        if (freed) return;
        freed = true;
        app.destroy({ removeView: true }, { children: true });
        for (const asset of assets) asset.destroy();
    };

    free = freeRun;
    page.scene.textContent = test.scene(start);
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
        draws,
        hidden: false,
        seen: [],
        step: timerStep(),
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clock.hidden = true;
    });
    const loaded = await Promise.all(
        test.rigs.map(async (rig) => {
            const asset = await MarrowAsset.load({ skeleton: `/rigs/${rig}.skel`, atlas: '/rigs/symbols.atlas' });

            assets.push(asset);

            return [rig, asset] as const;
        }),
    );
    const idleRefresh = await refreshRate();
    const runs: Run = {
        clock,
        rate: () => (clock.seen.length < RATE_FRAMES ? idleRefresh : Math.round(1000 / frameInterval(clock.seen))),
        show: progress.show,
        say: progress.say,
    };
    // the scene stands below the head of the page, which says what plays
    const top = Math.ceil(page.status.getBoundingClientRect().bottom + 12);
    const stage = app.stage.addChild(new Container());

    stage.y = top;
    const scene = test.build({
        stage,
        assets: new Map(loaded),
        frames: new Map(loaded.map(([rig, asset]) => [rig, frameOf(asset)] as const)),
        width: app.screen.width,
        height: Math.max(1, app.screen.height - top),
        count: start,
    });
    const started = performance.now();
    const outcome =
        test.grows === true
            ? await grow(runs, scene, start, test.noun)
            : await steady(runs, scene, start, settings.seconds ?? test.seconds ?? PLAY);

    if (lost) throw new Error('The browser removed the WebGL context during the run.');
    const seconds = (performance.now() - started) / 1000;
    const device = await describeDevice(app.renderer, { refresh: runs.rate(), idleRefresh, timerStep: clock.step });
    // Pixi makes a WebGL renderer where WebGPU was asked for and does not start
    const renderer = app.renderer.type === RendererType.WEBGPU ? 'webgpu' : 'webgl';

    freeRun();

    return {
        test: test.name,
        title: test.title,
        question: test.question,
        scene: test.scene(start),
        noun: test.noun,
        grows: test.grows === true,
        settings,
        renderer,
        device,
        seconds,
        ...outcome,
    };
}

/** What a run found: the number of skeletons, how they played, and for a test that grows, the number that dropped frames. */
type Outcome = Pick<LabResult, 'count' | 'play' | 'over'>;

/** Plays a scene with a fixed number of skeletons: a warm-up, then the time that counts. */
async function steady(runs: Run, scene: BuiltScene, count: number, seconds: number): Promise<Outcome> {
    const { clock, show, say } = runs;

    say(`Warming up for ${WARM_UP} seconds.`);
    await playShown(clock, scene, WARM_UP, (line) => show(`Warming up. ${line}`, 0));
    say(`Playing for ${seconds} seconds.`);
    const times = await playShown(clock, scene, seconds, (line, share) => show(line, share));

    return { count, play: summarize(times, runs.rate()), over: null };
}

/** A number of skeletons and how it played. */
type Played = { count: number; play: PlayResult };

/**
 * Narrows the limit down: the middle of the last number that played and the first that did
 * not plays next, until they are close or the time is up.
 *
 * @returns The last number that played and the first that did not.
 */
async function narrow(
    playCount: (count: number) => Promise<PlayResult>,
    best: Played,
    over: Played,
): Promise<[low: Played, high: Played]> {
    const until = performance.now() + GROW_NARROW * 1000;
    let low = best;
    let high = over;

    while (high.count - low.count > Math.max(1, Math.ceil(low.count * GROW_PRECISION)) && performance.now() < until) {
        const count = Math.round((low.count + high.count) / 2);
        const play = await playCount(count);

        if (atFullRate(play)) low = { count, play };
        else high = { count, play };
    }

    return [low, high];
}

/**
 * Adds skeletons until the frames drop. A number counts once it played at the full rate. One that
 * drops frames plays once more before it counts as too many, since a phone can stall for a moment.
 * Where the first number drops frames, the test halves it until one plays at the full rate. Then
 * it narrows the limit down between the last number that played and the first that did not.
 */
async function grow(runs: Run, scene: BuiltScene, first: number, noun: string): Promise<Outcome> {
    const { clock, show, say } = runs;
    const tryCount = async (count: number): Promise<PlayResult> => {
        scene.resize?.(count);
        const line = (text: string): void => show(`${count} ${noun}: ${text}`, Math.log(count) / Math.log(GROW_MOST));

        await playShown(clock, scene, GROW_SETTLE, line);

        return summarize(await playShown(clock, scene, GROW_PLAY, line), runs.rate());
    };
    /** Plays a number of skeletons, a second time where it drops frames the first time. */
    const playCount = async (count: number): Promise<PlayResult> => {
        const result = await tryCount(count);

        return atFullRate(result) ? result : tryCount(count);
    };
    let count = first;
    let best: Played | null = null;
    let over: Played | null = null;

    say(`Warming up for ${WARM_UP} seconds.`);
    await playShown(clock, scene, WARM_UP, (line) => show(`Warming up. ${line}`, 0));
    say(`Adding ${noun} until the frames drop.`);
    for (;;) {
        const result = await playCount(count);

        if (atFullRate(result)) {
            best = { count, play: result };
            if (over !== null || count >= GROW_MOST) break;
            count = Math.min(GROW_MOST, Math.ceil((count * (1 + GROW_STEP)) / 5) * 5);
        } else {
            over = { count, play: result };
            if (best !== null || count <= 1) break;
            count = Math.max(1, Math.floor(count / 2));
        }
    }
    if (best !== null && over !== null) {
        say(`Searching between ${best.count} and ${over.count} ${noun}.`);
        [best, over] = await narrow(playCount, best, over);
    }

    return best === null
        ? {
              count: 0,
              play: over?.play ?? summarize({ gaps: [], update: [], render: [], draws: 0 }, runs.rate()),
              over,
          }
        : { count: best.count, play: best.play, over };
}
