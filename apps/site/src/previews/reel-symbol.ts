import { type MarrowAsset, MarrowSpine, type MarrowSpineOptions } from 'pixi-marrow';
import { ReelSymbol } from 'pixi-reels';

/*
 * A reel symbol of pixi-reels drawn with pixi-marrow. pixi-reels ships `SpineReelSymbol` for
 * the official runtime. This one plays the animations of the symbols of the slot game Bzzz the
 * way that game does:
 *
 * - `idle` loops while the symbol rests. A symbol without it shows its setup pose.
 * - `blur_in` plays when its reel starts to spin and holds the blurred frame.
 * - `blur_out` and then `landing` play when the reel stops.
 * - `win` plays on a win, and `disable` dims the symbols that did not win.
 *
 * The skeletons are made once per symbol and kept. A symbol that leaves the reel takes its
 * skeleton off the stage, so that it does not update while nobody sees it.
 */

/** The size of a cell the Bzzz symbols are drawn for, in their own units. */
const DESIGN_CELL = 140;

/** What a {@link MarrowReelSymbol} is made with. */
export interface MarrowReelSymbolOptions {
    /** The asset of each symbol id. */
    readonly assets: Readonly<Record<string, MarrowAsset>>;
    /** The options of every skeleton: the perf preset, the skinning, the render mode. */
    readonly spine?: MarrowSpineOptions;
}

/** A symbol of a reel set: one Bzzz skeleton per symbol id, played by the reel's beats. */
export class MarrowReelSymbol extends ReelSymbol {
    private readonly assets: Readonly<Record<string, MarrowAsset>>;
    private readonly options: MarrowSpineOptions;
    private readonly spines = new Map<string, MarrowSpine>();
    private current: MarrowSpine | null = null;
    /** True while the reel of this symbol spins. */
    private spinning = false;
    /** The size of the cell, which the skeletons are centred in and scaled to. */
    private width = DESIGN_CELL;
    private height = DESIGN_CELL;

    constructor(options: MarrowReelSymbolOptions) {
        super();
        this.assets = options.assets;
        this.options = options.spine ?? {};
    }

    /** The skeleton that shows, or null between two symbols. */
    get spine(): MarrowSpine | null {
        return this.current;
    }

    // #region activate
    protected onActivate(symbolId: string): void {
        let spine = this.spines.get(symbolId);

        if (spine === undefined) {
            const asset = this.assets[symbolId];

            if (asset === undefined) throw new Error(`no asset for the symbol "${symbolId}"`);
            spine = new MarrowSpine(asset, { ...this.options, autoUpdate: false });
            spine.defaultMix = 0.1;
            this.spines.set(symbolId, spine);
            this.place(spine);
        }
        this.current = spine;
        spine.autoUpdate = true;
        this.view.addChild(spine);
        if (this.spinning) this.blurred();
        else this.rest();
    }
    // #endregion

    protected onDeactivate(): void {
        const spine = this.current;

        if (spine === null) return;
        spine.autoUpdate = false;
        spine.stop();
        this.view.removeChild(spine);
        this.current = null;
    }

    async playWin(): Promise<void> {
        await this.oneShot('win');
    }

    override async playLanding(): Promise<void> {
        await this.oneShot('landing');
    }

    /** Dims the symbol: the `disable` pose of a symbol that did not win. */
    disable(): void {
        if (this.has('disable')) this.current?.play('disable', { mix: 0.15 });
    }

    stopAnimation(): void {
        this.rest();
    }

    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        for (const spine of this.spines.values()) this.place(spine);
    }

    override onReelSpinStart(): void {
        this.spinning = true;
        this.blurred();
    }

    // #region landed
    override onReelLanded(): void {
        this.spinning = false;
        const spine = this.current;

        if (spine === null) return;
        if (!this.has('blur_out')) {
            void this.playLanding();

            return;
        }
        spine.play('blur_out');
        if (this.has('landing')) spine.queue('landing');
        this.queueRest();
    }
    // #endregion

    protected override onDestroy(): void {
        for (const spine of this.spines.values()) spine.destroy();
        this.spines.clear();
        this.current = null;
    }

    /** Centres a skeleton in the cell and scales it to the cell. The skeletons are centred on their origin. */
    private place(spine: MarrowSpine): void {
        spine.position.set(this.width / 2, this.height / 2);
        spine.scale.set(Math.min(this.width, this.height) / DESIGN_CELL);
    }

    /** True when the skeleton that shows has an animation of this name. */
    private has(name: string): boolean {
        return this.current?.asset.model.animations.some((animation) => animation.name === name) ?? false;
    }

    /** The idle loop, or the setup pose for a symbol without one. */
    private rest(): void {
        const spine = this.current;

        if (spine === null) return;
        if (this.has('idle')) spine.play('idle', { loop: true, mix: 0.1 });
        else spine.stop();
    }

    /** Queues the idle loop after what plays, or nothing for a symbol without one. */
    private queueRest(): void {
        if (this.has('idle')) this.current?.queue('idle', { loop: true, mix: 0.1 });
    }

    /** The blurred frame of a spinning reel: the end of `blur_in`. */
    private blurred(): void {
        if (this.has('blur_in')) this.current?.play('blur_in');
    }

    /** Plays an animation once, then the idle loop. Resolves when the animation has played. */
    private async oneShot(name: string): Promise<void> {
        const spine = this.current;

        if (spine === null || !this.has(name)) return;
        const track = spine.play(name, { mix: 0.1 });

        this.queueRest();
        await track.finished;
    }
}
