import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS, type SpineVersion } from '../../src/base/version';
import type { SkeletonModel } from '../../src/model/model';
import { listFixtures } from '../parity/fixtures';
import { clipAttachment, clipGroups, expectClips } from './clip-check';
import type { OfficialClips } from './clip-official';
import { FRAME, loadRig, meshes, play, type Rig, readFlags, slotIndex, step, vertexData, visibleSlots } from './rig';

/*
 * Which slots a clipping attachment cuts, against the official `SkeletonClipping` of each version
 * driven by the official draw loop. `expectClips` compares every pose: the slots of each clip, the
 * area of each mask, and the stats.
 */

const ADDITIVE = 1;
const MULTIPLY = 2;

/** The official examples with a clipping attachment, in both formats of every version. */
const CLIPPED = listFixtures()
    .filter((fixture) => ['coin-pro', 'tank-pro', 'spineboy-pro'].includes(fixture.rig))
    .map((fixture) => fixture.id);

/** Polygons in the space of a bone, large enough to hold a part of spineboy. */
const QUAD = [-220, -160, -180, 240, 260, 210, 230, -190];
const TRIANGLE = [-300, -40, 40, 330, 280, -260];
const CONCAVE = [-250, -200, -230, 260, 0, 40, 240, 250, 260, -210, 10, -60];

/**
 * Spineboy in the setup pose. Its visible slots are, in draw order: rear-upper-arm, rear-bracer,
 * gun, rear-foot, rear-thigh, rear-shin, neck, torso, front-upper-arm, head, eye, front-thigh,
 * front-foot, front-shin, mouth, goggles, front-bracer and front-fist.
 */
async function spineboy(version: SpineVersion, change?: (model: SkeletonModel) => void): Promise<Rig> {
    const rig = await loadRig(`${version}/spineboy-pro.skel`, change);

    step(rig, 0);

    return rig;
}

const BODY_AFTER_GUN = ['rear-foot', 'rear-thigh', 'rear-shin', 'neck', 'torso', 'front-upper-arm', 'head'];
const AFTER_HEAD = ['eye', 'front-thigh', 'front-foot', 'front-shin', 'mouth', 'goggles', 'front-bracer', 'front-fist'];

/** Updates the view, checks it against the official clipper and returns the slots each clip cuts, by name. */
function cutNames(rig: Rig): Record<string, string[]> & { clips: OfficialClips } {
    rig.view.update(rig.engine.state);
    const clips = expectClips(rig);
    const { names } = rig.model.slots;
    const cut: Record<string, string[]> = {};

    visibleSlots(rig).forEach(({ slot }, i) => {
        const by = names[clips.cuts[i] ?? -1];

        if (by !== undefined) cut[by] = [...(cut[by] ?? []), names[slot] ?? ''];
    });

    return Object.assign(cut, { clips });
}

/** The clip groups of the view as the number of meshes in each. */
const groupSizes = (rig: Rig): number[] => clipGroups(rig.view).map((group) => group.meshes.length);

describe('clipping in the official examples', () => {
    it.each(CLIPPED)('cuts the slots of %s that the official clipper cuts, to the same area', async (id) => {
        const rig = await loadRig(id);
        let masks = 0;
        let kept = 0;
        let removed = 0;

        for (const animation of rig.model.animations) {
            play(rig, animation.name);
            for (let frame = 0; frame < 16; frame++) {
                step(rig, Math.max(animation.duration, FRAME) / 15.5);
                const { samples } = expectClips(rig);

                // additive slots inside a clip stay in its one range. Only the tank has other blend modes
                for (const size of groupSizes(rig)) expect(size).toBe(1);
                masks += samples.length;
                for (const sample of samples) {
                    kept += sample.kept;
                    removed += sample.removed;
                }
            }
        }
        expect(masks).toBeGreaterThan(0);
        expect(kept).toBeGreaterThan(100);
        expect(removed).toBeGreaterThan(100);
        expect(rig.view.stats.templateBuilds).toBe(1);
    });

    it.each(['4.2', '4.3'] as const)('draws the %s coin in two ranges and two mask draws', async (version) => {
        const rig = await loadRig(`${version}/coin-pro.skel`);
        const names = (list: { slot: number }[]): string[] =>
            list.map((item) => rig.model.slots.names[item.slot] ?? '');

        step(rig, 0);
        // the end slot of the clip is its own slot, which never ends it: it cuts to the end
        expect(cutNames(rig)).toMatchObject({ clipping: ['shine'] });
        expect(names(visibleSlots(rig))).toEqual([
            'coin-side',
            'coin-side-round',
            'coin-front-texture',
            'coin-front-shine',
            'shine',
        ]);
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 4 });
        expect(groupSizes(rig)).toEqual([1]);
    });
});

