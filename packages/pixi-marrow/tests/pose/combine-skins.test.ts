import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type PoseEngine, type SkeletonModel } from '../../src/core';
import { MarrowSpine } from '../../src/index';
import { rigOf } from '../../src/pose/legacy/rig';
import { combineSkins, KEPT_SKINS } from '../../src/pose/shared/combine-skins';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { fixtureAsset, fixtureFiles, importRig } from '../api/helpers';

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
        // the index of the first skin went to a later list
        expect(createAttachmentLookup(model).parts(first)).not.toEqual(lists[0]);
        // a freed index waits for the next new skin and cannot be shown
        const lookup = createAttachmentLookup(model);
        const freed = [...Array(lookup.skinCount).keys()].find(
            (index) => index >= model.skins.length && lookup.skin(index) === undefined,
        );

        expect(freed).toBeDefined();
        expect(() => engine.setSkin(freed ?? -1)).toThrow(/no skin/);
        // the list of a freed skin makes a new one
        engine.setSkins(lists[0] ?? []);
        expect(engine.skins).toEqual(lists[0]);
        expect(engine.state.skin).toBe(freed);
    });

    it('uses freed indices again, so the count of skins stays bounded', async () => {
        const { model } = await importRig(`${version}/mix-and-match-pro.skel`);
        const lookup = createAttachmentLookup(model);
        const engine = await createPoseEngine(model);
        const lists = pairs(model, 60);

        expect(lists).toHaveLength(60);
        for (const list of lists) engine.setSkins(list);
        // the skin shown, the ones that wait, and one freed index that waits for the next skin
        expect(lookup.skinCount).toBeLessThanOrEqual(model.skins.length + KEPT_SKINS + 2);
        expect(liveCombined(model)).toHaveLength(KEPT_SKINS + 1);
        engine.setSkin(-1);
    });

    it('poses a skin at a used index again as a model that never freed a skin does', async () => {
        const { model } = await importRig(`${version}/mix-and-match-pro.skel`);
        const fresh = await importSkeleton(fixtureFiles(`${version}/mix-and-match-pro.skel`).skeleton);
        const lookup = createAttachmentLookup(model);
        const play = (pose: PoseEngine, list: readonly number[], animation: number): void => {
            pose.clearTracks();
            pose.setSkins(list);
            pose.setupPose();
            pose.setAnimation(0, animation, true);
            for (let i = 0; i < 40; i++) pose.update(1 / 60);
        };
        const playAll = (pose: PoseEngine, list: readonly number[]): void => {
            for (let animation = 0; animation < model.animations.length; animation++) play(pose, list, animation);
        };
        const expectSame = (actual: PoseEngine, expected: PoseEngine): void => {
            const shown = (pose: PoseEngine) => pose.state.attachments.map((attachment) => attachment?.name ?? null);

            expect(shown(actual)).toEqual(shown(expected));
            expect([...actual.state.world]).toEqual([...expected.state.world]);
            expect([...actual.state.active]).toEqual([...expected.state.active]);
            expect([...actual.state.deformLengths]).toEqual([...expected.state.deformLengths]);
        };
        const lists = pairs(model, 3 * KEPT_SKINS);
        const old = lists[0] ?? [];
        // a list no test made before, which takes the freed index
        const next = [lists[KEPT_SKINS + 2]?.[0] ?? 1, 1];
        const engine = await createPoseEngine(model);
        const reference = await createPoseEngine(fresh);

        // every animation with the first list, so that the rig keeps rows and caches for its index
        playAll(engine, old);
        playAll(reference, old);
        const index = engine.state.skin;
        const before = lookup.skin(index);

        for (const list of lists.slice(1, KEPT_SKINS + 2)) engine.setSkins(list);
        expect(lookup.skin(index)).toBeUndefined();
        for (let animation = 0; animation < model.animations.length; animation++) {
            play(engine, next, animation);
            play(reference, next, animation);
            expect(engine.state.skin).toBe(index);
            expect(lookup.skin(index)).not.toBe(before);
            expectSame(engine, reference);
        }
        // a new engine on the used index, and one of a model that never freed a skin
        const other = await createPoseEngine(model);
        const plain = await createPoseEngine(
            await importSkeleton(fixtureFiles(`${version}/mix-and-match-pro.skel`).skeleton),
        );

        playAll(other, next);
        playAll(plain, next);
        expect(other.state.skin).toBe(index);
        expectSame(other, plain);
        for (const pose of [engine, reference, other, plain]) pose.setSkin(-1);
    });

    it('keeps a skin while one of several engines shows it', async () => {
        const { model } = await importRig(`${version}/mix-and-match-pro.skel`);
        const [one, two] = [await createPoseEngine(model), await createPoseEngine(model)];
        const lists = pairs(model, KEPT_SKINS + 3);
        const shared = lists[0] ?? [];

        one.setSkins(shared);
        two.setSkins(shared);
        const index = one.state.skin;
        const skin = createAttachmentLookup(model).skin(index);

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
        // freed: the index holds another skin now, or none
        expect(createAttachmentLookup(model).skin(index)).not.toBe(skin);
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
        const skin = lookup.skin(index);

        spine.destroy();
        // it waits with the others that no engine shows, and goes once enough newer ones wait
        expect(skin).toBeDefined();
        expect(lookup.skin(index)).toBe(skin);
        // lists of three, which no other test of the file makes, so each is a new skin
        for (const [a = 1, b = 2] of pairs(model, KEPT_SKINS + 1)) combineSkins(lookup, model, [a, b, 1]);
        expect(lookup.skin(index)).not.toBe(skin);
    });
});
