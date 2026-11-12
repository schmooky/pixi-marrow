import type { BatcherPipe } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { RUN_PAD } from '../../src/render/batch-layout';
import { linkRenderer } from '../../src/render/batch-pipe';
import { MarrowBatcher, MarrowDarkBatcher } from '../../src/render/batcher';
import { darkByte } from '../../src/render/colors';
import { inspectView } from '../../src/render/inspect';
import { expectBatch, loadFamily, populate } from './batch-check';
import { batcherOf, bodyOf, createStage, elementOf, readRuns, readVertex } from './batch-stage';
import { createRig, kernelUVs, play, type Rig, step, trianglesOf, visibleSlots } from './rig';

/** The slot blend modes, as indices into `BLEND_MODES` of the model. */
const ADDITIVE = 1;
const MULTIPLY = 2;

/** The first rig of a list. */
function firstOf(rigs: readonly Rig[]): Rig {
    const [rig] = rigs;

    if (rig === undefined) throw new Error('no rig');

    return rig;
}

describe('where a batch of skeletons ends', () => {
    it('keeps the draw order when Pixi draws something else in between', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const before = await populate(stage, family, 3);
        // a skeleton with meshes of its own is something else to the batch
        const [between] = await populate(stage, family, 1, { renderMode: 'mesh' });
        const after = await populate(stage, family, 2);

        stage.render();
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch', 'mesh', 'batch']);
        expect(between?.view.stats.renderMode).toBe('mesh');
        const [first, , last] = stage.counts.draws;

        // two batches of one batcher: each binds its buffers again, and they do not overlap
        expect(first?.batcher).toBe(last?.batcher);
        expect([first?.starts, last?.starts]).toEqual([true, true]);
        expect(first?.size).toBe(elementOf(firstOf(before).view).indexSize * 3);
        expect(last?.start).toBe(first?.size);
        expect(last?.size).toBe(elementOf(firstOf(after).view).indexSize * 2);
        for (const rig of [...before, ...after]) expectBatch(rig);
    });

    it('holds the pages of several skeletons, up to the textures a batch can sample', async () => {
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const dragon = await loadFamily('4.2/dragon-ess.skel');
        const hero = await loadFamily('4.2/hero-pro.skel');
        const pages = (family: { textures: { source: unknown }[] }): unknown[] =>
            family.textures.map((texture) => texture.source);

        expect(dragon.textures.length).toBeGreaterThan(1);
        for (const maxTextures of [16, dragon.textures.length + 1, dragon.textures.length]) {
            const stage = createStage({ maxTextures });
            const rigs = [
                ...(await populate(stage, speedy, 2)),
                ...(await populate(stage, dragon, 2)),
                ...(await populate(stage, hero, 1)),
                ...(await populate(stage, speedy, 1)),
            ];

            stage.render();
            const held = stage.counts.draws.map((draw) => draw.textures);

            if (maxTextures === 16) expect(held).toEqual([[...pages(speedy), ...pages(dragon), ...pages(hero)]]);
            // a skeleton is never split: all of its pages are in the batch that draws it
            else if (maxTextures > dragon.textures.length) {
                expect(held).toEqual([
                    [...pages(speedy), ...pages(dragon)],
                    [...pages(hero), ...pages(speedy)],
                ]);
            } else expect(held).toEqual([pages(speedy), pages(dragon), [...pages(hero), ...pages(speedy)]]);
            expect(stage.counts.draws.map((draw) => draw.starts)).toEqual(held.map((_, index) => index === 0));
            for (const rig of rigs) expectBatch(rig);
        }
    });

    it('batches skeletons with dark colors apart, and takes a skeleton without them into their batch', async () => {
        const stage = createStage();
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const alien = await loadFamily('4.2/alien-pro.skel');
        const rigs = [
            ...(await populate(stage, speedy, 1)),
            ...(await populate(stage, alien, 2)),
            ...(await populate(stage, speedy, 2)),
        ];
        const dark = firstOf(rigs.slice(1));
        const joined = firstOf(rigs.slice(3));

        play(dark, 'death');
        step(dark, 0.4);
        stage.render();
        // the first skeleton has no dark color and no batch with them to join. The last two join
        expect(stage.counts.draws.map((draw) => draw.batcher?.name)).toEqual(['marrow', 'marrow-dark']);
        expect(batcherOf(dark.view)).toBeInstanceOf(MarrowDarkBatcher);
        expect(batcherOf(dark.view).staticWords).toBe(6);
        expect(batcherOf(firstOf(rigs).view).staticWords).toBe(5);
        expect(batcherOf(joined.view)).toBe(batcherOf(dark.view));
        expect(elementOf(joined.view).bytes).toBeGreaterThan(elementOf(firstOf(rigs).view).bytes);
        // black with an alpha of 1 is the dark color that tints nothing
        for (let vertex = 0; vertex < elementOf(joined.view).attributeSize; vertex++) {
            expect(readVertex(joined.view, vertex).dark).toBe(0xff000000);
        }
        // the batch with dark colors ends, and the next skeleton without them is in a batch of its kind again
        stage.root.addChildAt(firstOf(rigs.slice(4)).view.container, 0);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.batcher?.name)).toEqual(['marrow', 'marrow-dark']);
        expect(batcherOf(firstOf(rigs.slice(4)).view).staticWords).toBe(5);
        expect(batcherOf(joined.view).staticWords).toBe(6);
        // the bytes of the mesh mode: the dark color times the alpha byte of the light color, alpha 255
        const { state } = dark.engine;
        let tinted = 0;

        for (const { slot } of visibleSlots(dark)) {
            const { light, dark: held } = readVertex(dark.view, elementOf(dark.view).layout.at[slot] ?? 0);
            const alpha = light >>> 24;
            const has = dark.model.slots.hasDark[slot] === 1;
            const byte = (channel: number): number =>
                has ? darkByte(state.darkColors[slot * 3 + channel] ?? 0, alpha) : 0;

            expect(held >>> 0, `dark color of slot ${dark.model.slots.names[slot]}`).toBe(
                (byte(0) | (byte(1) << 8) | (byte(2) << 16) | (255 << 24)) >>> 0,
            );
            if (has && (held & 0xffffff) !== 0) tinted++;
        }
        expect(tinted).toBeGreaterThan(0);
        for (const rig of rigs) expectBatch(rig);
    });

    it('draws additive slots in the batch of the normal ones, marked in their vertices', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/spineboy-pro.skel');
        const rigs = await populate(stage, family, 2);
        const rig = firstOf(rigs);
        const { blendModes } = rig.model.slots;
        // the muzzle flash adds, and the setup pose hides it
        const flash = rig.model.slots.names.indexOf('muzzle-glow');

        expect(blendModes[flash]).toBe(ADDITIVE);
        rig.engine.state.attachments[flash] =
            rig.model.skins[rig.lookup.defaultSkin]?.attachments.find((item) => item.slot === flash)?.attachment ??
            null;
        rig.engine.state.colors[flash * 4 + 3] = 1;
        rig.view.update(rig.engine.state);
        stage.render();
        expect(stage.counts.draws).toHaveLength(1);
        expect(stage.counts.draws[0]?.blendMode).toBe('normal');
        const slots = visibleSlots(rig).map((item) => item.slot);

        expect(slots).toContain(flash);
        for (const slot of slots) {
            const { additive } = readVertex(rig.view, elementOf(rig.view).layout.at[slot] ?? 0);

            expect(additive, rig.model.slots.names[slot]).toBe(blendModes[slot] === ADDITIVE ? 255 : 0);
        }
        expectBatch(rig);
    });

    it('takes the blend mode of the display object for its batch', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, family, 3);

        firstOf(rigs.slice(1)).view.container.blendMode = 'add';
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.blendMode)).toEqual(['normal', 'add', 'normal']);
        for (const rig of rigs) expectBatch(rig);
    });

    it('switches to 32-bit indices once a batch has more than 65,535 vertices', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/raptor-pro.skel');
        const few = await populate(stage, family, 2);

        stage.render();
        const batcher = batcherOf(firstOf(few).view);
        const vertices = elementOf(firstOf(few).view).attributeSize;

        expect(batcher.indexBuffer).toBeInstanceOf(Uint16Array);
        const many = await populate(stage, family, Math.ceil(65536 / vertices));

        stage.render();
        expect(batcher.attributeSize / 2).toBeGreaterThan(65535);
        expect(batcher.indexBuffer).toBeInstanceOf(Uint32Array);
        expect(stage.counts.draws).toHaveLength(1);
        expectBatch(firstOf(few));
        expectBatch(many.at(-1) as Rig);
    });
});

