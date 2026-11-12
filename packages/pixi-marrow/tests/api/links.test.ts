import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { touchPose } from '../../src/pose/state';
import { loadAttachCode } from '../../src/render/attach-code';
import { loadMeshCode } from '../../src/render/mesh-code';
import { createStage } from '../render/batch-stage';
import type { CoverSlot } from '../render/cover-rig';
import { coverAsset } from './cover-asset';
import { FRAME } from './helpers';

/** Three slots that lie apart, each on a bone of its own. The middle one is the placeholder of these tests. */
const SLOTS: readonly CoverSlot[] = [
    { name: 'back', shows: 'small', at: [0, 0] },
    { name: 'middle', shows: 'small', at: [100, 0] },
    { name: 'front', shows: 'small', at: [200, 0] },
];

/** A Pixi object that draws: a mesh of one triangle. The stage of these tests notes it as a mesh. */
function drawable(): Mesh {
    const geometry = new MeshGeometry({
        positions: new Float32Array([0, 0, 10, 0, 10, 10]),
        uvs: new Float32Array(6),
        indices: new Uint32Array([0, 1, 2]),
    });

    return new Mesh({ geometry, texture: Texture.WHITE });
}

function thrownBy(run: () => unknown): MarrowError {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('nothing was thrown');
}

