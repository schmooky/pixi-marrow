import { Container } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { unknownName } from '../base/names';
import { Bone } from './bone';
import { namedIndex } from './checks';
import { type LinkParts, Links } from './links';
import type { AttachOptions, MarrowNames } from './options';
import { Slot } from './slot';

/** What `setupPose` resets. */
export type SetupPosePart = 'all' | 'bones' | 'slots';

/**
 * The part of a display object that reaches into the skeleton by name. It holds the handles of
 * bones and slots, the active skins and the setup pose. It also holds the Pixi objects that
 * follow a bone or are attached to a slot. `MarrowSpine` is the one class that extends it.
 *
 * @example
 * hero.skins = ['body', 'hat'];
 * hero.slot('glow').alpha = 0.5;
 * hero.bone('head').rotation += 10;
 * hero.attach('placeholder', label);
 */
export abstract class SpineLinks<N extends MarrowNames = MarrowNames> extends Container {
    /** The followed and the attached containers, once there is one. An update without any pays one check of this field. */
    protected links: Links | undefined;
    private linkParts: LinkParts | undefined;
    private readonly handles = new Map<string, Bone<N>>();
    private readonly slotHandles = new Map<string, Slot<N>>();

    /**
     * The handle of a bone: its pose next to its parent, to read and to write, and where it is in
     * this object after the last update. One object per bone, the same at every call.
     *
     * Throws a `MarrowError` that lists the bone names for a name the skeleton does not have.
     *
     * @example
     * const head = hero.bone('head');
     * head.rotation += 15; // stays until an animation that keys the bone plays
     * console.log(head.worldX, head.worldY);
     */
    bone(name: N['bones']): Bone<N> {
        let handle = this.handles.get(name);

        if (handle === undefined) {
            const { state, model } = this.parts();

            handle = new Bone<N>(state, indexOf('bone', model.bones.names, name), name);
            this.handles.set(name, handle);
        }

        return handle;
    }

    /**
     * The handle of a slot: the attachment it shows, its color and its dark color, to read and to
     * write. One object per slot, the same at every call.
     *
     * Throws a `MarrowError` that lists the slot names for a name the skeleton does not have.
     *
     * @example
     * const weapon = hero.slot('weapon');
     * weapon.attachment = 'axe';
     * weapon.tint = 0xff8080;
     */
    slot(name: N['slots']): Slot<N> {
        let handle = this.slotHandles.get(name);

        if (handle === undefined) {
            const { engine, model } = this.parts();

            handle = new Slot<N>(engine, indexOf('slot', model.slots.names, name), name);
            this.slotHandles.set(name, handle);
        }

        return handle;
    }

    /**
     * The name of the active skin, or null for none. It is null too while several skins are
     * active: read `skins` then. Setting a skin also puts the slots into their setup pose, as
     * code with the official runtime does after `setSkin`.
     */
    get skin(): N['skins'] | null {
        const { engine, model } = this.parts();
        const [only, more] = engine.skins;

        // the names type lists the skins of this skeleton
        return (more === undefined && only !== undefined ? (model.skins[only]?.name ?? null) : null) as
            | N['skins']
            | null;
    }

    set skin(name: N['skins'] | null) {
        this.skins = name === null ? [] : [name];
    }

    /**
     * The skins that are active, in order. Several skins are active as one skin. The official
     * runtime does that with a skin that `Skin.addSkin` filled with each of them in order: it
     * holds the attachments, bones and constraints of all of them. Where two skins store an attachment under
     * one slot and name, the later one wins. An empty list is no skin.
     *
     * Setting the list also puts the slots into their setup pose, as the `skin` setter does. Every
     * instance of an asset shares the combined skin of a list. Throws a `MarrowError` that lists
     * the skin names for a name the skeleton does not have.
     *
     * @example
     * hero.skins = ['body/girl', 'hair/long', 'outfit/knight'];
     */
    get skins(): N['skins'][] {
        const { engine, model } = this.parts();

        // the names type lists the skins of this skeleton
        return engine.skins.map((index) => model.skins[index]?.name ?? '') as N['skins'][];
    }

