import {
    AnimationState,
    AnimationStateData,
    AtlasAttachmentLoader,
    type Event,
    Physics,
    PhysicsConstraintData,
    Skeleton,
    SkeletonBinary,
    type SkeletonData,
    SkeletonJson,
    SliderData,
    Texture,
    TextureAtlas,
    type TrackEntry,
} from 'spine-core-4.3';
import type { AttachmentRef, PhysicsMode, TrackField } from '../../src/core';
import { attachmentRefs, eventKey, indexer, skinEntries, timelineKind } from './model-shared';
import type { RigFiles } from './official';
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

/** Reads a skeleton file with the official 4.3 loader. */
export function readData43(files: RigFiles): SkeletonData {
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
const FLAGS: readonly TrackField[] = [...COMMON_FLAGS, 'additive', 'keepHold'];

function configure(entry: TrackEntry, field: string, value: number | boolean | string): boolean {
    if (field === 'animationLast' && typeof value === 'number') {
        // the plain field is overwritten by the next update, the setter is what the official API offers
        entry.setAnimationLast(value);

        return true;
    }

    return false;
}

/** The official value of each physics mode of a pose engine. */
const PHYSICS: Record<PhysicsMode, Physics> = {
    none: Physics.none,
    reset: Physics.reset,
    update: Physics.update,
    pose: Physics.pose,
};

function createDriver(shared: Shared): OfficialDriver {
    const { data } = shared;
    const skeleton = new Skeleton(data);
    let mode: PhysicsMode = 'update';
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
    const readPose = (out: OfficialPose): void => {
        skeleton.bones.forEach((bone, i) => {
            // the animated pose. A slider writes the applied one.
            writeLocal(out.local, i, bone.pose);
            out.inherit[i] = bone.pose.inherit;
            out.active[i] = bone.active ? 1 : 0;
        });
        skeleton.slots.forEach((slot, i) => {
            // what is drawn: the pose after the sliders. For a slot no slider gave a pose of its own it is the animated one.
            const slotPose = slot.appliedPose;

            writeColors(out, i, slotPose.color, slotPose.darkColor);
            writeAttachment(out, i, shared.ref(slotPose.attachment), slotPose.sequenceIndex, slotPose.deform);
        });
        skeleton.drawOrder.appliedPose.forEach((slot, i) => {
            out.drawOrder[i] = slot.data.index;
        });
    };
    const readWorld = (out: OfficialPose): void => {
        skeleton.bones.forEach((bone, i) => {
            writeWorld(out.world, i, bone.active, bone.appliedPose);
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
        setMix: (from, to, duration) => stateData.setMix(animation(from), animation(to), duration),
        setAnimation: (track, index, loop) => entries.view(state.setAnimation(track, animation(index), loop)),
        addAnimation: (track, index, loop, delay) =>
            entries.view(state.addAnimation(track, animation(index), loop, delay)),
        setEmptyAnimation: (track, mixDuration) => entries.view(state.setEmptyAnimation(track, mixDuration)),
        addEmptyAnimation: (track, mixDuration, delay) =>
            entries.view(state.addEmptyAnimation(track, mixDuration, delay)),
        configure(view, fields) {
            const entry = entries.official(view);

            setEntryFields(entry, fields, NUMBERS, FLAGS, (field, value) => configure(entry, field, value));
        },
        clearTrack: (track) => state.clearTrack(track),
        clearTracks: () => state.clearTracks(),
        setSkin: (index) => skeleton.setSkin(data.skins[index] ?? null),
        setupPose: () => skeleton.setupPose(),
        setupPoseBones: () => skeleton.setupPoseBones(),
        setupPoseSlots: () => skeleton.setupPoseSlots(),
        update(dt) {
            state.update(dt);
            skeleton.update(dt);
            state.apply(skeleton);
            yDown.solve(() => skeleton.updateWorldTransform(PHYSICS[mode]));
        },
        get physics() {
            return mode;
        },
        set physics(value) {
            mode = value;
        },
        physicsTranslate: (x, y) => skeleton.physicsTranslate(x, y),
        physicsRotate: (x, y, degrees) => skeleton.physicsRotate(x, y, degrees),
        forces(windX, windY, gravityX, gravityY) {
            Object.assign(skeleton, { windX, windY, gravityX, gravityY });
        },
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

/** Loads a 4.3 skeleton for posing with the official 4.3 core. */
export function loadPose43(files: RigFiles): OfficialPoseRig {
    const data = readData43(files);
    const shared: Shared = {
        data,
        animationIndex: animationIndexer(data.animations),
        eventIndex: indexer(data.events, 'event'),
        ref: cachedRefs(attachmentRefs(data.skins.map((skin) => skinEntries(skin.attachments)))),
    };

    return {
        info: {
            version: '4.3',
            bones: data.bones.length,
            slots: data.slots.length,
            skins: data.skins.length,
            animations: data.animations.map(({ name, duration, timelines }) => ({
                name,
                duration,
                events: timelines.some((timeline) => timelineKind(timeline) === 'event'),
            })),
            physics: data.constraints.filter((constraint: unknown) => constraint instanceof PhysicsConstraintData)
                .length,
            sliders: data.constraints.filter((constraint: unknown) => constraint instanceof SliderData).length,
        },
        createDriver: () => createDriver(shared),
    };
}
