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
export type AttachmentData = RegionAttachmentData | MeshAttachmentData | BoundingBoxAttachmentData | PathAttachmentData | PointAttachmentData | ClippingAttachmentData;
export interface AttachmentRef {
  skin: number;
  slot: number;
  name: string;
}
export declare const BLEND_MODES: readonly string[];
export declare const BONE_SETUP_STRIDE = 7;
export interface BoneTable {
  count: number;
  names: string[];
  parents: Int16Array;
  setup: Float32Array;
  lengths: Float32Array;
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
export interface ConstraintBase {
  name: string;
  skinRequired: boolean;
  order?: number;
}
export type ConstraintData = IkConstraintData | TransformConstraintData | PathConstraintData | PhysicsConstraintData | SliderConstraintData;
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
  color: Float32Array;
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
export interface PathAttachmentData extends VertexData {
  type: "path";
  name: string;
  closed: boolean;
  constantSpeed: boolean;
  lengths: Float32Array;
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
  color: Float32Array;
  sequence: SequenceData | null;
}
export type ScaleYMode = "none" | "uniform" | "volume";
export interface SequenceData {
  count: number;
  start: number;
  digits: number;
  setupIndex: number;
}
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
  colors: Float32Array;
  darkColors: Float32Array;
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
  offsets: Float32Array;
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

