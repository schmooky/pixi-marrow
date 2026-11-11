import { Container, type DestroyOptions, Ticker } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { unknownName } from '../base/names';
import type { SkeletonInfo } from '../model/info';
import type { EventKey } from '../model/timelines';
import type { PoseEngine, TrackFields } from '../pose/engine';
import { SkeletonView, type ViewStats } from '../render/skeleton-view';
import { MarrowAsset, type MarrowLoadOptions } from './asset';
import type { MarrowEvent, MarrowNames, MarrowSpineOptions, PlayOptions, QueueOptions, StopOptions } from './options';
import { EMPTY_ANIMATION, type Track, TrackHandle } from './track';
import { EventList, TrackBook } from './track-book';

/**
 * The events a {@link MarrowSpine} emits, each with the arguments its listeners get. They are
 * emitted at the end of `update`, in the order the official runtime calls its listener.
 *
 * The empty animation that `stop` mixes through emits nothing. What a listener causes is emitted
 * by the next update.
 */
export interface MarrowSpineEvents<N extends MarrowNames = MarrowNames> {
    /** An animation became the current one of its track. */
    start: [track: Track<N>];
    /** Another animation replaced this one as the current one. It may still mix out. */
    interrupt: [track: Track<N>];
    /** The animation will not be applied again. */
    end: [track: Track<N>];
    /** The track let go of the animation. A queued animation that never started gets this alone. */
    dispose: [track: Track<N>];
    /** The animation played to its end. A looping animation completes once per loop. */
    complete: [track: Track<N>];
    /** An animation fired an event key. */
    event: [event: MarrowEvent<N>, track: Track<N>];
}

/** The index of the item with a name, or -1. */
function indexOfName(items: readonly { name: string }[], name: string): number {
    for (let i = 0; i < items.length; i++) {
        if (items[i]?.name === name) return i;
    }

    return -1;
}

/** The fields of a track entry that play options set, or undefined when they set none. */
function entryFields(options: PlayOptions): TrackFields | undefined {
    const { mix, speed, alpha, reverse } = options;

    if (mix === undefined && speed === undefined && alpha === undefined && reverse === undefined) return undefined;
    const fields: TrackFields = {};

    if (mix !== undefined) fields.mixDuration = mix;
    if (speed !== undefined) fields.timeScale = speed;
    if (alpha !== undefined) fields.alpha = alpha;
    if (reverse !== undefined) fields.reverse = reverse;

    return fields;
}

