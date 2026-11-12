/**
 * The scenes of the render check: stages with several instances, described as plain data. The
 * browser part builds each scene once per side and compares the pictures, see
 * scripts/render/scenes.js. A single rig proves that a skeleton is drawn right. A scene proves
 * that drawing many of them together changes nothing: the order of the objects, what their
 * parents do to them, and what happens when the stage changes between two frames.
 *
 * A scene names the official runtime it is compared with. The two official runtimes register the
 * same Pixi extensions, so a page holds one of them and a scene uses rigs of one Spine version.
 * The scene with rigs of two versions has no official picture: there the batched mode of ours is
 * judged against the mesh mode.
 *
 * A node of a scene is one of:
 *
 *   spine     an instance of a rig: `rig` is a key of `rigs`, `x`, `y`, `scale` and `rotation`
 *             place it, `time` is where in its animation it starts. `visible` and `renderable`
 *             set those flags. `mode` asks for a render mode on the batched side
 *   group     a container with `children`, and any of `alpha`, `tint`, `mask`, `filter`,
 *             `renderGroup` and a transform
 *   graphics  a rectangle of one color
 *   sprite    a tinted sprite
 *
 * An event changes the stage before the update of its step: `add` a node at an index, `remove`
 * an instance from the stage, `insert` it again, `move` it in the child list, `set` its flags or
 * `destroy` it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Width and height of the picture of a scene in pixels. */
const SIZE = 512;
/** Seconds every instance advances per frame. No multiple of 1/30 second, where exports put their keys. */
const DT = 0.0437;
/** Frames a scene plays, and the ones after which every side is captured. */
const STEPS = 16;
const CAPTURES = [0, 6, 15];

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const count = (length) => Array.from({ length }, (_, index) => index);
/** Where in its loop the instance with an index starts, as a share: no two start at the same pose. */
const phase = (index) => (index * 0.618034) % 1;

/** What a scene needs of a rig of the plan, playing one animation with one skin. */
function use(rigs, id, animation, skin = null) {
    const rig = rigs.find((entry) => entry.id === id);

    if (!rig) throw new Error(`the scenes need the rig ${id}`);
    if (rig.durations[animation] === undefined) throw new Error(`${id} has no animation ${animation}`);
    if (skin && !rig.skins.includes(skin)) throw new Error(`${id} has no skin ${skin}`);

    return {
        id,
        version: rig.version,
        skel: rig.files.skel,
        atlas: rig.files.atlas,
        skin,
        animation,
        duration: rig.durations[animation],
        frame: rig.frame,
        additive: rig.additive,
        features: rig.features,
    };
}

/**
 * An instance node. The frame of the rig is `size` pixels in its larger dimension, and its center
 * is at `cx`, `cy` whatever the rotation.
 *
 * @param key The key of the rig in `rigs` of the scene.
 * @param at Where in the loop of the animation the instance starts, from 0 to 1.
 */
function spine(name, key, rig, { cx, cy, size, rotation = 0, at = 0, ...flags }) {
    const [x, y, width, height] = rig.frame;
    const scale = round(size / Math.max(width, height), 4);
    // the center of the frame in the units of the object. Skeletons are drawn with y down
    const ox = (x + width / 2) * scale;
    const oy = -(y + height / 2) * scale;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return {
        type: 'spine',
        name,
        rig: key,
        x: round(cx - (ox * cos - oy * sin), 2),
        y: round(cy - (ox * sin + oy * cos), 2),
        scale,
        rotation,
        time: round(at * rig.duration, 4),
        ...flags,
    };
}

/** A scene with the defaults: 16 frames, three of them captured, judged against the official runtime. */
function scene(id, title, official, rigs, nodes, more = {}) {
    return {
        id: `scene/${id}`,
        title,
        official,
        // what ours is judged against, and why that is not the official runtime
        reference: official ? 'official' : 'mesh',
        why: '',
        size: SIZE,
        rigs,
        nodes,
        dt: DT,
        steps: STEPS,
        captures: CAPTURES,
        events: [],
        proof: null,
        // true for a scene that looks for a limit: what it finds does not fail the check
        limit: false,
        // with additive slots the alpha of a transparent target differs from the official one by design
        additive: Object.values(rigs).some((rig) => rig.additive),
        ...more,
    };
}

