import { Bounds, Container, getLocalBounds } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadIdleCode } from '../../src/api/idle-cache';
import { IDLE_MAX_SIDE, IDLE_WAIT } from '../../src/api/idle-image';
import { createPlacement, pixelBox, placeOf } from '../../src/api/idle-place';
import { viewOf } from '../../src/api/view-of';
import { MarrowSpine } from '../../src/index';
import { loadAttachCode } from '../../src/render/attach-code';
import { plainOutlines } from '../render/cuts';
import { coverAsset } from './cover-asset';
import { fixtureAsset } from './helpers';
import {
    cached,
    fakeRenderer,
    frame,
    framesUntilCached,
    idleSprite,
    render,
    stageOf,
    viewContainer,
} from './idle-stage';

/*
 * The idle cache in Node: when a skeleton at rest gets its image, what drops it, and what is
 * freed. The renderer is a fake that records what it is asked to draw, see `idle-stage.ts`.
 */

/** A skeleton at rest on a stage of its own, with the idle cache on and the animation `run` played to its end. */
async function resting(options: { play?: boolean } = {}): Promise<MarrowSpine> {
    const spine = new MarrowSpine(await fixtureAsset('4.2/speedy-ess.skel'), { autoUpdate: false, idleCache: 'auto' });

    stageOf(spine);
    spine.position.set(200.25, 300.5);
    spine.scale.set(0.5);
    if (options.play !== false) {
        spine.play('run', { loop: false });
        spine.update(5);
    }

    return spine;
}

beforeAll(async () => {
    await loadIdleCode();
});

