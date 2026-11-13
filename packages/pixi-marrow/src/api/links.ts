import { type Container, Matrix } from 'pixi.js';
import { MarrowError } from '../base/errors';
import type { SkeletonModel } from '../model/model';
import type { PoseEngine } from '../pose/engine';
import { isNewer, type PoseState, WORLD_STRIDE } from '../pose/state';
import { attachCode, attachCodeState, loadAttachCode } from '../render/attach-code';
import type { Link, ViewInserts } from '../render/attach-work';
import type { SkeletonView } from '../render/skeleton-view';
import type { AttachOptions } from './options';

/*
 * The containers of the user that a display object moves: the ones that follow a bone, and the
 * ones that are attached to a slot. Both get the transform of a bone, in the space of the
 * display object. An attached one is also drawn at the place of its slot in the draw order,
 * which the code of `attach-work.ts` does: that code loads with the first `attach`.
 *
 * Work follows change: a container is moved when the stamp of its bone is newer than the pose
 * that was looked at last, and a display object whose pose rests moves nothing.
 */

/** What the links of a display object work on. */
export interface LinkParts {
    readonly engine: PoseEngine;
    readonly state: PoseState;
    readonly model: SkeletonModel;
    readonly view: SkeletonView;
}

/** The transform a container gets: all containers are written one after the other. */
const transform = new Matrix();

/**
 * The followed and the attached containers of one display object.
 *
 * @example
 * const links = new Links({ state: engine.state, model, view });
 * links.follow(model.bones.names.indexOf('hand'), sword);
 * links.move(engine.state);
 */
export class Links {
    /** Every container, in the order it was added. */
    readonly items: Link[] = [];
    private readonly parts: LinkParts;
    /** What draws attached containers between the slots, once its code is loaded and one is attached. */
    private inserts: ViewInserts | undefined;
    /** True while attached containers wait for that code. */
    private waits = false;
    /** The version of the pose the containers were moved for, and whether one was added since. */
    private seen = 0;
    private fresh = false;
    private readonly onGone = (container: Container): void => this.drop(container, false);

    constructor(parts: LinkParts) {
        this.parts = parts;
    }

    /** Makes a container follow a bone from the next update on. */
    follow(bone: number, container: Container): void {
        this.check(container);
        this.add({ container, bone, slot: -1, followAttachment: false, followColor: false, fresh: true });
    }

    /**
     * Attaches a container to a slot: it follows the bone of the slot, and it is drawn at the
     * place of the slot once the code for attached containers is loaded. It is hidden until then.
     */
    attach(slot: number, container: Container, options: AttachOptions = {}): void {
        const { model } = this.parts;
        const taken = this.items.some((item) => item.slot === slot);

        this.check(container);
        if (taken) {
            throw new MarrowError(
                'invalid-data',
                `A container is attached to the slot "${model.slots.names[slot]}" already.`,
                {
                    fix: 'Detach that container first, or put both into one container: a slot holds one.',
                },
            );
        }
        this.add({
            container,
            bone: Number(model.slots.bones[slot]),
            slot,
            followAttachment: options.followAttachment === true,
            followColor: options.followColor === true,
            fresh: true,
        });
        container.visible = false;
        this.waits = true;
        if (attachCode() === undefined && attachCodeState() !== 'loading') void loadAttachCode();
        this.settle();
    }

    /**
     * Lets go of a container. An attached one leaves the display list and is visible again.
     *
     * @param attached Which kind of container to let go of: an attached one, or one that follows a bone.
     */
    release(container: Container, attached: boolean): void {
        const item = this.items.find((held) => held.container === container);

        if (item !== undefined && item.slot >= 0 === attached) this.drop(container, true);
    }

    /**
     * Moves the containers whose bones moved since the call before, and brings the alpha of the
     * attached ones in line with their slots. A display object calls it after every pose.
     */
    move(state: PoseState): void {
        const { items, seen } = this;

        if (this.waits) this.settle();
        if (state.version === seen && !this.fresh) return;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (item === undefined) continue;
            const moved = item.fresh || isNewer(Number(state.boneStamps[item.bone]), seen);

            // an attached container shows once the code that draws it between the slots has it
            if (item.slot >= 0 && (moved || isNewer(Number(state.slotStamps[item.slot]), seen))) {
                this.inserts?.show(item, state);
            }
            if (moved) place(item.container, state.world, item.bone * WORLD_STRIDE);
            item.fresh = false;
        }
        this.seen = state.version;
        this.fresh = false;
    }

    /** Lets go of every container, before the display object is destroyed. */
    clear(): void {
        for (const item of this.items.splice(0)) {
            item.container.off('destroyed', this.onGone);
            if (item.slot >= 0) item.container.visible = true;
        }
        this.inserts?.clear();
        this.waits = false;
    }

    /** Hands the attached containers to the code that draws them between the slots, once that code is there. */
    private settle(): void {
        const code = attachCode();

        if (code === undefined) return;
        this.waits = false;
        this.inserts ??= code.createInserts(this.parts.view);
        for (const item of this.items) {
            if (item.slot < 0 || this.inserts.containers.includes(item.container)) continue;
            this.inserts.add(item.slot, item.container);
            item.fresh = true;
            this.fresh = true;
        }
    }

    private add(item: Link): void {
        this.items.push(item);
        item.container.on('destroyed', this.onGone);
        this.fresh = true;
    }

    /** Forgets a container. One that was destroyed has left the display list on its own. */
    private drop(container: Container, alive: boolean): void {
        const index = this.items.findIndex((item) => item.container === container);
        const item = this.items[index];

        if (item === undefined) return;
        this.items.splice(index, 1);
        container.off('destroyed', this.onGone);
        if (item.slot < 0) return;
        this.inserts?.remove(container);
        if (alive) container.visible = true;
    }

    /** Throws a `MarrowError` for a container that is attached or follows a bone already. */
    private check(container: Container): void {
        const { model } = this.parts;
        const held = this.items.find((item) => item.container === container);

        if (held === undefined) return;
        const attached = held.slot >= 0;
        const where = attached
            ? `attached to the slot "${model.slots.names[held.slot]}"`
            : `following the bone "${model.bones.names[held.bone]}"`;

        throw new MarrowError('invalid-data', `The container is ${where} already.`, {
            fix: attached ? 'Call detach with the container first.' : 'Call unfollow with the container first.',
        });
    }
}

/**
 * Gives a container the transform of a bone, in the space of the display object. The y axis of
 * the bone is turned around, as in the official runtime: a container on a bone that is not
 * rotated stands upright.
 */
function place(container: Container, world: Float64Array, at: number): void {
    transform.set(
        Number(world[at]),
        Number(world[at + 2]),
        -Number(world[at + 1]),
        -Number(world[at + 3]),
        Number(world[at + 4]),
        Number(world[at + 5]),
    );
    container.setFromMatrix(transform);
}
