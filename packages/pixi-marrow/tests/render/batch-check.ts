import { Texture, TextureSource } from 'pixi.js';
import { expect } from 'vitest';
import { importAtlas } from '../../src/formats/atlas';
import { importSkeleton } from '../../src/formats/import';
import type { AtlasModel } from '../../src/model/atlas';
import type { SkeletonModel } from '../../src/model/model';
import { createPoseEngine } from '../../src/pose/engine';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { colorByte } from '../../src/render/colors';
import { SkeletonView, type SkeletonViewOptions } from '../../src/render/skeleton-view';
import { batcherOf, bodyOf, elementOf, readRuns, readVertex, type Stage } from './batch-stage';
import { fixtureFiles, kernelPositions, kernelUVs, type Rig, trianglesOf, visibleSlots } from './rig';

/*
 * What the tests of the batched mode share: instances of one skeleton as an asset creates them,
 * and a check of what a batch holds for a skeleton against the geometry kernel.
 */

/** A skeleton that was imported once, with the page textures its instances share. */
export interface Family {
    model: SkeletonModel;
    atlas: AtlasModel;
    textures: Texture[];
    /** Creates one more instance: a pose engine and a view of its own. */
    create(options?: SkeletonViewOptions): Promise<Rig>;
}

/**
 * Imports a fixture once. Its instances share the model, the atlas and one texture of a pixel
 * per page, as the instances of an asset do. They draw in the batched mode unless asked otherwise.
 */
export async function loadFamily(
    id: string,
    change?: (model: SkeletonModel, atlas: AtlasModel) => void,
): Promise<Family> {
    const files = fixtureFiles(id);
    const model = await importSkeleton(files.skeleton);
    const atlas = importAtlas(files.atlas);

    change?.(model, atlas);
    const textures = atlas.pages.map(() => new Texture({ source: new TextureSource({ width: 1, height: 1 }) }));
    const lookup = createAttachmentLookup(model);

    return {
        model,
        atlas,
        textures,
        async create(options: SkeletonViewOptions = {}): Promise<Rig> {
            const engine = await createPoseEngine(model);
            const view = new SkeletonView(model, atlas, textures, { renderMode: 'batched', ...options });

            return { model, atlas, lookup, engine, view };
        },
    };
}

/** Some instances of a family on a stage, each in the setup pose. */
export async function populate(
    stage: Stage,
    family: Family,
    count: number,
    options?: SkeletonViewOptions,
): Promise<Rig[]> {
    const rigs: Rig[] = [];

    for (let i = 0; i < count; i++) {
        const rig = await family.create(options);

        rig.view.update(rig.engine.state);
        stage.root.addChild(rig.view.container);
        rigs.push(rig);
    }

    return rigs;
}

/** A color of a pose as the bytes of a vertex: 0xAABBGGRR. */
function colorOf(rig: Rig, slot: number, tint: ArrayLike<number>): number {
    const { colors } = rig.engine.state;
    const byte = (channel: number): number => colorByte((colors[slot * 4 + channel] ?? 0) * (tint[channel] ?? 0));

    return (byte(0) | (byte(1) << 8) | (byte(2) << 16) | (byte(3) << 24)) >>> 0;
}

/**
 * Checks what the batch holds for a rig against the geometry kernel. Every visible slot must be
 * drawn once, in draw order, with its own triangles. Its vertices must have the positions of
 * the kernel under the transform of the display object, the texture coordinates of the kernel,
 * the texture of its page and the color of its slot. Returns how many slots were checked.
 */
export function expectBatch(rig: Rig): number {
    const { view } = rig;
    const element = elementOf(view);
    const batcher = batcherOf(view);
    const body = bodyOf(view);
    const indices = readRuns(view).flat();
    const { a, b, c, d, tx, ty } = body?.groupTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    let at = 0;
    let checked = 0;

    for (const { slot, attachment } of visibleSlots(rig)) {
        const name = rig.model.slots.names[slot];
        const triangles = trianglesOf(rig, attachment);
        const first = element.layout.at[slot] ?? -1;
        const positions = kernelPositions(rig, slot, attachment);
        const { uvs, page } = kernelUVs(rig, slot, attachment);
        const source = rig.view.parts.paints.body?.element.pages[page];
        const batch = element.batches.find((candidate) =>
            candidate.textures.textures.includes(source as TextureSource),
        );

        expect(indices.slice(at, at + triangles.length), `triangles of slot ${name}`).toEqual(
            triangles.map((vertex) => first + vertex),
        );
        at += triangles.length;
        for (let vertex = 0; vertex < positions.length / 2; vertex++) {
            const x = positions[vertex * 2] ?? Number.NaN;
            const y = positions[vertex * 2 + 1] ?? Number.NaN;
            const held = readVertex(view, first + vertex);

            expect([held.x, held.y], `position ${vertex} of slot ${name}`).toEqual([
                Math.fround(a * x + c * y + tx),
                Math.fround(d * y + b * x + ty),
            ]);
            expect([held.u, held.v], `texture coordinates ${vertex} of slot ${name}`).toEqual([
                uvs[vertex * 2],
                uvs[vertex * 2 + 1],
            ]);
            expect(held.light, `color of slot ${name}`).toBe(colorOf(rig, slot, attachment.color));
            expect(batch?.textures.textures[held.texture], `page of slot ${name}`).toBe(source);
        }
        checked++;
    }
    expect(at, 'indices after the last visible slot').toBe(indices.length);
    // a skeleton with dark colors needs the batcher that has them. One without can be in either
    if (rig.model.slots.hasDark.includes(1)) expect(batcher.name).toBe('marrow-dark');

    return checked;
}
