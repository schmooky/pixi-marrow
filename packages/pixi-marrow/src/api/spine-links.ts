import { Container } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { Bone } from './bone';
import { namedIndex, noName, warnLater } from './checks';
import type { SpineEventName, SpineListener } from './events';
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
 * Once the display object was destroyed, every member here that reaches into the skeleton throws
 * a `MarrowError` with the code `destroyed`. `unfollow` and `detach` do nothing then.
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
     * Listens for an event of the skeleton or of the Pixi container: the `on` of Pixi, with
     * types. The names and the arguments of the listener come from `MarrowSpineEvents` and from
     * the events of a container. A name that is no event does not compile. For an event of your
     * own, call `on` of the object as a Pixi `Container`.
     *
     * @example
     * hero.on('event', (event, track) => console.warn(event.name, track.animation));
     */
    declare on: <K extends string | symbol>(
        event: SpineEventName<N, K>,
        listener: SpineListener<N, K>,
        context?: unknown,
    ) => this;

    /** Listens for the next time an event is emitted. Typed as {@link on}. */
    declare once: <K extends string | symbol>(
        event: SpineEventName<N, K>,
        listener: SpineListener<N, K>,
        context?: unknown,
    ) => this;

    /** Removes a listener, or every listener of the event when none is given. Typed as {@link on}. */
    declare off: <K extends string | symbol>(
        event: SpineEventName<N, K>,
        listener?: SpineListener<N, K>,
        context?: unknown,
        once?: boolean,
    ) => this;

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
        const { state, model } = this.parts();
        let handle = this.handles.get(name);

        if (handle === undefined) {
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
        const { engine, model } = this.parts();
        let handle = this.slotHandles.get(name);

        if (handle === undefined) {
            handle = new Slot<N>(engine, indexOf('slot', model.slots.names, name), name);
            this.slotHandles.set(name, handle);
        }

        return handle;
    }

    /**
     * The name of the active skin, or null for none.
     *
     * While several skins are active it reads null: read and set `skins` then. Setting another
     * skin also puts the slots into their setup pose, as code with the official runtime does
     * after `setSkin`. Setting what it reads changes nothing, so `hero.skin = hero.skin` keeps
     * several skins, and the attachments and colors that slot handles set. `skins = []` clears them.
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
        // the value it reads is the one that is active, null for several skins too
        if (name === this.skin) return;
        this.skins = name === null ? [] : [name];
    }

    /**
     * The skins that are active, in order. Several skins are active as one skin. The official
     * runtime does that with a skin that `Skin.addSkin` filled with each of them in order: it
     * holds the attachments, bones and constraints of all of them. Where two skins store an attachment under
     * one slot and name, the later one wins. An empty list is no skin.
     *
     * Setting another list also puts the slots into their setup pose, as the `skin` setter does.
     * The list that is active, in the same order, changes nothing. Every instance of an asset
     * shares the combined skin of a list. Throws a `MarrowError` that lists the skin names for a
     * name the skeleton does not have.
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
            throw new MarrowError('invalid-option', `skins takes a list of skin names, not ${String(names)}.`, {
                fix: "Pass an array of names, such as ['body', 'hat'], or [] for no skin.",
            });
        }
        const skins = names.map((name) => namedIndex('skin', model.skins, name));

        // the same indices in the same order
        if (String(skins) === String(engine.skins)) return;
        engine.setSkins(skins);
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
            throw new MarrowError('invalid-option', `setupPose has no part "${String(part)}".`, {
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
     * attached to a slot already. A container that is no child of this object a moment after the
     * call gets a warning, once: it stands elsewhere than the bone.
     *
     * @example
     * hero.addChild(sparkle);
     * hero.follow('hand', sparkle);
     */
    follow(bone: N['bones'], container: Container): void {
        const { model } = this.parts();

        this.linked().follow(indexOf('bone', model.bones.names, bone), container);
        if (container.parent !== this) warnLater(({ warnStray }) => warnStray(this, container, bone));
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

    /**
     * Says what the handles and the links work on. The constructor of a display object calls it
     * once, and its `destroy` takes the parts away with undefined.
     */
    protected linkTo(parts: LinkParts | undefined): void {
        this.linkParts = parts;
    }

    /** What the handles and the links work on. Throws the `MarrowError` of a destroyed display object. */
    protected parts(): LinkParts {
        if (this.linkParts === undefined) {
            throw new MarrowError('destroyed', 'The display object was destroyed.', { fix: 'Make a new one.' });
        }

        return this.linkParts;
    }

    private linked(): Links {
        this.links ??= new Links(this.parts());

        return this.links;
    }
}

/** The index of a name, or the `MarrowError` that lists the valid names. */
function indexOf(kind: string, names: readonly string[], name: string): number {
    const index = names.indexOf(name);

    if (index < 0) throw noName(kind, name, names);

    return index;
}