/**
 * A Spine skeleton as a Pixi display object. It plays animations on tracks, mixes between them
 * and draws the result.
 *
 * Pass the names type that `pixi-marrow typegen` writes to make a misspelled name a compile error.
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
export class MarrowSpine<N extends MarrowNames = MarrowNames> extends Container {
    /** What this object shares with the other instances of its skeleton. */
    readonly asset: MarrowAsset;
    /**
     * The pose engine of this instance. An escape hatch: it is not stable and may change in any
     * release. An animation set on it directly gets no {@link Track} and emits no events.
     */
    readonly engine: PoseEngine;
    private readonly skeletonView: SkeletonView;
    private readonly book = new TrackBook();
    /** The engine events since the last emit. */
    private pending = new EventList();
    /** The second list: events that listeners cause wait in `pending` for the next update. */
    private spare = new EventList();
    private emitting = false;
    private ticking = false;

    /**
     * Creates one more instance of a loaded skeleton. It shows the setup pose until an animation
     * plays. The pose is flipped to Pixi's y axis, which points down.
     *
     * @param asset The loaded skeleton, from `MarrowAsset.load` or `MarrowAsset.from`.
     */
    constructor(asset: MarrowAsset, options: MarrowSpineOptions = {}) {
        super();
        if (asset.destroyed) {
            throw new MarrowError('invalid-data', 'The asset was destroyed.', { fix: 'Load the asset again.' });
        }
        this.asset = asset;
        this.engine = asset.createEngine();
        // Spine's y axis points up and Pixi's points down. The official Pixi runtime flips the pose too
        this.engine.state.scaleY = -1;
        this.skeletonView = new SkeletonView(asset.model, asset.atlas, asset.textures);
        this.addChild(this.skeletonView.container);
        // the setup pose, so that the object draws before its first update
        this.engine.update(0);
        this.skeletonView.update(this.engine.state);
        this.autoUpdate = options.autoUpdate ?? true;
    }

    /**
     * Loads a skeleton and creates a display object for it: `MarrowAsset.load`, then `new MarrowSpine`.
     * Loads of the same files share one asset.
     *
     * @example
     * const hero = await MarrowSpine.load<HeroNames>({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
     * hero.play('idle', { loop: true });
     */
    static async load<N extends MarrowNames = MarrowNames>(
        options: MarrowLoadOptions & MarrowSpineOptions,
    ): Promise<MarrowSpine<N>> {
        return new MarrowSpine<N>(await MarrowAsset.load(options), options);
    }

    /** The names, counts and features of the skeleton, as plain data. */
    get info(): SkeletonInfo {
        return this.asset.info;
    }

    /** Counters of the render path: draw calls, vertices and how often buffers were rebuilt. */
    get stats(): ViewStats {
        return this.skeletonView.stats;
    }

    /** The name of the active skin, or null. Setting it also resets the slots to the setup pose. */
    get skin(): N['skins'] | null {
        const name: string | null = this.asset.model.skins[this.engine.state.skin]?.name ?? null;

        // the names type lists the skins of this skeleton
        return name as N['skins'] | null;
    }

    set skin(name: N['skins'] | null) {
        const skins = this.asset.model.skins;
        const index = name === null ? -1 : indexOfName(skins, name);

        if (name !== null && index === -1) {
            throw unknownName(
                'skin',
                String(name),
                skins.map((skin) => skin.name),
            );
        }
        this.engine.setSkin(index);
        this.engine.setupPoseSlots();
    }

    /** Multiplies the time every track advances by. 1 is normal speed. */
    get timeScale(): number {
        return this.engine.timeScale;
    }

    set timeScale(value: number) {
        this.engine.timeScale = value;
    }

    /** Seconds to mix between two animations that have no mix set with {@link setMix}. */
    get defaultMix(): number {
        return this.engine.defaultMix;
    }

    set defaultMix(seconds: number) {
        this.engine.defaultMix = seconds;
    }

    /**
     * True when the object updates itself from Pixi's shared ticker, with the seconds the ticker
     * measured. Set it to false to call {@link update} yourself.
     */
    get autoUpdate(): boolean {
        return this.ticking;
    }

    set autoUpdate(value: boolean) {
        if (value === this.ticking) return;
        this.ticking = value;
        if (value) Ticker.shared.add(this.onTick, this);
        else Ticker.shared.remove(this.onTick, this);
    }

    /** Sets the seconds to mix when animation `from` changes to animation `to`. */
    setMix(from: N['animations'], to: N['animations'], seconds: number): void {
        this.engine.setMix(this.animationIndex(from), this.animationIndex(to), seconds);
    }

    /**
     * Plays an animation on a track now. It mixes from what the track holds and drops what was
     * queued there. Throws a `MarrowError` with code `unknown-name` for a name the skeleton lacks.
     *
     * @example
     * hero.play('idle', { loop: true });
     * const shot = hero.play('shoot', { track: 1, mix: 0.1, speed: 1.5 });
     * await shot.finished;
     */
    play(name: N['animations'], options: PlayOptions = {}): Track<N> {
        const index = this.animationIndex(name);

        this.absorb();
        const entry = this.engine.setAnimation(options.track ?? 0, index, options.loop ?? false);
        const handle = this.adopt(new TrackHandle<N>(this, entry, name, this.durationOf(index)));
        const fields = entryFields(options);

        // after the handle is known: a field the engine refuses throws, and the animation still plays
        if (fields !== undefined) handle.configure(fields);

        return handle;
    }

    /**
     * Plays an animation after what a track holds. On an empty track it plays now. Throws a
     * `MarrowError` with code `unknown-name` for a name the skeleton lacks.
     *
     * @example
     * hero.play('jump');
     * hero.queue('run', { loop: true, mix: 0.2 });
     */
    queue(name: N['animations'], options: QueueOptions = {}): Track<N> {
        const index = this.animationIndex(name);
        const track = options.track ?? 0;
        const delay = options.delay ?? 0;

        this.absorb();
        const before = this.book.last(track);
        const entry = this.engine.addAnimation(track, index, options.loop ?? false, delay);
        const handle = this.adopt(new TrackHandle<N>(this, entry, name, this.durationOf(index)));
        const fields = entryFields(options);

        if (fields !== undefined) {
            // the engine timed the entry with the mix it knew. The official setMixDuration times it again
            if (options.mix !== undefined && before !== undefined && delay <= 0) {
                const early = this.asset.model.version === '4.1';
                const start = early
                    ? delay + (before.trackComplete() - options.mix)
                    : Math.max(delay + before.trackComplete() - options.mix, 0);

                fields.delay = start;
            }
            handle.configure(fields);
        }

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
            this.absorb();
        }
    }

    /**
     * Advances the animations by `seconds`, brings the drawn skeleton in line with the new pose,
     * then emits the events. Call it once per frame when {@link autoUpdate} is false.
     *
     * @example
     * hero.autoUpdate = false;
     * app.ticker.add((ticker) => hero.update(ticker.deltaMS / 1000));
     */
    update(seconds: number): void {
        if (this.destroyed) return;
        this.engine.update(seconds);
        this.absorb();
        this.skeletonView.update(this.engine.state);
        this.emitPending();
    }

    /**
     * Stops updating and frees what this instance holds. Every {@link Track} of it resolves its
     * `finished`. The asset is shared and stays loaded.
     */
    override destroy(options?: DestroyOptions): void {
        if (this.destroyed) return;
        this.autoUpdate = false;
        this.engine.clearTracks();
        this.absorb();
        this.pending.clear();
        this.skeletonView.destroy();
        super.destroy(options);
    }

    private onTick(ticker: Ticker): void {
        this.update(ticker.deltaMS / 1000);
    }

    private animationIndex(name: string): number {
        const animations = this.asset.model.animations;
        const index = indexOfName(animations, name);

        if (index === -1) {
            throw unknownName(
                'animation',
                String(name),
                animations.map((animation) => animation.name),
            );
        }

        return index;
    }

    private durationOf(animation: number): number {
        return this.asset.model.animations[animation]?.duration ?? 0;
    }

    /** Mixes a track out through the empty animation. Its entry gets a handle that emits nothing. */
    private mixOut(track: number, mix: number): void {
        this.adopt(new TrackHandle(this, this.engine.setEmptyAnimation(track, mix), EMPTY_ANIMATION, 0));
    }

    /** Takes in the handle of an entry the engine made a moment ago, with the events of that command. */
    private adopt<H extends TrackHandle>(handle: H): H {
        this.book.add(handle);
        this.absorb();

        return handle;
    }

    /**
     * Takes the events of the engine and matches them to their tracks. The next update emits them.
     *
     * It runs after every engine command and every engine update, and before a command that
     * makes an entry. A 4.3 engine hands an entry object out again after its `dispose`. The
     * events of the earlier use must be matched before the object gets a new handle.
     */
    private absorb(): void {
        this.book.absorb(this.engine.takeEvents(), this.pending);
    }

    private emitPending(): void {
        const list = this.pending;

        // a listener that calls update: the events of that update wait for the next one
        if (list.types.length === 0 || this.emitting) return;
        // what listeners cause is emitted by the next update, so a listener cannot loop forever
        this.pending = this.spare;
        this.spare = list;
        this.emitting = true;
        try {
            for (let i = 0; i < list.types.length && !this.destroyed; i++) this.emitOne(list, i);
        } finally {
            this.emitting = false;
            list.clear();
        }
    }

    private emitOne(list: EventList, at: number): void {
        const type = list.types[at];
        const handle = list.handles[at];
        const key = list.keys[at];

        if (type === undefined || handle === undefined) return;
        if (type !== 'event') this.emit(type, handle);
        else if (key !== undefined && this.listenerCount('event') > 0) this.emit('event', this.eventOf(key), handle);
    }

    private eventOf(key: EventKey): MarrowEvent {
        return {
            name: this.asset.model.events[key.event]?.name ?? '',
            int: key.int,
            float: key.float,
            string: key.string,
            volume: key.volume,
            balance: key.balance,
            time: key.time,
        };
    }
}
