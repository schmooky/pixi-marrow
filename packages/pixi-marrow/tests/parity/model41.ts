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
} from 'spine-core-4.1';
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
    POSITION_MODES,
    pathData,
    pick,
    ROTATE_MODES,
    regionData,
    SPACING_MODES,
    sequenceData,
    shorts,
    skinEntries,
    slotTable,
    timelineBase,
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

/*
 * The IK, transform and path constraint data of 4.1 and 4.2 have the same fields. These
 * converters take plain shapes, so model42.ts uses them for the 4.2 classes too.
 */

/** What the three constraint kinds share. */
interface LegacyConstraint<B> {
    name: string;
    order: number;
    skinRequired: boolean;
    bones: B[];
}

interface LegacyIk<B> extends LegacyConstraint<B> {
    target: B;
    mix: number;
    softness: number;
    bendDirection: number;
    compress: boolean;
    stretch: boolean;
    uniform: boolean;
}

interface LegacyTransform<B> extends LegacyConstraint<B> {
    target: B;
    mixRotate: number;
    mixX: number;
    mixY: number;
    mixScaleX: number;
    mixScaleY: number;
    mixShearY: number;
    offsetRotation: number;
    offsetX: number;
    offsetY: number;
    offsetScaleX: number;
    offsetScaleY: number;
    offsetShearY: number;
    relative: boolean;
    local: boolean;
}

interface LegacyPath<B, S> extends LegacyConstraint<B> {
    target: S;
    positionMode: number;
    spacingMode: number;
    rotateMode: number;
    offsetRotation: number;
    position: number;
    spacing: number;
    mixRotate: number;
    mixX: number;
    mixY: number;
}

export function legacyIk<B>(c: LegacyIk<B>, bone: (data: B) => number): ConstraintData {
    return {
        type: 'ik',
        name: c.name,
        skinRequired: c.skinRequired,
        order: c.order,
        bones: shorts(c.bones.map(bone)),
        target: bone(c.target),
        mix: c.mix,
        softness: c.softness,
        bendDirection: c.bendDirection,
        compress: c.compress,
        stretch: c.stretch,
        uniform: c.uniform,
    };
}

export function legacyTransform<B>(c: LegacyTransform<B>, bone: (data: B) => number): ConstraintData {
    const offsets = [c.offsetRotation, c.offsetX, c.offsetY, c.offsetScaleX, c.offsetScaleY, c.offsetShearY];

    return {
        type: 'transform',
        name: c.name,
        skinRequired: c.skinRequired,
        order: c.order,
        bones: shorts(c.bones.map(bone)),
        source: bone(c.target),
        mixRotate: c.mixRotate,
        mixX: c.mixX,
        mixY: c.mixY,
        mixScaleX: c.mixScaleX,
        mixScaleY: c.mixScaleY,
        mixShearY: c.mixShearY,
        offsets: floats(offsets),
        relative: c.relative,
        local: c.local,
    };
}

export function legacyPath<B, S>(
    c: LegacyPath<B, S>,
    bone: (data: B) => number,
    slot: (data: S) => number,
): ConstraintData {
    return {
        type: 'path',
        name: c.name,
        skinRequired: c.skinRequired,
        order: c.order,
        bones: shorts(c.bones.map(bone)),
        slot: slot(c.target),
        positionMode: pick(POSITION_MODES, c.positionMode, 'position mode'),
        spacingMode: pick(SPACING_MODES, c.spacingMode, 'spacing mode'),
        rotateMode: pick(ROTATE_MODES, c.rotateMode, 'rotate mode'),
        offsetRotation: c.offsetRotation,
        position: c.position,
        spacing: c.spacing,
        mixRotate: c.mixRotate,
        mixX: c.mixX,
        mixY: c.mixY,
    };
}

/** Lookups from official objects to model indices. */
interface Lookup {
    slot: (slot: SkeletonData['slots'][number]) => number;
    event: (event: SkeletonData['events'][number]) => number;
    ref: (attachment: object) => AttachmentRef;
    /** Where the transform and the path constraints start in the one constraint list. */
    transformStart: number;
    pathStart: number;
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

/** The index a timeline animates. Constraint timelines count from the start of their own kind. */
function target(timeline: Timeline, lookup: Lookup): number {
    if (timeline instanceof IkConstraintTimeline) return timeline.ikConstraintIndex;
    if (timeline instanceof TransformConstraintTimeline) {
        return lookup.transformStart + timeline.transformConstraintIndex;
    }
    if (
        timeline instanceof PathConstraintPositionTimeline ||
        timeline instanceof PathConstraintSpacingTimeline ||
        timeline instanceof PathConstraintMixTimeline
    ) {
        return lookup.pathStart + timeline.pathConstraintIndex;
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

/** The model of a 4.1 skeleton, built from what the official 4.1 core holds after loading it. */
export function officialModel41(files: RigFiles): SkeletonModel {
    const data = readData(files);
    const bone = indexer(data.bones, 'bone');
    const slot = indexer(data.slots, 'slot');
    const official = [...data.ikConstraints, ...data.transformConstraints, ...data.pathConstraints];
    const constraint = indexer<object>(official, 'constraint');
    const skins = data.skins.map((skin) => ({ skin, entries: skinEntries(skin.attachments) }));
    const lookup: Lookup = {
        slot,
        event: indexer(data.events, 'event'),
        ref: attachmentRefs(skins.map(({ entries }) => entries)),
        transformStart: data.ikConstraints.length,
        pathStart: data.ikConstraints.length + data.transformConstraints.length,
    };

    return {
        version: '4.1',
        editorVersion: data.version ?? '',
        hash: data.hash ?? null,
        x: orZero(data.x),
        y: orZero(data.y),
        width: orZero(data.width),
        height: orZero(data.height),
        referenceScale: 100,
        bones: boneTable(
            data.bones.map((b) => ({
                name: b.name,
                parent: b.parent ? bone(b.parent) : -1,
                pose: b,
                length: b.length,
                inherit: b.transformMode,
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
                visible: true,
            })),
        ),
        events: data.events.map((event) => eventData(event.name, event, event.audioPath)),
        constraints: [
            ...data.ikConstraints.map((c) => legacyIk(c, bone)),
            ...data.transformConstraints.map((c) => legacyTransform(c, bone)),
            ...data.pathConstraints.map((c) => legacyPath(c, bone, slot)),
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
