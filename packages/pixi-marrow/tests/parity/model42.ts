import {
    AtlasAttachmentLoader,
    type Attachment,
    AttachmentTimeline,
    BoundingBoxAttachment,
    ClippingAttachment,
    CurveTimeline,
    DeformTimeline,
    DrawOrderTimeline,
    EventTimeline,
    IkConstraintTimeline,
    MeshAttachment,
    PathAttachment,
    PathConstraintMixTimeline,
    PathConstraintPositionTimeline,
    PathConstraintSpacingTimeline,
    PhysicsConstraintResetTimeline,
    PhysicsConstraintTimeline,
    PointAttachment,
    RegionAttachment,
    SequenceTimeline,
    SkeletonBinary,
    type SkeletonData,
    SkeletonJson,
    Texture,
    TextureAtlas,
    type Timeline,
    TransformConstraintTimeline,
} from 'spine-core-4.2';
import type { AttachmentData, AttachmentRef, ConstraintData, SkeletonModel, TimelineData } from '../../src/core';
import {
    attachmentRefs,
    boneOrSlotIndex,
    boneTable,
    clippingData,
    drawOrders,
    eventData,
    eventKey,
    floats,
    indexer,
    meshData,
    orZero,
    pathData,
    regionData,
    sequenceData,
    shorts,
    skinEntries,
    slotTable,
    timelineBase,
    vertexData,
} from './model-shared';
import { legacyIk, legacyPath, legacyTransform } from './model41';
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
    slot: (slot: SkeletonData['slots'][number]) => number;
    event: (event: SkeletonData['events'][number]) => number;
    ref: (attachment: object) => AttachmentRef;
    bone: (bone: SkeletonData['bones'][number]) => number;
    /** Where the transform, path and physics constraints start in the one constraint list. */
    transformStart: number;
    pathStart: number;
    physicsStart: number;
}

function meshLinks(mesh: MeshAttachment, ref: Lookup['ref']) {
    const parent = mesh.getParentMesh();

    return {
        parent: parent ? ref(parent) : null,
        timelineAttachment: mesh.timelineAttachment === mesh ? null : ref(mesh.timelineAttachment),
        sequence: sequenceData(mesh.sequence),
    };
}

function attachmentData(a: Attachment, lookup: Lookup): AttachmentData {
    if (a instanceof RegionAttachment) return regionData(a, sequenceData(a.sequence));
    if (a instanceof MeshAttachment) return meshData(a, meshLinks(a, lookup.ref));
    if (a instanceof BoundingBoxAttachment) return { type: 'boundingbox', name: a.name, ...vertexData(a) };
    if (a instanceof PathAttachment) return pathData(a);
    if (a instanceof PointAttachment) return { type: 'point', name: a.name, x: a.x, y: a.y, rotation: a.rotation };
    if (a instanceof ClippingAttachment) {
        return clippingData(a, a.endSlot ? lookup.slot(a.endSlot) : -1, { convex: false, inverse: false });
    }
    throw new Error(`Unknown official attachment class: ${a.constructor.name}`);
}

/** The package index does not export the physics constraint data class. */
type PhysicsData = SkeletonData['physicsConstraints'][number];

function physics(c: PhysicsData, lookup: Lookup): ConstraintData {
    return {
        type: 'physics',
        name: c.name,
        skinRequired: c.skinRequired,
        order: c.order,
        bone: lookup.bone(c.bone),
        x: c.x,
        y: c.y,
        rotate: c.rotate,
        scaleX: c.scaleX,
        shearX: c.shearX,
        limit: c.limit,
        step: c.step,
        inertia: c.inertia,
        strength: c.strength,
        damping: c.damping,
        massInverse: c.massInverse,
        wind: c.wind,
        gravity: c.gravity,
        mix: c.mix,
        inertiaGlobal: c.inertiaGlobal,
        strengthGlobal: c.strengthGlobal,
        dampingGlobal: c.dampingGlobal,
        massGlobal: c.massGlobal,
        windGlobal: c.windGlobal,
        gravityGlobal: c.gravityGlobal,
        mixGlobal: c.mixGlobal,
    };
}