/** Instances of two rigs in turns along a line, each over its neighbors. `a` comes first. */
function inTurns(a, b, length, more = () => ({})) {
    return count(length).map((i) =>
        spine(`i${i}`, i % 2 ? 'b' : 'a', i % 2 ? b : a, {
            cx: 256 + (i - (length - 1) / 2) * 50,
            cy: 256 + (i % 2 ? 36 : -36),
            size: i % 2 ? 250 : 300,
            rotation: round((i - (length - 1) / 2) * 0.06, 3),
            at: phase(i),
            ...more(i),
        }),
    );
}

/** Three instances of two rigs over each other around a point, for the scenes about a parent. */
function trio(a, b, cx, cy, prefix = 'g') {
    return [
        spine(`${prefix}0`, 'a', a, { cx: cx - 70, cy: cy - 10, size: 280, rotation: -0.1, at: phase(1) }),
        spine(`${prefix}1`, 'b', b, { cx, cy: cy + 20, size: 230, rotation: 0.05, at: phase(2) }),
        spine(`${prefix}2`, 'a', a, { cx: cx + 70, cy: cy + 5, size: 260, rotation: 0.12, at: phase(3) }),
    ];
}

/**
 * Writes a rig with screen slots, which no example rig has: the powerup of Spine 4.3 with every
 * second star changed from additive to screen. The file goes to `dir`, which the page server
 * serves like fixtures/.cache.
 */
function writeScreenRig(root, dir) {
    const file = 'powerup-screen.json';
    const rig = JSON.parse(readFileSync(join(root, 'fixtures/.cache/4.3/powerup-pro.json'), 'utf8'));
    let changed = 0;

    for (const [index, slot] of rig.slots.filter((entry) => entry.blend === 'additive').entries()) {
        if (index % 2 === 0) continue;
        slot.blend = 'screen';
        changed++;
    }
    if (changed === 0) throw new Error('the powerup rig has no additive slot to turn into a screen slot');
    mkdirSync(join(dir, '4.3'), { recursive: true });
    writeFileSync(join(dir, '4.3', file), JSON.stringify(rig));

    return file;
}

/** The scenes about many instances and about the order they are drawn in. */
function orderScenes(rigs) {
    const raptor42 = use(rigs, '4.2/raptor-pro', 'roar');
    const speedy42 = use(rigs, '4.2/speedy-ess', 'run');
    const raptor43 = use(rigs, '4.3/raptor-pro', 'roar');
    const speedy43 = use(rigs, '4.3/speedy-ess', 'run');
    const goblin = use(rigs, '4.2/goblins-pro', 'walk', 'goblin');
    const alien = use(rigs, '4.3/alien-pro', 'run');
    const crowd = count(12).map((i) =>
        spine(`i${i}`, 'a', raptor43, {
            cx: 80 + (i % 4) * 117,
            cy: 120 + Math.floor(i / 4) * 136,
            size: 190 + (i % 3) * 35,
            rotation: round((((i * 7) % 5) - 2) * 0.15, 3),
            at: phase(i),
        }),
    );

    return [
        scene(
            'crowd',
            '12 instances of one rig overlap, at different places, sizes, angles and times of an animation with draw order and attachment keys',
            '4.3',
            { a: raptor43 },
            crowd,
        ),
        scene(
            'interleaved',
            'instances of two rigs take turns in the draw order',
            '4.2',
            { a: raptor42, b: speedy42 },
            inTurns(raptor42, speedy42, 6),
            // the tooling proof: these two lie over each other, so the picture changes when they swap
            { proof: { swap: ['i2', 'i3'] } },
        ),
        scene(
            'mixed-modes',
            'the same stage, and on the batched side every first rig asks for the mesh mode: instances of both modes take turns',
            '4.2',
            { a: raptor42, b: speedy42 },
            inTurns(raptor42, speedy42, 6, (i) => (i % 2 ? {} : { mode: 'mesh' })),
        ),
        scene(
            'versions',
            'a rig of Spine 4.2 and a rig of Spine 4.3 take turns in one stage',
            null,
            { a: goblin, b: alien },
            inTurns(goblin, alien, 6),
            { why: 'the two official runtimes cannot share one Pixi app' },
        ),
        scene(
            'between',
            'a graphics object and a sprite lie between two instances in the draw order and overlap both',
            '4.3',
            { a: raptor43, b: speedy43 },
            [
                spine('below', 'a', raptor43, { cx: 200, cy: 250, size: 340, at: phase(1) }),
                { type: 'graphics', x: 150, y: 170, width: 210, height: 150, color: 0x2266ff, alpha: 0.8 },
                spine('middle', 'b', speedy43, { cx: 256, cy: 300, size: 220, at: phase(2) }),
                { type: 'sprite', x: 230, y: 140, width: 110, height: 230, rotation: 0.2, color: 0xffcc00, alpha: 0.9 },
                spine('above', 'a', raptor43, { cx: 315, cy: 275, size: 340, rotation: 0.1, at: phase(3) }),
            ],
        ),
    ];
}

