import { Container, type DestroyOptions, type Renderer } from 'pixi.js';
import { MarrowError } from '../base/errors';
import type { SkeletonInfo } from '../model/info';
import type { AtlasOutlines } from '../model/outlines';
import type { PoseEngine } from '../pose/engine';
import { SkeletonView } from '../render/skeleton-view';
import type { ViewStats } from '../render/stats';
import { MarrowAsset, type MarrowLoadOptions } from './asset';
import type { MarrowAssetsOptions } from './assets';
import { bakingEngine } from './baking';
import { checkSpineOptions, namedIndex, renderMode, warnNoEffect } from './checks';
import { EventPump } from './events';
import { createIdleCache, type IdleCache } from './idle-cache';
import type { MarrowNames, MarrowSpineOptions, PlayOptions, QueueOptions, StopOptions, UpdateProbe } from './options';
import { Pacer, type PacingStatus, unseen } from './pacing';
import { animationDuration, applyPlan, planPlay } from './play-fields';
import { type ResolvedPerf, resolvePerf } from './presets';
import { MarrowPerf } from './spine-perf';
import { SpinePhysics } from './spine-physics';
import { EMPTY_ANIMATION, type Track, type TrackEnd, TrackHandle } from './track';
import { TrackBook } from './track-book';
import { finite } from './values';
import { registerView } from './view-of';

/**
 * A Spine skeleton as a Pixi display object. It plays animations on tracks, mixes between them
 * and draws the result.
 *
 * Pass the names type that `pixi-marrow typegen` writes to make a misspelled name a compile error.
 *
 * After `destroy()` the object is of no more use. `play`, `queue`, `stop`, `setMix`, `bone`,
 * `slot`, the skins, `setupPose`, `follow`, `attach` and `autoUpdate = true` throw a
 * `MarrowError` with the code `destroyed`. `update`, `destroy`, `unfollow` and `detach` do nothing.
 *
 * @example
 * const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
 * app.stage.addChild(hero);
 * hero.play('idle', { loop: true });
 * const shot = hero.play('shoot', { track: 1 });
 * await shot.finished;
 * hero.queue('run', { loop: true, mix: 0.2 });
 * hero.on('event', (event: MarrowEvent, track: Track) => console.warn(event.name, track.animation));
 */
export class MarrowSpine<N extends MarrowNames = MarrowNames> extends SpinePhysics<N> {
    /** True on every `MarrowSpine`, for code that walks a scene tree and has no class to compare with. */
    readonly isMarrowSpine: true = true;
    /** What this object shares with the other instances of its skeleton. */
    readonly asset: MarrowAsset;
    /**
     * The pose engine of this instance. An escape hatch: it is not stable and may change in any
     * release. An animation set on it directly gets no {@link Track} and emits no events.
     */
    readonly engine: PoseEngine;
    private readonly skeletonView: SkeletonView;
    /** The outlines of the asset that the view was given last. */
    private outlines: AtlasOutlines | undefined;
    private readonly book = new TrackBook();
    /** The engine events between the update that caused them and the listeners. */
    private readonly pump = new EventPump();
    private tools: MarrowPerf | undefined;
    /**
     * The `perf` settings in effect: the preset, every setting, and which were given by name.
     * `perf.report()` lists them too.
     */
    readonly perfSettings: ResolvedPerf;
    /** When an update poses the skeleton, and with how much time. */
    private readonly pacer: Pacer;
    private readonly idle: IdleCache | undefined;
    /** The child that hears the renders, once the pacing or an update without a pose needs one. */
    private watch: Container | undefined;
    /** True when time passed that the drawn skeleton does not show. */
    private stale = false;

