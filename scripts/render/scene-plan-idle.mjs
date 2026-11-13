/**
 * The scenes of the render check about the idle cache. With `idleCache: 'auto'` a skeleton that
 * rests is drawn into an image once, and the image shows in its place. These scenes let ours
 * rest with the cache on until the images show, and then wake the skeletons, move them, fade
 * them and scale them. Every frame is compared with the official runtime, which draws everything
 * live in every frame, and with ours drawing the same scene live:
 *
 *   mesh, batched    ours with the cache in that mode against the official runtime
 *   idle, mesh       ours in the mesh mode with the cache against ours in the mesh mode without it
 *   idle, batched    the same in the batched mode
 *   idle cache       which instances showed their image at which steps. An instance must show
 *                    it at the steps of `idle.cached` and draw live at the steps of `idle.live`
 *
 * These comparisons get no second look. It moves a side by a part of a pixel, which drops the
 * images. `TOLERANCE.idle` of scripts/check-render.mjs says what they allow instead.
 *
 * The cache waits 30 updates of an unchanged pose and then two renders at one place, see
 * `IDLE_WAIT` of src/api/idle-image.ts, and its code loads in the first frames of a page. So the
 * images show from step 31 or 32. The steps of `idle.cached` leave a few steps of room.
 *
 * The proof of a scene holds the update of one frame back on a side that is wrong on purpose.
 * There an instance that starts to play keeps its image: the stale picture must be rejected.
 */
import { count, round, scene, spine, use } from './scene-kit.mjs';

/** A scene whose every frame is captured: an image can show in any of them. */
const everyFrame = (steps, more = {}) => ({ steps, captures: count(steps), ...more });

/** An instance that played its animation once and stands past its end. */
const rested = (rig, more = 0.3) => ({ loop: false, time: round(rig.duration + more, 4) });

/**
 * Four skeletons rest until their images show: one past the end of its animation, one that never
 * played, one with a skin, and one with a clip and additive slots. Then one plays again, and one
 * is faded by an alpha below 1. Both must draw live in the frame of that change.
 */
function restScene(rigs) {
    const speedy = use(rigs, '4.2/speedy-ess', 'run');
    const raptor = use(rigs, '4.2/raptor-pro', 'roar');
    const goblin = use(rigs, '4.2/goblins-pro', 'walk', 'goblin');
    const coin = use(rigs, '4.2/coin-pro', 'animation');

    return scene(
        'idle-rest',
        'four skeletons rest with the idle cache on until their images show, then one plays again and one fades',
        '4.2',
        { a: speedy, b: raptor, c: goblin, d: coin },
        [
            spine('r0', 'a', speedy, { cx: 120, cy: 200, size: 220, idle: true, ...rested(speedy) }),
            spine('r1', 'b', raptor, { cx: 300, cy: 190, size: 300, idle: true, play: false }),
            spine('r2', 'c', goblin, { cx: 140, cy: 380, size: 230, idle: true, ...rested(goblin) }),
            spine('r3', 'd', coin, { cx: 370, cy: 380, size: 200, idle: true, ...rested(coin, 0.1) }),
        ],
        everyFrame(48, {
            events: [
                { step: 40, op: 'play', name: 'r0', animation: 'run', loop: false },
                { step: 43, op: 'set', name: 'r2', alpha: 0.5 },
            ],
            idle: {
                cached: ['r0', 'r1', 'r2', 'r3'].map((name) => ({ name, step: 39 })),
                live: [
                    { name: 'r0', step: 40 },
                    { name: 'r0', step: 47 },
                    { name: 'r2', step: 43 },
                ],
            },
            // at this step `r0` plays again: a side that keeps its image there shows a stale picture
            proof: { hold: { step: 40 } },
        }),
    );
}

/**
 * Skeletons of Spine 4.3 rest below a parent. The parent moves by whole pixels, which keeps the
 * images, then by a part of a pixel, and later it grows. Each of those draws live in its frame.
 * One skeleton outside the parent rests all along.
 */
function moveScene(rigs) {
    const speedy = use(rigs, '4.3/speedy-ess', 'run');
    const raptor = use(rigs, '4.3/raptor-pro', 'roar');
    const boy = use(rigs, '4.3/spineboy-pro', 'idle');

    return scene(
        'idle-moves',
        'skeletons of 4.3 rest with the idle cache on below a parent that moves by whole pixels, then by a part of one, then grows',
        '4.3',
        { a: speedy, b: raptor, c: boy },
        [
            {
                type: 'group',
                name: 'holder',
                children: [
                    spine('m0', 'a', speedy, { cx: 150, cy: 210, size: 230, idle: true, ...rested(speedy) }),
                    spine('m1', 'b', raptor, { cx: 330, cy: 220, size: 300, idle: true, play: false }),
                ],
            },
            spine('m2', 'c', boy, { cx: 256, cy: 390, size: 220, idle: true, ...rested(boy) }),
        ],
        everyFrame(50, {
            events: [
                { step: 38, op: 'shift', group: 'holder', x: 3, y: -2 },
                { step: 42, op: 'shift', group: 'holder', x: 3.37, y: -2 },
                { step: 46, op: 'shift', group: 'holder', scale: 1.1 },
            ],
            idle: {
                cached: [
                    ...['m0', 'm1', 'm2'].map((name) => ({ name, step: 37 })),
                    ...['m0', 'm1', 'm2'].map((name) => ({ name, step: 41 })),
                    { name: 'm2', step: 49 },
                ],
                live: [
                    { name: 'm0', step: 42 },
                    { name: 'm1', step: 42 },
                    { name: 'm0', step: 46 },
                    { name: 'm1', step: 49 },
                ],
            },
        }),
    );
}

/**
 * Skeletons rest on a multisampled target. The idle cache keeps them live there: an image would
 * take five times the memory, and the samples on the edges of triangles tie too often. So no
 * image may show, and ours with the cache must draw what ours without it draws. The official
 * runtime is left out: without a second look, the mesh mode on WebGPU differs from it in some
 * edge samples, image or not.
 */
function multisampledScene(rigs) {
    const speedy = use(rigs, '4.3/speedy-ess', 'run');
    const raptor = use(rigs, '4.3/raptor-pro', 'roar');

    return scene(
        'idle-multisampled',
        'two skeletons rest with the idle cache on, drawn to a multisampled target, where they stay live',
        null,
        { a: speedy, b: raptor },
        [
            spine('s0', 'a', speedy, { cx: 150, cy: 250, size: 240, rotation: 0.2, idle: true, ...rested(speedy) }),
            spine('s1', 'b', raptor, { cx: 340, cy: 260, size: 320, idle: true, play: false }),
        ],
        everyFrame(42, {
            antialias: true,
            events: [{ step: 38, op: 'play', name: 's0', animation: 'run', loop: false }],
            idle: {
                cached: [],
                live: [36, 37, 38, 41].flatMap((step) => ['s0', 's1'].map((name) => ({ name, step }))),
            },
        }),
    );
}

/** The scenes about the idle cache. Every frame of each is compared. */
export function idleScenes(rigs) {
    return [restScene(rigs), moveScene(rigs), multisampledScene(rigs)];
}
