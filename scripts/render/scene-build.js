/*
 * Browser part of scripts/check-render.mjs: builds one side of a scene from its description, and
 * applies the changes a scene makes between frames. See scripts/render/scene-kit.mjs for the
 * nodes and the events of a description, and scripts/render/scenes.js for what runs a scene.
 */

/** A container for a group node: its transform, alpha, tint, filter and whether it is a render group. */
function makeGroup(PIXI, scene, node) {
    const group = new PIXI.Container(node.renderGroup ? { isRenderGroup: true } : {});

    group.position.set(node.x ?? 0, node.y ?? 0);
    group.scale.set(node.scale ?? 1);
    group.rotation = node.rotation ?? 0;
    if (node.alpha !== undefined) group.alpha = node.alpha;
    if (node.tint !== undefined) group.tint = node.tint;
    if (node.filter) {
        group.filters = [new PIXI.AlphaFilter({ alpha: node.filter.alpha })];
        // the area is given, so the bounds of a runtime do not decide how large the filter texture is
        group.filterArea = new PIXI.Rectangle(0, 0, scene.size, scene.size);
    }

    return group;
}

/** A Pixi object that is no instance: a rectangle drawn by a graphics object, or a tinted sprite. */
function makeShape(PIXI, node) {
    if (node.type === 'graphics') {
        return new PIXI.Graphics()
            .rect(node.x, node.y, node.width, node.height)
            .fill({ color: node.color, alpha: node.alpha });
    }
    const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);

    sprite.position.set(node.x, node.y);
    sprite.width = node.width;
    sprite.height = node.height;
    sprite.rotation = node.rotation ?? 0;
    sprite.tint = node.color;
    sprite.alpha = node.alpha;

    return sprite;
}

/**
 * The render mode an instance of a side asks for. The batched side lets a node pick its own. So
 * does the side with the default options in a scene about the lazy mesh mode: `side.picks`.
 */
export const modeOf = (side, node) => (side.mode === 'batched' || side.picks ? (node.mode ?? side.mode) : side.mode);

/**
 * What an instance holds on a side. The wrong side of a proof that misplaces hangs the object of
 * the proof on another slot: one of the same bone, so that its place in the draw order is all
 * that differs.
 */
function heldBy(scene, side, name, hold) {
    const misplace = side.wrong ? scene.proof?.misplace : undefined;

    return misplace && misplace.name === name && misplace.key === hold.key ? { ...hold, slot: misplace.slot } : hold;
}

/**
 * Creates the instance of a node and moves it to its place in time. It plays the animation of
 * its rig in a loop, or once with `loop: false`. A node with `play: false` plays nothing and
 * shows its setup pose.
 */
async function makeInstance(scene, side, node) {
    const rig = scene.rigs[node.rig];
    const url = (file) => `/fixtures/${side.runtime.name}/${rig.version}/${file}`;
    const instance = await side.runtime.create({
        skeleton: url(rig.skel),
        atlas: url(rig.atlas),
        mode: modeOf(side, node),
        // a node can ask for the mesh mode without the load that waits for its code
        preload: node.preload,
    });

    side.instances.push(instance);
    side.named.set(node.name, instance);
    instance.node = node;
    if (rig.skin) instance.setSkin(rig.skin);
    instance.place(node);
    for (const hold of node.holds ?? []) await instance.hold(heldBy(scene, side, node.name, hold));
    if (node.play !== false) instance.play(rig.animation, node.loop ?? true);
    // every instance at another time of its animation
    instance.update(node.time ?? 0);
    if (node.visible === false) instance.view.visible = false;
    if (node.renderable === false) instance.view.renderable = false;

    return instance.view;
}

/**
 * Builds a node and what is below it, and adds it to a parent.
 *
 * @param index Where in the child list of the parent it goes. Without it the node goes to the end.
 */