/** The scenes about what a parent does to the instances below it, and about instances that do not draw. */
function parentScenes(rigs) {
    const raptor42 = use(rigs, '4.2/raptor-pro', 'roar');
    const speedy42 = use(rigs, '4.2/speedy-ess', 'run');
    const raptor43 = use(rigs, '4.3/raptor-pro', 'roar');
    const speedy43 = use(rigs, '4.3/speedy-ess', 'run');
    const outside = (name, rig, cx, cy) => spine(name, 'b', rig, { cx, cy, size: 240, at: phase(5) });

    return [
        scene(
            'parent-alpha-tint',
            'three instances below a parent with alpha 0.6 and a tint, and one beside it',
            '4.2',
            { a: raptor42, b: speedy42 },
            [
                { type: 'group', alpha: 0.6, tint: 0xff9966, children: trio(raptor42, speedy42, 240, 230) },
                outside('free', speedy42, 300, 330),
            ],
        ),
        scene(
            'parent-mask',
            'three instances below a parent with a circle as its Pixi mask, and one beside it',
            '4.3',
            { a: raptor43, b: speedy43 },
            [
                outside('free', speedy43, 150, 380),
                { type: 'group', mask: { circle: [256, 250, 150] }, children: trio(raptor43, speedy43, 256, 250) },
            ],
        ),
        scene(
            'parent-filter',
            'three instances below a parent with an alpha filter, and one beside it',
            '4.2',
            { a: raptor42, b: speedy42 },
            [
                { type: 'group', filter: { alpha: 0.7 }, children: trio(raptor42, speedy42, 240, 230) },
                outside('free', speedy42, 300, 330),
            ],
        ),
        scene(
            'parent-render-group',
            'three instances below a parent that is a render group with a transform, between two instances of the stage',
            '4.3',
            { a: raptor43, b: speedy43 },
            [
                outside('before', speedy43, 170, 300),
                {
                    type: 'group',
                    renderGroup: true,
                    x: 30,
                    y: 20,
                    scale: 0.9,
                    rotation: 0.08,
                    children: trio(raptor43, speedy43, 256, 240),
                },
                outside('after', speedy43, 340, 320),
            ],
        ),
        scene(
            'hidden',
            'five instances over each other, one with visible = false and one with renderable = false',
            '4.2',
            { a: speedy42, b: raptor42 },
            inTurns(speedy42, raptor42, 5, (i) =>
                i === 1 ? { visible: false } : i === 3 ? { renderable: false } : {},
            ),
        ),
    ];
}

/** The scenes about what a rig brings into a batch: blend modes, dark tint, atlas pages and clips. */
function featureScenes(rigs, screenFile) {
    const speedy42 = use(rigs, '4.2/speedy-ess', 'run');
    const alien = use(rigs, '4.3/alien-pro', 'death');
    const chibi = use(rigs, '4.2/chibi-stickers', 'emotes/wave', 'spineboy');
    const dragon = use(rigs, '4.3/dragon-ess', 'flying');
    const coin = use(rigs, '4.2/coin-pro', 'animation');
    const tank = use(rigs, '4.2/tank-pro', 'shoot');
    const powerup = use(rigs, '4.3/powerup-pro', 'bounce');
    const screen = { ...powerup, id: '4.3/powerup-pro with screen slots', skel: screenFile };
    const four = (rig, size) =>
        count(4).map((i) =>
            spine(`i${i}`, 'a', rig, {
                cx: 180 + (i % 2) * 150 + (i > 1 ? 20 : 0),
                cy: 190 + Math.floor(i / 2) * 130,
                size,
                rotation: round((i - 1.5) * 0.1, 3),
                at: phase(i),
            }),
        );

    return [
        scene(
            'additive-dark-tint',
            'four instances of a rig with additive slots and dark tint',
            '4.3',
            { a: alien },
            four(alien, 300),
        ),
        scene(
            'multiply-pages',
            'four instances of a rig with a multiply slot and ten atlas pages',
            '4.2',
            { a: chibi },
            four(chibi, 300),
        ),
        scene(
            'pages',
            'four instances of a rig of regions on six atlas pages, with sequences',
            '4.3',
            { a: dragon },
            four(dragon, 320),
        ),
        scene(
            'screen',
            'four instances of a rig with normal, additive and screen slots',
            '4.3',
            { a: screen },
            four(screen, 300),
        ),
        scene(
            'clip',
            'a rig with a clip, dark tint and additive slots takes turns with a plain rig',
            '4.2',
            { a: coin, b: speedy42 },
            inTurns(coin, speedy42, 6),
        ),
        scene(
            'tank',
            'two instances of the largest rig: a clip, dark tint, additive and multiply slots',
            '4.2',
            { a: tank },
            [
                spine('i0', 'a', tank, { cx: 256, cy: 200, size: 480, at: phase(1) }),
                spine('i1', 'a', tank, { cx: 230, cy: 320, size: 380, rotation: -0.05, at: phase(2) }),
            ],
        ),
    ];
}

