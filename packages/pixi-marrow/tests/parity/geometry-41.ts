import {
    AnimationState,
    AnimationStateData,
    AtlasAttachmentLoader,
    type Attachment,
    BoundingBoxAttachment,
    ClippingAttachment,
    MeshAttachment,
    PathAttachment,
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
} from 'spine-core-4.1';
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

/** The official UV math on a copy of the mesh whose region UVs are rounded to 32 bits. */
function roundedUvs(mesh: MeshAttachment): Float32Array | Float64Array {
    const probe = new MeshAttachment(mesh.name, mesh.path);

    probe.region = mesh.region;
    probe.regionUVs = Float32Array.from(mesh.regionUVs);
    probe.updateRegion();

    return copyFloats(probe.uvs);
}

/** What the attachment holds for the region it has now. */
function texture(atlas: TextureAtlas, attachment: RegionAttachment | MeshAttachment): OfficialTexture {
    return {
        region: regionIndex(atlas, attachment.region),
        uvs: copyFloats(attachment.uvs),
        offsets: attachment instanceof RegionAttachment ? copyFloats(attachment.offset) : null,
    };
}

const frame = (atlas: TextureAtlas, attachment: RegionAttachment | MeshAttachment): OfficialFrame => ({
    ...texture(atlas, attachment),
    roundedUvs: attachment instanceof MeshAttachment ? roundedUvs(attachment) : null,
});

/** One frame per sequence index. The official picks the region of a sequence through a slot. */
function frames(atlas: TextureAtlas, attachment: RegionAttachment | MeshAttachment, slot: Slot): OfficialFrame[] {
    const { sequence } = attachment;

    if (!sequence) return [frame(atlas, attachment)];

    return sequence.regions.map((_, index) => {
        slot.sequenceIndex = index;
        sequence.apply(slot, attachment);

        return frame(atlas, attachment);
    });
}

const drawnMesh = (ref: AttachmentRef, attachment: MeshAttachment, frames: OfficialFrame[]): OfficialDrawable => ({
    ref,
    type: 'mesh',
    regionUVs: Float64Array.from(attachment.regionUVs),
    frames,
});

function drawables({ data, atlas }: Loaded): OfficialDrawable[] {
    const slots = new Skeleton(data).slots;

    return data.skins.flatMap((skin, skinIndex) =>
        skinEntries(skin.attachments).flatMap(({ slot, name, attachment }): OfficialDrawable[] => {
            const scratch = slots[slot];

            if (!scratch || !(attachment instanceof RegionAttachment || attachment instanceof MeshAttachment))
                return [];
            const ref = { skin: skinIndex, slot, name };

            return attachment instanceof MeshAttachment
                ? [drawnMesh(ref, attachment, frames(atlas, attachment, scratch))]
                : [{ ref, type: 'region', regionUVs: null, frames: frames(atlas, attachment, scratch) }];
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

/** An attachment on a slot in its current pose. Nothing for no attachment and for a point attachment. */
function place({ atlas, ref }: Loaded, slot: Slot, attachment: Attachment | null): OfficialShown[] {
    const base = {
        slot: slot.data.index,
        bone: slot.bone.data.index,
        sequenceIndex: slot.sequenceIndex,
        deform: slot.deform,
    };

    if (attachment instanceof RegionAttachment) {
        // the official picks the region of a sequence when it computes the vertices
        attachment.sequence?.apply(slot, attachment);

        return [
            {
                ...base,
                ref: ref(attachment),
                type: 'region',
                texture: texture(atlas, attachment),
                regionUVs: null,
                worldVerticesLength: 8,
                computeWorld: (_start, _count, out, offset, stride) =>
                    attachment.computeWorldVertices(slot, out, offset, stride),
            },
        ];
    }
    if (!(attachment instanceof VertexAttachment)) return [];
    const mesh = attachment instanceof MeshAttachment ? attachment : null;

    mesh?.sequence?.apply(slot, mesh);

    return [
        {
            ...base,
            ref: ref(attachment),
            type: vertexType(attachment),
            texture: mesh ? texture(atlas, mesh) : null,
            regionUVs: mesh ? mesh.regionUVs : null,
            worldVerticesLength: attachment.worldVerticesLength,
            computeWorld: (start, count, out, offset, stride) =>
                attachment.computeWorldVertices(slot, start, count, out, offset, stride),
        },
    ];
}

function play(loaded: Loaded, animation: string | undefined, skin: string | undefined): OfficialGeometryPlayback {
    const skeleton = new Skeleton(loaded.data);
    const state = new AnimationState(new AnimationStateData(loaded.data));

    if (skin !== undefined) skeleton.setSkinByName(skin);
    skeleton.setToSetupPose();
    if (animation !== undefined) state.setAnimation(0, animation, true);

    return {
        step(dt) {
            state.update(dt);
            state.apply(skeleton);
            skeleton.updateWorldTransform();
        },
        readBones(out) {
            skeleton.bones.forEach((bone, i) => {
                out.set([bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY], i * 6);
            });
        },
        shown: () => skeleton.slots.flatMap((slot) => place(loaded, slot, slot.getAttachment())),
        stored: () =>
            loaded.data.skins.flatMap((entries) =>
                skinEntries(entries.attachments).flatMap(({ slot, attachment }) => {
                    const target = skeleton.slots[slot];

                    return target ? place(loaded, target, attachment) : [];
                }),
            ),
    };
}

/** Loads a 4.1 skeleton and its atlas with the official 4.1 core. */
export function loadGeometry41(files: RigFiles): OfficialGeometry {
    const loaded = load(files);

    return {
        version: '4.1',
        animations: loaded.data.animations.map(({ name, duration }) => ({ name, duration })),
        skins: loaded.data.skins.map((skin) => skin.name),
        drawables: () => drawables(loaded),
        play: (animation, skin) => play(loaded, animation, skin),
    };
}