describe('a skeleton with slots that multiply or screen', () => {
    it('is one batch per run, and its last run takes the next skeleton in', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/celestial-circus-pro.skel');
        const rigs = await populate(stage, family, 3);
        const rig = firstOf(rigs);
        const keys = visibleSlots(rig).map(({ slot }) =>
            rig.model.slots.blendModes[slot] === MULTIPLY ? 'multiply' : 'normal',
        );
        const runs = keys.filter((key, index) => key !== keys[index - 1]);

        stage.render();
        expect(runs.length).toBeGreaterThan(2);
        expect(runs[0]).toBe('normal');
        expect(runs.at(-1)).toBe('normal');
        // the last run of a skeleton and the first run of the next one share a batch
        const expected = [...runs];

        for (let i = 1; i < rigs.length; i++) expected.push(...runs.slice(1));
        expect(stage.counts.draws.map((draw) => draw.blendMode)).toEqual(expected);
        expect(stage.counts.draws.map((draw) => draw.starts)).toEqual(expected.map((_, index) => index === 0));
        // no draw is empty, and together they cover the room of every skeleton
        const total = rigs.reduce((sum, item) => sum + elementOf(item.view).indexSize, 0);

        expect(stage.counts.draws.every((draw) => draw.size >= RUN_PAD)).toBe(true);
        expect(stage.counts.draws.reduce((sum, draw) => sum + draw.size, 0)).toBe(total);
        stage.counts.draws.forEach((draw, index) => {
            expect(draw.start).toBe(stage.counts.draws.slice(0, index).reduce((sum, item) => sum + item.size, 0));
        });
        for (const item of rigs) {
            expect(item.view.stats).toMatchObject({ renderMode: 'batched', drawCalls: runs.length });
            expect(readRuns(item.view)).toHaveLength(runs.length);
            expectBatch(item);
        }
    });

    it('reorders slots inside its runs without a new build', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/snowglobe-pro.skel');
        const rigs = await populate(stage, family, 3);
        const rig = firstOf(rigs.slice(1));
        const orders = new Set<string>();

        for (const item of rigs) play(item, 'shake');
        stage.render();
        for (let frame = 0; frame < 130; frame++) {
            for (const item of rigs) step(item, 1 / 60);
            stage.render();
            orders.add(rig.engine.state.drawOrder.join(' '));
            if (frame % 13 === 0) for (const item of rigs) expectBatch(item);
        }
        expect(orders.size).toBeGreaterThan(1);
        expect(rig.view.stats.drawCalls).toBe(2);
        expect(stage.counts.builds).toBe(1);
    });

    it('moves the borders of its batches when a run grows or shrinks, without a new build', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/celestial-circus-pro.skel');
        const rigs = await populate(stage, family, 3);
        const rig = firstOf(rigs.slice(1));
        const { blendModes } = rig.model.slots;

        stage.render();
        const draws = stage.counts.draws.map((draw) => ({ start: draw.start, size: draw.size }));
        const runs = rig.view.stats.drawCalls;
        // the first slot of the middle skeleton: it is in a run with others, which a batch before it started
        const [first, second] = visibleSlots(rig);

        expect([blendModes[first?.slot ?? 0], blendModes[second?.slot ?? 0]]).toEqual([0, 0]);
        rig.engine.state.colors[(first?.slot ?? 0) * 4 + 3] = 0;
        rig.view.update(rig.engine.state);
        stage.render();
        expect(stage.counts.builds).toBe(1);
        const moved = stage.counts.draws.map((draw) => ({ start: draw.start, size: draw.size }));
        const gone = first === undefined ? 0 : trianglesOf(rig, first.attachment).length;

        expect(gone).toBeGreaterThan(0);
        // the batch that holds the run is shorter, the next one starts earlier, and the last run of
        // the skeleton fills what is left: every later batch stays where it was
        expect(moved[runs - 1]).toEqual({ start: draws[runs - 1]?.start, size: (draws[runs - 1]?.size ?? 0) - gone });
        expect(moved[runs]?.start).toBe((draws[runs]?.start ?? 0) - gone);
        expect(moved.slice(2 * runs - 1)).toEqual(draws.slice(2 * runs - 1));
        expect(moved.reduce((sum, draw) => sum + draw.size, 0)).toBe(draws.reduce((sum, draw) => sum + draw.size, 0));
        for (const item of rigs) expectBatch(item);
    });

    it('asks Pixi for a new build when its runs change', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/celestial-circus-pro.skel');
        const rigs = await populate(stage, family, 2);
        const rig = firstOf(rigs);
        const { state } = rig.engine;

        stage.render();
        const draws = stage.counts.draws.length;

        // without its multiplying slots the skeleton is one run
        for (const { slot } of visibleSlots(rig)) {
            if (rig.model.slots.blendModes[slot] === MULTIPLY) state.colors[slot * 4 + 3] = 0;
        }
        rig.view.update(state);
        expect(elementOf(rig.view).resized).toBe(true);
        stage.render();
        expect(stage.counts.builds).toBe(2);
        expect(stage.counts.draws.length).toBeLessThan(draws);
        expect(rig.view.stats.drawCalls).toBe(1);
        expect(elementOf(rig.view).resized).toBe(false);
        for (const item of rigs) expectBatch(item);
        // and the next frames build nothing
        for (const item of rigs) step(item, 0.1);
        stage.render();
        expect(stage.counts.builds).toBe(2);
    });
});

