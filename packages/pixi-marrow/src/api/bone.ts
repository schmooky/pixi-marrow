import { Matrix } from 'pixi.js';
import { LOCAL_STRIDE, nextVersion, type PoseState, WORLD_STRIDE } from '../pose/state';
import { finiteArgument } from './checks';
import type { MarrowNames } from './options';

const DEGREES = 180 / Math.PI;

/**
 * One bone of a display object: its pose next to its parent bone, to read and to write, and
 * where it is in the display object after the last update. `MarrowSpine.bone` hands it out, one
 * object per bone.
 *
 * The local pose is the one the Spine editor shows, in Spine units, with the rotation in
 * degrees. A write takes effect with the next update. It stays until an animation that keys the
 * bone writes it again, which an animation that plays does in every update. That is what the
 * official runtime does with a write between two updates.
 *
 * The world values are for placing Pixi objects: they are in the space of the display object,
 * where y points down. They are those of the last update.
 *
 * @example
 * const head = hero.bone('head');
 * head.rotation += 15;
 * hero.update(0);
 * label.position.set(head.worldX, head.worldY);
 */
export class Bone<N extends MarrowNames = MarrowNames> {
    readonly name: N['bones'];
    private readonly state: PoseState;
    /** Where the local pose and the world transform of the bone start in the arrays of the pose. */
    private readonly local: number;
    private readonly world: number;
    private readonly index: number;

    /** @param index The index of the bone in the skeleton. */
    constructor(state: PoseState, index: number, name: N['bones']) {
        this.state = state;
        this.index = index;
        this.name = name;
        this.local = index * LOCAL_STRIDE;
        this.world = index * WORLD_STRIDE;
    }

    /** The position next to the parent bone. */
    get x(): number {
        return this.read(0);
    }

    set x(value: number) {
        this.write(0, 'x', value);
    }

    get y(): number {
        return this.read(1);
    }

    set y(value: number) {
        this.write(1, 'y', value);
    }

    /** The rotation next to the parent bone, in degrees, counter-clockwise as in the Spine editor. */
    get rotation(): number {
        return this.read(2);
    }

    set rotation(value: number) {
        this.write(2, 'rotation', value);
    }

    get scaleX(): number {
        return this.read(3);
    }

    set scaleX(value: number) {
        this.write(3, 'scaleX', value);
    }

    get scaleY(): number {
        return this.read(4);
    }

    set scaleY(value: number) {
        this.write(4, 'scaleY', value);
    }

    /** Where the bone is in the display object after the last update. */
    get worldX(): number {
        return Number(this.state.world[this.world + 4]);
    }

    get worldY(): number {
        return Number(this.state.world[this.world + 5]);
    }

    /** The direction of the x axis of the bone in the display object, in degrees, clockwise on the screen as a Pixi `angle`. */
    get worldRotation(): number {
        const { world } = this.state;

        return Math.atan2(Number(world[this.world + 2]), Number(world[this.world])) * DEGREES;
    }

    /** False while no active skin lists the bone: it is not posed then, and its world values are old. */
    get active(): boolean {
        return this.state.active[this.index] === 1;
    }

    /**
     * The world transform as a Pixi matrix: it takes a point next to the bone, in Spine's
     * coordinates, to the space of the display object.
     *
     * @param out The matrix to write. A new one when left out.
     */
    worldMatrix(out: Matrix = new Matrix()): Matrix {
        const { world } = this.state;
        const at = this.world;

        return out.set(
            Number(world[at]),
            Number(world[at + 2]),
            Number(world[at + 1]),
            Number(world[at + 3]),
            Number(world[at + 4]),
            Number(world[at + 5]),
        );
    }

    private read(field: number): number {
        return Number(this.state.local[this.local + field]);
    }

    /** Writes one number of the local pose and marks the pose, so that the engine poses the skeleton with it. */
    private write(field: number, name: string, value: number): void {
        const { state } = this;

        // the text that names the bone is built for the error only: a write in every frame allocates nothing
        if (!Number.isFinite(value)) finiteArgument(`bone("${this.name}")`, name, value);
        state.local[this.local + field] = value;
        state.version = nextVersion(state.version);
    }
}
