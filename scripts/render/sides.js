/*
 * Browser part of scripts/check-render.mjs: the official Pixi runtime and pixi-marrow behind one
 * small interface, so a case drives both with the same calls.
 *
 * An instance has: `view` (the display object), `root` (a container that holds the object alone
 * until a scene puts it somewhere else), `place`, `setSkin`, `play` (which loops unless it is
 * told not to), `setMode`, `update`, `stats` and `destroy`. Official instances also have `tint` and `hide`, which the tooling proof uses to make
 * a picture wrong on purpose. Ours also has `info`, `outlines`, `mode` and `spine`, which is the
 * display object once more.
 *
 * `hold` hangs a Pixi `Graphics` on an instance and `release` takes it off again. With a `slot`
 * it is drawn at the place of that slot in the draw order: `addSlotObject` of the official
 * runtime, `attach` of ours. With a `bone` it is a child of the display object that gets the
 * transform of that bone after every update: `follow` of ours. The official runtime has no call
 * for that, so its side writes the matrix `addSlotObject` writes, from that bone.
 *
 * Both sides run as they ship: every constraint is solved, physics and sliders included.
 * Physics has state, so a picture depends on every update since the object was made. The
 * two sides therefore get the same updates from the same start, see `officialSide`.
 */
import { modeOptions, readMode } from './mode.js';

function place(view, { x, y, scale, rotation = 0 }) {
    view.position.set(x, y);
    view.scale.set(scale);
    view.rotation = rotation;
}

/** What `hold` hangs on an instance: a circle with a `radius`, else a rectangle, of one color, in the units of the bone. */
function makeHeld(PIXI, shape) {
    const graphics = new PIXI.Graphics();

    if (shape.radius) graphics.circle(shape.x ?? 0, shape.y ?? 0, shape.radius);
    else graphics.rect(shape.x, shape.y, shape.width, shape.height);

    return graphics.fill({ color: shape.color, alpha: shape.alpha ?? 1 });
}

/**
 * The official runtime of one Spine version. `lib` is the loaded `@esotericsoftware/spine-pixi-v8`.
 *
 * A display object of pixi-marrow runs one update of 0 seconds when it is created, to show the
 * setup pose. The official one runs none until it is asked, or until its bounds are read. A
 * physics constraint takes its start from the pose of its first update. When the next pose turns
 * its bone, it swings by a part of that turn, even after 0 seconds. So the official object gets
 * the same first update here, before a skin is set or an animation plays. From there on a case
 * steps both sides alike.
 */
export function officialSide(PIXI, lib) {
    return {
        name: 'official',
        async create({ skeleton, atlas }) {
            await PIXI.Assets.load([skeleton, atlas]);
            const spine = lib.Spine.from({ skeleton, atlas, autoUpdate: false });
            const root = new PIXI.Container();
            // what the tooling proof changes after every update, since an animation can key the same values
            const changes = [];
            // the objects of `hold`, by key, and the ones that follow a bone: those are moved after every update
            const held = new Map();
            const followers = new Map();
            const matrix = new PIXI.Matrix();
            const follow = (shape, bone) => {
                // 4.3 keeps the world transform in the applied pose of the bone
                const pose = bone.appliedPose ?? bone;

                // what `addSlotObject` writes for the bone of a slot
                shape.setFromMatrix(matrix.set(pose.a, pose.c, -pose.b, -pose.d, pose.worldX, pose.worldY));
            };
            const slotColor = (name) => {
                const slot = spine.skeleton.findSlot(name);

                if (!slot) throw new Error(`The official skeleton has no slot ${name}`);

                // 4.3 keeps the color in the pose of the slot
                return slot.pose?.color ?? slot.color;
            };

            root.addChild(spine);

            return {
                view: spine,
                root,
                place: (placement) => place(spine, placement),
                setSkin(name) {
                    if (Array.isArray(name)) {
                        // several skins at once: an empty skin that `addSkin` fills with each, as code with the official runtime does it
                        const skin = new lib.Skin('combined');

                        for (const each of name) skin.addSkin(spine.skeleton.data.findSkin(each));
                        spine.skeleton.setSkin(skin);
                    } else spine.skeleton.setSkinByName(name);
                    if (spine.skeleton.setupPoseSlots) spine.skeleton.setupPoseSlots();
                    else spine.skeleton.setSlotsToSetupPose();
                },
                play: (name, loop = true) => spine.state.setAnimation(0, name, loop),
                // the official runtime has one way to draw
                setMode() {},
                update(seconds) {
                    spine.update(seconds);
                    for (const change of changes) change();
                    for (const [shape, bone] of followers) follow(shape, bone);
                },
                hold({ key, slot, bone, shape: look }) {
                    const shape = makeHeld(PIXI, look);

                    held.set(key, shape);
                    if (slot) spine.addSlotObject(slot, shape);
                    else {
                        const found = spine.skeleton.findBone(bone);

                        if (!found) throw new Error(`The official skeleton has no bone ${bone}`);
                        spine.addChild(shape);
                        followers.set(shape, found);
                        follow(shape, found);
                    }
                },
                release(key) {
                    const shape = held.get(key);

                    if (followers.delete(shape)) spine.removeChild(shape);
                    else spine.removeSlotObject(shape);
                    held.delete(key);
                    shape.destroy();
                },
                tint(name, factor) {
                    let base = 1;
                    let written = Number.NaN;

                    changes.push(() => {
                        const color = slotColor(name);

                        // a value other than the one written last came from the animation
                        if (color.r !== written) base = color.r;
                        written = base * factor;
                        color.r = written;
                    });
                },
                hide(name) {
                    changes.push(() => {
                        slotColor(name).a = 0;
                    });
                },
                stats: () => null,
                destroy() {
                    // a scene may have put the object under another parent, or have destroyed it already
                    if (!spine.destroyed) spine.destroy({ children: true });
                    root.destroy();
                },
            };
        },
    };
}

