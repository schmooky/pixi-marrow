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
});
