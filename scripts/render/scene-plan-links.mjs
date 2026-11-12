/**
 * The scenes of the render check about Pixi objects on a skeleton: a `Graphics` that is attached
 * to a slot, and one that follows a bone. The official side attaches with `addSlotObject`, ours
 * with `attach` and `follow`, see `hold` of scripts/render/sides.js.
 */
import { count, held, scene, spine, use } from './scene-kit.mjs';

/** A scene whose every frame is captured: a container at the wrong place can show in any of them. */
const everyFrame = (steps, more = {}) => ({ steps, captures: count(steps), ...more });

/** A badge over the head of the alien, larger than the head, so that the slots in front of it cut into it. */
const badge = held('badge', { slot: 'head' }, { x: -70, y: -60, width: 190, height: 120, color: 0xffcc00 });
/** A dot on the hand of the alien. It follows a bone, so it lies on top of the skeleton. */
const dot = held('dot', { bone: 'front-lower-arm' }, { radius: 26, color: 0x00ccff, alpha: 0.8 });
/** A tag across the coin, behind its shine and in front of its face. */
const tag = held('tag', { slot: 'coin-front-texture' }, { x: -130, y: -30, width: 260, height: 60, color: 0xcc2255 });
/** A dot that follows the bone of the shine of the coin. */
const spark = held('spark', { bone: 'shine' }, { radius: 20, color: 0x22cc66 });

/**
 * A skeleton that plays draw order keys around an attached slot, and one whose keys move a slot
 * across the attached one. The alien dies from 1.38 seconds on: its keys at 1.43, 1.63, 1.67
 * and 1.77 seconds move six slots, some from behind the head to in front of it. The coin turns:
 * its side goes behind and in front of its face. This scene holds the tooling proof: a side
 * that attaches the badge to another slot of the bone of the head, far back in the draw order.
 */
function playScene(rigs) {
    const alien = use(rigs, '4.3/alien-pro', 'death');
    const coin = use(rigs, '4.3/coin-pro', 'animation');

    return scene(
        'links-play',
        'a Graphics attached to a slot in the middle of the draw order and one that follows a bone, on two skeletons that play draw order keys',
        '4.3',
        { a: alien, b: coin },
        [
            spine('alien', 'a', alien, { cx: 170, cy: 256, size: 300, time: 1.38, holds: [badge, dot] }),
            spine('coin', 'b', coin, { cx: 390, cy: 256, size: 190, time: 0.55, holds: [tag, spark] }),
        ],
        everyFrame(16, { proof: { misplace: { name: 'alien', key: 'badge', slot: 'burst-bg' } } }),
    );
}

/**
 * Skeletons that rest. One holds its objects from the start and never plays. One gets them
 * while it rests, and loses one of them again. One plays to its end with them and rests there.
 */
function restScene(rigs) {
    const alien = use(rigs, '4.2/alien-pro', 'hit');
    const coin = use(rigs, '4.2/coin-pro', 'animation');

    return scene(
        'links-rest',
        'a Graphics attached to a slot and one that follows a bone, on skeletons that rest: from the start, attached and let go of at rest, and after the end of an animation',
        '4.2',
        { a: alien, b: coin },
        [
            spine('still', 'a', alien, { cx: 110, cy: 256, size: 210, play: false, holds: [badge, dot] }),
            spine('late', 'b', coin, { cx: 256, cy: 256, size: 150, play: false }),
            spine('ends', 'a', alien, {
                cx: 400,
                cy: 256,
                size: 210,
                loop: false,
                time: Math.max(0, alien.duration - 0.2),
                holds: [badge, dot],
            }),
        ],
        everyFrame(16, {
            events: [
                { step: 4, op: 'hold', name: 'late', hold: tag },
                { step: 6, op: 'hold', name: 'late', hold: spark },
                { step: 11, op: 'release', name: 'late', key: 'tag' },
                { step: 13, op: 'release', name: 'still', key: 'dot' },
            ],
        }),
    );
}

/** The scenes about objects on a skeleton. */
export function linkScenes(rigs) {
    return [playScene(rigs), restScene(rigs)];
}