describe('a skeleton with many atlas pages', () => {
    it('is one batch with up to 16 pages, and never falls back to meshes for them', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/chibi-stickers.skel');
        const rigs = await populate(stage, family, 2);
        const rig = firstOf(rigs);
        const pages = family.textures.map((texture) => texture.source);
        const used = new Set<number>();

        expect(pages.length).toBeGreaterThan(8);
        expect(pages.length).toBeLessThanOrEqual(16);
        for (let skin = 0; skin < family.model.skins.length; skin++) {
            for (const item of rigs) {
                item.engine.setSkin(skin);
                item.engine.setupPoseSlots();
                step(item, 0);
            }
            stage.render();
            const blends = visibleSlots(rig).map(({ slot }) => rig.model.slots.blendModes[slot] === MULTIPLY);
            const runs = blends.filter((blend, index) => blend !== blends[index - 1]).length;

            for (const { slot, attachment } of visibleSlots(rig)) used.add(kernelUVs(rig, slot, attachment).page);
            // the pages split nothing: a run ends where a slot multiplies, and nowhere else
            expect(rig.view.stats).toMatchObject({ renderMode: 'batched', drawCalls: runs });
            expect(stage.counts.draws.every((draw) => draw.kind === 'batch')).toBe(true);
            for (const draw of stage.counts.draws) expect(draw.textures).toEqual(pages);
            for (const item of rigs) expectBatch(item);
        }
        // the skins showed slots on pages past the eighth
        expect(Math.max(...used)).toBeGreaterThan(8);
    });

    it('samples the right page in every run, from the first build on', async () => {
        // 19 pages of one region each, and slots that go back and forth between the two groups of 16
        const pageOf = [0, 17, 1, 18, 16, 15];
        const files = {
            skeleton: JSON.stringify({
                skeleton: { spine: '4.2.0' },
                bones: [{ name: 'root' }],
                slots: pageOf.map((page, index) => ({ name: `s${index}`, bone: 'root', attachment: `r${page}` })),
                skins: [
                    {
                        name: 'default',
                        attachments: Object.fromEntries(
                            pageOf.map((page, index) => [`s${index}`, { [`r${page}`]: { width: 8, height: 8 } }]),
                        ),
                    },
                ],
                animations: {},
            }),
            atlas: Array.from(
                { length: 19 },
                (_, page) => `p${page}.png\nsize: 8, 8\nr${page}\nbounds: 0, 0, 8, 8\n`,
            ).join('\n'),
        };
        const stage = createStage();
        const rigs = [
            await createRig(files, undefined, { options: () => ({ renderMode: 'batched' }) }),
            await createRig(files, undefined, { options: () => ({ renderMode: 'batched' }) }),
        ];

        for (const rig of rigs) {
            step(rig, 0);
            stage.root.addChild(rig.view.container);
        }
        stage.render();
        // pages 0 | 17 | 1 | 18, 16 | 15: five runs, and the texture numbers are the places in a group
        expect(firstOf(rigs).view.stats.drawCalls).toBe(5);
        expect(stage.counts.builds).toBe(1);
        for (const rig of rigs) {
            expectBatch(rig);
            pageOf.forEach((page, slot) => {
                expect(readVertex(rig.view, elementOf(rig.view).layout.at[slot] ?? 0).texture).toBe(page % 16);
            });
        }
        // the two rigs have textures of their own, so the second one starts a batch
        expect(stage.counts.draws).toHaveLength(10);
        expect(stage.counts.draws.map((draw) => draw.textures.length)).toEqual([16, 3, 16, 3, 16, 16, 3, 16, 3, 16]);
    });

    it('draws with meshes for a renderer whose batches cannot sample the pages of a run', async () => {
        const stage = createStage({ maxTextures: 2 });
        const family = await loadFamily('4.2/dragon-ess.skel');
        const [rig] = await populate(stage, family, 1);

        if (rig === undefined) throw new Error('no rig');
        expect(rig.view.stats.renderMode).toBe('batched');
        // the view learns of the renderer when Pixi is about to draw it, and changes before it is collected
        stage.render();
        expect(rig.view.stats.renderMode).toBe('mesh');
        expect(inspectView(rig.view).mode).toMatchObject({ option: 'batched', mode: 'mesh', reason: 'limit' });
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['mesh']);
        expect(stage.counts.builds).toBe(1);
        step(rig, 0.1);
        stage.render();
        expect(rig.view.stats.renderMode).toBe('mesh');
        expect(stage.counts.builds).toBe(1);
        // a skeleton with fewer pages than the limit batches there
        const small = await loadFamily('4.2/speedy-ess.skel');
        const [speedy] = await populate(stage, small, 1);

        stage.render();
        expect(speedy?.view.stats.renderMode).toBe('batched');
    });

    it('throws for pages a batch cannot hold, when a view was not asked first', async () => {
        const stage = createStage({ maxTextures: 2 });
        const family = await loadFamily('4.2/dragon-ess.skel');
        const rig = await family.create();
        const pipe = linkRenderer(stage.renderer);
        const set = stage.root.renderGroup.instructionSet;
        const batch = Reflect.get(stage.renderer.renderPipes, 'batch') as BatcherPipe;
        let error: unknown;

        rig.view.update(rig.engine.state);
        const body = bodyOf(rig.view);

        if (body === undefined) throw new Error('no body');
        batch.buildStart(set);
        pipe.addRenderable(body, set);
        try {
            batch.buildEnd(set);
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(MarrowError);
        expect(error).toMatchObject({
            code: 'invalid-data',
            message: expect.stringContaining(
                `A batch of this renderer samples 2 textures, and a skeleton needs ${family.textures.length} of its atlas pages at once.`,
            ),
            fix: 'Create the display object with renderMode "mesh".',
        });
    });
});

