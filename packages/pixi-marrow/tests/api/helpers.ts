import { Texture, TextureSource, Ticker } from 'pixi.js';
import type { PoseEngine, PoseEvent, SkeletonModel } from '../../src/core';
import { type AtlasModel, importAtlas, importSkeleton } from '../../src/core';
import { MarrowAsset } from '../../src/index';
import { listFixtures, readFixture } from '../parity/fixtures';
import type { RigFiles } from '../parity/official';

/** The Spine versions the fixtures come in. 4.1 and 4.2 play on one pose engine, 4.3 on another. */
export const VERSIONS = ['4.1', '4.2', '4.3'] as const;

/** One frame at 60 frames per second, in seconds. */
export const FRAME = 1 / 60;

const rigs = new Map<string, Promise<{ model: SkeletonModel; atlas: AtlasModel }>>();

/** The files of a fixture, by its id, for example `4.2/spineboy-pro.skel`. */
export function fixtureFiles(id: string): RigFiles {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);

    return readFixture(fixture);
}

/** A fixture imported once per test file. The model is immutable, so tests share it. */
export function importRig(id: string): Promise<{ model: SkeletonModel; atlas: AtlasModel }> {
    let rig = rigs.get(id);

    if (rig === undefined) {
        const files = fixtureFiles(id);

        rig = importSkeleton(files.skeleton).then((model) => ({ model, atlas: importAtlas(files.atlas) }));
        rigs.set(id, rig);
    }

    return rig;
}

/** A texture of its own, so that a test can look at how it was set up. */
export function blankTexture(): Texture {
    return new Texture({ source: new TextureSource({ width: 2, height: 2 }) });
}

/** An asset from a fixture, with a blank texture per atlas page. */
export async function fixtureAsset(id: string): Promise<MarrowAsset> {
    const { model, atlas } = await importRig(id);

    return MarrowAsset.from({ model, atlas, textures: atlas.pages.map(() => Texture.WHITE) });
}

/**
 * Stops Pixi's shared ticker from asking for animation frames, which Node does not have. A test
 * advances it with `ticker.update(milliseconds)`.
 */
export function holdTicker(): Ticker {
    const ticker = Ticker.shared;

    ticker.autoStart = false;
    ticker.stop();

    return ticker;
}

/** A pose engine of its own for an asset, set up as a display object sets its engine up: y points down. */
export function bareEngine(asset: MarrowAsset): PoseEngine {
    const engine = asset.createEngine();

    engine.state.scaleY = -1;
    engine.state.yDown = true;

    return engine;
}

/** The index of an animation of a model, by name. */
export function animationIndex(model: SkeletonModel, name: string): number {
    const index = model.animations.findIndex((animation) => animation.name === name);

    if (index === -1) throw new Error(`no animation ${name}`);

    return index;
}

/** Engine events as text, one per event: the type and the animation name. The empty animation is left out. */
export function eventLabels(model: SkeletonModel, events: readonly PoseEvent[]): string[] {
    return events
        .filter((event) => event.animation !== -1)
        .map((event) => `${event.type} ${model.animations[event.animation]?.name}`);
}

/** The pose arrays of an engine, copied, for comparing two engines. */
export function poseOf(engine: PoseEngine): Record<string, unknown> {
    const { state } = engine;

    return {
        skin: state.skin,
        time: state.time,
        scale: [state.scaleX, state.scaleY],
        local: [...state.local],
        world: [...state.world],
        colors: [...state.colors],
        darkColors: [...state.darkColors],
        attachments: state.attachments.map((attachment) => attachment?.name ?? null),
        drawOrder: [...state.drawOrder],
        deformLengths: [...state.deformLengths],
    };
}
