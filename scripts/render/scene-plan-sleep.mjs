/**
 * The scenes of the render check about work that follows change. A runtime may leave work out
 * for a skeleton that does not change. What it must not do is show an old picture: a view that
 * skips work it had to do shows the frame before. So these scenes let skeletons rest and wake,
 * change them while they rest, and compare every frame with the official runtime, which does
 * all of its work in every frame.
 *
 * The scenes whose name starts with `lazy` are about the code of the mesh mode, which loads on
 * demand. Each runs on a page of its own with the default options alone, see `lazyCase` of
 * scripts/render/scenes.js and `meshChunkCase` of scripts/render/chunks.mjs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { count, DT, round, scene, spine, use } from './scene-kit.mjs';

/** Vertices the large rig of the scene `lazy-first` gets on top of the rig it is made from. */
const MORE_VERTICES = 400;

/**
 * Writes a rig that `auto` draws with meshes, which no example rig is: `auto` batches a skeleton
 * of up to 1024 vertices, and the largest example has 847. The copy is the raptor of Spine 4.3
 * with its region slots once more, and again, until it has `MORE_VERTICES` more: 667 and 400.
 * The copies lie over the slots they are copies of, so the picture stays what it was.
 *
 * @param dir A folder the page server serves like fixtures/.cache.
 * @returns The file name of the copy.
 */
function writeLargeRig(root, dir) {
    const file = 'raptor-large.json';
    const rig = JSON.parse(readFileSync(join(root, 'fixtures/.cache/4.3/raptor-pro.json'), 'utf8'));
    const skin = rig.skins.find((entry) => entry.name === 'default').attachments;
    // a slot that shows a region: an attachment without a type is one
    const regions = rig.slots.filter((slot) => {
        const shown = skin[slot.name]?.[slot.attachment];

        return shown && (shown.type ?? 'region') === 'region';
    });

    if (regions.length === 0) throw new Error('the raptor has no region slot to copy');
    for (let added = 0, round = 1; added < MORE_VERTICES; round++) {
        for (const slot of regions) {
            const name = `${slot.name} copy ${round}`;

            rig.slots.push({ ...slot, name });
            skin[name] = skin[slot.name];
            added += 4;
        }
    }
    mkdirSync(join(dir, '4.3'), { recursive: true });
    writeFileSync(join(dir, '4.3', file), JSON.stringify(rig));

    return file;
}

/** A scene whose every frame is captured: a stale picture can show in any of them. */
const everyFrame = (steps, more = {}) => ({ steps, captures: count(steps), ...more });

/**
 * A skeleton that rests for many frames and then plays again, one that never played and then
 * plays once, and one that rests from the start and then loops. This scene holds the tooling
 * proof: a side that leaves the update of one frame out while two of the three move.
 */
function wakeScene(rigs) {
    const speedy = use(rigs, '4.3/speedy-ess', 'run');
    const raptor = use(rigs, '4.3/raptor-pro', 'gun-grab');

    return scene(
        'sleep-wake',
        'three skeletons rest and wake: one plays to its end, rests and plays again, one never played and plays once, one rests and then loops',
        '4.3',
        { a: speedy, b: raptor },
        [
            spine('a', 'a', speedy, {
                cx: 150,
                cy: 256,
                size: 230,
                loop: false,
                time: round(speedy.duration - 0.2, 4),
            }),
            spine('b', 'b', raptor, { cx: 256, cy: 270, size: 300, play: false }),
            spine('c', 'a', speedy, {
                cx: 370,
                cy: 250,
                size: 230,
                loop: false,
                time: round(speedy.duration + 0.3, 4),
            }),
        ],
        everyFrame(30, {
            events: [
                { step: 8, op: 'play', name: 'b', animation: 'gun-grab', loop: false },
                { step: 12, op: 'play', name: 'a', animation: 'run', loop: false },
                { step: 20, op: 'play', name: 'c', animation: 'run-linear', loop: true },
            ],
            // at this step `a` runs and `b` grabs its gun: a frame held back is a stale picture
            proof: { hold: { step: 16 } },
        }),
    );
}

/** Skeletons that rest below a parent that moves, turns and changes its size from frame to frame. */
function parentScene(rigs) {
    const speedy = use(rigs, '4.2/speedy-ess', 'run');
    const raptor = use(rigs, '4.2/raptor-pro', 'roar');
    const moves = count(15).map((i) => ({
        step: i + 1,
        op: 'shift',
        group: 'holder',
        x: round(20 * Math.sin((i + 1) * 0.7), 2),
        y: round(14 * Math.cos((i + 1) * 0.45), 2),
        ...(i === 5 ? { rotation: 0.1 } : i === 9 ? { scale: 0.9 } : i === 12 ? { rotation: 0, scale: 1 } : {}),
    }));

    return scene(
        'sleep-parent-moves',
        'three skeletons rest below a parent that moves in every frame, next to one that plays',
        '4.2',
        { a: speedy, b: raptor },
        [
            {
                type: 'group',
                name: 'holder',
                children: [
                    spine('p0', 'a', speedy, {
                        cx: 170,
                        cy: 230,
                        size: 230,
                        loop: false,
                        time: round(speedy.duration + 0.2, 4),
                    }),
                    spine('p1', 'b', raptor, { cx: 256, cy: 260, size: 300, play: false }),
                    spine('p2', 'a', speedy, {
                        cx: 340,
                        cy: 240,
                        size: 230,
                        loop: false,
                        time: round(speedy.duration + 0.4, 4),
                    }),
                ],
            },
            spine('free', 'a', speedy, { cx: 256, cy: 380, size: 200, at: 0.3 }),
        ],
        everyFrame(16, { events: moves }),
    );
}

