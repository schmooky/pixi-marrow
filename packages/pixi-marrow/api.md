# Public API

Generated from the built declarations by `pnpm api:update`. Do not edit.
A change in this file is a change to the public surface.

## pixi-marrow

```ts
export declare class MarrowError extends Error {
  override readonly name: string;
  readonly code: MarrowErrorCode;
  readonly fix: string;
  readonly validNames: readonly string[];
  readonly closest: string | undefined;
  constructor(code: MarrowErrorCode, message: string, details: MarrowErrorDetails);
}
export type MarrowErrorCode = "invalid-data" | "unsupported-version" | "unsupported-feature";
export interface MarrowErrorDetails {
  fix: string;
  validNames?: readonly string[];
  closest?: string;
}
```

## pixi-marrow/core

```ts
export interface AnimationData {
  name: string;
  duration: number;
  timelines: TimelineData[];
}
export type AnimationFeature = "bones" | "colors" | "attachments" | "deform" | "sequences" | "drawOrder" | "events" | "inherit" | "constraints" | "physics";
export interface AnimationInfo {
  name: string;
  duration: number;
  timelines: number;
  features: AnimationFeature[];
}
export declare const ATLAS_FILTERS: readonly AtlasFilter[];
export declare const ATLAS_REGION_STRIDE = 11;
export interface AtlasCustomField {
  region: number;
  name: string;
  values: number[];
}
export type AtlasFilter = "nearest" | "linear" | "mipMapNearestNearest" | "mipMapLinearNearest" | "mipMapNearestLinear" | "mipMapLinearLinear";
export interface AtlasModel {
  pages: AtlasPage[];
  regionNames: string[];
  regions: Int32Array;
  custom: AtlasCustomField[];
}
export interface AtlasPage {
  name: string;
  width: number;
  height: number;
  minFilter: AtlasFilter;
  magFilter: AtlasFilter;
  repeatX: boolean;
  repeatY: boolean;
  pma: boolean;
}
export interface AtlasRegion {
  page: number;
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  originalWidth: number;
  originalHeight: number;
  degrees: number;
  u: number;
  v: number;
  u2: number;
  v2: number;
}
export type AttachmentData = RegionAttachmentData | MeshAttachmentData | BoundingBoxAttachmentData | PathAttachmentData | PointAttachmentData | ClippingAttachmentData;
export interface AttachmentLookup {
  readonly defaultSkin: number;
  get(skin: number, slot: number, name: string): AttachmentData | undefined;
  find(activeSkin: number, slot: number, name: string): AttachmentData | undefined;
  resolve(ref: AttachmentRef): AttachmentData | undefined;
}
export interface AttachmentRef {
  skin: number;
  slot: number;
  name: string;
}
export declare function attachmentRegions(atlas: AtlasModel, attachment: RegionAttachmentData | MeshAttachmentData): Int32Array;
export declare const BLEND_MODES: readonly string[];
export declare const BONE_SETUP_STRIDE = 7;
export interface BoneTable {
  count: number;
  names: string[];
  parents: Int16Array;
  setup: Float64Array;
  lengths: Float64Array;
  inherit: Uint8Array;
  skinRequired: Uint8Array;
}
export interface BoundingBoxAttachmentData extends VertexData {
  type: "boundingbox";
  name: string;
}
export interface ClippingAttachmentData extends VertexData {
  type: "clipping";
  name: string;
  endSlot: number;
  convex: boolean;
  inverse: boolean;
}
export declare function computeMeshUVs(region: AtlasRegion, regionUVs: FloatArray, out: FloatArray, offset?: number, stride?: number): void;
export declare function computeRegionOffsets(version: SpineVersion, attachment: RegionAttachmentData, region: AtlasRegion, out: FloatArray, offset?: number, stride?: number): void;
export declare function computeRegionUVs(region: AtlasRegion, out: FloatArray, offset?: number, stride?: number): void;
export declare function computeRegionWorldVertices(offsets: FloatArray, offsetsStart: number, world: Float64Array, bone: number, out: FloatArray, offset?: number, stride?: number): void;
export declare function computeWorldVertices(data: VertexData, world: Float64Array, bone: number, deform: Float64Array, deformLength: number, out: FloatArray, offset?: number, stride?: number, start?: number, count?: number): void;
export interface ConstraintBase {
  name: string;
  skinRequired: boolean;
  order?: number;
}
export type ConstraintData = IkConstraintData | TransformConstraintData | PathConstraintData | PhysicsConstraintData | SliderConstraintData;
export declare function createAttachmentLookup(model: SkeletonModel): AttachmentLookup;
export declare function createPoseEngine(model: SkeletonModel, options?: PoseEngineOptions): Promise<PoseEngine>;
export declare function describeSkeleton(model: SkeletonModel): SkeletonInfo;
export interface EventData {
  name: string;
  int: number;
  float: number;
  string: string;
  audioPath: string | null;
  volume: number;
  balance: number;
}
export interface EventKey {
  time: number;
  event: number;
  int: number;
  float: number;
  string: string;
  volume: number;
  balance: number;
}
export declare function findRegion(atlas: AtlasModel, path: string): number;
export type FloatArray = Float32Array | Float64Array;
export interface IkConstraintData extends ConstraintBase {
  type: "ik";
  bones: Int16Array;
  target: number;
  mix: number;
  softness: number;
  bendDirection: number;
  compress: boolean;
  stretch: boolean;
  uniform?: boolean;
  scaleYMode?: ScaleYMode;
}
export declare function importAtlas(text: string): AtlasModel;
export declare function importSkeleton(source: SkeletonSource): Promise<SkeletonModel>;
export declare const INHERIT_MODES: readonly string[];
export declare const LOCAL_STRIDE = 7;
export declare class MarrowError extends Error {
  override readonly name: string;
  readonly code: MarrowErrorCode;
  readonly fix: string;
  readonly validNames: readonly string[];
  readonly closest: string | undefined;
  constructor(code: MarrowErrorCode, message: string, details: MarrowErrorDetails);
}
export type MarrowErrorCode = "invalid-data" | "unsupported-version" | "unsupported-feature";
export interface MarrowErrorDetails {
  fix: string;
  validNames?: readonly string[];
  closest?: string;
}
export interface MeshAttachmentData extends VertexData {
  type: "mesh";
  name: string;
  path: string;
  color: Float64Array;
  width: number;
  height: number;
  regionUVs: Float32Array;
  triangles: Uint16Array;
  hullLength: number;
  parent: AttachmentRef | null;
  timelineAttachment: AttachmentRef | null;
  timelineSlots?: Int16Array;
  sequence: SequenceData | null;
}
export declare function meshSource(lookup: AttachmentLookup, mesh: MeshAttachmentData): MeshAttachmentData;
export interface PathAttachmentData extends VertexData {
  type: "path";
  name: string;
  closed: boolean;
  constantSpeed: boolean;
  lengths: Float64Array;
}
export interface PathConstraintData extends ConstraintBase {
  type: "path";
  bones: Int16Array;
  slot: number;
  positionMode: "fixed" | "percent";
  spacingMode: "length" | "fixed" | "percent" | "proportional";
  rotateMode: "tangent" | "chain" | "chainScale";
  offsetRotation: number;
  position: number;
  spacing: number;
  mixRotate: number;
  mixX: number;
  mixY: number;
}
export interface PhysicsConstraintData extends ConstraintBase {
  type: "physics";
  bone: number;
  x: number;
  y: number;
  rotate: number;
  scaleX: number;
  shearX: number;
  limit: number;
  step: number;
  inertia: number;
  strength: number;
  damping: number;
  massInverse: number;
  wind: number;
  gravity: number;
  mix: number;
  inertiaGlobal: boolean;
  strengthGlobal: boolean;
  dampingGlobal: boolean;
  massGlobal: boolean;
  windGlobal: boolean;
  gravityGlobal: boolean;
  mixGlobal: boolean;
  scaleYMode?: ScaleYMode;
}
export interface PointAttachmentData {
  type: "point";
  name: string;
  x: number;
  y: number;
  rotation: number;
}
export interface PoseEngine {
  readonly state: PoseState;
  timeScale: number;
  defaultMix: number;
  setMix(from: number, to: number, duration: number): void;
  setAnimation(track: number, animation: number, loop: boolean): TrackEntry;
  addAnimation(track: number, animation: number, loop: boolean, delay: number): TrackEntry;
  setEmptyAnimation(track: number, mixDuration: number): TrackEntry;
  addEmptyAnimation(track: number, mixDuration: number, delay: number): TrackEntry;
  configure(entry: TrackEntry, fields: TrackFields): void;
  clearTrack(track: number): void;
  clearTracks(): void;
  setSkin(skin: number): void;
  setupPose(): void;
  setupPoseBones(): void;
  setupPoseSlots(): void;
  update(dt: number): void;
  takeEvents(): PoseEvent[];
}
export interface PoseEngineOptions {
  constraints?: "error" | "ignore";
}
export interface PoseEvent {
  type: PoseEventType;
  track: number;
  animation: number;
  key?: EventKey;
}
export type PoseEventType = "start" | "interrupt" | "end" | "dispose" | "complete" | "event";
export interface PoseState {
  readonly model: SkeletonModel;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  skin: number;
  time: number;
  readonly local: Float64Array;
  readonly inherit: Uint8Array;
  readonly active: Uint8Array;
  readonly world: Float64Array;
  readonly colors: Float64Array;
  readonly darkColors: Float64Array;
  readonly attachments: (AttachmentData | null)[];
  readonly sequenceIndices: Int32Array;
  readonly deform: Float64Array[];
  readonly deformLengths: Int32Array;
  readonly drawOrder: Int16Array;
}
export declare function poseStateBytes(state: PoseState): number;
export declare function readRegion(atlas: AtlasModel, region: number): AtlasRegion;
export interface RegionAttachmentData {
  type: "region";
  name: string;
  path: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  width: number;
  height: number;
  color: Float64Array;
  sequence: SequenceData | null;
}
export declare function resolveSequenceIndex(sequence: SequenceData | null, index: number): number;
export type ScaleYMode = "none" | "uniform" | "volume";
export interface SequenceData {
  count: number;
  start: number;
  digits: number;
  setupIndex: number;
}
export declare function sequencePath(path: string, sequence: SequenceData | null, index: number): string;
export interface SkeletonCounts {
  bones: number;
  slots: number;
  skins: number;
  constraints: number;
  animations: number;
  attachments: number;
  regions: number;
  meshes: number;
  meshVertices: number;
  maxBonesPerVertex: number;
}
export type SkeletonFeature = "meshes" | "weights" | "linkedMeshes" | "clipping" | "paths" | "sequences" | "darkTint" | "additiveBlend" | "multiplyBlend" | "screenBlend" | "skinBones" | "ik" | "transform" | "path" | "physics" | "slider";
export interface SkeletonInfo {
  version: SpineVersion;
  editorVersion: string;
  bones: string[];
  slots: string[];
  skins: string[];
  events: string[];
  constraints: {
    name: string;
    type: ConstraintData["type"];
  }[];
  animations: AnimationInfo[];
  counts: SkeletonCounts;
  features: SkeletonFeature[];
}
export interface SkeletonModel {
  version: SpineVersion;
  editorVersion: string;
  hash: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  referenceScale: number;
  bones: BoneTable;
  slots: SlotTable;
  events: EventData[];
  constraints: ConstraintData[];
  skins: SkinData[];
  animations: AnimationData[];
}
export interface SkeletonSniff {
  format: "json" | "binary";
  version: SpineVersion;
  editorVersion: string;
}
export type SkeletonSource = string | Uint8Array | ArrayBuffer | object;
export interface SkinAttachment {
  slot: number;
  name: string;
  attachment: AttachmentData;
}
export interface SkinData {
  name: string;
  bones: Int16Array;
  constraints: Int16Array;
  attachments: SkinAttachment[];
}
export interface SliderConstraintData extends ConstraintBase {
  type: "slider";
  animation: number;
  additive: boolean;
  loop: boolean;
  mix: number;
  time: number;
  bone: number;
  property: TransformProperty | null;
  propertyOffset: number;
  offset: number;
  scale: number;
  max: number;
  local: boolean;
}
export interface SlotTable {
  count: number;
  names: string[];
  bones: Int16Array;
  colors: Float64Array;
  darkColors: Float64Array;
  hasDark: Uint8Array;
  attachments: (string | null)[];
  blendModes: Uint8Array;
  visible: Uint8Array;
}
export declare function sniffSkeleton(source: SkeletonSource): SkeletonSniff;
export declare const SPINE_VERSIONS: readonly SpineVersion[];
export type SpineVersion = "4.1" | "4.2" | "4.3";
export interface TimelineData {
  kind: TimelineKind;
  target: number;
  frames: Float32Array;
  curves: Float32Array | null;
  attachmentNames?: (string | null)[];
  attachment?: AttachmentRef;
  vertices?: Float32Array[];
  events?: EventKey[];
  drawOrders?: (Int16Array | null)[];
  folderSlots?: Int16Array;
}
export type TimelineKind = "rotate" | "translate" | "translateX" | "translateY" | "scale" | "scaleX" | "scaleY" | "shear" | "shearX" | "shearY" | "inherit" | "rgba" | "rgb" | "alpha" | "rgba2" | "rgb2" | "attachment" | "deform" | "sequence" | "event" | "drawOrder" | "drawOrderFolder" | "ikConstraint" | "transformConstraint" | "pathConstraintPosition" | "pathConstraintSpacing" | "pathConstraintMix" | "physicsConstraintInertia" | "physicsConstraintStrength" | "physicsConstraintDamping" | "physicsConstraintMass" | "physicsConstraintWind" | "physicsConstraintGravity" | "physicsConstraintMix" | "physicsConstraintReset" | "slider" | "sliderMix";
export interface TrackEntry {
  readonly trackIndex: number;
  readonly animation: number;
  readonly loop: boolean;
  readonly delay: number;
  readonly trackTime: number;
  readonly trackEnd: number;
  readonly timeScale: number;
  readonly alpha: number;
  readonly mixTime: number;
  readonly mixDuration: number;
  readonly reverse: boolean;
  readonly shortestRotation: boolean;
}
export type TrackField = "loop" | "delay" | "trackTime" | "trackEnd" | "timeScale" | "alpha" | "mixTime" | "mixDuration" | "reverse" | "shortestRotation" | "eventThreshold" | "animationStart" | "animationEnd" | "animationLast" | "holdPrevious" | "mixBlend" | "attachmentThreshold" | "drawOrderThreshold" | "mixAttachmentThreshold" | "alphaAttachmentThreshold" | "mixDrawOrderThreshold" | "additive" | "keepHold";
export type TrackFields = Partial<Record<TrackField, number | boolean | string>>;
export interface TransformConstraintData extends ConstraintBase {
  type: "transform";
  bones: Int16Array;
  source: number;
  mixRotate: number;
  mixX: number;
  mixY: number;
  mixScaleX: number;
  mixScaleY: number;
  mixShearY: number;
  offsets: Float64Array;
  relative?: boolean;
  local?: boolean;
  localSource?: boolean;
  localTarget?: boolean;
  additive?: boolean;
  clamp?: boolean;
  properties?: TransformFrom[];
}
export interface TransformFrom {
  property: TransformProperty;
  offset: number;
  to: TransformTo[];
}
export type TransformProperty = "rotate" | "x" | "y" | "scaleX" | "scaleY" | "shearY";
export interface TransformTo {
  property: TransformProperty;
  offset: number;
  max: number;
  scale: number;
}
export interface VertexData {
  vertices: Float32Array;
  bones: Int16Array | null;
  worldVerticesLength: number;
}
export declare const WORLD_STRIDE = 6;
```

## pixi-marrow/optimize

```ts
export interface CliHost {
  read(path: string): string | Uint8Array;
  write(path: string, text: string): void;
  print(line: string): void;
  printError(line: string): void;
}
export declare function generateNames(info: SkeletonInfo, options: NamesOptions): string;
export interface NamesOptions {
  typeName: string;
  source?: string;
}
export declare function runCli(args: readonly string[], host: CliHost): Promise<number>;
export declare function typeNameFor(fileName: string): string;
```

