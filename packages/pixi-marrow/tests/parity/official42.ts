import {
    AnimationState,
    AnimationStateAdapter,
    AnimationStateData,
    AtlasAttachmentLoader,
    type Event,
    Physics,
    Skeleton,
    SkeletonBinary,
    type SkeletonData,
    SkeletonJson,
    Texture,
    TextureAtlas,
    type TrackEntry,
} from 'spine-core-4.2';
import type { OfficialPlayback, OfficialRig, RigFiles } from './official';

/** Stands in for a GPU texture. Posing needs page sizes only. */
class FakeTexture extends Texture {
    setFilters(): void {}
    setWraps(): void {}
    dispose(): void {}
}

class EventRecorder extends AnimationStateAdapter {
    names: string[] = [];

    override event(_entry: TrackEntry, event: Event): void {
        this.names.push(event.data.name);
    }
}

function readData(files: RigFiles): SkeletonData {
    const atlas = new TextureAtlas(files.atlas);

    for (const page of atlas.pages) {
        const image: ImageBitmap = { width: page.width, height: page.height, close() {} };

        page.setTexture(new FakeTexture(image));
    }
    const loader = new AtlasAttachmentLoader(atlas);

    return typeof files.skeleton === 'string'
        ? new SkeletonJson(loader).readSkeletonData(files.skeleton)
        : new SkeletonBinary(loader).readSkeletonData(files.skeleton);
}

function play(data: SkeletonData, animation: string, loop: boolean, skin: string | undefined): OfficialPlayback {
    const skeleton = new Skeleton(data);
    const state = new AnimationState(new AnimationStateData(data));
    const recorder = new EventRecorder();

    if (skin !== undefined) skeleton.setSkinByName(skin);
    skeleton.setToSetupPose();
    state.addListener(recorder);
    state.setAnimation(0, animation, loop);

    return {
        step(dt) {
            state.update(dt);
            skeleton.update(dt);
            state.apply(skeleton);
            skeleton.updateWorldTransform(Physics.update);
        },
        readBones(out) {
            skeleton.bones.forEach((bone, i) => {
                out.set([bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY], i * 6);
            });
        },
        readSlotColors(out) {
            skeleton.slots.forEach((slot, i) => {
                out.set([slot.color.r, slot.color.g, slot.color.b, slot.color.a], i * 4);
            });
        },
        readAttachments: () => skeleton.slots.map((slot) => slot.getAttachment()?.name ?? null),
        readDrawOrder(out) {
            skeleton.drawOrder.forEach((slot, i) => {
                out[i] = slot.data.index;
            });
        },
        takeEvents: () => recorder.names.splice(0),
    };
}

/** Loads a 4.2 skeleton with the official 4.2 core. */
export function load42(files: RigFiles): OfficialRig {
    const data = readData(files);

    return {
        version: '4.2',
        boneNames: data.bones.map((bone) => bone.name),
        slotNames: data.slots.map((slot) => slot.name),
        skinNames: data.skins.map((skin) => skin.name),
        animations: data.animations.map(({ name, duration }) => ({ name, duration })),
        constraintCount:
            data.ikConstraints.length +
            data.transformConstraints.length +
            data.pathConstraints.length +
            data.physicsConstraints.length,
        play: (animation, loop, skin) => play(data, animation, loop, skin),
    };
}