    /**
     * Creates one more instance of a loaded skeleton. It shows the setup pose until an animation
     * plays. The pose is flipped to Pixi's y axis, which points down.
     *
     * Throws a `MarrowError` before anything is made: `destroyed` for a destroyed asset, and
     * `invalid-option` for a key that is no option and for a value an option does not take.
     *
     * @param asset The loaded skeleton, from `MarrowAsset.load` or `MarrowAsset.from`.
     */
    constructor(asset: MarrowAsset, options: MarrowSpineOptions = {}) {
        super();
        if (asset.destroyed) {
            throw new MarrowError('destroyed', 'The asset was destroyed.', { fix: 'Load the asset again.' });
        }
        checkSpineOptions(options);
        // the options name each setting as the settings do
        const settings = resolvePerf(options.perf, options);
        const mode = renderMode(options.renderMode ?? 'auto');

        this.asset = asset;
        this.label = options.label ?? 'MarrowSpine';
        if (options.ticker !== undefined) this.clock = options.ticker;
        this.perfSettings = settings;
        this.engine = bakingEngine(asset, asset.createEngine(), settings.bake);
        // Spine's y axis points up and Pixi's points down. The official Pixi runtime flips the pose too:
        // the scale flips it, and the flag tells physics constraints which way gravity points
        this.engine.state.scaleY = -1;
        this.engine.state.yDown = true;
        this.outlines = asset.outlines;
        this.skeletonView = new SkeletonView(asset.model, asset.atlas, asset.textures, {
            outlines: this.outlines,
            tightMesh: settings.tightMesh,
            occlusion: options.occlusion,
            renderMode: mode,
            skinning: settings.skinning,
            instancing: settings.instancing,
        });
        warnNoEffect(asset, settings, options.occlusion, mode);
        this.addChild(this.skeletonView.container);
        this.linkTo({ engine: this.engine, state: this.engine.state, model: asset.model, view: this.skeletonView });
        registerView(this, this.skeletonView);
        // The setup pose, so that the object draws before its first update. Physics is left out:
        // it starts from the pose of the first real update, as in the official Pixi runtime
        this.engine.physics = 'none';
        this.engine.update(0);
        this.engine.physics = 'update';
        this.draw();
        this.pacer = new Pacer(settings);
        // a render tells the pacing where the skeleton is, for `offscreen` and `lod`
        if (this.pacer.watching) this.listen();
        this.idle = createIdleCache(this, this.skeletonView, this.engine.state, settings.idleCache, asset.textures);
        this.autoUpdate = options.autoUpdate ?? true;
    }

    /**
     * Loads a skeleton and creates a display object for it: `MarrowAsset.load`, then `new MarrowSpine`.
     * Loads of the same files share one asset. A key that is no option throws before anything loads.
     *
     * @example
     * const hero = await MarrowSpine.load<HeroNames>({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
     * hero.play('idle', { loop: true });
     */
    static async load<N extends MarrowNames = MarrowNames>(
        options: MarrowLoadOptions & MarrowSpineOptions,
    ): Promise<MarrowSpine<N>> {
        checkSpineOptions(options);

        return new MarrowSpine<N>(await MarrowAsset.load(options), options);
    }

    /**
     * Creates a display object from a skeleton and an atlas that Pixi `Assets` loaded, by their
     * aliases. Synchronous: `MarrowAsset.get`, then `new MarrowSpine`.
     *
     * @example
     * const hero = MarrowSpine.from({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
     */
    static from<N extends MarrowNames = MarrowNames>(
        options: MarrowAssetsOptions & MarrowSpineOptions,
    ): MarrowSpine<N> {
        return new MarrowSpine<N>(MarrowAsset.get(options), options);
    }

    /** The names, counts and features of the skeleton, as plain data. */
    get info(): SkeletonInfo {
        return this.asset.info;
    }

    /**
     * Counters of the render path: draw calls, vertices, how often buffers were rebuilt, and what
     * the cuts of overdraw do at the moment.
     */
    get stats(): ViewStats {
        return this.skeletonView.stats;
    }

    /**
     * The perf tools of this object: `report()` lists every decision the runtime made for it and
     * why, `memory()` counts its bytes. Both are asynchronous, because their code loads on first use.
     *
     * @example
     * console.table(await hero.perf.report());
     * console.log((await hero.perf.memory()).instance);
     */
    get perf(): MarrowPerf {
        this.tools ??= new MarrowPerf(this, this.skeletonView, () => this.links?.items ?? []);

        return this.tools;
    }

    /**
     * The `renderMode` option: `auto`, `mesh` or `batched`. Setting it takes effect with the next
     * update. `stats.renderMode` names the mode in use. Any other value throws a `MarrowError`.
     */
    get renderMode(): NonNullable<MarrowSpineOptions['renderMode']> {
        return this.skeletonView.renderMode;
    }

    set renderMode(mode: NonNullable<MarrowSpineOptions['renderMode']>) {
        this.skeletonView.renderMode = renderMode(mode);
    }

    /** Sets the seconds to mix when animation `from` changes to animation `to`. */
    setMix(from: N['animations'], to: N['animations'], seconds: number): void {
        this.engine.setMix(this.animationIndex(from), this.animationIndex(to), finite('setMix seconds', seconds));
    }

