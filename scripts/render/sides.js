/*
 * Browser part of scripts/check-render.mjs: the official Pixi runtime and pixi-marrow behind one
 * small interface, so a case drives both with the same calls.
 *
 * An instance has: `root` (a container that holds the object alone), `place`, `setSkin`, `play`,
 * `update`, `stats` and `destroy`. Official instances also have `tint` and `hide`, which the
 * tooling proof uses to make a picture wrong on purpose. Ours also has `info`, `outlines` and
 * `spine`, the display object itself.
 */

/**
 * Switches off what pixi-marrow does not solve yet, the way the pose parity suite builds its
 * reference: physics constraints get `Physics.none`, which neither steps nor applies them, and
 * the sliders of 4.3 lose their update, which is what a mix of 0 does. IK, transform and path
 * constraints stay as they are, and so do all timelines.
 */
function switchOffPhysics(lib, skeleton) {
    const { updateWorldTransform } = lib.Skeleton.prototype;

    // the official display object asks for Physics.update in every update
    skeleton.updateWorldTransform = function update() {
        return updateWorldTransform.call(this, lib.Physics.none);
    };
    // an animation keys the mix of a slider, so a mix set here would not last
    for (const constraint of skeleton.constraints ?? []) {
        if (lib.Slider && constraint instanceof lib.Slider) constraint.update = () => {};
    }
}

function place(view, { x, y, scale }) {
    view.position.set(x, y);
    view.scale.set(scale);
}

/** The official runtime of one Spine version. `lib` is the loaded `@esotericsoftware/spine-pixi-v8`. */
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

            switchOffPhysics(lib, spine.skeleton);
            root.addChild(spine);

            return {
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
                destroy: () => root.destroy({ children: true }),
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
 */
export function oursSide(PIXI, lib) {
    return {
        name: 'ours',
        async create({ skeleton, atlas, cuts = 'default' }) {
            const asset = await lib.MarrowAsset.load({ skeleton, atlas, constraints: 'ignore' });

            // the outlines are read from the page images in idle time. From here on every instance has them
            const waited = performance.now();

            await asset.optimized;
            // the first instance of an asset waits for the scan, idle time included
            if (!scans.has(asset)) scans.set(asset, performance.now() - waited);
            const spine = new lib.MarrowSpine(asset, {
                autoUpdate: false,
                ...CUT_OPTIONS[cuts],
            });
            const root = new PIXI.Container();

            root.addChild(spine);

            return {
                root,
                spine,
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
                    root.removeChild(spine);
                    spine.destroy();
                    root.destroy();
                },
            };
        },
    };
}