    set skins(names: readonly N['skins'][]) {
        const { engine, model } = this.parts();

        if (!Array.isArray(names)) {
            throw new MarrowError('invalid-data', `skins takes a list of skin names, not ${String(names)}.`, {
                fix: "Pass an array of names, such as ['body', 'hat'], or [] for no skin.",
            });
        }
        engine.setSkins(names.map((name) => namedIndex('skin', model.skins, String(name))));
        engine.setupPoseSlots();
    }

    /**
     * Puts the skeleton into its setup pose: the official `setupPose`, which is `setToSetupPose`
     * before 4.3. `bones` resets the bones and the constraints only, `slots` the draw order and
     * the slots only. Tracks keep playing: the next update applies them over the setup pose. Call
     * `stop()` first to hold it.
     *
     * @example
     * hero.stop();
     * hero.setupPose();
     */
    setupPose(part: SetupPosePart = 'all'): void {
        const { engine } = this.parts();

        if (part === 'all') engine.setupPose();
        else if (part === 'bones') engine.setupPoseBones();
        else if (part === 'slots') engine.setupPoseSlots();
        else {
            throw new MarrowError('invalid-data', `setupPose has no part "${String(part)}".`, {
                fix: "Pass 'all', 'bones' or 'slots', or nothing for all.",
            });
        }
    }

    /**
     * Makes a container follow a bone: its position, rotation, scale and skew are those of the
     * bone after every update in which the bone moved. The transform is written in the space of
     * this object, so the container belongs inside it: add it with `addChild`. It stays where it
     * is in the display list, and it costs no draw call.
     *
     * Throws a `MarrowError` for an unknown bone, and for a container that follows a bone or is
     * attached to a slot already.
     *
     * @example
     * hero.addChild(sparkle);
     * hero.follow('hand', sparkle);
     */
    follow(bone: N['bones'], container: Container): void {
        const { model } = this.parts();

        this.linked().follow(indexOf('bone', model.bones.names, bone), container);
    }

    /** Lets a container go that follows a bone. It stays where it is. Does nothing for another container. */
    unfollow(container: Container): void {
        this.links?.release(container, false);
    }

    /**
     * Attaches a container to a slot. It becomes a part of this object. It is drawn at the place
     * of the slot in the draw order, after the attachment of the slot. It moves with the bone of
     * the slot. It shows while the bone is active and the alpha of the slot is above 0, and its
     * alpha is that of the slot. So this object sets the transform, `visible` and `alpha` of the
     * container while it is attached. A slot holds one container.
     *
     * The container is drawn between two slots. That ends a batch of the skeleton there, or a
     * draw range in the mesh mode. The cost is one more draw call per attached slot, and the draw
     * calls of the container. A clipping attachment does not clip it. The code that draws it
     * loads with the first call of a page, and the container is hidden until that code is there.
     *
     * Throws a `MarrowError` for an unknown slot, for a slot that holds a container, and for a
     * container that is attached or follows a bone already.
     *
     * @example
     * hero.attach('placeholder', label);
     * hero.attach('glow', flare, { followColor: true });
     */
    attach(slot: N['slots'], container: Container, options?: AttachOptions): void {
        const { model } = this.parts();

        this.linked().attach(indexOf('slot', model.slots.names, slot), container, options);
    }

    /** Lets an attached container go: it leaves this object and is visible again. Does nothing for another container. */
    detach(container: Container): void {
        this.links?.release(container, true);
    }

    /** Says what the handles and the links work on. The constructor of a display object calls it once. */
    protected linkTo(parts: LinkParts): void {
        this.linkParts = parts;
    }

    private parts(): LinkParts {
        if (this.linkParts === undefined) throw new Error('The display object is not set up.');

        return this.linkParts;
    }

    private linked(): Links {
        this.links ??= new Links(this.parts());

        return this.links;
    }
}

/** The index of a name, or the `MarrowError` that lists the valid names. */
function indexOf(kind: string, names: readonly string[], name: string): number {
    const index = names.indexOf(String(name));

    if (index < 0) throw unknownName(kind, String(name), names);

    return index;
}
