import {
    AtlasAttachmentLoader,
    type Attachment,
    AttachmentTimeline,
    BoundingBoxAttachment,
    ClippingAttachment,
    CurveTimeline,
    DeformTimeline,
    DrawOrderFolderTimeline,
    DrawOrderTimeline,
    EventTimeline,
    type FromProperty,
    IkConstraintData,
    isConstraintTimeline,
    MeshAttachment,
    PathAttachment,
    PathConstraintData,
    PhysicsConstraintData,
    PointAttachment,
    RegionAttachment,
    type Sequence,
    SequenceTimeline,
    SkeletonBinary,
    type SkeletonData,
    SkeletonJson,
    SliderData,
    Texture,
    TextureAtlas,
    type Timeline,
    TransformConstraintData,
} from 'spine-core-4.3';
import type { AttachmentData, AttachmentRef, ConstraintData, SkeletonModel, TimelineData } from '../../src/core';
import {
    attachmentRefs,
    boneOrSlotIndex,
    boneTable,
    clippingData,
    doubles,
    drawOrders,
    eventData,
    eventKey,
    floats,
    hiddenDrawOrders,
    indexer,
    meshData,
    orZero,
    POSITION_MODES,
    pathData,
    pick,
    ROTATE_MODES,
    regionData,
    SCALE_Y_MODES,
    SPACING_MODES,
    sequenceData,
    shorts,
    skinEntries,
    slotTable,
    timelineBase,
    transformProperty,
    vertexData,
} from './model-shared';
import type { RigFiles } from './official';

/** Stands in for a GPU texture. Loading needs page sizes only. */
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

/** Lookups from official objects to model indices. */
interface Lookup {
    bone: (bone: SkeletonData['bones'][number]) => number;
    slot: (slot: SkeletonData['slots'][number]) => number;
    event: (event: SkeletonData['events'][number]) => number;
    animation: (animation: SkeletonData['animations'][number]) => number;
    ref: (attachment: object) => AttachmentRef;
}

function ik(c: IkConstraintData, lookup: Lookup): ConstraintData {
    const pose = c.setupPose;

    return {
        type: 'ik',
        name: c.name,
        skinRequired: c.skinRequired,
        bones: shorts(c.bones.map(lookup.bone)),
        target: lookup.bone(c.target),
        mix: pose.mix,
        softness: pose.softness,
        bendDirection: pose.bendDirection,
        compress: pose.compress,
        stretch: pose.stretch,
        scaleYMode: pick(SCALE_Y_MODES, c.scaleYMode, 'scale Y mode'),
    };
}

function transform(c: TransformConstraintData, lookup: Lookup): ConstraintData {
    const pose = c.setupPose;

    return {
        type: 'transform',
        name: c.name,
        skinRequired: c.skinRequired,
        bones: shorts(c.bones.map(lookup.bone)),
        source: lookup.bone(c.source),
        mixRotate: pose.mixRotate,
        mixX: pose.mixX,
        mixY: pose.mixY,
        mixScaleX: pose.mixScaleX,
        mixScaleY: pose.mixScaleY,
        mixShearY: pose.mixShearY,
        offsets: doubles(c.offsets),
        localSource: c.localSource,
        localTarget: c.localTarget,
        additive: c.additive,
        clamp: c.clamp,
        properties: c.properties.map((from) => ({
            property: transformProperty(from, 'From'),
            offset: from.offset,
            to: from.to.map((to) => ({
                property: transformProperty(to, 'To'),
                offset: to.offset,
                max: to.max,
                scale: to.scale,
            })),
        })),
    };
}

function path(c: PathConstraintData, lookup: Lookup): ConstraintData {
    const pose = c.setupPose;

    return {
        type: 'path',
        name: c.name,
        skinRequired: c.skinRequired,
        bones: shorts(c.bones.map(lookup.bone)),
        slot: lookup.slot(c.slot),
        positionMode: pick(POSITION_MODES, c.positionMode, 'position mode'),
        spacingMode: pick(SPACING_MODES, c.spacingMode, 'spacing mode'),
        rotateMode: pick(ROTATE_MODES, c.rotateMode, 'rotate mode'),
        offsetRotation: c.offsetRotation,
        position: pose.position,
        spacing: pose.spacing,
        mixRotate: pose.mixRotate,
        mixX: pose.mixX,
        mixY: pose.mixY,
    };
}

