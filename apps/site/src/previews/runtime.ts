import { Application, Container, getTestContext, Ticker, UPDATE_PRIORITY } from 'pixi.js';
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
 *
 * A browser can also be unable to make a context at all. Safari is, once its graphics process
 * holds as many surfaces as macOS allows one process: a context is then lost a few milliseconds
 * after it was made, and so is the next one. A preview makes two contexts in such a browser and
 * then says so. It tries again when the tab comes back or its button is pressed.
 */

/** The canvas colour of every preview: the card colour of the site. */
const BACKGROUND = 0x111113;
/** How often in a row a preview starts again after it lost its WebGL context, before it asks. */
const RESTARTS = 3;
/** Milliseconds before the first new start. Each further one waits twice as long. */
const RESTART_PAUSE = 400;
/** Milliseconds a preview must run before a loss counts as the first one again. */
const CALM = 10_000;
/** Milliseconds a context must live to count as made. One that is lost sooner never worked. */
const INFANCY = 1500;
/** How many contexts in a row may be lost that young before a preview stops making them. */
const YOUNG_LOSSES = 2;
/** What a preview says when its context was taken away again and again. */
const TAKEN = 'The browser took the WebGL context of this preview away.';
/** What a preview says when no context lived. */
const NO_CONTEXT = 'The browser cannot make a WebGL context at the moment. Starting it again can help.';

/** How a preview lost its context: `young` within a moment of its birth, `lost` later. */
type Loss = 'young' | 'lost';

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
    anatomy: () => import('./anatomy'),
    placeholders: () => import('./placeholders'),
    debug: () => import('./debug'),
    reels: () => import('./reels'),
};

/** A preview whose app exists and whose scene is built. */
interface Running {
    /** Starts or stops the frames and the updates of the skeletons. */
    run(on: boolean): void;
    /** Frees the app and the skeletons, and empties the controls. The assets stay for the next start. */
    destroy(): void;
}