/** Skeletons of one rig in one batch: some rest while their neighbours play, then they change roles. */
function neighbourScene(rigs) {
    const speedy = use(rigs, '4.3/speedy-ess', 'run');
    const at = (index) => ({ cx: 130 + index * 85, cy: 256 + (index % 2 ? 30 : -30), size: 240 });

    return scene(
        'sleep-neighbour',
        'four skeletons of one rig share a batch: two rest while their neighbours play, then one wakes and one comes to rest',
        '4.3',
        { a: speedy },
        [
            spine('n0', 'a', speedy, { ...at(0), loop: false, time: round(speedy.duration + 0.3, 4) }),
            spine('n1', 'a', speedy, { ...at(1), at: 0.4 }),
            spine('n2', 'a', speedy, { ...at(2), play: false }),
            spine('n3', 'a', speedy, { ...at(3), loop: false, time: round(speedy.duration - 0.3, 4) }),
        ],
        everyFrame(20, {
            events: [
                { step: 10, op: 'play', name: 'n0', animation: 'run', loop: true },
                { step: 14, op: 'play', name: 'n2', animation: 'run-rough', loop: false },
            ],
        }),
    );
}

/**
 * Skeletons that are not drawn while they change, and are shown later: with `visible`, with
 * `renderable` and by leaving the stage. The frame that shows them again must hold the pose of
 * that frame, not the one they were hidden with.
 */
function hiddenScene(rigs) {
    const speedy = use(rigs, '4.2/speedy-ess', 'run');
    const raptor = use(rigs, '4.2/raptor-pro', 'roar');

    return scene(
        'sleep-hidden',
        'skeletons play while they are hidden, not renderable or off the stage, and are shown again. One rests while it is hidden',
        '4.2',
        { a: speedy, b: raptor },
        [
            spine('h0', 'a', speedy, { cx: 140, cy: 210, size: 230, at: 0.1 }),
            spine('h1', 'b', raptor, { cx: 256, cy: 250, size: 300, at: 0.5 }),
            spine('h2', 'a', speedy, { cx: 370, cy: 220, size: 230, at: 0.7 }),
            spine('h3', 'a', speedy, {
                cx: 256,
                cy: 380,
                size: 200,
                loop: false,
                time: round(speedy.duration + 0.2, 4),
            }),
        ],
        everyFrame(16, {
            events: [
                { step: 3, op: 'set', name: 'h0', visible: false },
                { step: 3, op: 'set', name: 'h1', renderable: false },
                { step: 3, op: 'remove', name: 'h2' },
                { step: 5, op: 'set', name: 'h3', visible: false },
                { step: 9, op: 'set', name: 'h0', visible: true },
                { step: 10, op: 'set', name: 'h1', renderable: true },
                { step: 11, op: 'insert', name: 'h2', index: 2 },
                { step: 12, op: 'set', name: 'h3', visible: true },
            ],
        }),
    );
}

/** Skeletons at rest whose skin, tint, alpha or render mode changes: no pose moves, the picture does. */
function changeScene(rigs) {
    const speedy = use(rigs, '4.2/speedy-ess', 'run');
    const goblin = use(rigs, '4.2/goblins-pro', 'walk', 'goblin');
    const rest = (rig, more = 0.2) => ({ loop: false, time: round(rig.duration + more, 4) });

    return scene(
        'sleep-change',
        'skeletons rest while their skin, their tint, their alpha and their render mode change',
        '4.2',
        { a: speedy, b: goblin },
        [
            spine('g0', 'b', goblin, { cx: 150, cy: 230, size: 260, ...rest(goblin, 0.3) }),
            spine('s1', 'a', speedy, { cx: 270, cy: 200, size: 220, ...rest(speedy) }),
            spine('s2', 'a', speedy, { cx: 380, cy: 250, size: 220, play: false }),
            spine('s3', 'a', speedy, { cx: 256, cy: 370, size: 220, ...rest(speedy, 0.4) }),
        ],
        everyFrame(18, {
            events: [
                { step: 3, op: 'skin', name: 'g0', skin: 'goblingirl' },
                { step: 5, op: 'set', name: 's1', tint: 0xff8080 },
                { step: 7, op: 'mode', name: 's2', mode: 'mesh' },
                { step: 9, op: 'set', name: 's3', alpha: 0.5 },
                { step: 11, op: 'set', name: 's1', tint: 0xffffff },
                { step: 13, op: 'mode', name: 's2', mode: 'batched' },
                { step: 15, op: 'skin', name: 'g0', skin: 'goblin' },
                { step: 16, op: 'set', name: 's3', alpha: 1 },
            ],
        }),
    );
}

