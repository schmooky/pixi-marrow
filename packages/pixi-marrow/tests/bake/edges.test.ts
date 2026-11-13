import { describe, expect, it } from 'vitest';
import { addBakedClips, bakeAnimation, decodeBakedClips, encodeBakedClips } from '../../src/bake';
import { playBaked } from '../../src/bake/playback';
import { bakesOf } from '../../src/bake/store';
import { importSkeleton, MarrowError, type PoseEngine } from '../../src/core';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { listFixtures, readFixture } from '../parity/fixtures';
import { DT, displayEngine, hostOf, modelOf } from './kit';

/*
 * Edges of baked playback that a review found: a baked attachment change, combined skins that
 * the baker shows, and clips whose arrays do not fit together.
 */

/** spineboy-pro of a version with one more animation, which swaps the attachment of the front foot. */
async function swapping(version: string) {
    const fixture = listFixtures().find((candidate) => candidate.id === `${version}/spineboy-pro.json`);

    if (fixture === undefined) throw new Error('no fixture. Run: pnpm fixtures');
    const json = JSON.parse(String(readFixture(fixture).skeleton));

    json.animations.swap = {
        slots: {
            'front-foot': {
                attachment: [
                    { time: 0, name: 'front-foot' },
                    { time: 0.5, name: null },
                    { time: 0.75, name: 'front-foot' },
                ],
            },
        },
        bones: {
            root: {
                rotate: [
                    { time: 0, value: 0 },
                    { time: 1, value: 0 },
                ],
            },
        },
    };

    return importSkeleton(JSON.stringify(json));
}

describe('a baked attachment change', () => {
    for (const version of ['4.2', '4.3']) {
        it(`resets the deform and the sequence index as the engine does, ${version}`, async () => {
            const model = await swapping(version);
            const host = await hostOf(model);
            const live = displayEngine(host);
            const baked = displayEngine(host);
            const tally = playBaked(host, baked, null);
            const both = (run: (engine: PoseEngine) => void): void => {
                run(live);
                run(baked);
            };
            const named = (name: string): number => model.animations.findIndex((animation) => animation.name === name);
            const slot = model.slots.names.indexOf('front-foot');

            // a deform of the foot is left over from another animation
            both((engine) => engine.setAnimation(0, named('hoverboard'), true));
            for (let i = 0; i < 20; i++) both((engine) => engine.update(DT));
            both((engine) => engine.clearTrack(0));
            both((engine) => engine.setupPoseBones());
            both((engine) => engine.setAnimation(0, named('swap'), true));
            for (let i = 0; i < 90; i++) {
                both((engine) => engine.update(DT));
                expect(baked.state.attachments[slot]).toBe(live.state.attachments[slot]);
                expect(baked.state.deformLengths[slot]).toBe(live.state.deformLengths[slot]);
                expect(baked.state.sequenceIndices[slot]).toBe(live.state.sequenceIndices[slot]);
            }
            expect(tally.baked).toBeGreaterThan(0);
        });
    }
});

describe('combined skins and baking', () => {
    it('lets go of a combined skin that it baked, as an engine that shows it does', async () => {
        const model = await importSkeleton(readFixture(fixtureOf('4.2/mix-and-match-pro.skel')).skeleton);
        const host = await hostOf(model);
        const lookup = createAttachmentLookup(model);
        const skins: number[] = [];

        for (let i = 0; i < 20; i++) {
            const engine = displayEngine(host);

            playBaked(host, engine, null);
            engine.setSkins([1, 2 + i]);
            skins.push(engine.state.skin);
            engine.setAnimation(0, 0, true);
            engine.update(DT);
            engine.update(DT);
            // as MarrowSpine.destroy does
            engine.clearTracks();
            engine.setSkin(-1);
        }
        // the last 8 that no engine shows wait, as without baking
        expect(skins.filter((index) => lookup.skin(index) !== undefined).length).toBeLessThanOrEqual(8);
        expect(bakesOf(model).bytes).toBeGreaterThan(0);
    });
});

describe('clips that do not fit together', () => {
    type Clip = ReturnType<typeof decodeBakedClips>[number];
    /** A damage, and the array it needs to have something in. */
    const damaged: [string, (clip: Clip) => ArrayLike<number>, (clip: Clip) => void][] = [
        ['a deform past its numbers', (clip) => clip.deformStarts, (clip) => clip.deformStarts.fill(1e9)],
        ['a bone the skeleton lacks', (clip) => clip.bones, (clip) => clip.bones.fill(30000)],
        ['an attachment it does not name', (clip) => clip.attachments, (clip) => clip.attachments.fill(999)],
        [
            'a placement of 3 numbers',
            (clip) => clip.placement,
            (clip) => Object.assign(clip, { placement: new Float64Array(3) }),
        ],
    ];

    for (const [what, needs, damage] of damaged) {
        it(`throws a MarrowError at the hand-over for ${what}`, async () => {
            const model = await modelOf('4.2/spineboy-pro.skel');
            const [clip] = decodeBakedClips(encodeBakedClips([await bakeAnimation(model, 'hoverboard')]));

            if (clip === undefined || needs(clip).length === 0) throw new Error('the clip keeps nothing to damage');
            expect(() => addBakedClips({ model }, [clip])).not.toThrow();
            damage(clip);
            expect(() => addBakedClips({ model }, [clip])).toThrow(MarrowError);
        });
    }
});

function fixtureOf(id: string) {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);

    return fixture;
}
