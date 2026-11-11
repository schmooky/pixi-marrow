import {
    AnimationState,
    AnimationStateData,
    AtlasAttachmentLoader,
    type Attachment,
    BoundingBoxAttachment,
    ClippingAttachment,
    MeshAttachment,
    PathAttachment,
    Physics,
    RegionAttachment,
    Skeleton,
    SkeletonBinary,
    type SkeletonData,
    SkeletonJson,
    type Slot,
    Texture,
    TextureAtlas,
    type TextureRegion,
    VertexAttachment,
} from 'spine-core-4.3';
import type { AttachmentRef } from '../../src/core';
import { copyFloats } from './geometry-compare';
import type {
    OfficialDrawable,
    OfficialFrame,
    OfficialGeometry,
    OfficialGeometryPlayback,
    OfficialShown,
    OfficialTexture,
} from './geometry-official';
import { attachmentRefs, skinEntries } from './model-shared';
import type { RigFiles } from './official';

/** Stands in for a GPU texture. The loader computes regions from the atlas text. */
class FakeTexture extends Texture {
    setFilters(): void {}
    setWraps(): void {}
    dispose(): void {}
}

interface Loaded {
    data: SkeletonData;
    atlas: TextureAtlas;
    /** Finds the skin entry of an official attachment by identity. */
    ref: (attachment: object) => AttachmentRef;
}

function load(files: RigFiles): Loaded {
    const atlas = new TextureAtlas(files.atlas);

    for (const page of atlas.pages) {
        const image: ImageBitmap = { width: page.width, height: page.height, close() {} };

        page.setTexture(new FakeTexture(image));
    }
    const loader = new AtlasAttachmentLoader(atlas);
    const data =
        typeof files.skeleton === 'string'
            ? new SkeletonJson(loader).readSkeletonData(files.skeleton)
            : new SkeletonBinary(loader).readSkeletonData(files.skeleton);

    return { data, atlas, ref: attachmentRefs(data.skins.map((skin) => skinEntries(skin.attachments))) };
}

/** The position of a region in the official atlas, or -1. */
function regionIndex(atlas: TextureAtlas, region: TextureRegion | null | undefined): number {
    const regions: readonly (TextureRegion | null | undefined)[] = atlas.regions;

    return regions.indexOf(region);
}

/** The official UV math on the region UVs of a mesh rounded to 32 bits. */
function roundedUvs(region: TextureRegion | null, mesh: MeshAttachment): Float32Array {
    const rounded = Float32Array.from(mesh.regionUVs);
    // the official Sequence.update allocates the UVs with Utils.newFloatArray: 32-bit
    const uvs = new Float32Array(rounded.length);

    MeshAttachment.computeUVs(region, rounded, uvs);

    return uvs;
}

/** 4.3 keeps the UVs and the offsets of every sequence index in the sequence, from load time on. */
function texture(atlas: TextureAtlas, attachment: RegionAttachment | MeshAttachment, index: number): OfficialTexture {
    const { sequence } = attachment;

    return {
        region: regionIndex(atlas, sequence.regions[index]),
        uvs: copyFloats(sequence.getUVs(index)),
        offsets: attachment instanceof RegionAttachment ? copyFloats(sequence.offsets?.[index] ?? []) : null,
    };
}

function frames(atlas: TextureAtlas, attachment: RegionAttachment | MeshAttachment): OfficialFrame[] {
    return attachment.sequence.regions.map((region, index) => ({
        ...texture(atlas, attachment, index),
        roundedUvs: attachment instanceof MeshAttachment ? roundedUvs(region, attachment) : null,
    }));
}

const drawnMesh = (ref: AttachmentRef, attachment: MeshAttachment, frames: OfficialFrame[]): OfficialDrawable => ({
    ref,
    type: 'mesh',
    regionUVs: Float64Array.from(attachment.regionUVs),
    frames,
});

