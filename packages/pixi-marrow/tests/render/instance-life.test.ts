import { describe, expect, it } from 'vitest';
import { layoutArrayBytes } from '../../src/render/inspect';
import { INSTANCE_PIPE } from '../../src/render/instance-pipe';
import { loadFamily, populate } from './batch-check';
import { createStage } from './batch-stage';
import { instanceOf } from './instance-check';
import { type Rig, step } from './rig';

/*
 * What instanced draws hold on to: the runs of the pipe, the instance layouts and what they
 * count as shared memory. Found in review: old runs kept destroyed views, a pipe kept the runs
 * of every destroyed render group on pixi.js before 8.21, the static data of a layout was
 * counted twice, and layouts that never draw instanced were made anyway. Found in an audit: parts,
 * layouts and pools held destroyed layouts, pools and their arrays, and pools never shrank.
 */

/** The books of the pipe of the instanced draws of a stage: its runs per instruction set. */
function booksOf(stage: ReturnType<typeof createStage>): { runs: { members: unknown[] }[] }[] {
    const pipe: unknown = Reflect.get(stage.renderer.renderPipes, INSTANCE_PIPE);
    const books: unknown = typeof pipe === 'object' && pipe !== null ? Reflect.get(pipe, 'all') : undefined;

    if (!Array.isArray(books)) throw new Error('the stage has no pipe of instanced draws');

    return books;
}

/** The body of the instanced draw of a rig. */
const bodyOf = (rig: Rig): unknown => instanceOf(rig).body;

/** The parts of the run of a rig, which hold what each draw of the run drew with. */
function partsOf(rig: Rig): object[] {
    const parts: unknown = Reflect.get(instanceOf(rig).body.run ?? {}, 'parts');

    if (!Array.isArray(parts)) throw new Error('the view draws in no run');

    return parts;
}

/** What a part drew with last: its layout, its pool and its shader. */
const heldBy = (part: object | undefined): unknown[] =>
    ['layout', 'pool', 'shader'].map((field) => (part === undefined ? undefined : Reflect.get(part, field)));

