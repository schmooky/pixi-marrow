/**
 * The scenes about instanced draws: with `skinning: 'gpu'` the mesh mode draws the instances of
 * a layout that follow each other in Pixi's render order in one draw. Each scene puts a run of
 * instances of one rig on the stage that differ in what an instanced draw must keep apart: the
 * tint and alpha of each instance, the attachments, draw orders and deforms of the animations they
 * play, the regions of a sequence, and a clip that comes and goes. Every scene is held to the
 * official runtime, and with `--skinning=gpu` the instanced side to the same scene drawn alone,
 * to the bit. See scripts/render/scene-kit.mjs for what a scene is made of.
 */
import { count, phase, round, scene, spine, use } from './scene-kit.mjs';

/** Six instances of one rig over each other in two rows. */
function run(rig, size, more = () => ({})) {
    return count(6).map((i) =>
        spine(`i${i}`, 'a', rig, {
            cx: 110 + (i % 3) * 145,
            cy: 170 + Math.floor(i / 3) * 170,
            size,
            rotation: round((i - 2.5) * 0.05, 3),
            at: phase(i),
            ...more(i),
        }),
    );
}

/** The events that start another animation on some instances of a run, at the first frame. */
const animations = (names) => names.map((animation, i) => ({ step: 0, op: 'play', name: `i${i}`, animation }));

/**
 * The scenes, in a fixed order.
 *
 * @param rigs The rigs `planRigs` returned, without a filter.
 */
export function instanceScenes(rigs) {
    const raptor = use(rigs, '4.3/raptor-pro', 'walk');
    const alien = use(rigs, '4.3/alien-pro', 'death');
    const owl = use(rigs, '4.3/owl-pro', 'idle');
    const goblin = use(rigs, '4.3/goblins-pro', 'walk', 'goblin');
    const girl = use(rigs, '4.3/goblins-pro', 'walk', 'goblingirl');
    const diamond = use(rigs, '4.3/diamond-pro', 'rotation');
    const boy = use(rigs, '4.3/spineboy-pro', 'walk');
    const tints = [
        { alpha: 0.5 },
        { tint: 0xff8040 },
        { alpha: 0 },
        { alpha: 0.75, tint: 0x40ff80 },
        {},
        { tint: 0x8080ff },
    ];

    return [
        scene(
            'instances-tint',
            'six instances of one rig in one run, each with a tint and an alpha of its own, one of them at alpha 0',
            '4.3',
            { a: raptor },
            run(raptor, 240),
            { events: tints.map((look, i) => ({ step: 0, op: 'set', name: `i${i}`, ...look })) },
        ),
        scene(
            'instances-animations',
            'six instances of one rig play animations with attachment, draw order and deform keys, each at a time of its own',
            '4.3',
            { a: alien },
            run(alien, 230),
            { events: animations(['death', 'jump', 'run', 'death', 'hit', 'jump']) },
        ),
        scene(
            'instances-deform',
            'six instances of a rig whose meshes deform in every animation, playing five of them',
            '4.3',
            { a: owl },
            run(owl, 220),
            { events: animations(['idle', 'left', 'right', 'up', 'down', 'idle']) },
        ),
        scene(
            'instances-skins',
            'six instances of a rig with deform and attachment keys, in two skins that take turns: each skin is a layout of its own',
            '4.3',
            { a: goblin, b: girl },
            run(goblin, 240, (i) => (i % 3 === 1 ? { rig: 'b' } : {})),
        ),
        scene(
            'instances-sequence',
            'six instances of a rig with sequences, a deform and a slider, playing three animations',
            '4.3',
            { a: diamond },
            run(diamond, 200),
            { events: animations(['rotation', 'disappear', 'idle-still', 'idle-rotating-alt-shape']) },
        ),
        scene(
            'instances-clip',
            'six instances walk, and some of them play an animation with a clip for a while, so they leave the run and join it again',
            '4.3',
            { a: boy },
            run(boy, 260),
            {
                steps: 24,
                captures: count(24),
                events: [
                    ...[1, 4].map((i) => ({ step: 6, op: 'play', name: `i${i}`, animation: 'portal' })),
                    { step: 12, op: 'play', name: 'i2', animation: 'portal' },
                    ...[1, 2, 4].map((i) => ({ step: 18, op: 'play', name: `i${i}`, animation: 'walk' })),
                ],
            },
        ),
        scene(
            'instances-between',
            'a run of instances with a graphics object after the second and a sprite after the fourth',
            '4.3',
            { a: raptor },
            [
                ...run(raptor, 240).slice(0, 2),
                { type: 'graphics', x: 120, y: 120, width: 200, height: 120, color: 0x2266ff, alpha: 0.7 },
                ...run(raptor, 240).slice(2, 4),
                { type: 'sprite', x: 260, y: 200, width: 90, height: 220, rotation: 0.2, color: 0xffcc00, alpha: 0.8 },
                ...run(raptor, 240).slice(4),
            ],
        ),
    ];
}