/** Skeletons that are destroyed while they rest, between two that play on. */
function destroyScene(rigs) {
    const speedy = use(rigs, '4.3/speedy-ess', 'run');
    const raptor = use(rigs, '4.3/raptor-pro', 'roar');

    return scene(
        'sleep-destroy',
        'two skeletons are destroyed while they rest, one after an animation and one that never played. Two others play on',
        '4.3',
        { a: speedy, b: raptor },
        [
            spine('d0', 'a', speedy, {
                cx: 150,
                cy: 230,
                size: 230,
                loop: false,
                time: round(speedy.duration + 0.2, 4),
            }),
            spine('d1', 'a', speedy, { cx: 240, cy: 270, size: 230, at: 0.2 }),
            spine('d2', 'b', raptor, { cx: 300, cy: 240, size: 300, play: false }),
            spine('d3', 'a', speedy, { cx: 380, cy: 280, size: 230, at: 0.6 }),
        ],
        everyFrame(14, {
            events: [
                { step: 4, op: 'destroy', name: 'd0' },
                { step: 8, op: 'destroy', name: 'd2' },
            ],
        }),
    );
}

/** The scenes about skeletons that rest and wake. Every frame of each is compared. */
export function sleepScenes(rigs) {
    return [wakeScene, parentScene, neighbourScene, hiddenScene, changeScene, destroyScene].map((make) => make(rigs));
}

/**
 * The scenes about the mesh mode that loads on demand.
 *
 *   lazy-never    small rigs with the default options, which draw in a batch. The page must not
 *                 ask for the code of the mesh mode
 *   lazy-first    a rig that `auto` draws with meshes, written at run time. Its first frame
 *                 must be drawn in the mesh mode: the code has to be there when the asset has
 *                 loaded
 *   lazy-switch   a small rig, of which one instance asks for the mesh mode while it plays. It
 *                 must draw in every frame until that mode is there, and then in it
 *   lazy-create   the same for an instance that asks for the mesh mode when it is created, with
 *                 an asset that was not loaded for that mode: its first frames are batched
 */
export function lazyScenes(rigs, { root, made }) {
    const speedy = use(rigs, '4.2/speedy-ess', 'run');
    const goblin = use(rigs, '4.2/goblins-pro', 'walk', 'goblin');
    const large = {
        ...use(rigs, '4.3/raptor-pro', 'walk'),
        id: `4.3/raptor-pro with ${MORE_VERTICES} more vertices`,
        skel: writeLargeRig(root, made),
    };
    const row = (rig, key, index, more = {}) =>
        spine(`i${index}`, key, rig, {
            cx: 150 + index * 105,
            cy: 256 + (index % 2 ? 25 : -25),
            size: 250,
            at: index * 0.23,
            ...more,
        });

    return [
        scene(
            'lazy-never',
            'small rigs with the default options: nothing here needs the mesh mode',
            '4.2',
            { a: speedy, b: goblin },
            [row(speedy, 'a', 0), row(goblin, 'b', 1), row(speedy, 'a', 2)],
            { steps: 8, captures: [0, 4, 7], lazy: 'never' },
        ),
        scene(
            'lazy-first',
            'a rig above the limit of auto, which draws with meshes: its first frame must be drawn in the mesh mode',
            '4.3',
            { a: large },
            [
                spine('i0', 'a', large, { cx: 190, cy: 256, size: 380, at: 0.1 }),
                spine('i1', 'a', large, { cx: 330, cy: 256, size: 380, at: 0.6 }),
            ],
            { steps: 6, captures: [0, 3, 5], lazy: 'first' },
        ),
        scene(
            'lazy-switch',
            'one of three small skeletons asks for the mesh mode while it plays: it must draw in every frame',
            '4.2',
            { a: speedy },
            [row(speedy, 'a', 0), row(speedy, 'a', 1), row(speedy, 'a', 2)],
            {
                ...everyFrame(Math.round(0.7 / DT)),
                events: [{ step: 3, op: 'mode', name: 'i1', mode: 'mesh' }],
                lazy: 'switch',
            },
        ),
        scene(
            'lazy-create',
            'one of three small skeletons asks for the mesh mode when it is created, and its asset was not loaded for it',
            '4.2',
            { a: speedy },
            [row(speedy, 'a', 0), row(speedy, 'a', 1, { mode: 'mesh', preload: false }), row(speedy, 'a', 2)],
            { ...everyFrame(Math.round(0.7 / DT)), lazy: 'create' },
        ),
    ];
}
