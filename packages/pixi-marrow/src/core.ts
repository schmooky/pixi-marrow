/**
 * `pixi-marrow/core`: model, importers and pose without Pixi. Runs in Node and in workers.
 */
export type { MarrowErrorCode, MarrowErrorDetails } from './base/errors';
export { MarrowError } from './base/errors';
export type { SpineVersion } from './base/version';
export { SPINE_VERSIONS } from './base/version';
export { importAtlas } from './formats/atlas';
export { importSkeleton } from './formats/import';
export type { SkeletonSniff, SkeletonSource } from './formats/sniff';
export { sniffSkeleton } from './formats/sniff';
export type { AtlasRegion } from './geometry/atlas-regions';
export {
    attachmentRegions,
    findRegion,
    readRegion,
    resolveSequenceIndex,
    sequencePath,
} from './geometry/atlas-regions';
export { computeMeshUVs } from './geometry/mesh';
export type { FloatArray } from './geometry/read';
export { computeRegionOffsets, computeRegionUVs, computeRegionWorldVertices } from './geometry/region';
export { computeWorldVertices } from './geometry/vertices';
export type { AtlasCustomField, AtlasFilter, AtlasModel, AtlasPage } from './model/atlas';
export { ATLAS_FILTERS, ATLAS_REGION_STRIDE } from './model/atlas';
export type {
    AttachmentData,
    AttachmentRef,
    BoundingBoxAttachmentData,
    ClippingAttachmentData,
    MeshAttachmentData,
    PathAttachmentData,
    PointAttachmentData,
    RegionAttachmentData,
    SequenceData,
    VertexData,
} from './model/attachments';
export type {
    ConstraintBase,
    ConstraintData,
    IkConstraintData,
    PathConstraintData,
    PhysicsConstraintData,
    ScaleYMode,
    SliderConstraintData,
    TransformConstraintData,
    TransformFrom,
    TransformProperty,
    TransformTo,
} from './model/constraints';
export type { AnimationFeature, AnimationInfo, SkeletonCounts, SkeletonFeature, SkeletonInfo } from './model/info';
export { describeSkeleton } from './model/info';
export type {
    AnimationData,
    BoneTable,
    EventData,
    SkeletonModel,
    SkinAttachment,
    SkinData,
    SlotTable,
} from './model/model';
export { BLEND_MODES, BONE_SETUP_STRIDE, INHERIT_MODES } from './model/model';
export type { EventKey, TimelineData, TimelineKind } from './model/timelines';
export type {
    PoseEngine,
    PoseEngineFactory,
    PoseEngineOptions,
    PoseEvent,
    PoseEventType,
    TrackEntry,
    TrackField,
    TrackFields,
} from './pose/engine';
export { createPoseEngine, loadPoseEngine } from './pose/engine';
export type { AttachmentLookup } from './pose/shared/lookup';
export { createAttachmentLookup, meshSource } from './pose/shared/lookup';
export type { PoseState } from './pose/state';
export { LOCAL_STRIDE, poseStateBytes, WORLD_STRIDE } from './pose/state';