/** The scene whose stage changes between frames. Every change is drawn and compared. */
function changeScene(rigs) {
    const raptor = use(rigs, '4.3/raptor-pro', 'roar');
    const speedy = use(rigs, '4.3/speedy-ess', 'run');
    const at = (name, key, rig, cx, cy, size) => spine(name, key, rig, { cx, cy, size, at: phase(cx / 10) });
    const events = [
        { step: 1, op: 'add', index: 2, node: at('e', 'b', speedy, 256, 300, 260) },
        { step: 2, op: 'remove', name: 'b' },
        { step: 3, op: 'move', name: 'd', index: 0 },
        { step: 4, op: 'set', name: 'c', visible: false },
        { step: 5, op: 'set', name: 'c', visible: true },
        { step: 6, op: 'insert', name: 'b', index: 1 },
        { step: 7, op: 'destroy', name: 'a' },
        { step: 8, op: 'set', name: 'e', renderable: false },
        { step: 9, op: 'set', name: 'e', renderable: true },
    ];

    return scene(
        'changes',
        'between frames an instance is added, removed, moved in the child list, hidden, shown, put back and destroyed',
        '4.3',
        { a: raptor, b: speedy },
        [
            at('a', 'b', speedy, 170, 240, 250),
            at('b', 'a', raptor, 230, 270, 300),
            at('c', 'b', speedy, 290, 230, 250),
            at('d', 'a', raptor, 340, 280, 300),
        ],
        { events, steps: 11, captures: count(11) },
    );
}

/**
 * The scenes that look for a limit: 1200 instances in one stage. What they find is reported and
 * does not fail the check, and each render mode of ours runs on a page of its own, so that a mode
 * that throws cannot disturb the next one.
 *
 * In the mesh mode every draw of a mesh takes a slot in the batch of uniform buffers of Pixi. On
 * WebGPU that batch is one buffer of 65535 floats in slots of 128 bytes, read in pixi.js 8.23.0,
 * and Pixi throws when it is full. The coin draws four meshes per instance, two of them for its
 * clip mask, and the speedy rig draws one.
 */
function limitScenes(rigs) {
    const grid = (rig) =>
        count(1200).map((i) =>
            spine(`i${i}`, 'a', rig, {
                cx: round(8 + (i % 40) * 12.7, 2),
                cy: round(12 + Math.floor(i / 40) * 16.6, 2),
                size: 26,
                at: phase(i),
            }),
        );
    const coin = use(rigs, '4.2/coin-pro', 'animation');
    const speedy = use(rigs, '4.2/speedy-ess', 'run');
    const few = { steps: 3, captures: [0, 2], limit: true };

    return [
        scene('many-clipped', '1200 instances of a small rig with a clip', '4.2', { a: coin }, grid(coin), few),
        scene('many', '1200 instances of a small rig without a clip', '4.2', { a: speedy }, grid(speedy), few),
    ];
}

/**
 * The scenes to run, in a fixed order.
 *
 * @param options.root The repo root.
 * @param options.rigs The rigs `planRigs` returned, without a filter: a scene picks its rigs by id.
 * @param options.made A folder for the fixtures this plan writes. The page server serves it.
 */
export function planScenes({ root, rigs, made }) {
    const screenFile = writeScreenRig(root, made);

    return [
        ...orderScenes(rigs),
        ...parentScenes(rigs),
        ...featureScenes(rigs, screenFile),
        changeScene(rigs),
        ...limitScenes(rigs),
    ];
}
