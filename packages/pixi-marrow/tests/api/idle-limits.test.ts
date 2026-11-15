import { AlphaFilter, Batch, Bounds, type Container, Graphics, getLocalBounds, TextureSource } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadIdleCode } from '../../src/api/idle-cache';
import { IDLE_BUDGET, IDLE_MAX_SIDE, IDLE_WAIT } from '../../src/api/idle-image';
import { MarrowSpine } from '../../src/index';
import { BatchElement } from '../../src/render/batch-element';
import { MarrowBatcher } from '../../src/render/batcher';
import { createStage } from '../render/batch-stage';
import { fixtureAsset } from './helpers';
import { cached, fakeRenderer, frame, framesUntilCached, stageOf, viewContainer } from './idle-stage';

/*
 * What the idle cache must not hold an image through, found in an audit: a page texture that
 * changes, a filter or a mask above the skeleton, and more images than a budget of memory. And
 * what it must not keep after an image: the view of the last capture in its render group.
 */

const made: MarrowSpine[] = [];

/** A skeleton at rest with the idle cache on, the animation `run` played to its end, on a stage of its own. */
async function resting(): Promise<MarrowSpine> {
    const spine = new MarrowSpine(await fixtureAsset('4.2/speedy-ess.skel'), { autoUpdate: false, idleCache: 'auto' });

    made.push(spine);
    stageOf(spine);
    spine.position.set(200.25, 300.5);
    spine.scale.set(0.5);
    spine.play('run', { loop: false });
    spine.update(5);

    return spine;
}

beforeAll(async () => {
    await loadIdleCode();
});

afterEach(() => {
    for (const spine of made.splice(0)) spine.destroy();
});

describe('the limits of the idle cache', () => {
    it('drops the image when a page source updates, and when a page texture takes another source', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const [page] = spine.asset.textures;

        if (page === undefined) throw new Error('speedy-ess has a page');
        expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
        // a canvas or a video page tells of new pixels
        page.source.update();
        frame(spine, fake);
        expect(cached(spine)).toBe(false);
        expect(framesUntilCached(spine, fake)).toBe(IDLE_WAIT + 2);
        const before = page.source;
        const swapped = new TextureSource({ resource: before.resource, width: before.width, height: before.height });

        page.source = swapped;
        frame(spine, fake);
        expect(cached(spine)).toBe(false);
        expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
        // the new source is the one heard from now on, and the old one no more
        before.update();
        frame(spine, fake);
        expect(cached(spine)).toBe(true);
        swapped.update();
        frame(spine, fake);
        expect(cached(spine)).toBe(false);
        page.source = before;
    });

    it('hears the pages only while an image shows, so a skeleton dropped without destroy() is not held', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const [page] = spine.asset.textures;

        if (page === undefined) throw new Error('speedy-ess has a page');
        const texture = page.listenerCount('update');
        const source = page.source.listenerCount('update');

        expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
        expect(page.listenerCount('update')).toBe(texture + 1);
        expect(page.source.listenerCount('update')).toBe(source + 1);
        // a change of the pose drops the image, and the pages are not heard any more
        spine.play('run', { loop: false });
        spine.update(0.1);
        frame(spine, fake);
        expect(cached(spine)).toBe(false);
        expect(page.listenerCount('update')).toBe(texture);
        expect(page.source.listenerCount('update')).toBe(source);
    });

    it('keeps the skeleton live under a filter or a mask, of its own or of a container above it', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const parent = spine.parent as Container;

        for (const [on, off] of [
            [() => (parent.filters = [new AlphaFilter()]), () => (parent.filters = [])],
            [() => (spine.filters = [new AlphaFilter()]), () => (spine.filters = [])],
            [() => (parent.mask = new Graphics().rect(0, 0, 100, 100).fill(0xffffff)), () => (parent.mask = null)],
        ] as const) {
            on();
            for (let i = 0; i < 3 * IDLE_WAIT; i++) frame(spine, fake);
            expect(cached(spine)).toBe(false);
            off();
            expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
            // one that comes while the image shows drops it in that render
            on();
            frame(spine, fake);
            expect(cached(spine)).toBe(false);
            off();
        }
        expect(fake.renders.length).toBe(3);
    });

    it('holds at most the budget of bytes in the images of all skeletons, and takes one again when room is made', async () => {
        const first = await resting();
        const bounds = getLocalBounds(viewContainer(first), new Bounds());

        first.scale.set((IDLE_MAX_SIDE - 20) / Math.max(bounds.width, bounds.height));
        const fake = fakeRenderer(first);

        framesUntilCached(first, fake);
        const target = fake.renders[0]?.target;

        if (target === undefined) throw new Error('an image');
        const fit = Math.floor(IDLE_BUDGET / (target.width * target.height * 4));
        const spines = [first];

        for (let i = 1; i <= fit; i++) {
            const spine = await resting();

            spine.scale.copyFrom(first.scale);
            framesUntilCached(spine, fakeRenderer(spine), 3 * IDLE_WAIT);
            spines.push(spine);
        }
        const last = spines[fit];

        expect(spines.slice(0, fit).every(cached)).toBe(true);
        if (last === undefined) throw new Error('one more than fits');
        expect(cached(last)).toBe(false);
        // the first one plays: its image goes, and the last one gets one
        first.play('run', { loop: false });
        first.update(0.1);
        expect(framesUntilCached(last, fakeRenderer(last), 3 * IDLE_WAIT)).toBeGreaterThan(0);
    });

    it('lets go of the view of the last capture in the render group it draws through', async () => {
        const spine = await resting();
        const stage = createStage();
        const studios: Container[] = [];
        const batchers = new Set<MarrowBatcher>();

        const released: unknown[] = [];

        Reflect.set(stage.renderer.renderTarget.renderTarget, 'resolution', 1);
        Reflect.set(stage.renderer.runners, 'contextChange', { add: () => undefined });
        // the pipe of instanced draws keeps runs per instruction set: the studio must give its own back
        Reflect.set(stage.renderer.renderPipes, 'marrowInstances', {
            destroyInstructionSet: (set: unknown) => released.push(set),
        });
        Reflect.set(stage.renderer, 'render', ({ container }: { container: Container }) => {
            stage.draw(container);
            studios.push(container);
            for (const instruction of container.renderGroup?.instructionSet.instructions ?? []) {
                if (instruction instanceof Batch && instruction.batcher instanceof MarrowBatcher) {
                    batchers.add(instruction.batcher);
                }
            }
        });
        stage.root.addChild(spine.parent as Container);
        for (let i = 0; i < 3 * IDLE_WAIT && !cached(spine); i++) {
            spine.update(1 / 60);
            stage.render();
        }
        expect(cached(spine)).toBe(true);
        const [studio] = studios;

        // the capture drew the skeleton in a batch of ours, and the studio kept none of it
        expect(batchers.size).toBeGreaterThan(0);
        expect(studio?.children).toEqual([]);
        expect(studio?.renderGroup?.instructionSet.instructions).toEqual([]);
        expect(studio?.renderGroup?.instructionSet.renderables).toEqual([]);
        expect(released).toContain(studio?.renderGroup?.instructionSet);
        for (const batcher of batchers) {
            const pool: unknown = Reflect.get(batcher, 'pool');

            for (const batch of Array.isArray(pool) ? pool : []) {
                expect((batch as Batch).elements.some((element) => element instanceof BatchElement)).toBe(false);
            }
        }
    });
});
