import { Matrix, Texture, TextureSource } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ImageBody } from '../../src/render/batch-image';
import { NO_DARK } from '../../src/render/batch-pack';
import { linkRenderer } from '../../src/render/batch-pipe';
import { MarrowBatcher } from '../../src/render/batcher';
import { MarrowDarkBatcher } from '../../src/render/dark-batcher';
import { loadMeshCode } from '../../src/render/mesh-code';
import { expectBatch, loadFamily, populate } from './batch-check';
import { createStage, type Stage } from './batch-stage';

/*
 * An image in a batch of the batched mode: the idle cache shows a skeleton at rest as one. It
 * must share the batch of the skeletons around it, where its texture fits, so that a grid of
 * symbols at rest and in play draws in one call.
 */

beforeAll(async () => {
    await loadMeshCode();
});

/** A texture of its own, of a size in pixels. */
function imageTexture(width: number, height: number): Texture {
    return new Texture({ source: new TextureSource({ width, height }) });
}

/** An image body that shows a texture, placed by a matrix, added to the stage. */
function addImage(stage: Stage, texture: Texture, matrix = new Matrix()): ImageBody {
    const body = new ImageBody('marrow-idle');

    body.texture = texture;
    body.setFromMatrix(matrix);
    body.visible = true;
    stage.root.addChild(body);

    return body;
}

/** The four vertices of an image as its batcher holds them. */
function quadOf(
    body: ImageBody,
): { x: number; y: number; u: number; v: number; tint: number; flags: number; dark: number }[] {
    const { element } = body;
    const batcher = element._batcher;

    if (!(batcher instanceof MarrowBatcher)) throw new Error('the image is in no batch of ours');
    const words = batcher.staticWords;
    const positions = batcher.attributeBuffer.float32View;

    return [0, 1, 2, 3].map((corner) => {
        const at = element._attributeStart / 2 + corner;

        return {
            x: positions[at * 2] ?? Number.NaN,
            y: positions[at * 2 + 1] ?? Number.NaN,
            u: batcher.statics[at * words] ?? Number.NaN,
            v: batcher.statics[at * words + 1] ?? Number.NaN,
            tint: batcher.staticBytes[at * words + 3] ?? 0,
            flags: batcher.staticBytes[at * words + 4] ?? 0,
            dark: words > 5 ? (batcher.staticBytes[at * words + 5] ?? 0) : 0,
        };
    });
}

describe('an image in a batch of skeletons', () => {
    it('draws in the batch of the skeletons around it, placed as Pixi places a sprite', async () => {
        const stage = createStage();
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const texture = imageTexture(40, 30);

        linkRenderer(stage.renderer);
        const before = await populate(stage, speedy, 2);
        const image = addImage(stage, texture, new Matrix(2, 0, 0, 2, 10, 20));
        const after = await populate(stage, speedy, 2);

        stage.render();
        const [draw] = stage.counts.draws;

        expect(stage.counts.draws.map((one) => one.kind)).toEqual(['batch']);
        expect(draw?.textures).toEqual([...speedy.textures.map((page) => page.source), texture.source]);
        const id = speedy.textures.length;

        expect(quadOf(image)).toEqual([
            { x: 10, y: 20, u: 0, v: 0, tint: 0xffffffff, flags: id, dark: 0 },
            { x: 90, y: 20, u: 1, v: 0, tint: 0xffffffff, flags: id, dark: 0 },
            { x: 90, y: 80, u: 1, v: 1, tint: 0xffffffff, flags: id, dark: 0 },
            { x: 10, y: 80, u: 0, v: 1, tint: 0xffffffff, flags: id, dark: 0 },
        ]);
        for (const rig of [...before, ...after]) expectBatch(rig);
    });

    it('starts a batch of its own where the textures of the batch run out', async () => {
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const stage = createStage({ maxTextures: speedy.textures.length });
        const texture = imageTexture(8, 8);

        linkRenderer(stage.renderer);
        await populate(stage, speedy, 1);
        addImage(stage, texture);
        await populate(stage, speedy, 1);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.textures)).toEqual([
            speedy.textures.map((page) => page.source),
            [texture.source],
            speedy.textures.map((page) => page.source),
        ]);
    });

    it('moves without a new build of the instructions, and builds again for another texture', async () => {
        const stage = createStage();
        const speedy = await loadFamily('4.2/speedy-ess.skel');

        linkRenderer(stage.renderer);
        await populate(stage, speedy, 1);
        const image = addImage(stage, imageTexture(10, 10));

        stage.render();
        const builds = stage.counts.builds;

        image.x += 5;
        stage.render();
        expect(stage.counts.builds).toBe(builds);
        expect(quadOf(image).map((vertex) => vertex.x)).toEqual([5, 15, 15, 5]);
        const other = imageTexture(20, 10);

        image.texture = other;
        stage.render();
        expect(stage.counts.builds).toBe(builds + 1);
        expect(stage.counts.draws[0]?.textures).toContain(other.source);
        expect(quadOf(image).map((vertex) => vertex.x)).toEqual([5, 25, 25, 5]);
    });

    it('joins a batch of skeletons with dark colors, and tints nothing dark', async () => {
        const stage = createStage();
        const alien = await loadFamily('4.2/alien-pro.skel');

        linkRenderer(stage.renderer);
        await populate(stage, alien, 1);
        const image = addImage(stage, imageTexture(10, 10));

        image.alpha = 0.5;
        stage.render();
        expect(stage.counts.draws).toHaveLength(1);
        expect(image.element._batcher).toBeInstanceOf(MarrowDarkBatcher);
        const [corner] = quadOf(image);

        expect(corner?.dark).toBe(NO_DARK >>> 0);
        // the alpha of the body, as Pixi keeps a tint: 0xAABBGGRR
        expect((corner?.tint ?? 0) >>> 24).toBe(127);
    });

    it('keeps a blend mode of its own out of the batch', async () => {
        const stage = createStage();
        const speedy = await loadFamily('4.2/speedy-ess.skel');

        linkRenderer(stage.renderer);
        await populate(stage, speedy, 1);
        const image = addImage(stage, imageTexture(10, 10));

        image.blendMode = 'add';
        await populate(stage, speedy, 1);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.blendMode)).toEqual(['normal', 'add', 'normal']);
    });
});
