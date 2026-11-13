import { MarrowSpine } from 'pixi-marrow';
import { type DebugLayer, MarrowDebug } from 'pixi-marrow/debug';
import { fit, rigControls } from './rig-controls';
import { definePreview } from './runtime';

/** The layers a switch of the preview turns on and off, with the state they start in. */
const SWITCHES: readonly [DebugLayer, boolean][] = [
    ['bones', true],
    ['regions', true],
    ['meshHulls', true],
    ['meshTriangles', false],
    ['overdraw', false],
];

/**
 * The debug overlays on the bee of the slot game Bzzz: bones, region and mesh shapes, and the
 * overdraw layer, which fills every triangle the skeleton draws with a color that adds up.
 */
export default definePreview({
    size: [760, 440],
    async setup(context) {
        const { app, size, toggle } = context;
        const hero = await MarrowSpine.load({ skeleton: '/rigs/animation_bee.skel', atlas: '/rigs/symbols.atlas' });

        app.stage.addChild(hero);
        hero.defaultMix = 0.2;
        hero.play('idle', { loop: true });
        fit(hero, size, 0.6);

        // #region overlay
        const debug = new MarrowDebug(hero, { layers: { meshTriangles: false, overdraw: false } });
        // #endregion

        rigControls(hero, context, { rest: 'idle', loop: false });
        for (const [layer, on] of SWITCHES) {
            debug.layers[layer] = on;
            toggle('Layers', layer, on, (value) => {
                debug.layers[layer] = value;
            });
        }
    },
});
