import {
    AnimationState,
    AnimationStateData,
    AtlasAttachmentLoader,
    type Event,
    MixBlend,
    Skeleton,
    SkeletonBinary,
    type SkeletonData,
    SkeletonJson,
    Texture,
    TextureAtlas,
    type TrackEntry,
} from 'spine-core-4.1';
import type { AttachmentRef, TrackField } from '../../src/core';
import { attachmentRefs, eventKey, indexer, skinEntries, timelineKind } from './model-shared';
import type { RigFiles } from './official';
import { describeAnimation } from './pose-info';
import {
    animationIndexer,
    COMMON_FLAGS,
    COMMON_NUMBERS,
    cachedRefs,
    createPose,
    entryViews,
    eventRecorder,
    type OfficialDriver,
    type OfficialPose,
    type OfficialPoseRig,
    setEntryFields,
    writeAttachment,
    writeColors,
    writeLocal,
    writeWorld,
    yDownKeeper,
} from './pose-shared';

/** Stands in for a GPU texture. Posing needs page sizes only. */
class FakeTexture extends Texture {
    setFilters(): void {}
    setWraps(): void {}
    dispose(): void {}
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

/** What the drivers of one rig share. */
interface Shared {
    data: SkeletonData;
    animationIndex: (animation: object | null) => number;
    eventIndex: (event: SkeletonData['events'][number]) => number;
    ref: (attachment: object | null | undefined) => AttachmentRef | null;
}

const NUMBERS: readonly TrackField[] = [...COMMON_NUMBERS, 'attachmentThreshold', 'drawOrderThreshold'];
const FLAGS: readonly TrackField[] = [...COMMON_FLAGS, 'holdPrevious'];

function configure(entry: TrackEntry, field: string, value: number | boolean | string): boolean {
    if (field === 'animationLast' && typeof value === 'number') {
        // the plain field is overwritten by the next update, the setter is what the official API offers
        entry.setAnimationLast(value);

        return true;
    }
    if (field === 'mixBlend' && (value === 'replace' || value === 'add')) {
        entry.mixBlend = value === 'add' ? MixBlend.add : MixBlend.replace;

        return true;
    }

    return false;
}

function createDriver(shared: Shared): OfficialDriver {
    const { data } = shared;
    const skeleton = new Skeleton(data);
    const stateData = new AnimationStateData(data);
    const state = new AnimationState(stateData);
    const entries = entryViews<TrackEntry>(shared.animationIndex);
    const recorder = eventRecorder<TrackEntry, Event>(entries, shared.animationIndex, (event) =>
        eventKey(event, shared.eventIndex(event.data)),
    );
    const pose = createPose(skeleton.bones.length, skeleton.slots.length);
    const yDown = yDownKeeper(skeleton, Skeleton);
    const animation = (index: number) => {
        const found = data.animations[index];

        if (found === undefined) throw new Error(`The rig has no animation ${index}`);

        return found;
    };
    const setSkin = (index: number): void => {
        const skin = data.skins[index];

        if (skin !== undefined) skeleton.setSkin(skin);
        else if (skeleton.skin !== null) {
            // what setSkin(null) does. The typings do not take null.
            skeleton.skin = null;
            skeleton.updateCache();
        }
    };
    const readPose = (out: OfficialPose): void => {
        skeleton.bones.forEach((bone, i) => {
            writeLocal(out.local, i, bone);
            out.inherit[i] = bone.data.transformMode;
            out.active[i] = bone.active ? 1 : 0;
        });
        skeleton.slots.forEach((slot, i) => {
            writeColors(out, i, slot.color, slot.darkColor);
            writeAttachment(out, i, shared.ref(slot.attachment), slot.sequenceIndex, slot.deform);
        });
        skeleton.drawOrder.forEach((slot, i) => {
            out.drawOrder[i] = slot.data.index;
        });
    };
    const readWorld = (out: OfficialPose): void => {
        skeleton.bones.forEach((bone, i) => {
            writeWorld(out.world, i, bone.active, bone);
        });
    };

    state.addListener(recorder.listener);

    return {
        get timeScale() {
            return state.timeScale;
        },
        set timeScale(value) {
            state.timeScale = value;
        },
        get defaultMix() {
            return stateData.defaultMix;
        },
        set defaultMix(value) {
            stateData.defaultMix = value;
        },
        setMix: (from, to, duration) => stateData.setMixWith(animation(from), animation(to), duration),
        setAnimation: (track, index, loop) => entries.view(state.setAnimationWith(track, animation(index), loop)),
        addAnimation: (track, index, loop, delay) =>
            entries.view(state.addAnimationWith(track, animation(index), loop, delay)),
        setEmptyAnimation: (track, mixDuration) => entries.view(state.setEmptyAnimation(track, mixDuration)),
        addEmptyAnimation: (track, mixDuration, delay) =>
            entries.view(state.addEmptyAnimation(track, mixDuration, delay)),
        configure(view, fields) {
            const entry = entries.official(view);

            setEntryFields(entry, fields, NUMBERS, FLAGS, (field, value) => configure(entry, field, value));
        },
        clearTrack: (track) => state.clearTrack(track),
        clearTracks: () => state.clearTracks(),
        setSkin,
        setupPose: () => skeleton.setToSetupPose(),
        setupPoseBones: () => skeleton.setBonesToSetupPose(),
        setupPoseSlots: () => skeleton.setSlotsToSetupPose(),
        update(dt) {
            state.update(dt);
            state.apply(skeleton);
            yDown.solve(() => skeleton.updateWorldTransform());
        },
        // 4.1 has no physics: the mode is kept and changes nothing
        physics: 'update',
        physicsTranslate() {},
        physicsRotate() {},
        forces() {},
        takeEvents: recorder.take,
        place(x, y, scaleX, scaleY) {
            Object.assign(skeleton, { x, y, scaleX });
            yDown.place(scaleY);
        },
        yDown: (value) => yDown.set(value),
        read() {
            readPose(pose);
            readWorld(pose);

            return pose;
        },
    };
}

/** Loads a 4.1 skeleton for posing with the official 4.1 core. */
export function loadPose41(files: RigFiles): OfficialPoseRig {
    const data = readData(files);
    const shared: Shared = {
        data,
        animationIndex: animationIndexer(data.animations),
        eventIndex: indexer(data.events, 'event'),
        ref: cachedRefs(attachmentRefs(data.skins.map((skin) => skinEntries(skin.attachments)))),
    };

    return {
        info: {
            version: '4.1',
            bones: data.bones.length,
            slots: data.slots.length,
            skins: data.skins.length,
            animations: data.animations.map((animation) => describeAnimation(animation, timelineKind)),
            physics: 0,
            sliders: 0,
        },
        createDriver: () => createDriver(shared),
    };
}