    /**
     * Plays an animation on a track now. It mixes from what the track holds and drops what was
     * queued there.
     *
     * Throws a `MarrowError` before anything plays. The code is `unknown-name` for a name the
     * skeleton lacks. It is `invalid-option` for a key that is no option, for an option value of
     * the wrong type and for a name that is no string.
     *
     * @example
     * hero.play('idle', { loop: true });
     * hero.play('aim', { track: 1, additive: true, alpha: 0.5 });
     * const shot = hero.play('shoot', { track: 2, mix: 0.1, speed: 1.5 });
     * await shot.finished;
     */
    play(name: N['animations'], options: PlayOptions = {}): Track<N> {
        const index = this.animationIndex(name);
        const { model } = this.asset;
        const plan = planPlay(options, 'play', model.version);

        this.catchUp();
        this.absorb();
        const entry = this.engine.setAnimation(plan.track, index, plan.loop);
        const handle = this.adopt(new TrackHandle<N>(this, entry, name, animationDuration(model, index)));

        applyPlan(handle, plan);

        return handle;
    }

    /**
     * Plays an animation after what a track holds. On an empty track it plays now. It takes the
     * options of {@link play} and `delay`, and throws for the same mistakes before anything is queued.
     *
     * @example
     * hero.play('jump');
     * hero.queue('run', { loop: true, mix: 0.2 });
     */
    queue(name: N['animations'], options: QueueOptions = {}): Track<N> {
        const index = this.animationIndex(name);
        const plan = planPlay(options, 'queue', this.asset.model.version);
        const { track, delay, fields } = plan;

        this.catchUp();
        this.absorb();
        const before = this.book.last(track);
        const entry = this.engine.addAnimation(track, index, plan.loop, delay);
        const handle = this.adopt(new TrackHandle<N>(this, entry, name, animationDuration(this.asset.model, index)));

        // the engine timed the entry with the mix it knew. The official setMixDuration times it again
        if (fields !== undefined && options.mix !== undefined && before !== undefined && delay <= 0) {
            const early = this.asset.model.version === '4.1';
            const start = early
                ? delay + (before.trackComplete() - options.mix)
                : Math.max(delay + before.trackComplete() - options.mix, 0);

            fields.delay = start;
        }
        applyPlan(handle, plan);

        return handle;
    }

    /**
     * Stops one track, or every track. With `mix` the track mixes out to the setup pose through
     * an empty animation. Without it the track is cleared at once and the pose stays as it is.
     *
     * @example
     * hero.stop({ track: 1, mix: 0.2 });
     * hero.stop();
     */
    stop(options: StopOptions = {}): void {
        const mix = options.mix ?? 0;
        const { track } = options;

        this.parts();
        this.catchUp();
        if (mix > 0) {
            this.absorb();
            if (track !== undefined) this.mixOut(track, mix);
            else {
                for (let i = 0; i < this.book.size; i++) {
                    if (this.book.last(i) !== undefined) this.mixOut(i, mix);
                }
            }
        } else {
            if (track === undefined) this.engine.clearTracks();
            else this.engine.clearTrack(track);
            this.absorb('stopped');
        }
    }

    /**
     * Advances the animations by `seconds`, brings the drawn skeleton in line with the new pose,
     * then emits the events. Call it once per frame when {@link autoUpdate} is false. Once the
     * asset was destroyed it does nothing, and {@link autoUpdate} turns off.
     *
     * The `updateRate` and `offscreen` settings apply here: an update that is not due gathers its
     * seconds for the next one. In the `pause` mode off the screen the time passes and the events
     * fire, and nothing is posed or drawn.
     *
     * `seconds` that are no finite number throw a `MarrowError`. More than 10 seconds in one
     * update advance the animations by all of them and start the physics again, as
     * `resetPhysics` does.
     *
     * @example
     * hero.autoUpdate = false;
     * app.ticker.add((ticker) => hero.update(ticker.deltaMS / 1000));
     */
    update(seconds: number): void {
        if (this.destroyed) return;
        // the page textures went with the asset: nothing of the pose could be drawn
        if (this.asset.destroyed) {
            this.autoUpdate = false;

            return;
        }
        this.checkStep(seconds);
        const due = this.pacer.take(seconds, this.skeletonView.stats.renderMode === 'batched');

        if (due < 0) return;
        if (this.dozes || this.pacer.paused) {
            this.rest(due);

            return;
        }
        // the physics did not run while nothing was drawn
        if (this.stale) this.calm();
        this.stale = false;
        if (this.probe !== null) this.measure(due, this.probe);
        else {
            this.pose(due);
            this.absorb(undefined, true);
            this.links?.move(this.engine.state);
            this.draw();
            this.idle?.update();
            this.pump.flush(this, this.asset.model.events);
        }
    }

    /**
     * Stops updating and frees what this instance holds. Every {@link Track} of it resolves its
     * `finished`, with `destroyed` when nothing ended it before. The asset is shared and stays
     * loaded. See the class for what the object does after this.
     */
    override destroy(options?: DestroyOptions): void {
        if (this.destroyed) return;
        this.autoUpdate = false;
        this.engine.clearTracks();
        // a combined skin stays while an engine shows it
        if (this.engine.skins.length > 1) this.engine.setSkin(-1);
        this.absorb('destroyed');
        this.pump.pending.clear();
        this.links?.clear();
        this.linkTo(undefined);
        this.idle?.destroy();
        this.skeletonView.destroy();
        super.destroy(options);
    }

