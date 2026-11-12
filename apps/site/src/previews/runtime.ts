import { Application, type Container, getTestContext, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';
import { type Controls, panel } from './panel';

/*
 * The runtime of the live previews. A preview is a module of this folder:
 *
 *   export default definePreview({ size, async setup({ app, chips }) { ... } });
 *
 * A page shows regions of that module as its code, so the code a reader sees is code that runs.
 *
 * A preview starts when its frame scrolls into view. It stops its frames and the updates of its
 * skeletons while the frame is off screen or the tab is hidden, and frees its app when the page
 * is left. A browser can take the WebGL context of a canvas away at any time. The preview then
 * stops at once, frees its app and starts a fresh one.
 */

/** The canvas colour of every preview: the card colour of the site. */
const BACKGROUND = 0x111113;
/** How often in a row a preview starts again after it lost its WebGL context, before it asks. */
const RESTARTS = 3;
/** Milliseconds before the first new start. Each further one waits twice as long. */
const RESTART_PAUSE = 400;
/** Milliseconds a preview must run before a loss counts as the first one again. */
const CALM = 10_000;

/** What a preview builds its scene with: the app, the size of the scene and the controls under the canvas. */
interface PreviewContext extends Controls {
    /** The Pixi application. Its stage is in design units: scaled to fit the canvas and centred. */
    app: Application;
    /** The size of the scene in design units, as the preview states it. */
    size: readonly [width: number, height: number];
}

/** A live preview: the design size of its scene and the function that builds it. */
export interface Preview {
    /** The size of the scene in design units. The stage is scaled to show all of it. */
    size: readonly [width: number, height: number];
    /** Builds the scene. */
    setup(context: PreviewContext): Promise<void>;
}

/** Loads a preview module. */
type Loader = () => Promise<{ default: Preview }>;

/** Types a preview module. */
export const definePreview = (preview: Preview): Preview => preview;

/** The preview modules by name. Each is a chunk of its own, loaded when its frame comes into view. */
const PREVIEWS: Record<string, Loader> = {
    play: () => import('./play'),
    placeholders: () => import('./placeholders'),
};

/** A preview whose app exists and whose scene is built. */
interface Running {
    /** Starts or stops the frames and the updates of the skeletons. */
    run(on: boolean): void;
    /** Frees the app, the skeletons and their assets, and empties the controls. */
    destroy(): void;
}

/** A start that is under way. */
interface Attempt {
    /** The running preview. `lost` when the context went away during the start, null when it was cancelled. */
    ready: Promise<Running | 'lost' | null>;
    /** Ends the start and frees what it made so far. */
    cancel(): void;
}

/** How many previews run at the moment. */
let active = 0;

/**
 * Counts a preview that starts or stops to run. Pixi's system ticker drives the housekeeping of
 * every app on the page and asks for a frame each time. It stops with the last preview that
 * runs, so a page without one asks for no frame at all.
 */
function count(change: 1 | -1): void {
    active += change;
    if (active > 0) Ticker.system.start();
    else Ticker.system.stop();
}

/** True while Pixi may hold its test context: from the first app of a page until the page is left. */
let probed = false;

/**
 * Pixi keeps a small WebGL context of its own for the life of a page, to ask the driver for
 * its limits. A page that is left gives it back at once, and Pixi makes a new one when it needs
 * one. A browser frees the contexts of a page it has left only when it likes.
 */
function releaseProbe(): void {
    if (!probed) return;
    probed = false;
    getTestContext().getExtension('WEBGL_lose_context')?.loseContext();
}

/** Every skeleton below a container. */
function skeletons(root: Container, out: MarrowSpine[] = []): MarrowSpine[] {
    for (const child of root.children) {
        if (child instanceof MarrowSpine) out.push(child);
        else skeletons(child, out);
    }

    return out;
}

/**
 * Starts a preview: creates its app in the frame and builds the scene.
 *
 * @param lost Called once when the WebGL context of the running preview is gone. The preview has
 * stopped by then, and the caller destroys it.
 */
function begin(load: Loader, canvasHost: HTMLElement, bar: HTMLElement, lost: () => void): Attempt {
    /** True once the start was cancelled or the context went away: what was made is freed. */
    let over = false;
    let contextLost = false;
    let free = (): void => {};
    let lose = (): void => {};

    const build = async (): Promise<Running | 'lost' | null> => {
        const { default: preview } = await load();
        const [width, height] = preview.size;
        const app = new Application();

        await app.init({
            resizeTo: canvasHost,
            background: BACKGROUND,
            // WebGL2 runs in every current browser, and pixi-silk draws on it without setup
            preference: 'webgl',
            antialias: false,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio, 2),
        });
        const webgl = 'gl' in app.renderer ? app.renderer : null;

        probed = true;
        /** True once the scene is built and the caller holds the preview. */
        let ready = false;
        let running = false;
        let freed = false;

        free = (): void => {
            if (freed) return;
            freed = true;
            const assets = new Set(skeletons(app.stage).map((skeleton) => skeleton.asset));

            if (running) count(-1);
            running = false;
            // Pixi loses the context when it destroys a renderer. A browser warns when that is asked of a lost one
            if (webgl?.gl.isContextLost()) Reflect.set(webgl.context.extensions, 'loseContext', null);
            app.destroy({ removeView: true }, { children: true });
            for (const asset of assets) asset.destroy();
            bar.replaceChildren();
        };
        const pause = (): void => {
            if (running) count(-1);
            running = false;
            app.ticker.stop();
            // a skeleton updates itself from Pixi's shared ticker, not from the ticker of the app
            for (const skeleton of skeletons(app.stage)) skeleton.autoUpdate = false;
        };

        lose = (): void => {
            if (contextLost || freed) return;
            contextLost = true;
            pause();
            if (over) return;
            // while the scene is built the start ends here. Later the caller is told
            if (ready) lost();
            else {
                over = true;
                free();
            }
        };
        if (over) {
            free();

            return null;
        }
        const fit = (): void => {
            const scale = Math.min(app.screen.width / width, app.screen.height / height);

            app.stage.scale.set(scale);
            app.stage.position.set((app.screen.width - width * scale) / 2, (app.screen.height - height * scale) / 2);
        };

        // Pixi draws on a lost context and throws when it compiles a shader there. So the app
        // does not draw by itself: this draws, and looks at the context first
        app.ticker.remove(app.render, app);
        app.ticker.add(
            () => {
                if (webgl?.gl.isContextLost()) lose();
                else app.render();
            },
            undefined,
            UPDATE_PRIORITY.LOW,
        );
        app.canvas.addEventListener('webglcontextlost', lose);
        app.renderer.on('resize', fit);
        fit();
        canvasHost.replaceChildren(app.canvas);
        try {
            await preview.setup({ app, size: preview.size, ...panel(bar) });
        } catch (error) {
            free();
            // a scene that is built on an app that was freed meanwhile fails, and that is no failure
            if (over) return contextLost ? 'lost' : null;
            throw error;
        }
        if (over) return contextLost ? 'lost' : null;
        ready = true;
        running = true;
        count(1);

        return {
            run(on) {
                if (on === running || contextLost) return;
                if (!on) {
                    pause();

                    return;
                }
                running = true;
                count(1);
                app.ticker.start();
                for (const skeleton of skeletons(app.stage)) skeleton.autoUpdate = true;
            },
            destroy: free,
        };
    };

    return {
        ready: build(),
        cancel() {
            over = true;
            free();
        },
    };
}

