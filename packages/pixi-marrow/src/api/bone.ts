import { Matrix, Point, type PointData } from 'pixi.js';
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

    /**
     * Takes a point next to the bone, in Spine's coordinates for that bone, to the space of the
     * display object: the official `Bone.localToWorld`, with the pose of the last update. Pixi's
     * `toGlobal` of the display object takes the result on to the stage.
     *
     * @param out The point to write. A new one when left out.
     *
     * @example
     * const tip = hero.bone('sword').localToWorld({ x: 120, y: 0 });
     * spark.position.copyFrom(tip);
     */
    localToWorld(point: PointData, out: Point = new Point()): Point {
        const { world } = this.state;
        const at = this.world;
        const { x, y } = point;

        return out.set(
            x * Number(world[at]) + y * Number(world[at + 1]) + Number(world[at + 4]),
            x * Number(world[at + 2]) + y * Number(world[at + 3]) + Number(world[at + 5]),
        );
    }

    /**
     * Takes a point in the space of the display object to the coordinates of the bone: the
     * official `Bone.worldToLocal` of the skeleton's Spine version, with the pose of the last
     * update. Pixi's `toLocal` of the display object brings a point from the stage first. A bone
     * scaled to 0 has no inverse, and the result is not finite then, as in the official runtime.
     *
     * @param out The point to write. A new one when left out.
     *
     * @example
     * const grip = hero.bone('hand').worldToLocal(hero.toLocal(event.global));
     */
    worldToLocal(point: PointData, out: Point = new Point()): Point {
        const { world } = this.state;
        const at = this.world;
        const a = Number(world[at]);
        const b = Number(world[at + 1]);
        const c = Number(world[at + 2]);
        const d = Number(world[at + 3]);
        const det = a * d - b * c;
        const x = point.x - Number(world[at + 4]);
        const y = point.y - Number(world[at + 5]);

        // the two official formulas differ in their last bits: 4.3 divides once, 4.1 and 4.2 multiply by the inverse
        if (this.state.model.version === '4.3') return out.set((x * d - y * b) / det, (y * a - x * c) / det);
        const inverse = 1 / det;

        return out.set(x * d * inverse - y * b * inverse, y * a * inverse - x * c * inverse);
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