    /**
     * An update with a probe: the same steps as without one, with the clock read between them.
     * Matching events to their tracks counts as events.
     */
    private measure(seconds: number, probe: UpdateProbe): void {
        const start = performance.now();

        this.pose(seconds);
        const posed = performance.now();

        this.absorb(undefined, true);
        const absorbed = performance.now();

        this.links?.move(this.engine.state);
        this.draw();
        this.idle?.update();
        const drawn = performance.now();

        this.pump.flush(this, this.asset.model.events);
        probe.record(posed - start, drawn - absorbed, absorbed - posed + (performance.now() - drawn));
    }

    /** Poses the skeleton, with the level of detail the last render asked for. */
    private pose(seconds: number): void {
        this.poseAt(seconds, this.pacer.small);
    }

    /** Where the pacing of updates stands, for `perf.report()`. */
    pacingStatus(): PacingStatus {
        return this.pacer.status(this.skeletonView.stats.renderMode === 'batched');
    }

    /** Brings the drawn skeleton in line with the pose, with the outlines the asset has now. */
    private draw(): void {
        const { outlines } = this.asset;

        // the scan of the page images ends some time after the load
        if (outlines !== this.outlines) {
            this.outlines = outlines;
            this.skeletonView.setOutlines(outlines);
        }
        this.skeletonView.update(this.engine.state);
    }

    /**
     * An update of an object that nothing draws. The time passes, the events fire and `finished`
     * resolves. Nothing is drawn, and an animation that plays alone is not posed either.
     */
    private rest(seconds: number): void {
        // without an entry no time passes that the picture would show
        if (this.book.live > 0) {
            if (this.engine.solo() === null) this.pose(seconds);
            else this.engine.advance(seconds);
            this.stale = true;
            this.listen();
            this.absorb(undefined, true);
        }
        this.pump.flush(this, this.asset.model.events);
    }

    /** Hears the renders from now on, through an empty child: `onRender` of this object stays the game's. */
    private listen(): void {
        if (this.watch !== undefined) return;
        this.watch = new Container({ label: 'marrow-pacing' });
        this.watch.onRender = (renderer) => this.seen(renderer);
        this.addChild(this.watch);
    }

    /**
     * What a render tells: where the skeleton is, for the pacing. A render that draws the object
     * after updates without a pose poses and draws it first, at the time its tracks are at.
     */
    private seen(renderer: Renderer): void {
        this.pacer.seen(this, renderer);
        if (!this.stale || this.pacer.paused || unseen(this, true)) return;
        this.stale = false;
        this.calm();
        this.pose(0);
        this.absorb();
        this.links?.move(this.engine.state);
        this.draw();
    }

    /** The index of an animation. Throws for a destroyed object, and for a name the skeleton lacks. */
    private animationIndex(name: unknown): number {
        return namedIndex('animation', this.parts().model.animations, name);
    }

    /** Mixes a track out through the empty animation. Its entry gets a handle that emits nothing. */
    private mixOut(track: number, mix: number): void {
        this.adopt(new TrackHandle(this, this.engine.setEmptyAnimation(track, mix), EMPTY_ANIMATION, 0), 'stopped');
    }

    /** Takes in the handle of an entry the engine made a moment ago, with the events of that command. */
    private adopt<H extends TrackHandle>(handle: H, cause?: TrackEnd): H {
        this.book.add(handle);
        this.absorb(cause);

        return handle;
    }

    /**
     * Takes the events of the engine and matches them to their tracks. The next update emits them.
     *
     * It runs after every engine command and every engine update, and before a command that
     * makes an entry. A 4.3 engine hands an entry object out again after its `dispose`. The
     * events of the earlier use must be matched before the object gets a new handle.
     *
     * @param cause Why the entries end that the command before this call ended.
     * @param emits True in an update, which emits at once: an event nobody listens for is left out.
     */
    private absorb(cause?: TrackEnd, emits = false): void {
        this.book.absorb(this.engine.takeEvents(), this.pump.pending, cause, emits ? this : undefined);
    }

    /**
     * Poses the time that `updateRate` or `offscreen` gathered, before a command changes the
     * tracks: that time plays what the tracks held. Its events fire with the next update.
     */
    private catchUp(): void {
        const carried = this.pacer.drain();

        if (carried > 0) {
            this.pose(carried);
            this.absorb();
        }
    }
}