describe('the idle cache', () => {
    it('draws a skeleton at rest into an image after the wait, and shows it in place of the view', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const view = viewContainer(spine);

        // the wait, then two renders at the same place
        expect(framesUntilCached(spine, fake)).toBe(IDLE_WAIT + 2);
        expect(fake.renders).toHaveLength(1);
        const [drawn] = fake.renders;
        const sprite = idleSprite(spine);

        expect(drawn?.viewInside).toBe(true);
        expect(drawn?.clear).toBe(true);
        // the view is back in its place, and the sprite follows it
        expect(spine.children.indexOf(view)).toBe(0);
        expect(spine.children.indexOf(sprite as Container)).toBe(1);
        expect(view.visible).toBe(false);
        expect(sprite?.texture).toBe(drawn?.target);
        // the image covers the bounds of the skeleton on the pixel grid of the target, with a margin
        const place = createPlacement();

        placeOf(spine, 1, place);
        const box = pixelBox(getLocalBounds(view, new Bounds()), place, 1);

        expect([drawn?.target.width, drawn?.target.height]).toEqual([box.width, box.height]);
        expect(drawn?.transform.tx).toBeCloseTo(Number(place[4]) - box.x, 9);
        expect(drawn?.transform.a).toBeCloseTo(0.5, 12);
        // the sprite puts the corner of the image on a whole pixel
        sprite?.updateLocalTransform();
        const corner = spine.localTransform.apply(sprite?.localTransform.apply({ x: 0, y: 0 }) ?? { x: 0, y: 0 });

        expect(corner.x).toBeCloseTo(box.x, 9);
        expect(corner.y).toBeCloseTo(box.y, 9);
        // it stays while nothing changes, and draws nothing more
        for (let i = 0; i < 50; i++) frame(spine, fake);
        expect(cached(spine)).toBe(true);
        expect(fake.renders).toHaveLength(1);
        spine.destroy();
    });

    it('is not there with the setting off, and waits the full time before an image', async () => {
        const off = new MarrowSpine(await fixtureAsset('4.2/speedy-ess.skel'), { autoUpdate: false });
        const fake = fakeRenderer(off);

        for (let i = 0; i < 2 * IDLE_WAIT; i++) frame(off, fake);
        expect(idleSprite(off)).toBeUndefined();
        const spine = await resting();
        const later = fakeRenderer(spine);

        for (let i = 0; i < IDLE_WAIT - 1; i++) frame(spine, later);
        // no sprite, so no callback in any render, before the wait is over
        expect(idleSprite(spine)).toBeUndefined();
        spine.destroy();
        off.destroy();
    });

    it('drops the image in the update that plays again, and lets go of its pixels', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);

        framesUntilCached(spine, fake);
        const texture = fake.renders[0]?.target;

        spine.play('run', { loop: true });
        spine.update(1 / 60);
        // before any render: the frame of the update shows the live skeleton
        expect(cached(spine)).toBe(false);
        expect(viewContainer(spine).visible).toBe(true);
        // the texture keeps no pixels, and is not destroyed: Pixi may hold it in a group of bindings
        expect([texture?.source.pixelWidth, texture?.source.pixelHeight, texture?.destroyed]).toEqual([1, 1, false]);
        // a skeleton that plays never gets an image
        for (let i = 0; i < 3 * IDLE_WAIT; i++) frame(spine, fake);
        expect(fake.renders).toHaveLength(1);
        // and gets a new one once it rests again
        spine.stop();
        expect(framesUntilCached(spine, fake)).toBeGreaterThan(IDLE_WAIT);
        expect(fake.renders).toHaveLength(2);
        // the next image takes the texture again, at its own size
        expect(fake.renders[1]?.target).toBe(texture);
        expect(texture?.source.pixelWidth).toBeGreaterThan(1);
        spine.destroy();
    });

    it('keeps the image for a move by whole pixels, and drops it in the render of any other placement', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const parent = new Container();
        const stage = spine.parent;

        stage?.addChild(parent);
        parent.addChild(spine);
        framesUntilCached(spine, fake);
        parent.position.set(3, -7);
        frame(spine, fake);
        expect(cached(spine)).toBe(true);
        // a part of a pixel would sample between texels
        parent.position.x += 0.25;
        render(spine, fake);
        expect(cached(spine)).toBe(false);
        // the wait starts again
        expect(framesUntilCached(spine, fake)).toBe(IDLE_WAIT + 2);
        for (const change of [
            () => parent.scale.set(1.1),
            () => parent.scale.set(0.9),
            () => {
                parent.rotation = 0.01;
            },
        ]) {
            change();
            render(spine, fake);
            expect(cached(spine)).toBe(false);
            framesUntilCached(spine, fake);
        }
        spine.destroy();
    });

    it('drops the image for an alpha or a blend mode above the skeleton, and for a restored context', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const stage = spine.parent;

        if (stage === null) throw new Error('no stage');
        framesUntilCached(spine, fake);
        stage.alpha = 0.5;
        render(spine, fake);
        expect(cached(spine)).toBe(false);
        // it waits while the alpha stays
        for (let i = 0; i < 2 * IDLE_WAIT; i++) frame(spine, fake);
        expect(cached(spine)).toBe(false);
        stage.alpha = 1;
        framesUntilCached(spine, fake);
        stage.blendMode = 'add';
        render(spine, fake);
        expect(cached(spine)).toBe(false);
        stage.blendMode = 'normal';
        framesUntilCached(spine, fake);
        // a tint is a factor of every color, so the image takes it as the slots do
        spine.tint = 0xff8080;
        frame(spine, fake);
        expect(cached(spine)).toBe(true);
        fake.lose();
        fake.restore();
        render(spine, fake);
        expect(cached(spine)).toBe(false);
        spine.destroy();
    });

    it('draws no image under a tint when a slot has a dark color, which the shaders leave untinted', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/alien-pro.skel'), {
            autoUpdate: false,
            idleCache: 'auto',
        });
        const fake = fakeRenderer(spine);

        stageOf(spine);
        spine.position.set(300, 400);
        spine.scale.set(0.25);
        expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
        spine.tint = 0x808080;
        render(spine, fake);
        expect(cached(spine)).toBe(false);
        expect(framesUntilCached(spine, fake)).toBe(-1);
        spine.tint = 0xffffff;
        expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
        spine.destroy();
    });

    it('draws no image while the context is lost, and drops one drawn by another renderer', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);

        fake.lose();
        for (let i = 0; i < 2 * IDLE_WAIT; i++) frame(spine, fake);
        expect(fake.renders).toHaveLength(0);
        fake.restore();
        frame(spine, fake);
        frame(spine, fake);
        expect(cached(spine)).toBe(true);
        render(spine, fakeRenderer(spine));
        expect(cached(spine)).toBe(false);
        spine.destroy();
        // a context lost between the render that made the image due and the update that would draw it
        const late = await resting();
        const other = fakeRenderer(late);

        for (let i = 0; i < IDLE_WAIT + 1; i++) frame(late, other);
        other.lose();
        late.update(1 / 60);
        expect(other.renders).toHaveLength(0);
        other.restore();
        expect(framesUntilCached(late, other)).toBe(2);
        late.destroy();
    });

    it('draws no image while the skeleton moves in every render', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);

        for (let i = 0; i < 3 * IDLE_WAIT; i++) {
            spine.x += 0.3;
            frame(spine, fake);
        }
        expect(fake.renders).toHaveLength(0);
        // a move by whole pixels keeps an image exact, so it counts as still
        for (let i = 0; i < 3 * IDLE_WAIT && !cached(spine); i++) {
            spine.x += 1;
            frame(spine, fake);
        }
        expect(cached(spine)).toBe(true);
        spine.destroy();
    });

    it('draws the image at the resolution of the target, and none for a multisampled target', async () => {
        const spine = await resting();
        const sharp = fakeRenderer(spine, 2);

        framesUntilCached(spine, sharp);
        const [drawn] = sharp.renders;

        // the skeleton is at a scale of 0.5, so 1 unit of the target is 1 pixel of the image
        expect(drawn?.transform.a).toBeCloseTo(1, 12);
        expect(drawn?.target.source.scaleMode).toBe('nearest');
        // the same skeleton drawn to a multisampled target draws live, and gets no image there
        const smooth = fakeRenderer(spine, 2, true);

        render(spine, smooth);
        expect(cached(spine)).toBe(false);
        for (let i = 0; i < 3 * IDLE_WAIT; i++) frame(spine, smooth);
        expect(smooth.renders).toHaveLength(0);
        spine.destroy();
    });

    it('draws a skeleton larger than the limit live, and tries again after the wait', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const bounds = getLocalBounds(viewContainer(spine), new Bounds());

        spine.scale.set((IDLE_MAX_SIDE + 10) / bounds.width);
        for (let i = 0; i < 3 * IDLE_WAIT; i++) frame(spine, fake);
        expect(fake.renders).toHaveLength(0);
        spine.scale.set(0.5);
        expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
        spine.destroy();
    });

    it('drops the image when the render mode changes, and when outlines arrive', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const view = viewOf(spine);

        framesUntilCached(spine, fake);
        spine.renderMode = 'mesh';
        spine.update(0);
        expect(cached(spine)).toBe(false);
        framesUntilCached(spine, fake);
        view?.setOutlines(plainOutlines(spine.asset.atlas));
        spine.update(0);
        expect(cached(spine)).toBe(false);
        spine.destroy();
    });

    it('draws no image for a skeleton with an attached container, and one for a container that follows a bone', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);
        const follower = new Container();

        spine.addChild(follower);
        spine.follow('root', follower);
        framesUntilCached(spine, fake);
        // the follower is a child of its own, drawn live after the image
        expect(spine.children.indexOf(follower)).toBe(2);
        const label = new Container();

        await loadAttachCode();
        spine.attach('torso', label);
        spine.update(0);
        expect(cached(spine)).toBe(false);
        for (let i = 0; i < 3 * IDLE_WAIT; i++) frame(spine, fake);
        expect(cached(spine)).toBe(false);
        spine.detach(label);
        expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
        spine.destroy();
    });

    it('draws no image while a visible slot multiplies or screens', async () => {
        for (const blend of ['multiply', 'screen'] as const) {
            const asset = await coverAsset([
                { name: 'a', shows: 'big' },
                { name: 'b', shows: 'mid', blend },
            ]);
            const spine = new MarrowSpine(asset, { autoUpdate: false, idleCache: 'auto' });
            const fake = fakeRenderer(spine);

            stageOf(spine);
            for (let i = 0; i < 3 * IDLE_WAIT; i++) frame(spine, fake);
            expect(fake.renders).toHaveLength(0);
            // the same skeleton gets one once that slot is hidden
            spine.slot('b').alpha = 0;
            expect(framesUntilCached(spine, fake)).toBeGreaterThan(0);
            spine.destroy();
        }
        // additive slots blend with the slots below them alone
        const additive = new MarrowSpine(await coverAsset([{ name: 'a', shows: 'big', blend: 'additive' }]), {
            autoUpdate: false,
            idleCache: 'auto',
        });

        stageOf(additive);
        // the first update of the display object starts the cache, and the wait follows
        expect(framesUntilCached(additive, fakeRenderer(additive))).toBe(IDLE_WAIT + 3);
        additive.destroy();
    });

    it('lets go of the pixels and the sprite when the display object is destroyed', async () => {
        const spine = await resting();
        const fake = fakeRenderer(spine);

        framesUntilCached(spine, fake);
        const sprite = idleSprite(spine);
        const texture = fake.renders[0]?.target;

        spine.destroy();
        expect(texture?.source.pixelWidth).toBe(1);
        expect(sprite?.destroyed).toBe(true);
        // a skeleton that never rested holds nothing to free
        const busy = await resting();

        busy.destroy();
        expect(idleSprite(busy)).toBeUndefined();
    });
});