async function addNode(env, scene, side, node, parent, index) {
    // a side builds its stage from the pixi.js its runtime runs on
    const { PIXI } = side;
    let object;

    if (node.type === 'spine') object = await makeInstance(scene, side, node);
    else if (node.type === 'group') {
        object = makeGroup(PIXI, scene, node);
        if (node.name) side.groups.set(node.name, object);
        for (const child of node.children) await addNode(env, scene, side, child, object);
        if (node.mask) {
            const mask = new PIXI.Graphics().circle(...node.mask.circle).fill(0xffffff);

            object.addChild(mask);
            object.mask = mask;
        }
    } else object = makeShape(PIXI, node);
    if (index === undefined) parent.addChild(object);
    else parent.addChildAt(object, index);
}

/**
 * One side of a scene: a stage of its own with every node of the scene.
 *
 * @param spec.key The name of the side. `spec.runtime` is the official side or ours, and
 * `spec.mode` the render mode its instances ask for. `spec.wrong` builds the tooling proof of
 * the scene. For a proof that swaps, two instances change places in the child list here. A
 * proof that holds a frame back is made while the scene plays.
 */
export async function buildSide(env, scene, spec) {
    const { PIXI } = spec.runtime;
    const stage = new PIXI.Container();
    const side = {
        ...spec,
        PIXI,
        // the render texture the side is drawn into, on the renderer of its runtime
        studio: spec.runtime.studio(scene.size),
        root: stage,
        stage,
        instances: [],
        named: new Map(),
        groups: new Map(),
        home: { x: 0, y: 0 },
        place(placement) {
            side.home = placement;
            stage.position.set(placement.x, placement.y);
        },
        stats: () => null,
        // draw calls of the captured frames, and how often Pixi built instructions
        draws: [],
        builds: { first: null, later: 0, renders: 0 },
    };

    try {
        for (const node of scene.nodes) await addNode(env, scene, side, node, stage);
        if (spec.wrong && scene.proof.swap) {
            const [a, b] = scene.proof.swap.map((name) => side.named.get(name).view);

            stage.swapChildren(a, b);
        }
    } catch (error) {
        destroySide(side);
        throw error;
    }

    return side;
}

/** Destroys the instances of a side and its stage. */
export function destroySide(side) {
    for (const instance of side.instances) instance.destroy();
    side.instances.length = 0;
    side.stage.destroy({ children: true });
}

/** The flags and the looks an event of kind `set` can change on a display object. */
const SETTABLE = ['visible', 'renderable', 'alpha', 'tint'];

/** Moves a group: any of `x`, `y`, `scale` and `rotation` an event names. */
function shiftGroup(group, event) {
    group.position.set(event.x ?? group.position.x, event.y ?? group.position.y);
    if (event.scale !== undefined) group.scale.set(event.scale);
    if (event.rotation !== undefined) group.rotation = event.rotation;
}

/** Applies one change between two frames to a side: see the events of scripts/render/scene-kit.mjs. */
export async function applyEvent(env, scene, side, event) {
    const target = event.name ? side.named.get(event.name) : null;

    if (event.op === 'add') await addNode(env, scene, side, event.node, side.stage, event.index);
    else if (event.op === 'remove') side.stage.removeChild(target.view);
    else if (event.op === 'insert') side.stage.addChildAt(target.view, event.index);
    else if (event.op === 'move') side.stage.setChildIndex(target.view, event.index);
    else if (event.op === 'set') {
        for (const key of SETTABLE) if (event[key] !== undefined) target.view[key] = event[key];
    } else if (event.op === 'play') target.play(event.animation, event.loop ?? true);
    else if (event.op === 'skin') target.setSkin(event.skin);
    else if (event.op === 'mode') target.setMode(event.mode);
    else if (event.op === 'hold') await target.hold(heldBy(scene, side, event.name, event.hold));
    else if (event.op === 'release') target.release(event.key);
    else if (event.op === 'shift') shiftGroup(side.groups.get(event.group), event);
    else if (event.op === 'destroy') {
        target.destroy();
        side.instances.splice(side.instances.indexOf(target), 1);
        side.named.delete(event.name);
    } else throw new Error(`unknown event ${event.op}`);
}
