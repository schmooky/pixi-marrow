import { describe, expect, it } from 'vitest';
import { MarrowSpine } from '../../src/index';
import { bareEngine, FRAME, fixtureAsset, poseOf } from './helpers';

/*
 * A display object poses itself once in its constructor, to draw before its first update. The
 * official Pixi runtime does not. Physics has state, so that first pose must leave it alone:
 * the physics starts from the pose of the first real update.
 */

describe.each(['4.2/sack-pro.skel', '4.3/sack-pro.skel', '4.3/celestial-circus-pro.skel'])(
    'the start of physics of %s',
    (id) => {
        it('is the first update after the constructor', async () => {
            const asset = await fixtureAsset(id);
            const spine = new MarrowSpine(asset, { autoUpdate: false });
            // an engine that never posed before its first animation, as the official object
            const late = bareEngine(asset);
            // an engine whose physics began at the setup pose
            const early = bareEngine(asset);
            let differs = false;

            early.update(0);
            asset.model.animations.forEach((animation, index) => {
                spine.play(animation.name, { loop: true });
                late.setAnimation(0, index, true);
                early.setAnimation(0, index, true);
                for (let i = 0; i < 12; i++) {
                    spine.update(FRAME);
                    late.update(FRAME);
                    early.update(FRAME);
                    expect(poseOf(spine.engine), `${animation.name}, update ${i + 1}`).toEqual(poseOf(late));
                    differs ||= JSON.stringify(poseOf(early).world) !== JSON.stringify(poseOf(late).world);
                }
            });
            // the test can tell the two starts apart
            expect(differs).toBe(true);
            expect(spine.physics).toBe('update');
            spine.destroy();
        });
    },
);
