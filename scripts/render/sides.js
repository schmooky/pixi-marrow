/*
 * Browser part of scripts/check-render.mjs: the official Pixi runtime and pixi-marrow behind one
 * small interface, so a case drives both with the same calls.
 *
 * An instance has: `view` (the display object), `root` (a container that holds the object alone
 * until a scene puts it somewhere else), `place`, `setSkin`, `play`, `update`, `stats` and
 * `destroy`. Official instances also have `tint` and `hide`, which the tooling proof uses to make
 * a picture wrong on purpose. Ours also has `info`, `outlines`, `mode` and `spine`, which is the
 * display object once more.
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
                    spine.skeleton.setSkinByName(name);
                    if (spine.skeleton.setupPoseSlots) spine.skeleton.setupPoseSlots();
                    else spine.skeleton.setSlotsToSetupPose();
                },
                play: (name) => spine.state.setAnimation(0, name, true),
                update(seconds) {
                    spine.update(seconds);
                    for (const change of changes) change();
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
 */
export function oursSide(PIXI, lib) {
    return {
        name: 'ours',
        async create({ skeleton, atlas, cuts = 'default', mode }) {
            const asset = await lib.MarrowAsset.load({ skeleton, atlas });

            // the outlines are read from the page images in idle time. From here on every instance has them
            const waited = performance.now();

            await asset.optimized;
            // the first instance of an asset waits for the scan, idle time included
            if (!scans.has(asset)) scans.set(asset, performance.now() - waited);
            const spine = new lib.MarrowSpine(asset, {
                autoUpdate: false,
                ...CUT_OPTIONS[cuts],
                ...modeOptions(mode),
            });
            const root = new PIXI.Container();

            root.addChild(spine);

            return {
                view: spine,
                root,
                spine,
                /** The render mode the runtime reports for this instance, see scripts/render/mode.js. */
                mode: () => readMode(spine),
                place: (placement) => place(spine, placement),
                setSkin(name) {
                    spine.skin = name;
                },
                play: (name) => spine.play(name, { loop: true, track: 0 }),
                update: (seconds) => spine.update(seconds),
                stats: () => (spine.stats ? { ...spine.stats } : null),
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
                    root.destroy();
                },
            };
        },
    };
}
