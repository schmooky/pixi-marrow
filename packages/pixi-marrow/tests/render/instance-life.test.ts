import { describe, expect, it } from 'vitest';
import { layoutArrayBytes } from '../../src/render/inspect';
import { INSTANCE_PIPE } from '../../src/render/instance-pipe';
import { loadFamily, populate } from './batch-check';
import { createStage } from './batch-stage';
import { instanceOf } from './instance-check';
import type { Rig } from './rig';

/*
 * What instanced draws hold on to: the runs of the pipe, the instance layouts and what they
 * count as shared memory. Found in review: old runs kept destroyed views, a pipe kept the runs
 * of every destroyed render group on pixi.js before 8.21, the static data of a layout was
 * counted twice, and layouts that never draw instanced were made anyway.
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

describe('what instanced draws hold on to', () => {
    it('lets go of the views of runs that a new build does not take', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');
        const gpu = { renderMode: 'mesh', skinning: 'gpu' } as const;
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

        b.view.destroy();
        c.view.destroy();
        expect(
            booksOf(stage).some((book) => book.runs.some((run) => gone.some((body) => run.members.includes(body)))),
        ).toBe(false);
    });

    it('frees the runs of an instruction set that is gone, also where Pixi does not say so', async () => {
        const stage = createStage();
        const raptor = await loadFamily('4.3/raptor-pro.skel');

        await populate(stage, raptor, 2, { renderMode: 'mesh', skinning: 'gpu' });
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
        const [rig] = await populate(stage, raptor, 1, { renderMode: 'mesh', skinning: 'gpu' });

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
        expect(layout.bytes).toBe(layout.skin.data.byteLength + layout.entries.data.byteLength + unionBytes + room);
    });

    it('makes no instanced draw for a layout that always draws alone', async () => {
        const stage = createStage();
        const tank = await loadFamily('4.2/tank-pro.skel');
        const [rig] = await populate(stage, tank, 2, { renderMode: 'mesh', skinning: 'gpu' });

        stage.render();
        if (rig === undefined) throw new Error('a rig');
        const skin: unknown = Reflect.get(rig.view.parts.paints.mesh ?? {}, 'skin');
        const layout: unknown = typeof skin === 'object' && skin !== null ? Reflect.get(skin, 'skinLayout') : undefined;

        // tank-pro multiplies or screens a slot, so its instances never share a draw
        expect(typeof layout === 'object' && layout !== null && Reflect.get(layout, 'instances')).toBeUndefined();
    });
});
