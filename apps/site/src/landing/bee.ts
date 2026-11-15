// #region import
import { Application } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';

// #endregion

/*
 * The bee of the landing page: the bee of the slot game Bzzz, playing its idle loop, drawn on a
 * transparent canvas so that she stands on the page itself, beside the code that draws her. The
 * regions are the code the page shows.
 *
 * Around them the page looks after the bee. It frees the app when the page is left, and draws
 * a new bee when the page comes back from the cache of pages. A reader who asked for less
 * motion sees her first pose. A lost WebGL context or a load that fails leaves a line of text.
 */

/** Share of the element that the bee fills, across or down, whichever runs out first. */
const FILL = 0.9;
/** What the box says where the bee did not load, and where the browser removed her context. */
const NO_BEE = 'The bee did not load. The code beside her is the same.';
const LOST = 'The browser removed the WebGL context of the bee.';

/** Puts a line of text in the box in place of the bee. The box is then no picture. */
function say(host: HTMLElement, text: string): void {
    const line = document.createElement('p');

    line.className = 'landing-bee-note';
    line.textContent = text;
    host.removeAttribute('role');
    host.removeAttribute('aria-label');
    host.replaceChildren(line);
}

/** Frees an app, also one whose context is lost. */
function destroyApp(app: Application): void {
    const webgl = 'gl' in app.renderer ? app.renderer : null;

    // Pixi loses the context when it destroys a renderer. A browser warns when that is asked of a lost one
    if (webgl?.gl.isContextLost()) Reflect.set(webgl.context.extensions, 'loseContext', null);
    app.destroy({ removeView: true }, { children: true });
}

/**
 * Draws the bee into an element and keeps it centred as the element changes size.
 *
 * @example
 * void mountBee(document.querySelector('[data-landing-bee]'));
 */
export async function mountBee(host: HTMLElement): Promise<void> {
    /** Ends the listeners of this bee when it ends. */
    const listening = new AbortController();
    const { signal } = listening;
    /** The app once it is made, true once the bee stands, and true once the page was left or the context lost. */
    let made: Application | null = null;
    let drawn = false;
    let ended = false;
    const free = (): void => {
        if (made !== null) destroyApp(made);
        made = null;
    };
    // a bee that still loads is freed once she stands: freed sooner, she would update herself for the life of the page
    const end = (): void => {
        ended = true;
        listening.abort();
        made?.ticker.stop();
        if (drawn) free();
    };
    /** What the box says to a screen reader while it shows the bee. A line of text in its place takes it away. */
    const label = host.getAttribute('aria-label');
    const back = (event: PageTransitionEvent): void => {
        if (!event.persisted) return;
        removeEventListener('pageshow', back);
        if (label !== null) {
            host.setAttribute('role', 'img');
            host.setAttribute('aria-label', label);
        }
        host.replaceChildren();
        void mountBee(host);
    };

    // Pixi answers a lost context by asking for a new one, again and again where the browser
    // cannot make one. This listener hears the loss before the canvas does, and ends it there
    host.addEventListener(
        'webglcontextlost',
        (event) => {
            event.stopPropagation();
            end();
            say(host, LOST);
        },
        { capture: true, signal },
    );
    addEventListener('pagehide', end, { signal });
    addEventListener('pageshow', back);
    try {
        // #region app
        const app = new Application();

        await app.init({
            resizeTo: host,
            backgroundAlpha: 0,
            resolution: Math.min(devicePixelRatio, 2),
            autoDensity: true,
        });
        host.append(app.canvas);
        // #endregion

        made = app;

        // #region draw
        const bee = await MarrowSpine.load({
            skeleton: '/rigs/animation_bee.skel',
            atlas: '/rigs/symbols.atlas',
        });

        app.stage.addChild(bee);
        bee.play('idle', { loop: true });
        // #endregion

        drawn = true;
        if (ended) {
            free();

            return;
        }
        // the box of the first pose, measured once, keeps the bee still in the middle while it plays
        bee.update(0);
        const box = bee.getLocalBounds().rectangle.clone();
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        const place = (): void => {
            const { width, height } = app.screen;
            const scale = Math.min((width * FILL) / box.width, (height * FILL) / box.height);

            bee.scale.set(scale);
            bee.position.set(
                width / 2 - (box.x + box.width / 2) * scale,
                height / 2 - (box.y + box.height / 2) * scale,
            );
            // a bee that stands still is drawn on each change of the size
            if (!app.ticker.started) app.render();
        };
        // she plays while the tab is visible, unless the reader asked for less motion: then she shows her first pose
        const sync = (): void => {
            const moving = !motion.matches && !document.hidden;

            bee.autoUpdate = moving;
            if (moving) app.ticker.start();
            else app.ticker.stop();
            place();
        };
        // the element takes its height from the text and code beside it, which can change without the window changing
        const resized = new ResizeObserver(() => app.queueResize());

        app.renderer.on('resize', place);
        resized.observe(host);
        signal.addEventListener('abort', () => resized.disconnect());
        motion.addEventListener('change', sync, { signal });
        document.addEventListener('visibilitychange', sync, { signal });
        sync();
    } catch {
        drawn = true;
        free();
        if (!ended) {
            listening.abort();
            say(host, NO_BEE);
        }
    }
}
