import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type MarrowAsset, MarrowError, MarrowSpine, type PerfEntry } from '../../src/index';
import { loadMeshCode } from '../../src/render/mesh-code';
import { createStage } from '../render/batch-stage';
import { fixtureAsset } from './helpers';

/*
 * The option `instancing` and the row of the perf report that says whether an instance draws
 * instanced, in a run of how many and in how many draws, or why not. A stage without a GPU runs
 * Pixi's render group system, so the runs are those Pixi builds, see `batch-stage.ts`.
 */

describe('the option instancing and its row of the report', () => {
    const made: MarrowSpine[] = [];

    function create(asset: MarrowAsset, options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        // instancing is in no preset: the tests name it, and the ones about its absence turn it off
        const spine = new MarrowSpine(asset, {
            renderMode: 'mesh',
            skinning: 'gpu',
            instancing: 'auto',
            ...options,
            autoUpdate: false,
        });

        made.push(spine);

        return spine;
    }

    async function row(spine: MarrowSpine): Promise<PerfEntry> {
        const found = (await spine.perf.report()).find((entry) => entry.feature === 'instancing');

        if (found === undefined) throw new Error('the report has no row instancing');

        return found;
    }

    beforeAll(async () => {
        await loadMeshCode();
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('is off in every preset, takes auto by name, and names the closest value of a wrong one', async () => {
        const asset = await fixtureAsset('4.3/raptor-pro.skel');

        for (const perf of ['exact', 'balanced', 'fast'] as const) {
            const spine = new MarrowSpine(asset, { renderMode: 'mesh', skinning: 'gpu', perf, autoUpdate: false });

            made.push(spine);
            expect(spine.perfSettings.instancing).toBe('off');
        }
        expect(create(asset, { perf: 'fast', instancing: 'auto' }).perfSettings.instancing).toBe('auto');
        expect(create(asset, { perf: { preset: 'fast', instancing: 'auto' } }).perfSettings.instancing).toBe('auto');
        try {
            create(asset, { instancing: 'of' as 'off' });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(MarrowError);
            expect(error instanceof MarrowError && error.closest).toBe('off');
        }
    });

    it('says why an instance draws alone', async () => {
        const asset = await fixtureAsset('4.3/raptor-pro.skel');
        const tank = await fixtureAsset('4.2/tank-pro.skel');
        const rows = await Promise.all([
            row(create(asset, { instancing: 'off' })),
            row(create(asset, { skinning: 'cpu' })),
            row(create(asset, { renderMode: 'batched' })),
            row(create(tank)),
        ]);

        expect(rows.map((entry) => entry.value)).toEqual(['off', 'off', 'off', 'off']);
        expect(rows.map((entry) => entry.reason)).toEqual([
            'the option instancing is "off"',
            expect.stringContaining('the option skinning is "cpu"'),
            expect.stringContaining('draws in a batch'),
            expect.stringContaining('multiplies or screens'),
        ]);
    });

    it('leaves a layout alone whose attachments have more than twice the vertices a pose shows, unless on', async () => {
        const stage = createStage();
        const speedy = await fixtureAsset('4.2/speedy-ess.skel');
        const raptor = await fixtureAsset('4.3/raptor-pro.skel');
        // speedy-ess has 108 vertices in all, and its setup pose shows 44
        const auto = [0, 1].map(() => create(speedy));
        const on = [0, 1].map(() => create(speedy, { instancing: 'on' }));

        for (const spine of [...auto, ...on]) stage.root.addChild(spine);
        stage.render();
        const [declined, forced] = await Promise.all([
            row(auto[0] ?? on[0] ?? create(raptor)),
            row(on[0] ?? create(raptor)),
        ]);

        expect(declined).toEqual({
            feature: 'instancing',
            value: 'off',
            reason: 'an instanced draw runs all 108 vertices of the attachments of every slot per instance, more than twice the 44 a pose shows (the setup attachments, and the largest attachment of a slot that is empty in the setup pose), so "auto" draws it alone. "on" draws it instanced anyway',
        });
        expect(forced.value).toBe('on, run of 2, 1 draw call');
        // raptor-pro shows 642 of its 679 vertices in the setup pose
        expect((await row(create(raptor))).reason).not.toContain('a pose shows');
        expect(create(raptor, { instancing: 'on' }).perfSettings.instancing).toBe('on');
    });

    it('names the run and its draws, and an instance that is alone in its run', async () => {
        const stage = createStage();
        const asset = await fixtureAsset('4.3/raptor-pro.skel');
        const spines = [0, 1, 2].map(() => create(asset));
        const before = await row(spines[0] ?? create(asset));

        expect(before.value).toBe('on');
        expect(before.reason).toContain('Pixi has not built the instructions');
        for (const spine of spines) stage.root.addChild(spine);
        stage.render();
        const rows = await Promise.all(spines.map(row));

        expect(rows.map((entry) => entry.value)).toEqual(Array(3).fill('on, run of 3, 1 draw call'));
        expect(rows[0]?.reason).toContain('Its own draw holds 3 instances');
        expect(rows[0]?.reason).toMatch(/runs all \d+ vertices of the layout per instance, \d+ of them visible/);
        // another rig between them ends the run
        const other = create(await fixtureAsset('4.3/raptor-pro.json'), { instancing: 'off' });

        stage.root.addChildAt(other, 1);
        stage.render();
        expect((await row(spines[0] ?? other)).value).toBe('on, alone');
        expect((await row(spines[0] ?? other)).reason).toContain('Pixi draws something else before and after it');
        expect((await spines[0]?.perf.report())?.find((entry) => entry.feature === 'drawCalls')).toEqual({
            feature: 'drawCalls',
            value: '1 shared',
            reason: '1 instanced draw, shared with 0 other instances. See the row instancing',
        });
    });

    it('counts the slot of an instance in its bytes, and the room of the pool as shared', async () => {
        const asset = await fixtureAsset('4.3/raptor-pro.skel');
        const instanced = create(asset);
        const alone = create(asset, { instancing: 'off' });
        const [mine, theirs] = await Promise.all([instanced.perf.memory(), alone.perf.memory()]);

        // a slot holds the bones and three texels a slot, a view alone two textures of its own
        expect(mine.instance).toBeGreaterThan(0);
        expect(mine.instance).not.toBe(theirs.instance);
        expect(mine.shared).toBeGreaterThan(theirs.shared);
    });

    it('counts no uploads of its own while it draws instanced, and the uploads of the pool where they happen', async () => {
        const stage = createStage();
        const asset = await fixtureAsset('4.3/raptor-pro.skel');
        const spines = [0, 1, 2].map(() => create(asset));

        for (const spine of spines) {
            spine.play('walk', { loop: true });
            stage.root.addChild(spine);
        }
        stage.render();
        for (let frame = 0; frame < 5; frame++) {
            for (const spine of spines) spine.update(1 / 60);
            stage.render();
        }
        const [first] = spines;

        if (first === undefined) throw new Error('three spines');
        const { stats } = first;

        expect([stats.positionUploads, stats.colorUploads, stats.boneUploads, stats.uvUploads]).toEqual([0, 0, 0, 0]);
        const uploads = (await first.perf.report()).find((entry) => entry.feature === 'uploads');

        expect(uploads?.value).toBe('shared');
        // one pool for the three: at most a pose and a palette upload in each of the 6 frames, not 3 of each
        const count = Number(/(\d+) uploads? so far/.exec(uploads?.reason ?? '')?.[1]);

        expect(count).toBeGreaterThanOrEqual(6);
        expect(count).toBeLessThanOrEqual(12);
        expect(uploads?.reason).toContain('shared by 3 instances');
        // the same skeleton drawn alone counts its own
        const alone = create(asset, { instancing: 'off' });

        alone.play('walk', { loop: true });
        alone.update(1 / 60);
        expect(alone.stats.boneUploads).toBeGreaterThan(0);
    });
});
