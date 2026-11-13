import { describe, expect, it } from 'vitest';
import { createPoseEngine, type SkeletonModel } from '../../src/core';
import { MarrowSpine } from '../../src/index';
import { rigOf } from '../../src/pose/legacy/rig';
import { combineSkins, KEPT_SKINS } from '../../src/pose/shared/combine-skins';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { fixtureAsset, importRig } from '../api/helpers';

/*
 * How long a combined skin lives. It stays while an engine shows it, waits with the last few that
 * none shows, and is freed after that, together with what the engines keep for it. That a freed
 * and rebuilt skin poses like the official runtime is the parity family "slots and skins".
 */

/** The combined skins of a model that are not freed. */
function liveCombined(model: SkeletonModel): number[] {
    const lookup = createAttachmentLookup(model);
    const live: number[] = [];

    for (let index = model.skins.length; index < lookup.skinCount; index++) {
        if (lookup.skin(index) !== undefined) live.push(index);
    }

    return live;
}

/** Lists of two skins of the model, skipping the default skin. */
function pairs(model: SkeletonModel, count: number): number[][] {
    const lists: number[][] = [];

    for (let i = 1; i < model.skins.length && lists.length < count; i++) {
        for (let j = i + 1; j < model.skins.length && lists.length < count; j++) lists.push([i, j]);
    }

    return lists;
}

describe.each(['4.2', '4.3'])('combined skins of Spine %s', (version) => {
    it('keeps the skin an engine shows and the last ones none shows, and frees the rest', async () => {
        // the first test of the file on this model: no combined skin of it exists yet
        const { model } = await importRig(`${version}/mix-and-match-pro.json`);
        const engine = await createPoseEngine(model);
        const lists = pairs(model, KEPT_SKINS + 5);
        const first = combineSkins(createAttachmentLookup(model), model, lists[0] ?? []);

        for (const list of lists) {
            engine.setSkins(list);
            engine.update(1 / 60);
        }
        const live = liveCombined(model);

        // the one shown and the last that wait
        expect(live).toHaveLength(KEPT_SKINS + 1);
        expect(live).toContain(engine.state.skin);
        expect(createAttachmentLookup(model).skin(first)).toBeUndefined();
        // a freed skin cannot be shown, and its list makes a new one
        expect(() => engine.setSkin(first)).toThrow(/no skin/);
        engine.setSkins(lists[0] ?? []);
        expect(engine.state.skin).not.toBe(first);
        expect(engine.skins).toEqual(lists[0]);
    });

    it('keeps a skin while one of several engines shows it', async () => {
        const { model } = await importRig(`${version}/mix-and-match-pro.skel`);
        const [one, two] = [await createPoseEngine(model), await createPoseEngine(model)];
        const lists = pairs(model, KEPT_SKINS + 3);
        const shared = lists[0] ?? [];

        one.setSkins(shared);
        two.setSkins(shared);
        const index = one.state.skin;

        // one engine moves on through more lists than are kept
        for (const list of lists.slice(1)) one.setSkins(list);
        expect(createAttachmentLookup(model).skin(index)).toBeDefined();
        expect(two.state.skin).toBe(index);
        // the other moves on too: the skin waits, then goes
        two.setSkin(-1);
        for (const list of lists.slice(1)) {
            one.setSkins(list);
            one.setSkins(shared.toReversed());
        }
        expect(createAttachmentLookup(model).skin(index)).toBeUndefined();
    });
});

describe('the caches of a freed combined skin', () => {
    it('go from the rig of the 4.1 and 4.2 engine', async () => {
        const { model } = await importRig('4.2/mix-and-match-pro.json');
        const engine = await createPoseEngine(model);
        const rig = rigOf(model);
        const lists = pairs(model, KEPT_SKINS + 4);

        engine.setAnimation(0, 0, true);
        for (const list of lists) {
            engine.setSkins(list);
            engine.update(1 / 60);
        }
        const kept = new Set(liveCombined(model));
        const cached = [...rig.caches.keys()].filter((skin) => skin >= model.skins.length);

        expect(cached.length).toBeGreaterThan(0);
        expect(cached.every((skin) => kept.has(skin))).toBe(true);
        for (const clip of rig.clips) {
            for (const timeline of clip?.timelines ?? []) {
                timeline.shown.forEach((row, at) => {
                    if (at - 1 >= model.skins.length && row !== undefined) expect(kept.has(at - 1)).toBe(true);
                });
            }
        }
    });
});

describe('a display object with several skins', () => {
    it('lets its combined skin go when it is destroyed', async () => {
        const asset = await fixtureAsset('4.3/mix-and-match-pro.skel');
        const { model } = asset;
        const lookup = createAttachmentLookup(model);
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        spine.skins = ['skin-base', 'hair/brown', 'nose/long'];
        const index = spine.engine.state.skin;

        spine.destroy();
        // it waits with the others that no engine shows, and goes once enough newer ones wait
        expect(lookup.skin(index)).toBeDefined();
        // lists of three, which no other test of the file makes, so each is a new skin
        for (const [a = 1, b = 2] of pairs(model, KEPT_SKINS + 1)) combineSkins(lookup, model, [a, b, 1]);
        expect(lookup.skin(index)).toBeUndefined();
    });
});
