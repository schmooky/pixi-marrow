// #region import
import { Application } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';

// #endregion

/*
 * The bee of the landing page: the bee of the slot game Bzzz, playing its idle loop, drawn on a
 * transparent canvas so that the grey of the card shows through, the same grey as the code beside
 * it. The regions are the code the page shows.
 */

/** Share of the height of the element that the bee fills. */
const FILL = 0.82;

/**
 * Draws the bee into an element and keeps it centred as the element changes size.
 *
 * @example
 * void mountBee(document.querySelector('[data-landing-bee]'));
 */
export async function mountBee(host: HTMLElement): Promise<void> {
    // #region app
    const app = new Application();

    await app.init({
        resizeTo: host,
        backgroundAlpha: 0,
        resolution: devicePixelRatio,
        autoDensity: true,
    });
    host.append(app.canvas);
    // #endregion

    // #region draw
    const bee = await MarrowSpine.load({
        skeleton: '/rigs/animation_bee.skel',
        atlas: '/rigs/symbols.atlas',
    });

    app.stage.addChild(bee);
    bee.play('idle', { loop: true });
    // #endregion

    // the box of the first pose, measured once, keeps the bee still in the middle while it plays
    bee.update(0);
    const box = bee.getLocalBounds().rectangle.clone();
    const place = (): void => {
        const { width, height } = app.screen;
        const scale = Math.min((width * FILL) / box.width, (height * FILL) / box.height);

        bee.scale.set(scale);
        bee.position.set(width / 2 - (box.x + box.width / 2) * scale, height / 2 - (box.y + box.height / 2) * scale);
    };

    place();
    app.renderer.on('resize', place);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) app.ticker.stop();
        else app.ticker.start();
    });
}
