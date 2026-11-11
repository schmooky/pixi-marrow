/*
 * Browser part of scripts/check-render.mjs: the official Pixi runtime and pixi-marrow behind one
 * small interface, so a case drives both with the same calls.
 *
 * An instance has: `root` (a container that holds the object alone), `place`, `setSkin`, `play`,
 * `update`, `stats` and `destroy`. Official instances also have `tint` and `hide`, which the
 * tooling proof uses to make a picture wrong on purpose. Ours also has `info`.
 */

/** The constraint lists of an official skeleton: one list plus the physics subset in 4.3, one per kind in 4.2. */
const CONSTRAINT_LISTS = [
    'constraints',
    'physics',
    'ikConstraints',
    'transformConstraints',
    'pathConstraints',
    'physicsConstraints',
];

/**
 * Removes every constraint from an official skeleton, the way the pose parity suite builds its
 * reference without constraints: the lists are emptied and the update order is rebuilt.
 */
function removeConstraints(skeleton) {
    for (const list of CONSTRAINT_LISTS) {
        if (Array.isArray(skeleton[list])) skeleton[list].length = 0;
    }
    skeleton.updateCache();
}

/**
 * Removes the timelines that animate constraints. They look their constraint up by index and
 * would fail on the emptied lists. Durations stay. The data is shared, so this runs once.
 */
function stripConstraintTimelines(data) {
    if (data.constraintTimelinesStripped) return;
    data.constraintTimelinesStripped = true;
    for (const animation of data.animations) {
        const kept = animation.timelines.filter((timeline) => typeof timeline.constraintIndex !== 'number');

        if (kept.length !== animation.timelines.length) animation.setTimelines(kept);
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

            stripConstraintTimelines(spine.skeleton.data);
            removeConstraints(spine.skeleton);
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

/** pixi-marrow. `lib` is the loaded package, which must export `MarrowSpine`. */
export function oursSide(PIXI, lib) {
    return {
        name: 'ours',
        async create({ skeleton, atlas }) {
            const spine = await lib.MarrowSpine.load({ skeleton, atlas, constraints: 'ignore' });
            const root = new PIXI.Container();

            spine.autoUpdate = false;
            root.addChild(spine);

            return {
                root,
                place: (placement) => place(spine, placement),
                setSkin(name) {
                    spine.skin = name;
                },
                play: (name) => spine.play(name, { loop: true, track: 0 }),
                update: (seconds) => spine.update(seconds),
                stats: () => (spine.stats ? { ...spine.stats } : null),
                info: () => spine.info ?? null,
                destroy() {
                    root.removeChild(spine);
                    spine.destroy();
                    root.destroy();
                },
            };
        },
    };
}