describe('what instanced draws hold on to', () => {
    it('lets go of the views of runs that a new build does not take', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');
        const gpu = { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' } as const;
        const [a] = await populate(stage, raptor, 1, gpu);
        const [x1] = await populate(stage, raptor, 1, { renderMode: 'mesh' });
        const [b] = await populate(stage, raptor, 1, gpu);
        const [x2] = await populate(stage, raptor, 1, { renderMode: 'mesh' });
        const [c] = await populate(stage, raptor, 1, gpu);

        if (a === undefined || b === undefined || c === undefined || x1 === undefined || x2 === undefined) {
            throw new Error('five rigs');
        }
        stage.render();
        expect(booksOf(stage)[0]?.runs).toHaveLength(3);
        // the views drawn alone go: one run is left
        x1.view.destroy();
        x2.view.destroy();
        stage.render();
        const held = (rig: Rig): boolean =>
            booksOf(stage).some((book) => book.runs.some((run) => run.members.includes(bodyOf(rig))));

        expect(held(a) && held(b) && held(c)).toBe(true);
        const gone = [bodyOf(b), bodyOf(c)];
        // the build took one run. The two others hold no member and no shader
        const spare = booksOf(stage)[0]?.runs.slice(1) ?? [];

        expect(spare.map((run) => run.members.length)).toEqual([0, 0]);
        expect(spare.map((run) => (Reflect.get(run, 'parts') as object[]).length)).toEqual([1, 1]);
        expect(spare.flatMap((run) => Reflect.get(run, 'parts') as object[]).flatMap(heldBy)).not.toContainEqual(
            expect.anything(),
        );
        b.view.destroy();
        c.view.destroy();
        expect(
            booksOf(stage).some((book) => book.runs.some((run) => gone.some((body) => run.members.includes(body)))),
        ).toBe(false);
        // the next build frees the runs the one before did not take
        stage.render();
        expect(booksOf(stage)[0]?.runs).toHaveLength(1);
        expect(spare.map((run) => (Reflect.get(run, 'parts') as object[]).length)).toEqual([0, 0]);
    });

    it('frees the runs of an instruction set that is gone, also where Pixi does not say so', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');

        await populate(stage, raptor, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });
        stage.render();
        const pipe: unknown = Reflect.get(stage.renderer.renderPipes, INSTANCE_PIPE);
        const books = booksOf(stage);
        const [book] = books;

        if (book === undefined || typeof pipe !== 'object' || pipe === null) throw new Error('a book');
        let destroyed = 0;
        const gone = {
            runs: [{ members: [], destroy: () => destroyed++ }],
            used: 0,
            last: undefined,
            // a set that the garbage collector took
            set: { deref: () => undefined },
        };

        books.push(gone);
        Reflect.apply(Reflect.get(pipe, 'sweep') as () => void, pipe, []);
        expect(destroyed).toBe(1);
        expect(booksOf(stage)).toEqual([book]);
    });

    it('counts the static data of a layout once, with the template', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');
        const [rig] = await populate(stage, raptor, 1, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        stage.render();
        if (rig === undefined) throw new Error('a rig');
        const { layout } = instanceOf(rig);
        const { template } = rig.view.parts;

        if (layout === undefined) throw new Error('raptor-pro draws instanced');
        const unions: unknown = Reflect.get(layout, 'unions');
        const unionBytes = Array.isArray(unions)
            ? unions.reduce(
                  (sum: number, union: { buffer: { data: Uint8Array } }) => sum + union.buffer.data.byteLength,
                  0,
              )
            : Number.NaN;
        const room = layout.pools.reduce((sum, pool) => sum + pool.bytes - pool.used * pool.slotBytes, 0);

        // raptor-pro has no sequence: the layout draws with the statics of the template
        expect(layout.statics.data).toBe(template.statics);
        expect(layoutArrayBytes(template)).toBeGreaterThanOrEqual(template.statics.byteLength);
        // the buffer aSkin is the one of the skin data, which counts it once for the views drawn alone too
        const skin: unknown = Reflect.get(rig.view.parts.paints.mesh ?? {}, 'skin');

        expect(layout.skin).toBe(typeof skin === 'object' && skin !== null ? Reflect.get(skin, 'buffer') : null);
        expect(layout.bytes).toBe(layout.entries.data.byteLength + unionBytes + room);
    });

    it('makes no instanced draw for a layout that always draws alone', async () => {
        const stage = createStage();
        const tank = await loadFamily('4.2/tank-pro.skel');
        const [rig] = await populate(stage, tank, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        stage.render();
        if (rig === undefined) throw new Error('a rig');
        const skin: unknown = Reflect.get(rig.view.parts.paints.mesh ?? {}, 'skin');
        const layout: unknown = typeof skin === 'object' && skin !== null ? Reflect.get(skin, 'skinLayout') : undefined;

        // tank-pro multiplies or screens a slot, so its instances never share a draw
        expect(typeof layout === 'object' && layout !== null && Reflect.get(layout, 'instances')).toBeUndefined();
    });

    it('lets a part that drew nothing go of its layout, pool and shader, and frees one that rests long', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');
        const [a, b] = await populate(stage, raptor, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        if (a === undefined || b === undefined) throw new Error('two rigs');
        // another blend mode is another draw of the run
        b.view.container.blendMode = 'add';
        stage.render();
        expect(stage.counts.draws).toHaveLength(2);
        expect(heldBy(partsOf(a)[1]).every((held) => held !== undefined)).toBe(true);
        b.view.container.blendMode = 'normal';
        stage.render();
        expect(stage.counts.draws).toHaveLength(1);
        expect(heldBy(partsOf(a)[1])).toEqual([undefined, undefined, undefined]);
        expect(heldBy(partsOf(a)[0]).every((held) => held !== undefined)).toBe(true);
        // 60 frames without a draw, counted from the one above
        for (let i = 0; i < 59; i++) stage.render(false);
        expect(partsOf(a)).toHaveLength(2);
        stage.render(false);
        expect(partsOf(a)).toHaveLength(1);
        // the part that is left draws on
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([2]);
    });

    it('frees the pools once no view holds a slot, and starts small again', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');
        const rigs = await populate(stage, raptor, 6, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });
        const [first] = rigs;

        if (first === undefined) throw new Error('six rigs');
        stage.render();
        const { layout } = instanceOf(first);
        const pool = layout?.pools[0];

        if (layout === undefined || pool === undefined) throw new Error('raptor-pro draws instanced');
        expect(pool.room).toBe(8);
        // the views draw in a batch now. The layout stays with their skin data, the pools go
        for (const rig of rigs) {
            rig.view.renderMode = 'batched';
            step(rig, 0);
        }
        expect(layout.pools).toEqual([pool]);
        await Promise.resolve();
        expect(layout.pools).toEqual([]);
        expect(pool.pose.destroyed).toBe(true);
        expect(pool.poseData.byteLength + pool.paletteData.byteLength).toBe(0);
        first.view.renderMode = 'mesh';
        step(first, 0);
        expect(layout.pools.map((fresh) => fresh.room)).toEqual([4]);
    });

    it('keeps the pools of a layout whose last slot is taken again in the same task', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');
        const [rig] = await populate(stage, raptor, 1, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        if (rig === undefined) throw new Error('a rig');
        stage.render();
        const { layout } = instanceOf(rig);
        const pool = layout?.pools[0];

        rig.view.renderMode = 'batched';
        step(rig, 0);
        rig.view.renderMode = 'mesh';
        step(rig, 0);
        await Promise.resolve();
        expect(layout?.pools).toEqual([pool]);
        expect(pool?.pose.destroyed).toBe(false);
    });

    it('lets go of the template and of the arrays of the pools with the layout', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');
        const rigs = await populate(stage, raptor, 2, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });
        const [rig] = rigs;

        if (rig === undefined) throw new Error('two rigs');
        stage.render();
        const { layout } = instanceOf(rig);
        const pool = layout?.pools[0];

        if (layout === undefined || pool === undefined) throw new Error('raptor-pro draws instanced');
        for (const each of rigs) each.view.destroy();
        expect(Reflect.get(layout, 'template')).toBeUndefined();
        expect(pool.poseData.byteLength + pool.paletteData.byteLength).toBe(0);
    });
});