/** The options of a display object of ours for each way to cut overdraw. */
const CUT_OPTIONS = {
    default: {},
    off: { tightMesh: 'off', occlusion: 'off' },
    polygons: { tightMesh: 'on' },
};

/** Per asset of ours: the milliseconds from the end of its load to the end of the scan of its pages. */
const scans = new WeakMap();

/** Resolves once the code of ours for attached containers is loaded. One per page. */
let attachCode = null;

/**
 * Loads the code of ours that draws attached containers. It loads with the first `attach` of a
 * page, and a container is hidden until it is there. The runtime has no call that waits for it.
 * So an instance nobody draws attaches a container and updates until the container has a
 * parent. The instances of a scene then get no update the official side does not get.
 */
function loadAttachCode(PIXI, lib, asset, slot) {
    attachCode ??= (async () => {
        const probe = new lib.MarrowSpine(asset, { autoUpdate: false });
        const container = new PIXI.Container();

        probe.attach(slot, container);
        for (let tries = 0; container.parent === null; tries++) {
            if (tries > 1000) throw new Error('the code for attached containers did not load');
            await new Promise((next) => setTimeout(next, 10));
            probe.update(0);
        }
        probe.destroy();
        container.destroy();
    })();

    return attachCode;
}

/**
 * pixi-marrow. `lib` is the loaded package, which must export `MarrowSpine`.
 *
 * An instance is created with the defaults, so the exact cuts of overdraw are on: covered slots
 * are skipped and a region without a visible pixel is not drawn. `cuts: 'off'` creates it with
 * both off. That is the picture the cuts must not change. `cuts: 'polygons'` also draws every
 * region as the polygon around its visible pixels, which is not exact to the bit.
 *
 * `mode` asks for a render mode by name: `mesh` or `batched`. Without it the instance is created
 * with the default, which is `auto`. `instance.mode()` reads back what the runtime drew in.
 *
 * `idle: true` creates it with `idleCache: 'auto'`: at rest it draws itself into an image and
 * shows that. `instance.cached()` says whether it shows the image now.
 *
 * The code of the mesh mode is a chunk that loads on demand. An asset loads it when `auto` draws
 * its skeleton with meshes, and when the load asks for the mesh mode. So an instance that asks
 * for the mesh mode by name gets an asset that was loaded for it: the same shared asset, once
 * more, which waits for the chunk. Without that the instance would draw in a batch until the
 * chunk arrives. `preload: false` leaves that load out, for a scene about that path.
 *
 * `skinning` is the `skinning` option of every instance, `gpu` for example, or null for none.
 *
 * `instancing: 'off'` draws a mesh instance alone, where it would draw instanced with
 * `skinning: 'gpu'`. Without it the instance has the default, which is `auto`.
 *
 * `bake: 'auto'` plays from baked frames where it can. The code of baked playback is a chunk
 * too, and the instance plays without it until it is there, so `create` waits for it.
 */