function drawables({ data, atlas }: Loaded): OfficialDrawable[] {
    return data.skins.flatMap((skin, skinIndex) =>
        skinEntries(skin.attachments).flatMap(({ slot, name, attachment }): OfficialDrawable[] => {
            if (!(attachment instanceof RegionAttachment || attachment instanceof MeshAttachment)) return [];
            const ref = { skin: skinIndex, slot, name };

            return attachment instanceof MeshAttachment
                ? [drawnMesh(ref, attachment, frames(atlas, attachment))]
                : [{ ref, type: 'region', regionUVs: null, frames: frames(atlas, attachment) }];
        }),
    );
}

function vertexType(attachment: VertexAttachment): OfficialShown['type'] {
    if (attachment instanceof MeshAttachment) return 'mesh';
    if (attachment instanceof BoundingBoxAttachment) return 'boundingbox';
    if (attachment instanceof PathAttachment) return 'path';
    if (attachment instanceof ClippingAttachment) return 'clipping';
    throw new Error(`Unknown official vertex attachment class: ${attachment.constructor.name}`);
}

/**
 * An attachment on a slot in its current pose. Nothing for no attachment and for a point
 * attachment. 4.3 keeps the pose apart from the object: the applied pose is the one to render.
 */
function place({ atlas, ref }: Loaded, skeleton: Skeleton, slot: Slot, attachment: Attachment | null): OfficialShown[] {
    const pose = slot.appliedPose;
    const base = {
        slot: slot.data.index,
        bone: slot.bone.data.index,
        sequenceIndex: pose.sequenceIndex,
        deform: pose.deform,
    };

    if (attachment instanceof RegionAttachment) {
        return [
            {
                ...base,
                ref: ref(attachment),
                type: 'region',
                texture: texture(atlas, attachment, attachment.sequence.resolveIndex(pose)),
                regionUVs: null,
                worldVerticesLength: 8,
                computeWorld: (_start, _count, out, offset, stride) =>
                    attachment.computeWorldVertices(slot, attachment.getOffsets(pose), out, offset, stride),
            },
        ];
    }
    if (!(attachment instanceof VertexAttachment)) return [];
    const mesh = attachment instanceof MeshAttachment ? attachment : null;

    return [
        {
            ...base,
            ref: ref(attachment),
            type: vertexType(attachment),
            texture: mesh ? texture(atlas, mesh, mesh.sequence.resolveIndex(pose)) : null,
            regionUVs: mesh ? mesh.regionUVs : null,
            worldVerticesLength: attachment.worldVerticesLength,
            computeWorld: (start, count, out, offset, stride) =>
                attachment.computeWorldVertices(skeleton, slot, start, count, out, offset, stride),
        },
    ];
}

function play(loaded: Loaded, animation: string | undefined, skin: string | undefined): OfficialGeometryPlayback {
    const skeleton = new Skeleton(loaded.data);
    const state = new AnimationState(new AnimationStateData(loaded.data));

    if (skin !== undefined) skeleton.setSkin(skin);
    skeleton.setupPose();
    if (animation !== undefined) state.setAnimation(0, animation, true);

    return {
        step(dt) {
            state.update(dt);
            skeleton.update(dt);
            state.apply(skeleton);
            skeleton.updateWorldTransform(Physics.update);
        },
        readBones(out) {
            skeleton.bones.forEach((bone, i) => {
                const pose = bone.appliedPose;

                out.set([pose.a, pose.b, pose.c, pose.d, pose.worldX, pose.worldY], i * 6);
            });
        },
        shown: () => skeleton.slots.flatMap((slot) => place(loaded, skeleton, slot, slot.appliedPose.attachment)),
        stored: () =>
            loaded.data.skins.flatMap((entries) =>
                skinEntries(entries.attachments).flatMap(({ slot, attachment }) => {
                    const target = skeleton.slots[slot];

                    return target ? place(loaded, skeleton, target, attachment) : [];
                }),
            ),
    };
}

/** Loads a 4.3 skeleton and its atlas with the official 4.3 core. */
export function loadGeometry43(files: RigFiles): OfficialGeometry {
    const loaded = load(files);

    return {
        version: '4.3',
        animations: loaded.data.animations.map(({ name, duration }) => ({ name, duration })),
        skins: loaded.data.skins.map((skin) => skin.name),
        drawables: () => drawables(loaded),
        play: (animation, skin) => play(loaded, animation, skin),
    };
}