function physics(c: PhysicsConstraintData, lookup: Lookup): ConstraintData {
    const pose = c.setupPose;

    return {
        type: 'physics',
        name: c.name,
        skinRequired: c.skinRequired,
        bone: lookup.bone(c.bone),
        x: c.x,
        y: c.y,
        rotate: c.rotate,
        scaleX: c.scaleX,
        shearX: c.shearX,
        limit: c.limit,
        step: c.step,
        inertia: pose.inertia,
        strength: pose.strength,
        damping: pose.damping,
        massInverse: pose.massInverse,
        wind: pose.wind,
        gravity: pose.gravity,
        mix: pose.mix,
        inertiaGlobal: c.inertiaGlobal,
        strengthGlobal: c.strengthGlobal,
        dampingGlobal: c.dampingGlobal,
        massGlobal: c.massGlobal,
        windGlobal: c.windGlobal,
        gravityGlobal: c.gravityGlobal,
        mixGlobal: c.mixGlobal,
        scaleYMode: pick(SCALE_Y_MODES, c.scaleYMode, 'scale Y mode'),
    };
}

function slider(c: SliderData, lookup: Lookup): ConstraintData {
    // The typings say a slider always has a property. A slider that no bone drives has none.
    const property: FromProperty | undefined = c.property;

    return {
        type: 'slider',
        name: c.name,
        skinRequired: c.skinRequired,
        animation: lookup.animation(c.animation),
        additive: c.additive,
        loop: c.loop,
        mix: c.setupPose.mix,
        time: c.setupPose.time,
        bone: c.bone ? lookup.bone(c.bone) : -1,
        property: property ? transformProperty(property, 'From') : null,
        propertyOffset: property ? property.offset : 0,
        offset: c.offset,
        scale: c.scale,
        max: c.max,
        local: c.local,
    };
}

function constraintData(c: SkeletonData['constraints'][number], lookup: Lookup): ConstraintData {
    if (c instanceof IkConstraintData) return ik(c, lookup);
    if (c instanceof TransformConstraintData) return transform(c, lookup);
    if (c instanceof PathConstraintData) return path(c, lookup);
    if (c instanceof PhysicsConstraintData) return physics(c, lookup);
    if (c instanceof SliderData) return slider(c, lookup);
    throw new Error(`Unknown official constraint class: ${c.constructor.name}`);
}

/** The loader gives every region and mesh a sequence. One without a path suffix means the file has none. */
const sequence = (official: Sequence) => (official.hasPathSuffix() ? sequenceData(official) : null);

function meshLinks(mesh: MeshAttachment, ref: Lookup['ref']) {
    const source = mesh.getSourceMesh();
    const timelineAttachment = mesh.timelineAttachment ?? mesh;
    const links = {
        parent: source ? ref(source) : null,
        timelineAttachment: timelineAttachment === mesh ? null : ref(timelineAttachment),
        sequence: sequence(mesh.sequence),
    };

    return mesh.timelineSlots.length > 0 ? { ...links, timelineSlots: shorts(mesh.timelineSlots) } : links;
}

function attachmentData(a: Attachment, lookup: Lookup): AttachmentData {
    // The JSON loader can leave timeline slots on the source of a linked mesh that is no mesh.
    if (a.timelineSlots.length > 0 && !(a instanceof MeshAttachment)) {
        throw new Error(`The model has no timeline slots for the official ${a.constructor.name} ${a.name}`);
    }
    if (a instanceof RegionAttachment) return regionData(a, sequence(a.sequence));
    if (a instanceof MeshAttachment) return meshData(a, meshLinks(a, lookup.ref));
    if (a instanceof BoundingBoxAttachment) return { type: 'boundingbox', name: a.name, ...vertexData(a) };
    if (a instanceof PathAttachment) return pathData(a);
    if (a instanceof PointAttachment) return { type: 'point', name: a.name, x: a.x, y: a.y, rotation: a.rotation };
    if (a instanceof ClippingAttachment) {
        return clippingData(a, a.endSlot ? lookup.slot(a.endSlot) : -1, { convex: a.convex, inverse: a.inverse });
    }
    throw new Error(`Unknown official attachment class: ${a.constructor.name}`);
}