describe.each(SPINE_VERSIONS)('the clip rules of Spine %s', (version) => {
    const legacy = version !== '4.3';

    it('cuts the slots after a clipping attachment, up to and with its end slot', async () => {
        const rig = await spineboy(version);
        const { state } = rig.engine;
        const torso = slotIndex(rig, 'torso');

        state.attachments[slotIndex(rig, 'gun')] = clipAttachment('clip', torso, QUAD);
        expect(cutNames(rig)).toMatchObject({ gun: ['rear-foot', 'rear-thigh', 'rear-shin', 'neck', 'torso'] });
        // before the clip, inside it, after it
        expect(meshes(rig.view).length).toBe(3);
        expect(groupSizes(rig)).toEqual([3 - 2]);
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 5 });
        // an end slot that is not drawn ends the clip all the same: alpha 0, no attachment, an inactive bone
        state.colors[torso * 4 + 3] = 0;
        expect(cutNames(rig)).toMatchObject({ gun: ['rear-foot', 'rear-thigh', 'rear-shin', 'neck'] });
        state.colors[torso * 4 + 3] = 1;
        state.attachments[torso] = null;
        expect(cutNames(rig)).toMatchObject({ gun: ['rear-foot', 'rear-thigh', 'rear-shin', 'neck'] });
        state.attachments[slotIndex(rig, 'neck')] = null;
        state.active[rig.model.slots.bones[torso] ?? -1] = 0;
        expect(cutNames(rig)).toMatchObject({ gun: ['rear-foot', 'rear-thigh', 'rear-shin'] });
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, templateBuilds: 1 });
    });

    it('cuts to the end of the draw order without an end slot that follows', async () => {
        const rig = await spineboy(version);
        const { state } = rig.engine;
        const gun = slotIndex(rig, 'gun');

        // no end slot, the slot of the clip itself, a slot before the clip
        for (const end of [-1, gun, slotIndex(rig, 'rear-bracer')]) {
            state.attachments[gun] = clipAttachment('clip', end, TRIANGLE);
            expect(cutNames(rig)).toMatchObject({ gun: [...BODY_AFTER_GUN, ...AFTER_HEAD] });
            expect(meshes(rig.view).length).toBe(2);
            expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 4 });
        }
    });

    it('does not start a second clip while one is active', async () => {
        const rig = await spineboy(version);
        const { state } = rig.engine;

        state.attachments[slotIndex(rig, 'gun')] = clipAttachment('first', slotIndex(rig, 'head'), QUAD);
        state.attachments[slotIndex(rig, 'neck')] = clipAttachment('second', slotIndex(rig, 'front-fist'), TRIANGLE);
        const cut = cutNames(rig);

        // the second one is not applied, and its end slot means nothing
        expect(cut).toMatchObject({ gun: BODY_AFTER_GUN.filter((name) => name !== 'neck') });
        expect(cut.neck).toBeUndefined();
        expect(cut.clips.started).toEqual([slotIndex(rig, 'gun')]);
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 5 });
    });

    it(
        legacy
            ? 'never ends a clip at an end slot that shows a clipping attachment'
            : 'ends a clip at an end slot that shows a clipping attachment, and starts that one',
        async () => {
            const rig = await spineboy(version);
            const { state } = rig.engine;
            const neck = slotIndex(rig, 'neck');

            state.attachments[slotIndex(rig, 'gun')] = clipAttachment('first', neck, QUAD);
            state.attachments[neck] = clipAttachment('second', slotIndex(rig, 'head'), CONCAVE);
            const cut = cutNames(rig);

            if (legacy) {
                // the end slot is skipped before the clipper is asked to end: the first clip cuts to the end
                expect(cut).toMatchObject({
                    gun: [...BODY_AFTER_GUN.filter((name) => name !== 'neck'), ...AFTER_HEAD],
                });
                expect(cut.neck).toBeUndefined();
                expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 4 });
            } else {
                expect(cut).toMatchObject({
                    gun: ['rear-foot', 'rear-thigh', 'rear-shin'],
                    neck: ['torso', 'front-upper-arm', 'head'],
                });
                // two clips with nothing between them: two containers side by side
                expect(groupSizes(rig)).toEqual([1, 1]);
                expect(meshes(rig.view).length).toBe(4);
                expect(rig.view.stats).toMatchObject({ clips: 2, maskDraws: 4, drawCalls: 8 });
            }
        },
    );

    it('starts the next clip after the end slot of the one before, and none on an inactive bone', async () => {
        const rig = await spineboy(version);
        const { state } = rig.engine;
        const { bones } = rig.model.slots;
        const [gun, neck] = [slotIndex(rig, 'gun'), slotIndex(rig, 'neck')];

        state.attachments[gun] = clipAttachment('first', slotIndex(rig, 'rear-shin'), QUAD);
        state.attachments[neck] = clipAttachment('second', slotIndex(rig, 'head'), TRIANGLE);
        expect(cutNames(rig)).toMatchObject({
            gun: ['rear-foot', 'rear-thigh', 'rear-shin'],
            neck: ['torso', 'front-upper-arm', 'head'],
        });
        expect(groupSizes(rig)).toEqual([1, 1]);
        expect(rig.view.stats).toMatchObject({ clips: 2, maskDraws: 4, drawCalls: 8 });
        // the bone of the second clip is switched off: its slots are drawn whole
        state.active[bones[neck] ?? -1] = 0;
        let cut = cutNames(rig);

        expect(cut).toMatchObject({ gun: ['rear-foot', 'rear-thigh', 'rear-shin'] });
        expect(cut.neck).toBeUndefined();
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 5 });
        // and the bone of the first one
        state.active[bones[gun] ?? -1] = 0;
        cut = cutNames(rig);
        expect(cut.gun).toBeUndefined();
        expect(clipGroups(rig.view)).toEqual([]);
        expect(rig.view.stats).toMatchObject({ clips: 0, maskDraws: 0, drawCalls: 1 });
        const children = [...rig.view.container.children];

        // two ranges and two containers at first, and a range between the containers for the second pose
        expect(children.length).toBe(5);
        // both back: the same containers, and nothing new
        state.active[bones[gun] ?? -1] = 1;
        state.active[bones[neck] ?? -1] = 1;
        expect(Object.keys(cutNames(rig)).sort()).toEqual(['clips', 'gun', 'neck']);
        expect(rig.view.container.children).toEqual(children);
        expect(groupSizes(rig)).toEqual([1, 1]);
    });

    it('splits the slots inside a clip at a multiply slot, behind one mask', async () => {
        const rig = await spineboy(version, (model) => {
            model.slots.blendModes[model.slots.names.indexOf('torso')] = MULTIPLY;
            model.slots.blendModes[model.slots.names.indexOf('rear-shin')] = ADDITIVE;
        });
        const { state } = rig.engine;

        state.attachments[slotIndex(rig, 'gun')] = clipAttachment('clip', slotIndex(rig, 'head'), QUAD);
        expect(cutNames(rig)).toMatchObject({ gun: BODY_AFTER_GUN });
        // before the torso, the torso, after it: three ranges and one mask. The additive slot starts none
        expect(groupSizes(rig)).toEqual([3]);
        expect(clipGroups(rig.view)[0]?.meshes.map((mesh) => mesh.blendMode)).toEqual([
            'inherit',
            'multiply',
            'inherit',
        ]);
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 7 });
        const shin = rig.view.stats.vertices;
        const { statics } = vertexData(rig.view);
        const additive = Array.from({ length: shin }, (_, vertex) => readFlags(statics, vertex).additive);

        expect(additive.filter((flag) => flag === 255).length).toBeGreaterThan(0);
    });

    it(
        legacy
            ? 'does not turn a clip inside out: the inverse flag is for 4.3'
            : 'turns a clip inside out for the inverse flag, around its convex hull',
        async () => {
            const rig = await spineboy(version);
            const { state } = rig.engine;
            const gun = slotIndex(rig, 'gun');
            const head = slotIndex(rig, 'head');

            state.attachments[gun] = clipAttachment('inside-out', head, CONCAVE, { inverse: true });
            expect(cutNames(rig)).toMatchObject({ gun: BODY_AFTER_GUN });
            const [group] = clipGroups(rig.view);

            expect(group?.inverse).toBe(!legacy);
            // the hull of the polygon has 4 corners, the polygon has 6
            expect(group?.mask.geometry.indexCount).toBe(legacy ? 12 : 6);
            // another attachment on the same slot: the same container, the right way around
            state.attachments[gun] = clipAttachment('plain', head, CONCAVE);
            expect(cutNames(rig)).toMatchObject({ gun: BODY_AFTER_GUN });
            expect(clipGroups(rig.view)[0]?.container).toBe(group?.container);
            expect(clipGroups(rig.view)[0]?.inverse).toBe(false);
            expect(clipGroups(rig.view)[0]?.mask.geometry.indexCount).toBe(12);
            // marked convex: 4.3 takes the hull
            state.attachments[gun] = clipAttachment('marked', head, CONCAVE, { convex: true });
            expect(cutNames(rig)).toMatchObject({ gun: BODY_AFTER_GUN });
            expect(clipGroups(rig.view)[0]?.mask.geometry.indexCount).toBe(legacy ? 12 : 6);
        },
    );

    it('follows the draw order: a slot that moves out of the clip is drawn whole', async () => {
        const rig = await spineboy(version);
        const { state } = rig.engine;
        const [gun, torso, bracer] = [slotIndex(rig, 'gun'), slotIndex(rig, 'torso'), slotIndex(rig, 'rear-bracer')];

        state.attachments[gun] = clipAttachment('clip', slotIndex(rig, 'head'), TRIANGLE);
        expect(cutNames(rig).gun).toContain('torso');
        // the torso trades places with a slot before the clip
        const [from, to] = [state.drawOrder.indexOf(torso), state.drawOrder.indexOf(bracer)];

        state.drawOrder[from] = bracer;
        state.drawOrder[to] = torso;
        const cut = cutNames(rig);

        expect(cut.gun).not.toContain('torso');
        expect(cut.gun).toContain('rear-bracer');
        // the clip moved to the end of the draw order: nothing is left to cut, and no mask is drawn
        state.drawOrder.copyWithin(state.drawOrder.indexOf(gun), state.drawOrder.indexOf(gun) + 1);
        state.drawOrder[state.drawOrder.length - 1] = gun;
        expect(cutNames(rig).gun).toBeUndefined();
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 0, drawCalls: 1 });
        expect(clipGroups(rig.view)).toEqual([]);
    });
});
