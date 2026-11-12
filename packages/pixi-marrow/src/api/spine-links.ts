import { Container } from 'pixi.js';
import { unknownName } from '../base/names';
import { Bone } from './bone';
import { type LinkParts, Links } from './links';
import type { AttachOptions, MarrowNames } from './options';

/**
 * The part of a display object that ties Pixi objects to the skeleton. These are the handles
 * of its bones, the containers that follow a bone and the ones that are attached to a slot.
 * `MarrowSpine` is the one class that extends it.
 *
 * @example
 * hero.follow('hand', sparkle);
 * hero.attach('placeholder', label);
 * hero.bone('head').rotation += 10;
 */
export abstract class SpineLinks<N extends MarrowNames = MarrowNames> extends Container {
    /** The followed and the attached containers, once there is one. An update without any pays one check of this field. */
    protected links: Links | undefined;
    private linkParts: LinkParts | undefined;
    private readonly handles = new Map<string, Bone<N>>();

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
