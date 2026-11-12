/*
 * Browser part of scripts/bench/ab.mjs: the two runtimes behind one small interface. A display
 * object is created the way an application creates it, with nothing around it, so that the
 * time and the memory of an instance are those of the runtime alone.
 *
 * A side has `load`, which loads the files once and returns a function that creates display
 * objects, plus `setSkin` and `play`. Both kinds of display object have `update(seconds)` and
 * `destroy()`, and both are created with their own ticker switched off.
 */

/** The official runtime of one Spine version. `lib` is the loaded `@esotericsoftware/spine-pixi-v8`. */
export function officialSide(PIXI, lib) {
    return {
        name: 'official',
        async load({ skeleton, atlas }) {
            await PIXI.Assets.load([skeleton, atlas]);

            // the official runtime has no options that change what it draws
            return () => lib.Spine.from({ skeleton, atlas, autoUpdate: false });
        },
        setSkin(object, name) {
            object.skeleton.setSkinByName(name);
            if (object.skeleton.setupPoseSlots) object.skeleton.setupPoseSlots();
            else object.skeleton.setSlotsToSetupPose();
        },
        play: (object, animation) => object.state.setAnimation(0, animation, true),
    };
}

/** pixi-marrow. `lib` is the loaded package. */
export function oursSide(lib) {
    return {
        name: 'ours',
        async load({ skeleton, atlas }) {
            const asset = await lib.MarrowAsset.load({ skeleton, atlas });

            // the outlines are read in idle time after the load. The cuts of overdraw need them
            await asset.optimized;

            return (options = {}) => new lib.MarrowSpine(asset, { autoUpdate: false, ...options });
        },
        setSkin(object, name) {
            object.skin = name;
        },
        play: (object, animation) => object.play(animation, { loop: true }),
    };
}
