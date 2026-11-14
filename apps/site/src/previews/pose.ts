import { Graphics, type Ticker } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';
import { MarrowDebug } from 'pixi-marrow/debug';
import { fit } from './rig-controls';
import { definePreview } from './runtime';

/*
 * Local and world transforms on the bee of the slot game Bzzz. The bee stands in its setup pose
 * and one bone turns: it sways, or follows a drag over the canvas. The bones that turn with it
 * are drawn in the color of the site, every other bone stays grey. The numbers under the canvas
 * are the local rotation of the bone and of its first child, and where each points on screen.
 */

/** The bones to turn, by the name the panel shows. */
const BONES = { neck: 'neek', head: 'head', hand: 'tors2', antenna: 'head2', wing: 'wingl' } as const;

type Part = keyof typeof BONES;

const MOTIONS = ['sway', 'drag'] as const;

type Motion = (typeof MOTIONS)[number];

/** Degrees the bone sways to each side, and seconds of one sway. */
const SWAY = 22;
const SWAY_SECONDS = 2.4;
/** Degrees of turn per design unit that the pointer moves across. */
const DRAG_DEGREES = 0.6;
const HIGHLIGHT = 0xff7a3d;

/** The indices of a bone and of every bone below it. */
function family(hero: MarrowSpine, bone: number): number[] {
    const { parents, count } = hero.asset.model.bones;
    const found = [bone];

    // a parent comes before its children in the bone list, so one pass finds every descendant
    for (let i = bone + 1; i < count; i++) {
        if (found.includes(parents[i] ?? -1)) found.push(i);
    }

    return found;
}

export default definePreview({
    size: [760, 440],
    async setup(context) {
        const { app, size, pick, readout } = context;
        const hero = await MarrowSpine.load({ skeleton: '/rigs/animation_bee.skel', atlas: '/rigs/symbols.atlas' });
        const lines = new Graphics();
        const { names, lengths } = hero.asset.model.bones;
        const showBone = readout('Bone', 54);
        const showChild = readout('First child', 54);
        const showFamily = readout('Follow it', 54);
        let part: Part = 'neck';
        let motion: Motion = 'sway';
        let setupRotation = 0;
        let turn = 0;
        let clock = 0;
        let dragFrom: { x: number; turn: number } | null = null;
        let moved: number[] = [];

        app.stage.addChild(hero);
        hero.update(0);
        fit(hero, size, 0.7);
        // the overlay draws every bone in grey, and the lines of this preview draw the family over it
        new MarrowDebug(hero, {
            layers: { bones: true, regions: false, meshHulls: false },
            colors: { bones: 0x6b6b75 },
        });
        // the lines lie over the bee at its scale, so that dimming the bee leaves them bright
        hero.alpha = 0.55;
        lines.position.copyFrom(hero.position);
        lines.scale.copyFrom(hero.scale);
        app.stage.addChild(lines);
        /** Draws the bones that follow the turned one, from each to its parent and along its length. */
        const drawFamily = (): void => {
            lines.clear();
            for (const index of moved) {
                const bone = hero.bone(names[index] ?? '');
                const tip = bone.localToWorld({ x: Math.max(lengths[index] ?? 0, 10), y: 0 });

                lines.moveTo(bone.worldX, bone.worldY).lineTo(tip.x, tip.y);
                lines.circle(bone.worldX, bone.worldY, (index === moved[0] ? 7 : 3.5) / hero.scale.x);
            }
            lines.stroke({ color: HIGHLIGHT, width: 3.5 / hero.scale.x });
        };
        /** Says what the turned bone and its first child show now. */
        const describe = (): void => {
            const [first, child] = moved;
            const bone = hero.bone(names[first ?? 0] ?? '');

            showBone(
                `${bone.name}: local ${bone.rotation.toFixed(1)}, on screen ${bone.worldRotation.toFixed(1)} degrees`,
            );
            if (child === undefined) showChild('none: nothing hangs below this bone');
            else {
                const next = hero.bone(names[child] ?? '');

                showChild(
                    `${next.name}: local ${next.rotation.toFixed(1)}, on screen ${next.worldRotation.toFixed(1)} degrees`,
                );
            }
            showFamily(`${moved.length - 1} bones below it, ${moved.length} posed again each frame`);
        };
        /** Picks the bone to turn, back in the setup pose. */
        const choose = (next: Part): void => {
            part = next;
            hero.setupPose('bones');
            const index = names.indexOf(BONES[next]);

            moved = family(hero, index);
            setupRotation = hero.bone(BONES[next]).rotation;
            turn = 0;
            clock = 0;
        };

        hero.eventMode = 'none';
        app.stage.eventMode = 'static';
        app.stage.hitArea = app.screen;
        app.stage.on('pointerdown', (event) => {
            if (motion === 'drag') dragFrom = { x: event.getLocalPosition(app.stage).x, turn };
        });
        app.stage.on('globalpointermove', (event) => {
            if (dragFrom !== null)
                turn = dragFrom.turn + (event.getLocalPosition(app.stage).x - dragFrom.x) * DRAG_DEGREES;
        });
        app.stage.on('pointerup', () => {
            dragFrom = null;
        });
        app.stage.on('pointerupoutside', () => {
            dragFrom = null;
        });
        app.ticker.add((ticker: Ticker) => {
            if (motion === 'sway') {
                clock += ticker.deltaMS / 1000;
                turn = Math.sin((clock / SWAY_SECONDS) * Math.PI * 2) * SWAY;
            }
            hero.bone(BONES[part]).rotation = setupRotation + turn;
            drawFamily();
            describe();
        });
        pick('Turn', Object.keys(BONES) as Part[], choose, 'neck');
        pick(
            'Motion',
            MOTIONS,
            (next) => {
                motion = next;
            },
            'sway',
        );
        choose('neck');
    },
});
