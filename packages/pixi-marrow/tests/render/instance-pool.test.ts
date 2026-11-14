import { Geometry, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { i32 } from '../../src/geometry/read';
import { InstancePool, NO_ENTRY } from '../../src/render/instance-pool';
import { loadFamily, populate } from './batch-check';
import { createStage } from './batch-stage';
import { instanceOf, loadInstanced } from './instance-check';
import { play, type Rig, step } from './rig';
import { watchUpdates } from './skin-check';

/*
 * The pools of instanced draws: the slots of the views of a layout in shared data textures, and
 * the index buffers of the draw orders. See `instance-pool.ts` and `instance-layout.ts`.
 */

/** A pool of a skeleton of 5 bones and 3 slots, with 4 texels for the vertices the CPU places. */
const shape = { bones: 5, slots: 3, cpuTexels: 4, cpuAt: new Int32Array([0, -1]) };

/** The instance layout of a rig that draws instanced. */
function layoutOf(rig: Rig) {
    const layout = instanceOf(rig).layout;

    if (layout === undefined) throw new Error('the view draws alone');

    return layout;
}

describe('a pool of instanced views', () => {
    it('gives out slots, takes them back and grows, keeping what the slots hold', () => {
        const pool = new InstancePool(shape);
        const slots = [0, 1, 2, 3].map(() => pool.alloc());

        expect(slots.map((slot) => slot?.index)).toEqual([0, 1, 2, 3]);
        expect(pool.room).toBe(4);
        // 5 bones of 6 numbers are 8 texels, then the 4 texels the CPU fills
        expect(pool.poseStride).toBe(12);
        expect(pool.paletteStride).toBe(9);
        slots[3]?.bones.fill(7);
        slots[3]?.colors.fill(9);
        const fifth = pool.alloc();

        expect(fifth?.index).toBe(4);
        expect(pool.room).toBe(8);
        // the slots look into the new arrays, which hold what the old ones held
        expect(slots[3]?.bones.buffer).toBe(pool.poseData.buffer);
        expect(Array.from(slots[3]?.bones.subarray(0, 30) ?? [])).toEqual(Array(30).fill(7));
        expect(Array.from(slots[3]?.colors ?? [])).toEqual(Array(36).fill(9));
        expect(pool.retired).toHaveLength(2);
        // a slot given back is the next one out
        if (slots[1] !== undefined) pool.release(slots[1]);
        expect(pool.used).toBe(4);
        expect(pool.alloc()?.index).toBe(1);
    });

    it('uploads one stretch per texture, from the first texel written to the last', () => {
        const pool = new InstancePool(shape);
        const [a, b] = [pool.alloc(), pool.alloc()];
        const calls: string[] = [];

        pool.pose.update = (start = 0, end = 0) => calls.push(`pose ${start} ${end}`);
        pool.palette.update = (start = 0, end = 0) => calls.push(`palette ${start} ${end}`);
        expect(pool.flush()).toBe(0);
        a?.bonesWritten(1, 2);
        b?.bonesWritten(0, 0);
        b?.colorsWritten(2, 2);
        expect(pool.flush()).toBe(2);
        // bone 1 starts in texel 1, bone 2 ends in texel 4. The second slot starts at texel 12
        expect(calls).toEqual(['pose 1 14', 'palette 15 17']);
        expect(pool.flush()).toBe(0);
    });

    it('has a limit, past which the layout starts another pool', async () => {
        const pool = new InstancePool({ bones: 1, slots: 2048 * 2048, cpuTexels: 0, cpuAt: new Int32Array(0) });

        expect(pool.limit).toBe(0);
        expect(pool.alloc()).toBeUndefined();
        const family = await loadFamily('4.3/raptor-pro.skel');
        const stage = createStage();
        const rigs = await populate(stage, family, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });
        const layout = layoutOf(rigs[0] as Rig);

        expect(layout.pools).toHaveLength(1);
        expect(layout.pools[0]?.used).toBe(2);
    });

    it('points every shader of a pool that grew at its new textures, and destroys the old ones after the render', async () => {
        const rig = await loadInstanced('4.3/raptor-pro.skel');

        step(rig, 0);
        const layout = layoutOf(rig);
        const pool = layout.pools[0];

        if (pool === undefined) throw new Error('a pool');
        const pages = (count: number) =>
            Array.from(
                { length: count },
                () => new Texture({ source: new TextureSource({ width: 1, height: 1 }) }).source,
            );
        const one = layout.shader(pool, layout.intern(pages(1)), false, false);
        const two = layout.shader(pool, layout.intern(pages(1)), true, false);
        const old = pool.pose;

        // the pool grows: four more slots than it had room for
        const more = Array.from({ length: pool.room + 1 }, () => pool.alloc());

        expect(pool.pose).not.toBe(old);
        layout.shader(pool, layout.intern(pages(1)), false, false);
        // the shader the draw did not ask for lets go of the old texture too
        expect(two.resources.uPose).toBe(pool.pose);
        expect(one.resources.uPose).toBe(pool.pose);
        expect(pool.retired).toHaveLength(0);
        // a pool can grow inside a render: draws before it bound the old texture, and WebGPU submits them at the end
        expect(old.destroyed).toBe(false);
        await Promise.resolve();
        expect(old.destroyed).toBe(true);
        for (const slot of more) if (slot !== undefined) pool.release(slot);
    });
});