export function oursSide(PIXI, lib, skinning = null) {
    return {
        name: 'ours',
        async create({ skeleton, atlas, cuts = 'default', mode, preload = true, idle = false, bake, instancing }) {
            // outlines are off by default: the check asks for the scan, so that the cuts of
            // overdraw are part of every comparison with the official runtime
            const asset = await lib.MarrowAsset.load({
                skeleton,
                atlas,
                outlines: 'auto',
                ...(mode === 'mesh' && preload ? { renderMode: 'mesh' } : {}),
            });

            // the outlines are read from the page images in idle time. From here on every instance has them
            const waited = performance.now();

            await asset.optimized;
            // the first instance of an asset waits for the scan, idle time included
            if (!scans.has(asset)) scans.set(asset, performance.now() - waited);
            const spine = new lib.MarrowSpine(asset, {
                autoUpdate: false,
                ...CUT_OPTIONS[cuts],
                ...modeOptions(mode),
                ...(idle ? { idleCache: 'auto' } : {}),
                ...(skinning ? { skinning } : {}),
                ...(bake ? { bake } : {}),
                // instancing is in no preset: a side with skinning on the GPU names it, as it was the
                // default when the check was written, and a side that draws alone turns it off
                ...(instancing ? { instancing } : skinning === 'gpu' ? { instancing: 'auto' } : {}),
            });

            for (let tries = 0; bake && spine.engine.source === null; tries++) {
                if (tries > 1000) throw new Error('the code of baked playback did not load');
                await new Promise((next) => setTimeout(next, 10));
            }
            const root = new PIXI.Container();
            const held = new Map();

            root.addChild(spine);

            return {
                view: spine,
                root,
                spine,
                async hold({ key, slot, bone, shape: look }) {
                    const shape = makeHeld(PIXI, look);

                    held.set(key, { shape, slot });
                    if (slot) {
                        await loadAttachCode(PIXI, lib, asset, slot);
                        spine.attach(slot, shape);
                    } else {
                        spine.addChild(shape);
                        spine.follow(bone, shape);
                    }
                },
                release(key) {
                    const { shape, slot } = held.get(key);

                    if (slot) spine.detach(shape);
                    else {
                        spine.unfollow(shape);
                        spine.removeChild(shape);
                    }
                    held.delete(key);
                    shape.destroy();
                },
                /** The render mode the runtime reports for this instance, see scripts/render/mode.js. */
                mode: () => readMode(spine),
                /** Whether the instance shows the image of its idle cache: its sprite of that label shows. */
                cached: () => spine.children.some((child) => child.label === 'marrow-idle' && child.visible),
                place: (placement) => place(spine, placement),
                setSkin(name) {
                    if (Array.isArray(name)) spine.skins = name;
                    else spine.skin = name;
                },
                play: (name, loop = true) => spine.play(name, { loop, track: 0 }),
                /** Asks for another render mode at run time: `auto`, `mesh` or `batched`. */
                setMode(mode) {
                    spine.renderMode = mode;
                },
                update: (seconds) => spine.update(seconds),
                stats: () => (spine.stats ? { ...spine.stats } : null),
                /** The updates that played baked, those the engine posed, and why the last one did. Null without `bake`. */
                baked: () => {
                    const source = spine.engine.source;

                    return source ? { baked: source.baked, unbaked: source.unbaked, last: source.last } : null;
                },
                info: () => spine.info ?? null,
                /** How many regions of the atlas have a polygon, an opaque rectangle or no outline at all. */
                outlines() {
                    const regions = asset.outlines?.regions ?? [];

                    return {
                        pages: asset.atlas.pages.length,
                        scanMs: scans.get(asset) ?? 0,
                        regions: regions.length,
                        polygons: regions.filter((region) => region?.polygon).length,
                        opaque: regions.filter((region) => region?.opaque).length,
                        unread: regions.filter((region) => region === null).length,
                    };
                },
                destroy() {
                    // a scene may have put the object under another parent, or have destroyed it already
                    if (!spine.destroyed) spine.destroy();
                    // ours lets go of what it holds and destroys none of it
                    for (const { shape } of held.values()) shape.destroy();
                    held.clear();
                    root.destroy();
                },
            };
        },
    };
}
