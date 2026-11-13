import type { PhysicsMode, PoseEngine } from '../pose/engine';
import { finiteArgument, physicsMode } from './checks';
import type { MarrowNames } from './options';
import { SpineLinks } from './spine-links';

/**
 * The physics controls of a display object: the mode, a reset for one update, and the moves the
 * physics constraints follow. `MarrowSpine` is the one class that extends it.
 *
 * @example
 * hero.physics = 'pose';
 * hero.resetPhysics();
 * hero.physicsTranslate(12, 0);
 */
export abstract class SpinePhysics<N extends MarrowNames = MarrowNames> extends SpineLinks<N> {
    abstract readonly engine: PoseEngine;
    /** The mode to return to after the one update that resets the physics, or null without one. */
    private afterReset: PhysicsMode | null = null;

    /**
     * How physics constraints run in an update. Default `update`. The mode stays until it is set
     * again. A skeleton without physics constraints ignores it, and so does every Spine 4.1 skeleton.
     *
     * - `update` advances the physics by the time that passed and moves the bones.
     * - `none` leaves the physics out: the bones keep the pose of the animations.
     * - `pose` moves the bones to where the physics is, and does not advance it.
     * - `reset` starts the physics from the pose of the animations in every update. For one such
     *   update call {@link resetPhysics}.
     *
     * Any other value throws a `MarrowError`.
     */
    get physics(): PhysicsMode {
        return this.afterReset ?? this.engine.physics;
    }

    set physics(mode: PhysicsMode) {
        const checked = physicsMode(mode);

        // a reset that waits for its update stays: the new mode returns after it
        if (this.afterReset === null) this.engine.physics = checked;
        else this.afterReset = checked;
    }

    /**
     * Makes the next update start the physics again from the pose of the animations: that
     * update runs in mode `reset`, then the mode of {@link physics} returns. Call it after a
     * jump of the skeleton, so that the physics does not swing from where it was.
     *
     * @example
     * hero.position.set(400, 300);
     * hero.resetPhysics();
     */
    resetPhysics(): void {
        if (this.afterReset !== null) return;
        this.afterReset = this.engine.physics;
        this.engine.physics = 'reset';
    }

    /**
     * Tells the physics constraints that the skeleton moved, so that they lag behind: the
     * official `Skeleton.physicsTranslate`. `x` and `y` are in the space of this object, where y
     * points down. The object never calls it on its own when its Pixi position changes, and
     * neither does the official Pixi runtime unless it is asked to.
     *
     * @example
     * hero.x += 12;
     * hero.physicsTranslate(12, 0);
     */
    physicsTranslate(x: number, y: number): void {
        this.engine.physicsTranslate(
            finiteArgument('physicsTranslate', 'x', x),
            finiteArgument('physicsTranslate', 'y', y),
        );
    }

    /**
     * Tells the physics constraints that the skeleton turned by `degrees` around the point `x`,
     * `y` of this object's space: the official `Skeleton.physicsRotate`. Positive degrees turn
     * the way Pixi's `rotation` does.
     *
     * @example
     * hero.angle += 5;
     * hero.physicsRotate(0, 0, 5);
     */
    physicsRotate(x: number, y: number, degrees: number): void {
        this.engine.physicsRotate(
            finiteArgument('physicsRotate', 'x', x),
            finiteArgument('physicsRotate', 'y', y),
            finiteArgument('physicsRotate', 'degrees', degrees),
        );
    }

    /** Ends the one update that resets the physics: the mode that was set before it returns. An update calls it. */
    protected settleReset(): void {
        if (this.afterReset === null) return;
        this.engine.physics = this.afterReset;
        this.afterReset = null;
    }
}