describe('containers on a display object', () => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { ...options, autoUpdate: false });

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        asset = await coverAsset(SLOTS, { outlines: 'off' });
        await Promise.all([loadAttachCode(), loadMeshCode()]);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    describe.each(['batched', 'mesh'] as const)('attached to a slot in the %s mode', (renderMode) => {
        it('are drawn at the place of the slot, between the slots before and after it', () => {
            const stage = createStage();
            const spine = create({ renderMode });
            const label = drawable();

            stage.root.addChild(spine);
            spine.attach('middle', label);
            spine.update(FRAME);
            stage.render();
            // the skeleton up to the slot, the container, the rest of the skeleton
            expect(stage.counts.draws.map((draw) => draw.kind)).toEqual([
                renderMode === 'mesh' ? 'mesh' : 'batch',
                'mesh',
                renderMode === 'mesh' ? 'mesh' : 'batch',
            ]);
            expect(label.visible).toBe(true);
            expect(label.position.x).toBeCloseTo(100);
            // nothing is built again while the slot stays where it is
            const { builds } = stage.counts;

            for (let frame = 0; frame < 5; frame++) {
                spine.update(FRAME);
                stage.render();
            }
            expect(stage.counts.builds).toBe(builds);
            spine.detach(label);
            spine.update(FRAME);
            stage.render();
            expect(label.parent).toBeNull();
            expect(stage.counts.draws).toHaveLength(1);
        });
    });

    it('follow a bone without a place in the draw order', () => {
        const stage = createStage();
        const spine = create();
        const marker = new Container();

        stage.root.addChild(spine);
        spine.addChild(marker);
        spine.follow('bone-front', marker);
        spine.update(FRAME);
        stage.render();
        expect(marker.position.x).toBeCloseTo(200);
        expect(marker.parent).toBe(spine);
        // the skeleton is one batch as before: a container that follows costs no draw call
        expect(stage.counts.draws).toHaveLength(1);
        // the transform of the bone: position, rotation and scale
        const bone = spine.bone('bone-front');

        bone.rotation = 30;
        bone.scaleX = 2;
        spine.update(FRAME);
        expect(marker.rotation).toBeCloseTo((bone.worldRotation * Math.PI) / 180);
        expect(marker.scale.x).toBeCloseTo(2);
        expect(marker.scale.y).toBeCloseTo(1);
        spine.unfollow(marker);
        bone.x = 500;
        spine.update(FRAME);
        expect(marker.position.x).toBeCloseTo(200);
        expect(marker.parent).toBe(spine);
        // letting go twice, and of a container that was never held, does nothing
        spine.unfollow(marker);
        spine.detach(marker);
    });

    it('follow the alpha, the attachment and the color of their slot when they are attached', () => {
        const spine = create();
        const { state } = spine.engine;
        const [plain, picky, tinted] = [drawable(), drawable(), drawable()];
        const slot = (name: string): number => asset.model.slots.names.indexOf(name);
        const write = (run: () => void): void => {
            run();
            touchPose(state);
            spine.update(FRAME);
        };

        spine.attach('back', plain);
        spine.attach('middle', picky, { followAttachment: true });
        spine.attach('front', tinted, { followColor: true });
        spine.update(FRAME);
        expect([plain.visible, picky.visible, tinted.visible]).toEqual([true, true, true]);
        expect(plain.alpha).toBe(1);
        // the alpha of the slot is the alpha of the container, and at 0 the container is hidden
        write(() => {
            state.colors[slot('back') * 4 + 3] = 0.5;
            state.colors[slot('front') * 4] = 0.5;
        });
        expect(plain.alpha).toBe(0.5);
        expect(tinted.tint).toBe(0x7fffff);
        expect(plain.tint).toBe(0xffffff);
        write(() => {
            state.colors[slot('back') * 4 + 3] = 0;
        });
        expect(plain.visible).toBe(false);
        // a slot without an attachment keeps its container, unless the container was attached to follow it
        write(() => {
            state.attachments[slot('back')] = null;
            state.attachments[slot('middle')] = null;
            state.colors[slot('back') * 4 + 3] = 1;
        });
        expect([plain.visible, picky.visible]).toEqual([true, false]);
    });

    it('refuse a name the skeleton does not have, a slot that is taken and a container that is held', () => {
        const spine = create();
        const [label, other] = [drawable(), drawable()];

        spine.attach('middle', label);
        expect(thrownBy(() => spine.attach('midle' as never, other))).toMatchObject({
            code: 'unknown-name',
            closest: 'middle',
            validNames: ['back', 'middle', 'front'],
        });
        expect(thrownBy(() => spine.attach('middle', other))).toMatchObject({
            message: expect.stringContaining('A container is attached to the slot "middle" already.'),
            fix: 'Detach that container first, or put both into one container: a slot holds one.',
        });
        expect(thrownBy(() => spine.attach('front', label))).toMatchObject({
            message: expect.stringContaining('The container is attached to the slot "middle" already.'),
            fix: 'Call detach with the container first.',
        });
        expect(thrownBy(() => spine.follow('bone-front', label)).fix).toBe('Call detach with the container first.');
        spine.follow('bone-back', other);
        expect(thrownBy(() => spine.attach('front', other))).toMatchObject({
            message: expect.stringContaining('The container is following the bone "bone-back" already.'),
            fix: 'Call unfollow with the container first.',
        });
        expect(thrownBy(() => spine.follow('bone' as never, drawable())).code).toBe('unknown-name');
        expect(thrownBy(() => spine.bone('root-bone' as never))).toMatchObject({
            code: 'unknown-name',
            closest: 'root',
        });
        expect(
            thrownBy(() => {
                spine.bone('root').x = Number.NaN;
            }).fix,
        ).toBe('Pass a finite number.');
        // after a detach the slot and the container are free again
        spine.detach(label);
        spine.attach('middle', other.parent === null ? drawable() : other);
        spine.attach('front', label);
    });

    it('lets go of every container when it is destroyed, and of a container that is destroyed', () => {
        const stage = createStage();
        const spine = create();
        const [label, gone, marker] = [drawable(), drawable(), new Container()];

        stage.root.addChild(spine);
        spine.addChild(marker);
        spine.follow('bone-back', marker);
        spine.attach('middle', label);
        spine.attach('front', gone);
        spine.update(FRAME);
        stage.render();
        expect(stage.counts.draws).toHaveLength(4);
        // a container that the user destroys leaves on its own: its slot is free, and the batch closes again
        gone.destroy();
        spine.update(FRAME);
        stage.render();
        expect(stage.counts.draws).toHaveLength(3);
        spine.attach('front', drawable());
        spine.update(FRAME);
        // the display object goes: its containers are let go of, alive and visible
        label.visible = false;
        spine.destroy();
        expect(label.destroyed).toBe(false);
        expect(label.parent).toBeNull();
        expect(label.visible).toBe(true);
        expect(label.listenerCount('destroyed')).toBe(0);
        expect(marker.listenerCount('destroyed')).toBe(0);
        // every order: what is destroyed later finds nothing to do
        label.destroy();
        marker.destroy();
        spine.detach(label);
        spine.unfollow(marker);
    });

    describe.each(['batched', 'mesh'] as const)('in the report of a display object in the %s mode', (renderMode) => {
        it('are named with their slot or bone, and with what they cost', async () => {
            const stage = createStage();
            const spine = create({ renderMode });
            const links = async (): Promise<{ value: string; reason: string } | undefined> =>
                (await spine.perf.report()).find((row) => row.feature === 'links');
            const label = drawable();
            const marker = new Container({ label: 'spark' });

            stage.root.addChild(spine);
            spine.update(FRAME);
            stage.render();
            expect(await links()).toMatchObject({ value: 'none' });
            // a container that follows a bone is free
            spine.addChild(marker);
            spine.follow('bone-front', marker);
            spine.update(FRAME);
            stage.render();
            expect(await links()).toMatchObject({
                value: '0 attached, 1 following',
                reason: '"spark" behind bone "bone-front": a container that follows a bone costs no draw call',
            });
            // an attached one ends a draw call of the skeleton: two draw calls now
            spine.attach('middle', label);
            spine.update(FRAME);
            stage.render();
            const row = await links();

            expect(row?.value).toBe('1 attached, 1 following');
            expect(row?.reason).toContain('"Mesh" on slot "middle"');
            expect(row?.reason).toContain(
                `ends ${renderMode === 'batched' ? 'a batch' : 'a draw range'} of the skeleton at its slot: the skeleton is 2 draw calls now`,
            );
            expect(row?.reason).toContain('"spark" behind bone "bone-front"');
            spine.detach(label);
            spine.unfollow(marker);
            spine.update(FRAME);
            expect(await links()).toMatchObject({ value: 'none' });
        });
    });

    it('rest with their skeleton, and move when a bone is written', () => {
        const stage = createStage();
        const spine = create();
        const [label, marker] = [drawable(), new Container()];

        stage.root.addChild(spine);
        spine.addChild(marker);
        spine.attach('middle', label);
        spine.follow('bone-front', marker);
        for (let frame = 0; frame < 12; frame++) {
            spine.update(FRAME);
            stage.render();
        }
        const { skips } = spine.stats;
        const { builds } = stage.counts;

        spine.update(FRAME);
        expect(spine.stats.skips).toBe(skips + 1);
        // a write wakes the skeleton for one update: the bone moves, and the containers with it
        spine.bone('bone-middle').y = 40;
        spine.bone('bone-front').x = 260;
        spine.update(FRAME);
        expect(spine.stats.skips).toBe(skips + 1);
        expect(label.position.y).toBeCloseTo(-40);
        expect(marker.position.x).toBeCloseTo(260);
        spine.update(FRAME);
        stage.render();
        expect(spine.stats.skips).toBe(skips + 2);
        expect(stage.counts.builds).toBe(builds);
    });
});