/** A start that is under way. */
interface Attempt {
    /** The running preview. A loss when the context went away during the start, null when it was cancelled. */
    ready: Promise<Running | Loss | null>;
    /** Ends the start. Its context is given back at once, and what it made is freed when its scene is built. */
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
 * The stage of a preview that has ended. A load that was under way when the preview ended can
 * still add a skeleton to it. That skeleton is destroyed at once: it would update itself for
 * the life of the page otherwise.
 */
function endedStage(): Container {
    const stage = new Container();

    stage.on('childAdded', (child: Container) => child.destroy({ children: true }));

    return stage;
}

/**
 * Starts a preview: creates its app in the frame and builds the scene.
 *
 * A start that is cut short, by a lost context or by the page that is left, still builds its
 * scene to the end and frees it then. A scene is built across loads, and what it makes after a
 * load could not be found before.
 *
 * The assets of a scene are not freed with it. Loads of the same files share one asset, so the
 * next start, which can overlap with the end of this one, gets the asset this one holds.
 *
 * @param lost Called once when the WebGL context of the running preview is gone. The preview has
 * stopped by then, and the caller destroys it.
 */
function begin(load: Loader, canvasHost: HTMLElement, bar: HTMLElement, lost: (loss: Loss) => void): Attempt {
    let cancelled = false;
    /** How the context went away, or null while it lives. */
    let loss: Loss | null = null;
    let free = (): void => {};
    /** Gives the context back and stops the frames. The scene is freed later. */
    let release = (): void => {};

    const build = async (): Promise<Running | Loss | null> => {
        const { default: preview } = await load();

        if (cancelled) return null;
        const [width, height] = preview.size;
        const canvas = document.createElement('canvas');
        const app = new Application();
        /** True when the context went away before the app was made. */
        let early = false;
        let lose = (): void => {
            early = true;
        };

        // Pixi answers a lost context by asking the browser to restore it. A browser that cannot
        // make a context then makes one after the other, many in a second. This listener is the
        // first one of the canvas and ends the event, so Pixi never hears of a loss
        canvas.addEventListener('webglcontextlost', (event) => {
            event.stopImmediatePropagation();
            lose();
        });
        await app.init({
            canvas,
            resizeTo: canvasHost,
            background: BACKGROUND,
            // WebGL2 runs in every current browser, and pixi-silk draws on it without setup
            preference: 'webgl',
            antialias: false,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio, 2),
        });
        const born = performance.now();
        const webgl = 'gl' in app.renderer ? app.renderer : null;
        const controls = panel(bar);

        probed = true;
        /** True once the scene is built and the caller holds the preview. */
        let ready = false;
        let running = false;
        let freed = false;
        let shut = false;
        /** Ends the controls and empties the panel. The next start can fill it at once. */
        const close = (): void => {
            if (shut) return;
            shut = true;
            controls.close();
            bar.replaceChildren();
        };

        free = (): void => {
            if (freed) return;
            freed = true;
            if (running) count(-1);
            running = false;
            // Pixi loses the context when it destroys a renderer. A browser warns when that is asked of a lost one
            if (webgl?.gl.isContextLost()) Reflect.set(webgl.context.extensions, 'loseContext', null);
            app.destroy({ removeView: true }, { children: true });
            close();
            app.stage = endedStage();
        };
        const pause = (): void => {
            if (running) count(-1);
            running = false;
            app.ticker.stop();
            // a skeleton updates itself from Pixi's shared ticker, not from the ticker of the app
            for (const skeleton of skeletons(app.stage)) skeleton.autoUpdate = false;
        };

        lose = (): void => {
            if (loss !== null || freed) return;
            loss = performance.now() - born < INFANCY ? 'young' : 'lost';
            pause();
            // while the scene is built the start ends when it is built. Later the caller is told
            if (ready && !cancelled) lost(loss);
        };
        release = (): void => {
            if (freed) return;
            pause();
            close();
            if (webgl !== null && !webgl.gl.isContextLost()) webgl.context.extensions.loseContext?.loseContext();
        };
        if (cancelled) {
            free();

            return null;
        }
        if (early || webgl?.gl.isContextLost()) lose();
        // nothing of the scene is made yet, and none of it could be drawn
        if (loss !== null) {
            free();

            return loss;
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
        app.renderer.on('resize', fit);
        fit();
        canvasHost.replaceChildren(app.canvas);
        /** What a start that was cut short ends with. */
        const cut = (): Loss | null => (cancelled ? null : loss);

        try {
            await preview.setup({ app, size: preview.size, ...controls });
        } catch (error) {
            free();
            if (cancelled || loss !== null) return cut();
            throw error;
        }
        if (cancelled || loss !== null) {
            free();

            return cut();
        }
        ready = true;
        running = true;
        count(1);

        return {
            run(on) {
                if (on === running || loss !== null) return;
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
            cancelled = true;
            release();
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
    /** True while that message says that the context is gone. A tab that comes back then tries again. */
    let starved = false;
    /** Losses of the context in a row, how many of them were young, and the timers that start again and that forget them. */
    let losses = 0;
    let young = 0;
    let restart = 0;
    let calm = 0;

    const wanted = (): boolean => onScreen && !document.hidden && !left;
    /** Starts a preview that stopped with a message once more. */
    const again = (): void => {
        stopped = false;
        starved = false;
        losses = 0;
        young = 0;
        canvasHost.replaceChildren();
        sync();
    };
    /** Shows why the preview does not run, with a button that starts it again. */
    const stop = (message: string): void => {
        const text = document.createElement('p');
        const button = document.createElement('button');

        stopped = true;
        frame.dataset.state = 'stopped';
        text.textContent = message;
        button.type = 'button';
        button.textContent = 'Try again';
        button.addEventListener('click', again);
        canvasHost.replaceChildren(text, button);
    };
    /** The context is gone: the app is freed, and a fresh one starts after a pause. */
    const lost = (loss: Loss): void => {
        running?.destroy();
        running = null;
        clearTimeout(calm);
        losses += 1;
        young = loss === 'young' ? young + 1 : 0;
        if (young >= YOUNG_LOSSES || losses > RESTARTS) {
            stop(young >= YOUNG_LOSSES ? NO_CONTEXT : TAKEN);
            starved = true;

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
                if (made === 'young' || made === 'lost') lost(made);
                else if (made !== null) {
                    running = made;
                    calm = window.setTimeout(() => {
                        losses = 0;
                        young = 0;
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
    /** The tab or the page is back. What kept the browser from making a context may be gone by now. */
    const back = (): void => {
        if (starved && wanted()) again();
        else sync();
    };

    document.addEventListener('visibilitychange', back);
    addEventListener('pagehide', leave);
    // a page that comes back from the back and forward cache starts its previews again
    addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        left = false;
        back();
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