describe('the batchers', () => {
    it('take the texture count of the renderer, also from a Pixi that does not pass it', () => {
        MarrowBatcher.textures = 5;
        const bare = new MarrowBatcher();
        const told = new MarrowDarkBatcher({ maxTextures: 3 });

        expect([bare.maxTextures, bare.name, told.maxTextures, told.name]).toEqual([5, 'marrow', 3, 'marrow-dark']);
        expect(bare.shader.glProgram.fragment).toContain('uniform sampler2D uTextures[5];');
        expect(told.shader.glProgram.fragment).toContain('uniform sampler2D uTextures[3];');
        bare.destroy();
        told.destroy();
        MarrowBatcher.textures = 16;
    });

    it('refuse an element that is no skeleton, with an error that says what to do', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const [rig] = await populate(stage, family, 1);

        stage.render();
        const batcher = batcherOf(firstOf(rig === undefined ? [] : [rig]).view);
        const foreign = { ...elementOf(firstOf(rig === undefined ? [] : [rig]).view) };

        expect(() => batcher.add(foreign as never)).toThrow(MarrowError);
        expect(() => batcher.add(foreign as never)).toThrow('got an element that is no skeleton');
    });

    it('leave an element alone once they are destroyed', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const [rig] = await populate(stage, family, 1);

        if (rig === undefined) throw new Error('no rig');
        stage.render();
        const element = elementOf(rig.view);

        expect(element.placed).toBe(true);
        batcherOf(rig.view).destroy();
        expect(element.placed).toBe(false);
        step(rig, 0.1);
        expect(() => element.sync()).not.toThrow();
    });
});
