import {
    AnimationState,
    AnimationStateData,
    AtlasAttachmentLoader,
    type Event,
    MixBlend,
    Physics,
    Skeleton,
    SkeletonBinary,
    type SkeletonData,
    SkeletonJson,
    Texture,
    TextureAtlas,
    type TrackEntry,
} from 'spine-core-4.2';
import type { AttachmentRef, TrackField } from '../../src/core';
import { attachmentRefs, eventKey, indexer, skinEntries, timelineKind } from './model-shared';
import type { RigFiles } from './official';
import {
    animationIndexer,
    COMMON_FLAGS,
    COMMON_NUMBERS,
    cachedRefs,
    createAudit,
    createPose,
    type DriverOptions,
    entryViews,
    eventRecorder,
    isConstraintKind,
    type OfficialDriver,
    type OfficialPose,
    type OfficialPoseRig,
    type RigOptions,
    setEntryFields,
    writeAttachment,
    writeColors,
    writeLocal,
    writeWorld,
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

const NUMBERS: readonly TrackField[] = [
    ...COMMON_NUMBERS,
    'mixAttachmentThreshold',
    'alphaAttachmentThreshold',
    'mixDrawOrderThreshold',
];
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

function createDriver(shared: Shared, options: DriverOptions): OfficialDriver {
    const { data } = shared;
    const skeleton = new Skeleton(data);
    // the world reference: the same bones, no constraints
    const bare = new Skeleton(data);
    const stateData = new AnimationStateData(data);
    const state = new AnimationState(stateData);
    const recorder = eventRecorder<TrackEntry, Event>(shared.animationIndex, (event) =>
        eventKey(event, shared.eventIndex(event.data)),
    );
    const entries = entryViews<TrackEntry>(shared.animationIndex);
    const pose = createPose(skeleton.bones.length, skeleton.slots.length);
    const animation = (index: number) => {
        const found = data.animations[index];

        if (found === undefined) throw new Error(`The rig has no animation ${index}`);

        return found;
    };
    const setSkin = (target: Skeleton, index: number): void => {
        target.setSkin(data.skins[index] ?? null);
    };
    const readPose = (out: OfficialPose): void => {
        skeleton.bones.forEach((bone, i) => {
            writeLocal(out.local, i, bone);
            out.inherit[i] = bone.inherit;
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
            const twin = bare.bones[i];

            if (twin === undefined) throw new Error('The two skeletons differ');
            twin.x = bone.x;
            twin.y = bone.y;
            twin.rotation = bone.rotation;
            twin.scaleX = bone.scaleX;
            twin.scaleY = bone.scaleY;
            twin.shearX = bone.shearX;
            twin.shearY = bone.shearY;
            twin.inherit = bone.inherit;
        });
        bare.updateWorldTransform(Physics.update);
        bare.bones.forEach((bone, i) => {
            writeWorld(out.world, i, bone.active, bone);
        });
    };
    const audit = options.audit ? createAudit(skeleton.bones.length, skeleton.slots.length, readPose) : undefined;

    bare.ikConstraints.length = 0;
    bare.transformConstraints.length = 0;
    bare.pathConstraints.length = 0;
    bare.physicsConstraints.length = 0;
    bare.updateCache();
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
        setSkin(index) {
            setSkin(skeleton, index);
            setSkin(bare, index);
        },
        setupPose: () => skeleton.setToSetupPose(),
        setupPoseBones: () => skeleton.setBonesToSetupPose(),
        setupPoseSlots: () => skeleton.setSlotsToSetupPose(),
        update(dt) {
            state.update(dt);
            skeleton.update(dt);
            state.apply(skeleton);
            audit?.before();
            skeleton.updateWorldTransform(Physics.update);
            audit?.after();
        },
        takeEvents: recorder.take,
        read() {
            readPose(pose);
            readWorld(pose);

            return pose;
        },
        leaks: audit?.leaks ?? [],
    };
}

/** Loads a 4.2 skeleton for posing with the official 4.2 core. */
export function loadPose42(files: RigFiles, options: RigOptions = {}): OfficialPoseRig {
    const data = readData(files);
    const shared: Shared = {
        data,
        animationIndex: animationIndexer(data.animations),
        eventIndex: indexer(data.events, 'event'),
        ref: cachedRefs(attachmentRefs(data.skins.map((skin) => skinEntries(skin.attachments)))),
    };

    if (options.stripConstraintTimelines) {
        for (const animation of data.animations) {
            animation.setTimelines(animation.timelines.filter((timeline) => !isConstraintKind(timelineKind(timeline))));
        }
    }

    return {
        info: {
            version: '4.2',
            bones: data.bones.length,
            slots: data.slots.length,
            skins: data.skins.length,
            animations: data.animations.map(({ name, duration, timelines }) => ({
                name,
                duration,
                events: timelines.some((timeline) => timelineKind(timeline) === 'event'),
            })),
        },
        createDriver: (driverOptions = {}) => createDriver(shared, driverOptions),
    };
}
