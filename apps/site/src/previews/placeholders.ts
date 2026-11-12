import { MarrowSpine } from 'pixi-marrow';
import { conic, SilkGraphics } from 'pixi-silk';
import { fit, rigControls } from './rig-controls';
import { definePreview } from './runtime';

// #region ring
const RING = conic([0x64d2ff, 0xbf5af2, 0xff375f]);
// #endregion

/**
 * Two shapes of pixi-silk in the bee of the slot game Bzzz. The ring is attached to the slot
 * `bee_sp`, which lies between the wings and the body in the draw order. The mark follows the
 * bone of the head and stays on top of the skeleton.
 */
export default definePreview({
    size: [760, 440],
    async setup(context) {
        const { app, size, toggle, readout } = context;
        const hero = await MarrowSpine.load({ skeleton: '/rigs/animation_bee.skel', atlas: '/rigs/symbols.atlas' });

        app.stage.addChild(hero);
        hero.defaultMix = 0.2;
        hero.play('idle', { loop: true });
        fit(hero, size, 0.6);

        // #region attach
        const ring = new SilkGraphics();

        ring.circle(-73, -15, 72).stroke({ width: 14, gradient: RING });
        hero.attach('bee_sp', ring);
        // #endregion

        // #region follow
        const mark = new SilkGraphics();

        mark.regularPoly(125, 0, 12, 4).fill(0x30d158);
        hero.addChild(mark);
        hero.follow('head', mark);
        // #endregion

        rigControls(hero, context, { rest: 'idle', loop: false });
        toggle('Links', 'attach', true, (on) => {
            if (on) hero.attach('bee_sp', ring);
            else hero.detach(ring);
        });
        toggle('Links', 'follow', true, (on) => {
            if (on) hero.follow('head', mark);
            else hero.unfollow(mark);
        });
        const show = readout('Bone', 21);
        /** A whole number in four places, so that the line keeps its width. */
        const places = (value: number): string => value.toFixed(0).padStart(4);

        // #region bone
        const head = hero.bone('head');

        app.ticker.add(() => {
            show(`head  x ${places(head.worldX)}  y ${places(head.worldY)}`);
        });
        // #endregion
    },
});