/** The index a timeline animates. Constraint timelines count from the start of their own kind. */
function target(timeline: Timeline, lookup: Lookup): number {
    if (timeline instanceof IkConstraintTimeline) return timeline.constraintIndex;
    if (timeline instanceof TransformConstraintTimeline) return lookup.transformStart + timeline.constraintIndex;
    if (
        timeline instanceof PathConstraintPositionTimeline ||
        timeline instanceof PathConstraintSpacingTimeline ||
        timeline instanceof PathConstraintMixTimeline
    ) {
        return lookup.pathStart + timeline.constraintIndex;
    }
    if (timeline instanceof PhysicsConstraintTimeline || timeline instanceof PhysicsConstraintResetTimeline) {
        // -1 applies the timeline to every physics constraint
        return timeline.constraintIndex === -1 ? -1 : lookup.physicsStart + timeline.constraintIndex;
    }

    return boneOrSlotIndex(timeline);
}

function timelineData(timeline: Timeline, lookup: Lookup): TimelineData {
    const base = timelineBase(timeline, target(timeline, lookup), timeline instanceof CurveTimeline);

    if (timeline instanceof AttachmentTimeline) {
        return { ...base, attachmentNames: timeline.attachmentNames.map((name) => name ?? null) };
    }
    if (timeline instanceof DeformTimeline) {
        return { ...base, attachment: lookup.ref(timeline.attachment), vertices: timeline.vertices.map(floats) };
    }
    if (timeline instanceof SequenceTimeline) return { ...base, attachment: lookup.ref(timeline.getAttachment()) };
    if (timeline instanceof EventTimeline) {
        return { ...base, events: timeline.events.map((event) => eventKey(event, lookup.event(event.data))) };
    }
    if (timeline instanceof DrawOrderTimeline) return { ...base, drawOrders: drawOrders(timeline.drawOrders) };

    return base;
}

/** The model of a 4.2 skeleton, built from what the official 4.2 core holds after loading it. */
export function officialModel42(files: RigFiles): SkeletonModel {
    const data = readData(files);
    const bone = indexer(data.bones, 'bone');
    const slot = indexer(data.slots, 'slot');
    const official = [
        ...data.ikConstraints,
        ...data.transformConstraints,
        ...data.pathConstraints,
        ...data.physicsConstraints,
    ];
    const constraint = indexer<object>(official, 'constraint');
    const skins = data.skins.map((skin) => ({ skin, entries: skinEntries(skin.attachments) }));
    const pathStart = data.ikConstraints.length + data.transformConstraints.length;
    const lookup: Lookup = {
        bone,
        slot,
        event: indexer(data.events, 'event'),
        ref: attachmentRefs(skins.map(({ entries }) => entries)),
        transformStart: data.ikConstraints.length,
        pathStart,
        physicsStart: pathStart + data.pathConstraints.length,
    };

    return {
        version: '4.2',
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
                pose: b,
                length: b.length,
                inherit: b.inherit,
                skinRequired: b.skinRequired,
            })),
        ),
        slots: slotTable(
            data.slots.map((s) => ({
                name: s.name,
                bone: bone(s.boneData),
                color: s.color,
                darkColor: s.darkColor,
                attachmentName: s.attachmentName,
                blendMode: s.blendMode,
                visible: s.visible,
            })),
        ),
        events: data.events.map((event) => eventData(event.name, event, event.audioPath)),
        constraints: [
            ...data.ikConstraints.map((c) => legacyIk(c, bone)),
            ...data.transformConstraints.map((c) => legacyTransform(c, bone)),
            ...data.pathConstraints.map((c) => legacyPath(c, bone, slot)),
            ...data.physicsConstraints.map((c) => physics(c, lookup)),
        ],
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
