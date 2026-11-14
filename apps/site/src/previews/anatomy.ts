import type { Ticker } from 'pixi.js';
// #region import
import { MarrowSpine } from 'pixi-marrow';
import { MarrowDebug } from 'pixi-marrow/debug';
// #endregion
import { fit } from './rig-controls';
import { definePreview } from './runtime';

/*
 * The parts of a Spine skeleton, shown on three symbols of the slot game Bzzz. `bones` draws the
 * bones over a playing symbol. `slots` builds the setup pose up from the back, one slot after the
 * other in the draw order, and names each. `attachments` draws the outline of every region and
 * the triangles of every mesh while the symbol plays, so the empty slots it fills show too.
 */

/** The symbols to pick from, simplest first. */
const RIGS = { A: 'animation_a', coin: 'animation_coin', bee: 'animation_bee' } as const;

type RigName = keyof typeof RIGS;

const VIEWS = ['picture', 'bones', 'slots', 'attachments'] as const;

type View = (typeof VIEWS)[number];

/** The blend modes of a slot, by their number in the model. */
const BLENDS = ['normal', 'additive', 'multiply', 'screen'] as const;
/** Seconds between two slots while the draw order builds up, and the pause once it is complete. */
const SLOT_STEP = 0.45;
const BUILT_PAUSE = 2;

/** A symbol on the stage with its overlay. */
interface Rig {
    hero: MarrowSpine;
    debug: MarrowDebug;
}

/** What a slot shows in the setup pose, in words. */
function describeSlot(hero: MarrowSpine, index: number): string {
    const { slots, skins } = hero.asset.model;
    const name = slots.names[index] ?? '';
    const shown = slots.attachments[index] ?? null;
    const blend = BLENDS[slots.blendModes[index] ?? 0] ?? 'normal';

    if (shown === null) return `${name}, empty in the setup pose`;
    const skin = skins.find((item) => item.name === 'default') ?? skins[0];
    const attachment = skin?.attachments.find((item) => item.slot === index && item.name === shown)?.attachment;
    let kind: string = attachment?.type ?? 'attachment';

    if (attachment?.type === 'mesh') {
        kind = `mesh of ${attachment.regionUVs.length / 2} vertices${attachment.bones === null ? '' : ', weighted'}`;
    }

    return `${name}, a ${kind}${blend === 'normal' ? '' : `, ${blend}`}`;
}

/** The parts of a skeleton, counted. */
function partsOf(hero: MarrowSpine): string {
    const { counts } = hero.info;

    return `${counts.bones} bones, ${counts.slots} slots, ${counts.regions} regions, ${counts.meshes} meshes`;
}

export default definePreview({
    size: [760, 440],
    async setup(context) {
        const { app, size, pick, readout } = context;
        const rigs = new Map<RigName, Promise<Rig>>();
        const showParts = readout('Parts', 56);
        const showSlot = readout('Draw order', 56);
        let shown: Rig | null = null;
        let view: View = 'picture';
        let built = 0;
        let clock = 0;

        /** Loads a symbol once, with an overlay that draws nothing until a view asks. */
        const load = (name: RigName): Promise<Rig> => {
            let rig = rigs.get(name);

            if (rig === undefined) {
                rig = MarrowSpine.load({ skeleton: `/rigs/${RIGS[name]}.skel`, atlas: '/rigs/symbols.atlas' }).then(
                    (hero) => {
                        hero.play('idle', { loop: true });
                        fit(hero, size, 0.62);

                        return { hero, debug: new MarrowDebug(hero, { layers: { regions: false, meshHulls: false } }) };
                    },
                );
                rigs.set(name, rig);
            }

            return rig;
        };
        /** Hides every slot after the first `count` in the draw order, and shows the others as set up. */
        const buildUp = (hero: MarrowSpine, count: number): void => {
            const { slots } = hero.asset.model;

            for (let i = 0; i < slots.count; i++) {
                hero.slot(slots.names[i] ?? '').alpha = i < count ? (slots.colors[i * 4 + 3] ?? 1) : 0;
            }
        };
        /** Shows a view on the symbol that shows. */
        const show = (next: View): void => {
            view = next;
            built = 0;
            clock = 0;
            showSlot(next === 'slots' ? 'Builds up from the back' : 'Pick slots to build the symbol up');
            if (shown === null) return;
            const { hero, debug } = shown;

            debug.layers.bones = next === 'bones';
            debug.layers.regions = next === 'attachments';
            debug.layers.meshHulls = next === 'attachments';
            debug.layers.meshTriangles = next === 'attachments';
            if (next !== 'slots') {
                hero.setupPose('slots');
                hero.play('idle', { loop: true });

                return;
            }
            // the draw order shows best in the setup pose, where nothing moves
            hero.stop();
            hero.setupPose();
            buildUp(hero, 0);
        };
        /** Adds the next slot of the draw order while the slots build up. */
        const step = (ticker: Ticker): void => {
            if (view !== 'slots' || shown === null) return;
            const { hero } = shown;
            const count = hero.asset.model.slots.count;

            clock += ticker.deltaMS / 1000;
            if (built < count && clock >= SLOT_STEP) {
                clock = 0;
                built++;
                buildUp(hero, built);
                showSlot(`${built} of ${count}: ${describeSlot(hero, built - 1)}`);
            } else if (built >= count && clock >= BUILT_PAUSE) {
                clock = 0;
                built = 0;
                buildUp(hero, 0);
            }
        };
        /** Puts a symbol on the stage in place of the one before. */
        const choose = async (name: RigName): Promise<void> => {
            const rig = await load(name);

            shown?.hero.removeFromParent();
            shown = rig;
            app.stage.addChild(rig.hero);
            showParts(partsOf(rig.hero));
            show(view);
        };

        app.ticker.add(step);
        pick('Symbol', Object.keys(RIGS) as RigName[], (name) => void choose(name), 'bee');
        pick('Show', VIEWS, show, 'picture');
        await choose('bee');
    },
});