/** What frees every preview of the page: one function per frame. */
const leavers = new Set<() => void>();

/** Runs one preview while its frame is on screen and the tab is visible. */
function watch(frame: HTMLElement, load: Loader | undefined): void {
    const canvasHost = frame.querySelector<HTMLElement>('[data-preview-canvas]');
    const bar = frame.querySelector<HTMLElement>('[data-preview-bar]');

    if (canvasHost === null || bar === null) return;
    let running: Running | null = null;
    let attempt: Attempt | null = null;
    /** True while a message with a button stands in the frame: the preview waits for a press. */
    let stopped = false;
    let onScreen = false;
    let left = false;
    /** Losses of the context in a row, and the timers that start again and that forget them. */
    let losses = 0;
    let restart = 0;
    let calm = 0;

    const wanted = (): boolean => onScreen && !document.hidden && !left;
    /** Shows why the preview does not run, with a button that starts it again. */
    const stop = (message: string): void => {
        const text = document.createElement('p');
        const button = document.createElement('button');

        stopped = true;
        frame.dataset.state = 'stopped';
        text.textContent = message;
        button.type = 'button';
        button.textContent = 'Try again';
        button.addEventListener('click', () => {
            stopped = false;
            losses = 0;
            canvasHost.replaceChildren();
            sync();
        });
        canvasHost.replaceChildren(text, button);
    };
    /** The context is gone: the app is freed, and a fresh one starts after a pause. */
    const lost = (): void => {
        running?.destroy();
        running = null;
        clearTimeout(calm);
        losses += 1;
        if (losses > RESTARTS) {
            stop('The browser took the WebGL context of this preview away.');

            return;
        }
        frame.dataset.state = 'restarting';
        restart = window.setTimeout(
            () => {
                restart = 0;
                sync();
            },
            RESTART_PAUSE * 2 ** (losses - 1),
        );
    };
    const sync = (): void => {
        if (running !== null) {
            running.run(wanted());
            frame.dataset.state = wanted() ? 'running' : 'paused';

            return;
        }
        if (!wanted() || attempt !== null || stopped || restart !== 0) return;
        if (load === undefined) {
            stop(`There is no preview "${frame.dataset.preview}".`);

            return;
        }
        const mine = begin(load, canvasHost, bar, lost);

        attempt = mine;
        frame.dataset.state = 'starting';
        mine.ready.then(
            (made) => {
                // a start that was cancelled belongs to a page that was left
                if (attempt !== mine) return;
                attempt = null;
                if (made === 'lost') lost();
                else if (made !== null) {
                    running = made;
                    calm = window.setTimeout(() => {
                        losses = 0;
                    }, CALM);
                    sync();
                }
            },
            (error: unknown) => {
                if (attempt !== mine) return;
                attempt = null;
                // No line in the console: a page that is left ends the loads of a start, and that is no error
                stop(`The preview did not start. ${error instanceof Error ? error.message : String(error)}`);
            },
        );
    };
    const leave = (): void => {
        left = true;
        clearTimeout(restart);
        clearTimeout(calm);
        restart = 0;
        attempt?.cancel();
        attempt = null;
        running?.destroy();
        running = null;
        releaseProbe();
        if (!stopped) frame.dataset.state = 'left';
    };

    new IntersectionObserver((entries) => {
        onScreen = entries.at(-1)?.isIntersecting ?? false;
        sync();
    }).observe(frame);
    document.addEventListener('visibilitychange', sync);
    addEventListener('pagehide', leave);
    // a page that comes back from the back and forward cache starts its previews again
    addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        left = false;
        sync();
    });
    leavers.add(leave);
}

/**
 * Starts every preview frame of the page that was not started before.
 *
 * @param more Preview modules by name on top of those of the site, for a page that is not part
 * of it, such as a story.
 */
export function mountPreviews(more: Record<string, Loader> = {}): void {
    for (const frame of document.querySelectorAll<HTMLElement>('[data-preview]')) {
        if (frame.dataset.state !== undefined) continue;
        const name = frame.dataset.preview ?? '';

        frame.dataset.state = 'waiting';
        watch(frame, more[name] ?? PREVIEWS[name]);
    }
}

// The dev server reloads the page, or swaps this module, whenever a file changes. Each new page
// makes new WebGL contexts, and a browser frees the old ones when it likes. So they are freed here
if (import.meta.hot) {
    const freeAll = (): void => {
        for (const leave of leavers) leave();
    };

    import.meta.hot.on('vite:beforeFullReload', freeAll);
    import.meta.hot.dispose(freeAll);
}
