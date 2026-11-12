// #region import
import { MarrowSpine } from 'pixi-marrow';
// #endregion
import { fit, type Playing, rigControls } from './rig-controls';
import { definePreview } from './runtime';

/** A skeleton on the stage with the way its chips play it. */
interface Rig extends Playing {
    hero: MarrowSpine;
}

/**
 * The bee of the slot game Bzzz, and the big bee of its feature. The panel is built from the
 * rig that shows: its skins when it has several, and its animations. The runtime mixes from one
 * animation into the next.
 */
export default definePreview({
    size: [640, 400],
    async setup(context) {
        const { app, size, pick, readout } = context;
        // #region draw
        const hero = await MarrowSpine.load({
            skeleton: '/rigs/animation_bee.skel',
            atlas: '/rigs/symbols.atlas',
        });

        app.stage.addChild(hero);
        hero.play('idle', { loop: true });
        // #endregion

        const bee: Rig = { hero, rest: 'idle', loop: false };
        let big: Promise<Rig> | undefined;
        let shown = bee;
        let show: (text: string) => void = () => {};
        const onEvent = (event: { name: string }): void => show(event.name);
        /** The big bee flies across the reels of the game, so it is shown from further away. */
        const loadBig = async (): Promise<Rig> => {
            const loaded = await MarrowSpine.load({
                skeleton: '/rigs/animation_bee_big.skel',
                atlas: '/rigs/symbols.atlas',
            });

            loaded.visible = false;
            loaded.defaultMix = 0.2;
            loaded.position.set(size[0] / 2, size[1] / 2);
            loaded.scale.set(0.6);
            loaded.on('event', onEvent);
            app.stage.addChild(loaded);

            return { hero: loaded, rest: 'feature', loop: true };
        };

        hero.defaultMix = 0.2;
        hero.on('event', onEvent);
        fit(hero, size, 0.7);
        pick(
            'Rig',
            ['bee', 'big bee'],
            async (name) => {
                if (name === 'big bee') big ??= loadBig();
                const next = name === 'bee' ? bee : await big;

                if (next === undefined || next === shown) return;
                // the rig that leaves mixes out to its setup pose and rests
                shown.hero.stop({ mix: 0.1 });
                shown.hero.visible = false;
                rows.remove();
                next.hero.visible = true;
                next.hero.play(next.rest, { loop: true });
                rows = rigControls(next.hero, context, next);
                shown = next;
                show('none yet');
            },
            'bee',
        );
        let rows = rigControls(hero, context, bee);

        show = readout('Event', 10);
        show('none yet');
    },
});
