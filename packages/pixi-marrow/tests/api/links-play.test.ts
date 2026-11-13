import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Links } from '../../src/api/links';
import { type MarrowAsset, MarrowSpine } from '../../src/index';
import { nextVersion } from '../../src/pose/state';
import { loadAttachCode } from '../../src/render/attach-code';
import { loadMeshCode } from '../../src/render/mesh-code';
import { loadFamily, populate } from '../render/batch-check';
import { createStage } from '../render/batch-stage';
import type { CoverSlot } from '../render/cover-rig';
import { settle, WINDOW } from '../render/heap';
import { coverAsset } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';

/*
 * Bone handles, followed and attached containers while a skeleton plays, on the engines of both
 * generations: Spine 4.2 and 4.3.
 */

/** A Pixi object that draws: a mesh of one triangle. The stage of these tests notes it as a mesh. */
function drawable(): Mesh {
    const geometry = new MeshGeometry({
        positions: new Float32Array([0, 0, 10, 0, 10, 10]),
        uvs: new Float32Array(6),
        indices: new Uint32Array([0, 1, 2]),
    });

    return new Mesh({ geometry, texture: Texture.WHITE });
}

describe('handles and containers while a skeleton plays', () => {
    const made: MarrowSpine[] = [];

    function create(asset: MarrowAsset, options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { ...options, autoUpdate: false });

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        await Promise.all([loadAttachCode(), loadMeshCode()]);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    describe.each([
        ['4.2/spineboy-pro.skel', 'walk'],
        ['4.3/spineboy-pro.skel', 'walk'],
    ])('a write to a bone of %s', (id, animation) => {
        it('stays on a bone no animation keys, is replaced on a keyed bone, and wakes a skeleton that rests', async () => {
            const asset = await fixtureAsset(id);
            const spine = create(asset);
            const names = asset.model.bones.names;
            const before = names.map((name) => spine.bone(name).rotation);

            spine.play(animation, { loop: true });
            spine.update(FRAME);
            // every bone is turned by hand between two updates, as the official runtime allows
            for (const name of names) spine.bone(name).rotation = (before[names.indexOf(name)] ?? 0) + 33;
            spine.update(FRAME);
            const kept = names.filter((name, i) => spine.bone(name).rotation === (before[i] ?? 0) + 33);
            const replaced = names.filter((name) => !kept.includes(name));

            // the animation keys some bones and leaves others alone
            expect(kept.length).toBeGreaterThan(0);
            expect(replaced.length).toBeGreaterThan(0);
            for (let frame = 0; frame < 20; frame++) spine.update(FRAME);
            for (const name of kept)
                expect(spine.bone(name).rotation, name).toBe((before[names.indexOf(name)] ?? 0) + 33);
            // at rest: a write wakes the skeleton for one update, and it rests again
            spine.stop();
            for (let frame = 0; frame < 240; frame++) spine.update(FRAME);
            const { skips } = spine.stats;
            const bone = spine.bone(kept[0] ?? names[0] ?? '');
            const { worldRotation } = bone;

            spine.update(FRAME);
            expect(spine.stats.skips).toBe(skips + 1);
            bone.rotation += 20;
            // the world values are those of the last update
            expect(bone.worldRotation).toBe(worldRotation);
            spine.update(FRAME);
            expect(spine.stats.skips).toBe(skips + 1);
            expect(Math.abs(bone.worldRotation - worldRotation)).toBeGreaterThan(1);
            expect(bone.active).toBe(true);
            expect(bone.worldMatrix().tx).toBe(bone.worldX);
            // and it rests again: at once on 4.2, after one more update on 4.3
            for (let frame = 0; frame < 3; frame++) spine.update(FRAME);
            const rested = spine.stats.skips;

            spine.update(FRAME);
            expect(spine.stats.skips).toBe(rested + 1);
            expect(rested - skips).toBeGreaterThanOrEqual(3);
        });
    });

    describe.each(['batched', 'mesh'] as const)('in the %s mode', (renderMode) => {
        it('allocate nothing in an update once they are warm', async () => {
            const stage = createStage();
            const family = await loadFamily('4.2/spineboy-pro.skel');
            const [rig] = await populate(stage, family, 1, { renderMode });

            if (rig === undefined) throw new Error('no rig');
            const { state } = rig.engine;
            const { names, bones } = rig.model.slots;
            const links = new Links({ engine: rig.engine, state, model: rig.model, view: rig.view });
            // containers that draw nothing themselves: what a Pixi object costs to draw is its own
            const [label, marker] = [new Container(), new Container()];
            const head = rig.model.bones.names.indexOf('head');
            const gun = bones[names.indexOf('gun')] ?? 0;

            // Pixi sets a transform from a matrix with numbers it makes on the way, as it does for
            // the official runtime. What is measured here is the work of this library around that
            for (const container of [label, marker]) container.setFromMatrix = (): void => undefined;
            links.attach(names.indexOf('gun'), label);
            links.follow(head, marker);
            rig.engine.update(0);
            links.move(state);
            rig.view.update(state);
            // Pixi collects the containers once. Its own work per frame is not measured here
            stage.render();
            const windows = settle((i) => {
                // two bones move in every update: the containers follow, and the view places their slots
                state.world[head * 6 + 4] = i % 40;
                state.world[gun * 6 + 5] = i % 7;
                state.version = nextVersion(state.version);
                state.boneStamps[head] = state.version;
                state.boneStamps[gun] = state.version;
                links.move(state);
                rig.view.update(state);
            });

            expect(windows).toBeGreaterThan(0);
            expect(label.visible).toBe(true);
            expect(label.parent).toBe(rig.view.container);
            expect(rig.view.stats.skips).toBeLessThan(WINDOW);
        });

        it('stay in the draw order while a draw order key moves a slot across the attached one', async () => {
            const asset = await fixtureAsset('4.2/coin-pro.skel');
            /** Plays the coin for 150 frames, with a container on the slot or without one, and counts. */
            const run = (attached: boolean): { moved: number; builds: number; kinds: string[] } => {
                const stage = createStage();
                const spine = create(asset, { renderMode });
                const order = (): string => spine.engine.state.drawOrder.join(' ');
                const counted = { moved: 0, builds: 0, kinds: [] as string[] };

                stage.root.addChild(spine);
                // the key of the animation moves the slot `coin-side` behind the one the container is attached to
                if (attached) spine.attach('coin-front-texture', drawable());
                spine.play('animation', { loop: true });
                spine.update(0);
                stage.render();
                const { builds } = stage.counts;

                for (let frame = 0; frame < 150; frame++) {
                    const before = order();

                    spine.update(FRAME);
                    stage.render();
                    if (order() !== before) counted.moved++;
                    counted.kinds.push(stage.counts.draws.map((draw) => draw.kind).join(' '));
                }
                counted.builds = stage.counts.builds - builds;

                return counted;
            };
            // the first coins of a page grow the room for cut triangles, which builds the instructions again
            run(true);
            const plain = run(false);
            const held = run(true);
            const own = renderMode === 'batched' ? 'batch' : 'mesh';

            expect(held.moved).toBe(2);
            // the container is drawn in every frame, and the skeleton around it
            for (const drawn of held.kinds) {
                expect(drawn.split(' ').filter((kind) => kind === 'mesh').length).toBeGreaterThan(
                    renderMode === 'batched' ? 0 : 1,
                );
                expect(drawn).toContain(own);
            }
            // a key that moves a slot across the container rewrites indices, and Pixi builds nothing again
            expect([plain.builds, held.builds]).toEqual([0, 0]);
            console.log(
                `coin, ${renderMode}: ${held.moved} changes of the draw order in 150 frames. Instruction builds: ${plain.builds} without a container, ${held.builds} with one`,
            );
        });
    });

    it('draw a slot behind an opaque one when a container sits between them', async () => {
        const slots: CoverSlot[] = [
            { name: 'small', shows: 'small' },
            { name: 'holder', shows: 'small', at: [400, 0] },
            { name: 'big', shows: 'big' },
        ];
        const spine = create(await coverAsset(slots));
        const label = drawable();

        for (let frame = 0; frame < 12; frame++) spine.update(FRAME);
        // the big slot covers the small one, which is left out
        expect(spine.stats.coveredSlots).toBe(1);
        // nothing is known about a container: what is below it is drawn
        spine.attach('holder', label);
        for (let frame = 0; frame < 80; frame++) spine.update(FRAME);
        expect(spine.stats.coveredSlots).toBe(0);
        spine.detach(label);
        for (let frame = 0; frame < 80; frame++) spine.update(FRAME);
        expect(spine.stats.coveredSlots).toBe(1);
    });
});