/** The indices of every entry of every slot of a rig, in its draw order. */
function unionOf(rig: Rig): number[] {
    const { template } = rig.view.parts;
    const indices: number[] = [];

    for (const slot of rig.engine.state.drawOrder) {
        for (let entry = i32(template.slotEntries, slot); entry < i32(template.slotEntries, slot + 1); entry++) {
            if (i32(template.counts, entry) === 0) continue;
            for (const vertex of template.triangles[entry] ?? []) indices.push(i32(template.first, entry) + vertex);
        }
    }

    return indices;
}

describe('the index buffers of draw orders', () => {
    it('hold every entry of every slot in the draw order, one per order, shared by the views', async () => {
        const family = await loadFamily('4.3/raptor-pro.skel');
        const stage = createStage();
        const [a, b] = await populate(stage, family, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        if (a === undefined || b === undefined) throw new Error('two rigs');
        for (const rig of [a, b]) {
            play(rig, 'walk');
            step(rig, 0);
        }
        const union = instanceOf(a).union;
        const indices = unionOf(a);

        if (union === undefined) throw new Error('the view draws instanced');
        expect(union.count).toBe(indices.length);
        expect(Array.from(union.buffer.data.subarray(0, indices.length))).toEqual(indices);
        expect(instanceOf(b).union).toBe(union);
        expect(union.uses).toBe(2);
        // another order is another buffer, and the old one stays for a while
        b.engine.state.drawOrder.reverse();
        b.engine.state.drawOrderStamp = ++b.engine.state.version;
        b.view.update(b.engine.state);
        expect(instanceOf(b).union).not.toBe(union);
        expect(union.uses).toBe(1);
        expect(union.buffer.destroyed).toBe(false);
    });
});

describe('the geometries of a run', () => {
    it('let go of the index buffer of a draw order that other draws still use, as pixi.js 8.16 destroys it with a geometry', async () => {
        const destroy = Geometry.prototype.destroy;
        // pixi.js before 8.21 destroys the index buffer of a geometry with the geometry
        const spy = vi.spyOn(Geometry.prototype, 'destroy').mockImplementation(function (this: Geometry, buffers) {
            this.indexBuffer?.destroy();
            destroy.call(this, buffers);
        });
        const stage = createStage();
        const family = await loadFamily('4.3/raptor-pro.skel');
        const [moving, still] = await populate(stage, family, 2, {
            renderMode: 'mesh',
            skinning: 'gpu',
            instancing: 'auto',
        });

        if (moving === undefined || still === undefined) throw new Error('two rigs');
        try {
            stage.render();
            const { state } = moving.engine;

            // the first part of the run draws with another draw order in every frame, and lets the oldest go
            for (let frame = 0; frame < 6; frame++) {
                const at = frame % (state.drawOrder.length - 1);
                const slot = state.drawOrder[at] ?? 0;

                state.drawOrder[at] = state.drawOrder[at + 1] ?? 0;
                state.drawOrder[at + 1] = slot;
                state.drawOrderStamp = ++state.version;
                moving.view.update(state);
                stage.render();
                expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([1, 1]);
            }
            expect(instanceOf(still).union?.buffer.destroyed).toBe(false);
            expect(instanceOf(moving).union?.buffer.destroyed).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('the life of an instanced view', () => {
    it('draws nothing while the context is lost', async () => {
        const context = { lost: false };
        const stage = createStage({ context });
        const family = await loadFamily('4.3/raptor-pro.skel');

        await populate(stage, family, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([2]);
        context.lost = true;
        stage.render();
        expect(stage.counts.draws).toEqual([]);
        context.lost = false;
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([2]);
    });

    it('uploads no instance data while its run rests, and the data of a frame in which one moved', async () => {
        const stage = createStage();
        const family = await loadFamily('4.3/raptor-pro.skel');
        const [first] = await populate(stage, family, 3, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        if (first === undefined) throw new Error('three rigs');
        stage.render();
        const buffer = instanceOf(first).body.run?.part(0).buffer;

        if (buffer === undefined) throw new Error('the view draws in a run');
        const uploads = watchUpdates(buffer);

        stage.render();
        stage.render();
        expect(uploads).toHaveLength(0);
        first.view.container.x = 12;
        stage.render();
        stage.render();
        expect(uploads).toHaveLength(1);
    });

    it('gives its slot back when destroyed, and leaves its run', async () => {
        const stage = createStage();
        const family = await loadFamily('4.3/raptor-pro.skel');
        const rigs = await populate(stage, family, 3, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        stage.render();
        const [first, second] = rigs;

        if (first === undefined || second === undefined) throw new Error('three rigs');
        const layout = layoutOf(first);
        const pool = layout.pools[0];
        const run = instanceOf(first).body.run;

        expect(pool?.used).toBe(3);
        second.view.destroy();
        expect(pool?.used).toBe(2);
        expect(run?.members).toHaveLength(2);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([2]);
        // the last view of the layout takes the pools with it
        for (const rig of rigs) rig.view.destroy();
        expect(pool?.pose.destroyed).toBe(true);
        expect(layout.pools).toHaveLength(0);
    });

    it('lets its shaders go before it destroys the textures they bind, so that Pixi does not warn', async () => {
        const stage = createStage();
        const family = await loadFamily('4.3/raptor-pro.skel');
        const rigs = await populate(stage, family, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });
        const warnings: unknown[] = [];
        const warn = vi
            .spyOn(console, 'warn')
            .mockImplementation((...args: unknown[]) => warnings.push(args.join(' ')));

        stage.render();
        try {
            for (const rig of rigs) rig.view.destroy();
        } finally {
            warn.mockRestore();
        }
        expect(warnings.filter((text) => String(text).includes('destroyed while still bound'))).toEqual([]);
    });

    it('writes none for every slot before the entries a view shows', async () => {
        const rig = await loadInstanced('4.3/raptor-pro.skel');

        step(rig, 0);
        const slot = instanceOf(rig).slot;
        const { seen, template } = rig.view.parts;

        slot?.show(template, seen.list, 0, new Uint8Array(0));
        for (let owner = 0; owner < rig.model.slots.count; owner++) {
            const at = owner * 12;

            expect((slot?.colors[at + 8] ?? 0) | ((slot?.colors[at + 9] ?? 0) << 8)).toBe(NO_ENTRY);
        }
    });
});