function timelineData(timeline: Timeline, lookup: Lookup): TimelineData {
    // a constraint index points into the one constraint list. -1 means every physics constraint
    const target = isConstraintTimeline(timeline) ? timeline.constraintIndex : boneOrSlotIndex(timeline);
    const base = timelineBase(timeline, target, timeline instanceof CurveTimeline);

    if (timeline instanceof AttachmentTimeline) {
        return { ...base, attachmentNames: timeline.attachmentNames.map((name) => name ?? null) };
    }
    if (timeline instanceof DeformTimeline) {
        return { ...base, attachment: lookup.ref(timeline.attachment), vertices: timeline.vertices.map(floats) };
    }
    if (timeline instanceof SequenceTimeline) return { ...base, attachment: lookup.ref(timeline.attachment) };
    if (timeline instanceof EventTimeline) {
        return { ...base, events: timeline.events.map((event) => eventKey(event, lookup.event(event.data))) };
    }
    if (timeline instanceof DrawOrderTimeline) return { ...base, drawOrders: hiddenDrawOrders(timeline) };
    if (timeline instanceof DrawOrderFolderTimeline) {
        // a key orders the folder: its numbers are positions in the slot list of the folder
        return { ...base, drawOrders: drawOrders(timeline.getDrawOrders()), folderSlots: shorts(timeline.getSlots()) };
    }

    return base;
}

/** The model of a 4.3 skeleton, built from what the official 4.3 core holds after loading it. */
export function officialModel43(files: RigFiles): SkeletonModel {
    const data = readData(files);
    const bone = indexer(data.bones, 'bone');
    const constraint = indexer(data.constraints, 'constraint');
    const skins = data.skins.map((skin) => ({ skin, entries: skinEntries(skin.attachments) }));
    const lookup: Lookup = {
        bone,
        slot: indexer(data.slots, 'slot'),
        event: indexer(data.events, 'event'),
        animation: indexer(data.animations, 'animation'),
        ref: attachmentRefs(skins.map(({ entries }) => entries)),
    };

    return {
        version: '4.3',
        editorVersion: data.version ?? '',
        hash: data.hash ?? null,
        x: orZero(data.x),
        y: orZero(data.y),
        width: orZero(data.width),
        height: orZero(data.height),
        referenceScale: data.referenceScale,
        bones: boneTable(
            data.bones.map((b) => ({
                name: b.name,
                parent: b.parent ? bone(b.parent) : -1,
                pose: b.setupPose,
                length: b.length,
                inherit: b.setupPose.inherit,
                skinRequired: b.skinRequired,
            })),
        ),
        slots: slotTable(
            data.slots.map((s) => ({
                name: s.name,
                bone: bone(s.boneData),
                color: s.setupPose.color,
                darkColor: s.setupPose.darkColor,
                attachmentName: s.attachmentName,
                blendMode: s.blendMode,
                visible: s.visible,
            })),
        ),
        events: data.events.map((event) => eventData(event.name, event.setupPose, event._audioPath)),
        constraints: data.constraints.map((c) => constraintData(c, lookup)),
        skins: skins.map(({ skin, entries }) => ({
            name: skin.name,
            bones: shorts(skin.bones.map(bone)),
            constraints: shorts(skin.constraints.map(constraint)),
            attachments: entries.map((entry) => ({ ...entry, attachment: attachmentData(entry.attachment, lookup) })),
        })),
        animations: data.animations.map((animation) => ({
            name: animation.name,
            duration: animation.duration,
            timelines: animation.timelines.map((timeline) => timelineData(timeline, lookup)),
        })),
    };
}
