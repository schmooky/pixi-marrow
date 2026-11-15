import { Ticker } from 'pixi.js';
import { MarrowError } from '../base/errors';
import type { PhysicsMode, PoseEngine } from '../pose/engine';
import { physicsMode } from './checks';
import type { MarrowNames, SpineTicker, UpdateProbe } from './options';
import { unseen } from './pacing';
import { SpineLinks } from './spine-links';
import { finite } from './values';

/**
 * An update of more seconds than this starts the physics again in place of running them all. An
 * hour of physics in one update takes 20 to 130 milliseconds, and the result is no pose a game wants.
 */
const LONG_UPDATE = 10;

/**
 * The clock and the pose engine of a display object. They are the ticker that updates it, the
 * time scale, the default mix and the probe of its updates. For physics they are the mode, a
 * reset for one update, and the moves the constraints follow. `MarrowSpine` is the one class
 * that extends it.
 *
 * @example
 * hero.physics = 'pose';
 * hero.resetPhysics();
 * hero.physicsTranslate(12, 0);
 */
export abstract class SpinePhysics<N extends MarrowNames = MarrowNames> extends SpineLinks<N> {
    abstract readonly engine: PoseEngine;
    /** What {@link ticker} reads. The constructor of the display object sets it from the `ticker` option. */
    protected clock: SpineTicker = Ticker.shared;
    private ticking = false;
    /** True during an update from the ticker of an object that Pixi does not draw. */
    protected dozes = false;
    /** The mode to return to after the one update that resets the physics, or null without one. */
    private afterReset: PhysicsMode | null = null;
    /** True while `lod` leaves physics and deform out of the updates. */
    private reduced = false;
    /** True when `lod` turned the deform off, so that it turns it on again. */
    private hidDeform = false;
    /** What {@link updateProbe} holds. An update without a probe pays one check of this field. */
    protected probe: UpdateProbe | null = null;

    /** Advances the animations by `seconds`, and draws the new pose. See `MarrowSpine.update`. */
    abstract update(seconds: number): void;

    /**
     * The ticker that updates the object while {@link autoUpdate} is true: the `ticker` option,
     * or Pixi's shared ticker.
     */
    get ticker(): SpineTicker {
        return this.clock;
    }

    /**
     * True when the object updates itself from its {@link ticker}, with the seconds the ticker
     * measured. Set it to false to call `update` yourself. See the `autoUpdate` option for what
     * such an update leaves out while Pixi does not draw the object.
     */
    get autoUpdate(): boolean {
        return this.ticking;
    }

    set autoUpdate(value: boolean) {
        if (value === this.ticking) return;
        // a destroyed object throws
        if (value) this.parts();
        this.ticking = value;
        if (value) this.clock.add(this.onTick, this);
        else this.clock.remove(this.onTick, this);
    }

    /**
     * Multiplies the time every track advances by. 1 is normal speed. The same factor is `speed`
     * on a `Track` and in the play options, for one animation. A value that is no finite number
     * throws a `MarrowError`.
     */
    get timeScale(): number {
        return this.engine.timeScale;
    }

    set timeScale(value: number) {
        this.engine.timeScale = finite('timeScale', value);
    }

    /**
     * Seconds to mix between two animations that have no mix set with `setMix`. A value that is
     * no finite number throws a `MarrowError`.
     */
    get defaultMix(): number {
        return this.engine.defaultMix;
    }

    set defaultMix(seconds: number) {
        this.engine.defaultMix = finite('defaultMix', seconds);
    }

    /**
     * What measures the updates of this object, or null. Default null. `createProbe` of
     * `pixi-marrow/perf` sets it, and `stop` of that probe takes it back. With a probe every
     * update reads the clock five times and calls `record`. Without one it pays one check.
     *
     * Throws a `MarrowError` for a value that is not null and has no `record` method.
     *
     * @example
     * hero.updateProbe = { record: (pose, geometry, events) => console.warn(pose + geometry + events) };
     */
    get updateProbe(): UpdateProbe | null {
        return this.probe;
    }

    set updateProbe(probe: UpdateProbe | null) {
        if (probe !== null && typeof probe?.record !== 'function') {
            throw new MarrowError('invalid-option', `updateProbe was set to ${String(probe)}, which cannot record.`, {
                fix: 'Set an object with a record(pose, geometry, events) method, or null.',
            });
        }
        this.probe = probe;
    }

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
        this.engine.physicsTranslate(finite('physicsTranslate x', x), finite('physicsTranslate y', y));
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
            finite('physicsRotate x', x),
            finite('physicsRotate y', y),
            finite('physicsRotate degrees', degrees),
        );
    }

    /**
     * Updates the engine by `seconds`. While `small`, which `lod` asks for, the engine updates in
     * physics mode `none` with its deform off. Back at full size the physics is reset, so that
     * it does not swing from an old pose, and the deform comes back. A physics mode `none` or a
     * deform switch that the game set stays as the game set it.
     */
    protected poseAt(seconds: number, small: boolean): void {
        const { engine } = this;
        const mode = engine.physics;

        if (small && !this.reduced) {
            this.hidDeform = engine.deform;
            engine.deform = false;
        } else if (!small && this.reduced) {
            if (this.hidDeform) engine.deform = true;
            if (mode !== 'none') this.resetPhysics();
        }
        this.reduced = small;
        if (small) engine.physics = 'none';
        engine.update(seconds);
        if (small) engine.physics = mode;
        this.settleReset();
    }

    private onTick(ticker: { deltaMS: number }): void {
        this.dozes = unseen(this, false);
        this.update(ticker.deltaMS / 1000);
        this.dozes = false;
    }

    /**
     * Makes the next update start the physics again, unless its mode is `none`. Call it when
     * time passed that the physics did not run for: it would run all of that time in one update.
     */
    protected calm(): void {
        if (this.engine.physics !== 'none') this.resetPhysics();
    }

    /**
     * Checks the seconds of an update. Throws a `MarrowError` for a value that is no finite
     * number: the physics would never return from an infinite time. A long time starts the
     * physics again, see {@link LONG_UPDATE}.
     */
    protected checkStep(seconds: number): void {
        if (seconds <= LONG_UPDATE) return;
        finite('update seconds', seconds);
        this.calm();
    }

    /** Ends the one update that resets the physics: the mode that was set before it returns. */
    private settleReset(): void {
        if (this.afterReset === null) return;
        this.engine.physics = this.afterReset;
        this.afterReset = null;
    }
}
