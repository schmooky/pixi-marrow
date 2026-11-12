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
    isIgnoredKind,
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

/** The numbers of an official object that `follow` copies, by name. */
function copyFields<T extends object>(from: T, to: T | undefined, fields: readonly (keyof T)[]): void {
    if (to === undefined) throw new Error('The two skeletons differ');
    for (const field of fields) to[field] = from[field];
}

/**
 * Gives the second skeleton everything its IK, transform and path constraints read and an
 * animation or a setup pose call can change: the local pose and the inherit mode of every bone,
 * the values of every constraint of the three kinds, and the attachment and deform of every slot,
 * which a path constraint reads. Physics constraints are not copied: they do not run there.
 */
function follow(from: Skeleton, to: Skeleton): void {
    from.bones.forEach((bone, i) => {
        copyFields(bone, to.bones[i], ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'inherit']);
    });
    from.ikConstraints.forEach((constraint, i) => {
        copyFields(constraint, to.ikConstraints[i], ['mix', 'softness', 'bendDirection', 'compress', 'stretch']);
    });
    from.transformConstraints.forEach((constraint, i) => {
        const mixes = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'] as const;

        copyFields(constraint, to.transformConstraints[i], mixes);
    });
    from.pathConstraints.forEach((constraint, i) => {
        copyFields(constraint, to.pathConstraints[i], ['position', 'spacing', 'mixRotate', 'mixX', 'mixY']);
    });
    from.slots.forEach((slot, i) => {
        const twin = to.slots[i];

        if (twin === undefined) throw new Error('The two skeletons differ');
        twin.attachment = slot.attachment;
        twin.deform.length = 0;
        for (const value of slot.deform) twin.deform.push(value);
    });
}

function createDriver(shared: Shared, options: DriverOptions): OfficialDriver {
    const { data } = shared;
    const skeleton = new Skeleton(data);
    const { world = 'second' } = options;
    // the world reference: the same skeleton with physics off. Without it the played one is.
    const twin = world === 'second' ? new Skeleton(data) : undefined;
    const physics = world === 'direct' ? Physics.none : Physics.update;
    const stateData = new AnimationStateData(data);
    const state = new AnimationState(stateData);
    const entries = entryViews<TrackEntry>(shared.animationIndex);
    const recorder = eventRecorder<TrackEntry, Event>(entries, shared.animationIndex, (event) =>
        eventKey(event, shared.eventIndex(event.data)),
    );
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
        (twin ?? skeleton).bones.forEach((bone, i) => {
            writeWorld(out.world, i, bone.active, bone);
        });
    };
    const audit = options.audit ? createAudit(skeleton.bones.length, skeleton.slots.length, readPose) : undefined;

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
            // the same change from the same pose, so that the update order is sorted alike
            if (twin) setSkin(twin, index);
        },
        setupPose() {
            skeleton.setToSetupPose();
            if (twin) follow(skeleton, twin);
        },
        setupPoseBones() {
            skeleton.setBonesToSetupPose();
            if (twin) follow(skeleton, twin);
        },
        setupPoseSlots() {
            skeleton.setSlotsToSetupPose();
            if (twin) follow(skeleton, twin);
        },
        update(dt) {
            state.update(dt);
            skeleton.update(dt);
            state.apply(skeleton);
            audit?.before();
            skeleton.updateWorldTransform(physics);
            audit?.after();
            if (twin) {
                follow(skeleton, twin);
                twin.updateWorldTransform(Physics.none);
            }
        },
        takeEvents: recorder.take,
        place(x, y, scaleX, scaleY) {
            for (const each of twin ? [skeleton, twin] : [skeleton]) Object.assign(each, { x, y, scaleX, scaleY });
        },
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

    if (options.stripIgnoredTimelines) {
        for (const animation of data.animations) {
            animation.setTimelines(animation.timelines.filter((timeline) => !isIgnoredKind(timelineKind(timeline))));
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
            ignored: data.physicsConstraints.length,
        },
        createDriver: (driverOptions = {}) => createDriver(shared, driverOptions),
    };
}
