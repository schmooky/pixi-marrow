# Public API

Generated from the built declarations by `pnpm api:update`. Do not edit.
A change in this file is a change to the public surface.

## pixi-marrow

```ts
export interface AtlasAssetData {
  images?: Texture | TextureSource | string | Readonly<Record<string, Texture | TextureSource | string>>;
  imageMetadata?: Readonly<Record<string, unknown>>;
}
export interface AtlasOutlines {
  version: 1;
  margin: number;
  opaqueMargin: number;
  regions: (RegionOutline | null)[];
}
export interface AttachOptions {
  followAttachment?: boolean;
  followColor?: boolean;
}
export type BakeMode = "off" | "auto" | readonly string[];
export declare class Bone<N extends MarrowNames = MarrowNames> {
  readonly name: N["bones"];
  private readonly state;
  private readonly local;
  private readonly world;
  private readonly index;
  constructor(state: PoseState, index: number, name: N["bones"]);
  get x(): number;
  set x(value: number);
  get y(): number;
  set y(value: number);
  get rotation(): number;
  set rotation(value: number);
  get scaleX(): number;
  set scaleX(value: number);
  get scaleY(): number;
  set scaleY(value: number);
  get worldX(): number;
  get worldY(): number;
  get worldRotation(): number;
  get active(): boolean;
  worldMatrix(out?: Matrix): Matrix;
  localToWorld(point: PointData, out?: Point): Point;
  worldToLocal(point: PointData, out?: Point): Point;
  private read;
  private write;
}
export interface LoadedAtlas {
  readonly atlas: AtlasModel;
  readonly textures: readonly Texture[];
}
export declare class MarrowAsset {
  readonly model: SkeletonModel;
  readonly atlas: AtlasModel;
  readonly textures: readonly Texture[];
  readonly createEngine: PoseEngineFactory;
  private readonly loaded;
  private readonly key;
  private description;
  private gone;
  private found;
  private scan;
  private work;
  private readonly scans;
  private constructor();
  get info(): SkeletonInfo;
  get destroyed(): boolean;
  get outlines(): AtlasOutlines | undefined;
  get outlinesState(): OutlinesState;
  get optimized(): Promise<void>;
  static load(options: MarrowLoadOptions): Promise<MarrowAsset>;
  static from(data: MarrowAssetData): Promise<MarrowAsset>;
  static get(options: MarrowAssetsOptions): MarrowAsset;
  private static fetch;
  destroy(): void;
  private startScan;
  private onPageUpdate;
}
export interface MarrowAssetData {
  model: SkeletonModel;
  atlas: AtlasModel;
  textures: readonly Texture[];
  outlines?: "auto" | "off" | AtlasOutlines;
  renderMode?: "auto" | "mesh" | "batched";
}
export interface MarrowAssetsOptions {
  skeleton: string;
  atlas: string;
  outlines?: "auto" | "off";
  renderMode?: "auto" | "mesh" | "batched";
}
export declare class MarrowError extends Error {
  override readonly name: string;
  readonly code: MarrowErrorCode;
  readonly fix: string;
  readonly validNames: readonly string[];
  readonly closest: string | undefined;
  constructor(code: MarrowErrorCode, message: string, details: MarrowErrorDetails);
}
export type MarrowErrorCode = "invalid-data" | "unsupported-version" | "unsupported-feature" | "unknown-name";
export interface MarrowErrorDetails {
  fix: string;
  validNames?: readonly string[];
  closest?: string;
}
export interface MarrowEvent<N extends MarrowNames = MarrowNames> {
  name: N["events"];
  int: number;
  float: number;
  string: string;
  volume: number;
  balance: number;
  time: number;
}
export interface MarrowLoadOptions {
  skeleton: string | Uint8Array | ArrayBuffer | object;
  atlas: string;
  textures?: Readonly<Record<string, Texture | string>>;
  outlines?: "auto" | "off" | string | AtlasOutlines;
  renderMode?: "auto" | "mesh" | "batched";
}
export interface MarrowNames {
  animations: string;
  skins: string;
  bones: string;
  slots: string;
  events: string;
}
export declare class MarrowPerf {
  private readonly owner;
  private readonly view;
  private readonly links;
  constructor(owner: PerfOwner, view: SkeletonView, links?: () => readonly Link[]);
  report(): Promise<PerfEntry[]>;
  memory(): Promise<PerfMemory>;
}
export declare class MarrowSpine<N extends MarrowNames = MarrowNames> extends SpinePhysics<N> {
  readonly asset: MarrowAsset;
  readonly engine: PoseEngine;
  private readonly skeletonView;
  private outlines;
  private readonly book;
  private readonly pump;
  private ticking;
  private tools;
  private readonly pacer;
  private readonly idle;
  private lodOn;
  private probe;
  constructor(asset: MarrowAsset, options?: MarrowSpineOptions);
  static load<N extends MarrowNames = MarrowNames>(options: MarrowLoadOptions & MarrowSpineOptions): Promise<MarrowSpine<N>>;
  static from<N extends MarrowNames = MarrowNames>(options: MarrowAssetsOptions & MarrowSpineOptions): MarrowSpine<N>;
  get info(): SkeletonInfo;
  get stats(): ViewStats;
  get perf(): MarrowPerf;
  get updateProbe(): UpdateProbe | null;
  set updateProbe(probe: UpdateProbe | null);
  get renderMode(): NonNullable<MarrowSpineOptions["renderMode"]>;
  set renderMode(mode: NonNullable<MarrowSpineOptions["renderMode"]>);
  get timeScale(): number;
  set timeScale(value: number);
  get defaultMix(): number;
  set defaultMix(seconds: number);
  get autoUpdate(): boolean;
  set autoUpdate(value: boolean);
  setMix(from: N["animations"], to: N["animations"], seconds: number): void;
  play(name: N["animations"], options?: PlayOptions): Track<N>;
  queue(name: N["animations"], options?: QueueOptions): Track<N>;
  stop(options?: StopOptions): void;
  update(seconds: number): void;
  override destroy(options?: DestroyOptions): void;
  private measure;
  private pose;
  private draw;
  private onTick;
  private animationIndex;
  private mixOut;
  private adopt;
  private absorb;
}
export interface MarrowSpineEvents<N extends MarrowNames = MarrowNames> {
  start: [track: Track<N>];
  interrupt: [track: Track<N>];
  end: [track: Track<N>];
  dispose: [track: Track<N>];
  complete: [track: Track<N>];
  event: [event: MarrowEvent<N>, track: Track<N>];
}
export interface MarrowSpineOptions {
  autoUpdate?: boolean;
  renderMode?: "auto" | "mesh" | "batched";
  tightMesh?: "auto" | "on" | "off";
  occlusion?: "auto" | "off";
  perf?: PerfPreset | PerfOptions;
  skinning?: PerfSettings["skinning"];
  bake?: PerfSettings["bake"];
  idleCache?: PerfSettings["idleCache"];
  offscreen?: PerfSettings["offscreen"];
  updateRate?: PerfSettings["updateRate"];
  lod?: PerfSettings["lod"];
}
export type OffscreenMode = "update" | "throttle" | "pause";
export type OutlinesState = "given" | "scanned" | "scanning" | "unread" | "off";
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export declare const PERF_PRESETS: Readonly<Record<PerfPreset, Readonly<PerfSettings>>>;
export interface PerfEntry {
  feature: PerfFeature;
  value: string;
  reason: string;
  animation?: string;
}
export type PerfFeature = "renderMode" | "motion" | "links" | "drawCalls" | "blend" | "pages" | "clipping" | "tightMesh" | "occlusion" | "outlines" | "darkTint" | "physics" | "bake" | "constraints" | "bones" | "slots" | "vertices" | "uploads" | "layout";
export interface PerfMemory {
  shared: number;
  instance: number;
  gpu: number;
  gpuBuffers: number;
  gpuTextures: number;
}
export interface PerfOptions extends Partial<PerfSettings> {
  preset?: PerfPreset;
}
export type PerfPreset = "exact" | "balanced" | "fast";
export interface PerfSettings {
  tightMesh: "auto" | "on" | "off";
  skinning: SkinningMode;
  bake: BakeMode;
  idleCache: "off" | "auto";
  offscreen: OffscreenMode;
  updateRate: UpdateRate;
  lod: "off" | "auto";
}
export type PhysicsMode = "none" | "reset" | "update" | "pose";
export interface PlayOptions {
  track?: number;
  loop?: boolean;
  mix?: number;
  speed?: number;
  alpha?: number;
  reverse?: boolean;
  additive?: boolean;
  start?: number;
  end?: number;
  shortestRotation?: boolean;
  eventThreshold?: number;
  entry?: TrackFields;
}
export interface QueueOptions extends PlayOptions {
  delay?: number;
}
export interface RegionOutline {
  name: string;
  rect: PageRect;
  polygon: number[] | null;
  triangles: number[];
  coverage: number;
  opaque: PageRect | null;
}
export declare function registerMarrowAssets(): void;
export type SetupPosePart = "all" | "bones" | "slots";
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
export type SkinningMode = "auto" | "cpu" | "gpu";
export declare class Slot<N extends MarrowNames = MarrowNames> {
  readonly name: N["slots"];
  readonly bone: N["bones"];
  private readonly engine;
  private readonly index;
  constructor(engine: PoseEngine, index: number, name: N["slots"]);
  get attachment(): string | null;
  set attachment(name: string | null);
  get tint(): number;
  set tint(value: number);
  get alpha(): number;
  set alpha(value: number);
  get darkTint(): number | null;
  set darkTint(value: number | null);
}
export declare abstract class SpineLinks<N extends MarrowNames = MarrowNames> extends Container {
  protected links: Links | undefined;
  private linkParts;
  private readonly handles;
  private readonly slotHandles;
  bone(name: N["bones"]): Bone<N>;
  slot(name: N["slots"]): Slot<N>;
  get skin(): N["skins"] | null;
  set skin(name: N["skins"] | null);
  get skins(): N["skins"][];
  set skins(names: readonly N["skins"][]);
  setupPose(part?: SetupPosePart): void;
  follow(bone: N["bones"], container: Container): void;
  unfollow(container: Container): void;
  attach(slot: N["slots"], container: Container, options?: AttachOptions): void;
  detach(container: Container): void;
  protected linkTo(parts: LinkParts): void;
  private parts;
  private linked;
}
export interface StopOptions {
  track?: number;
  mix?: number;
}
export interface Track<N extends MarrowNames = MarrowNames> {
  readonly animation: N["animations"];
  readonly track: number;
  loop: boolean;
  speed: number;
  alpha: number;
  readonly additive: boolean;
  readonly time: number;
  readonly finished: Promise<void>;
  stop(options?: Pick<StopOptions, "mix">): void;
  configure(fields: TrackFields): void;
}
export type TrackField = "loop" | "delay" | "trackTime" | "trackEnd" | "timeScale" | "alpha" | "mixTime" | "mixDuration" | "reverse" | "shortestRotation" | "eventThreshold" | "animationStart" | "animationEnd" | "animationLast" | "holdPrevious" | "mixBlend" | "attachmentThreshold" | "drawOrderThreshold" | "mixAttachmentThreshold" | "alphaAttachmentThreshold" | "mixDrawOrderThreshold" | "additive" | "keepHold";
export type TrackFields = Partial<Record<TrackField, number | boolean | string>>;
export interface UpdateProbe {
  record(pose: number, geometry: number, events: number): void;
}
export type UpdateRate = "display" | number;
export interface ViewStats {
  renderMode: DrawMode;
  drawCalls: number;
  vertices: number;
  templateBuilds: number;
  indexRebuilds: number;
  positionUploads: number;
  colorUploads: number;
  uvUploads: number;
  indices: number;
  bufferBytes: number;
  clips: number;
  maskDraws: number;
  maskUploads: number;
  maskRebuilds: number;
  tightRanges: number;
  coveredSlots: number;
  skips: number;
  placedSlots: number;
  coloredSlots: number;
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
  readonly skinCount: number;
  skin(index: number): SkinData | undefined;
  parts(index: number): readonly number[];
  add(key: string, parts: readonly number[], make: () => SkinData): number;
  drop(index: number): void;
  get(skin: number, slot: number, name: string): AttachmentData | undefined;
  nameOf(skin: number, slot: number, attachment: AttachmentData): string | undefined;
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
export declare function createPoseEngine(model: SkeletonModel): Promise<PoseEngine>;
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
export declare const isNewer: (stamp: number, seen: number) => boolean;
export declare function loadPoseEngine(model: SkeletonModel): Promise<PoseEngineFactory>;
export declare const LOCAL_STRIDE = 7;
export declare class MarrowError extends Error {
  override readonly name: string;
  readonly code: MarrowErrorCode;
  readonly fix: string;
  readonly validNames: readonly string[];
  readonly closest: string | undefined;
  constructor(code: MarrowErrorCode, message: string, details: MarrowErrorDetails);
}
export type MarrowErrorCode = "invalid-data" | "unsupported-version" | "unsupported-feature" | "unknown-name";
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
export declare const nextVersion: (version: number) => number;
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
export type PhysicsMode = "none" | "reset" | "update" | "pose";
export interface PointAttachmentData {
  type: "point";
  name: string;
  x: number;
  y: number;
  rotation: number;
}
export interface PoseEngine {
  readonly state: PoseState;
  readonly bytes: number;
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
  setSkins(skins: readonly number[]): void;
  readonly skins: readonly number[];
  readonly slotPose: SlotPose;
  setAttachment(slot: number, attachment: AttachmentData | null): void;
  setColor(slot: number, r: number, g: number, b: number, a: number): void;
  setDarkColor(slot: number, r: number, g: number, b: number): void;
  setupPose(): void;
  setupPoseBones(): void;
  setupPoseSlots(): void;
  physics: PhysicsMode;
  physicsTranslate(x: number, y: number): void;
  physicsRotate(x: number, y: number, degrees: number): void;
  update(dt: number): void;
  source: PoseSource | null;
  solo(): TrackEntry | null;
  advance(dt: number, time?: Float64Array): void;
  holdsSetup(animation: number, bones?: Uint8Array): boolean;
  takeEvents(): PoseEvent[];
}
export type PoseEngineFactory = () => PoseEngine;
export interface PoseEvent {
  type: PoseEventType;
  track: number;
  animation: number;
  entry: TrackEntry;
  key?: EventKey;
}
export type PoseEventType = "start" | "interrupt" | "end" | "dispose" | "complete" | "event";
export interface PoseSource {
  update(dt: number): boolean;
  posed(): void;
}
export interface PoseState {
  readonly model: SkeletonModel;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  yDown: boolean;
  skin: number;
  time: number;
  windX: number;
  windY: number;
  gravityX: number;
  gravityY: number;
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
  version: number;
  readonly boneStamps: Uint32Array;
  readonly slotStamps: Uint32Array;
  drawOrderStamp: number;
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
export interface SlotPose {
  readonly colors: Float64Array;
  readonly darkColors: Float64Array;
  readonly attachments: readonly (AttachmentData | null)[];
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
export declare function touchPose(state: PoseState): void;
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
  readonly animationStart: number;
  readonly animationEnd: number;
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
export declare const ATLAS_OUTLINES_VERSION = 1;
export interface AtlasOutlines {
  version: 1;
  margin: number;
  opaqueMargin: number;
  regions: (RegionOutline | null)[];
}
export declare function buildAtlasOutlines(atlas: AtlasModel, pages: readonly (PagePixels | null | undefined)[], options?: OutlinesOptions): AtlasOutlines;
export interface CliHost {
  read(path: string): string | Uint8Array;
  write(path: string, text: string): void;
  print(line: string): void;
  printError(line: string): void;
}
export declare function decodePng(bytes: Uint8Array, name?: string): Promise<PngImage>;
export declare function generateNames(info: SkeletonInfo, options: NamesOptions): string;
export interface NamesOptions {
  typeName: string;
  source?: string;
}
export interface OutlinesOptions {
  margin?: number;
  maxVertices?: number;
  threshold?: number;
  opaqueMargin?: number;
  minOpaqueArea?: number;
}
export interface OutlinesSummary {
  regions: number;
  outlined: number;
  empty: number;
  opaque: number;
  skippedPages: number;
  quadArea: number;
  outlineArea: number;
  savedArea: number;
  savedShare: number;
}
export interface PagePixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PngImage {
  width: number;
  height: number;
  data: Uint8Array;
}
export declare function readAtlasOutlines(json: unknown, atlas: AtlasModel): AtlasOutlines;
export interface RegionOutline {
  name: string;
  rect: PageRect;
  polygon: number[] | null;
  triangles: number[];
  coverage: number;
  opaque: PageRect | null;
}
export declare function runCli(args: readonly string[], host: CliHost): Promise<number>;
export declare function summarizeOutlines(atlas: AtlasModel, outlines: AtlasOutlines): OutlinesSummary;
export declare function typeNameFor(fileName: string): string;
```

## pixi-marrow/perf

```ts
export declare function createProbe(spine: ProbeTarget): PerfProbe;
export declare class PerfProbe implements UpdateProbe {
  private target;
  private updates;
  private readonly times;
  private drawCalls;
  private vertices;
  private uploads;
  private rangesRebuilt;
  private clips;
  private coveredSlots;
  private skippedUpdates;
  private placedSlots;
  private lastSkips;
  private lastPositions;
  private lastUploads;
  private lastRebuilds;
  constructor(target: ProbeTarget);
  get attached(): boolean;
  record(pose: number, geometry: number, events: number): void;
  read(): ProbeReading;
  reset(): void;
  stop(): void;
  private add;
  private bucket;
  private mark;
}
export interface ProbeBucket {
  total: number;
  mean: number;
  worst: number;
}
export interface ProbeCounters {
  drawCalls: number;
  vertices: number;
  uploads: number;
  rangesRebuilt: number;
  clips: number;
  coveredSlots: number;
  skippedUpdates: number;
  placedSlots: number;
}
export interface ProbeReading {
  updates: number;
  update: ProbeBucket;
  pose: ProbeBucket;
  geometry: ProbeBucket;
  events: ProbeBucket;
  counters: ProbeCounters;
}
export interface ProbeTarget {
  updateProbe: UpdateProbe | null;
  readonly stats: ViewStats;
  readonly destroyed: boolean;
}
```

## pixi-marrow/bake

```ts
export declare function addBakedClips(asset: {
  readonly model: SkeletonModel;
}, clips: readonly BakedClip[]): void;
export declare function bakeAnimation(model: SkeletonModel, animation: string | number, options?: BakeOptions): Promise<BakedClip>;
export declare function bakeAnimations(model: SkeletonModel, options?: BakeOptions): Promise<BakedClip[]>;
export declare function bakedBytes(clip: BakedClip): number;
export interface BakedClip {
  readonly animation: string;
  readonly skins: readonly string[];
  readonly fps: number;
  readonly duration: number;
  readonly frames: number;
  readonly hash: string | null;
  readonly boneCount: number;
  readonly slotCount: number;
  readonly placement: Float64Array;
  readonly bones: Int16Array;
  readonly world: Float32Array;
  readonly colorSlots: Int16Array;
  readonly colorMasks: Uint8Array;
  readonly colors: Float32Array;
  readonly darkSlots: Int16Array;
  readonly darkMasks: Uint8Array;
  readonly darkColors: Float32Array;
  readonly attachmentSlots: Int16Array;
  readonly attachmentNames: readonly (string | null)[];
  readonly attachments: Int16Array;
  readonly sequenceSlots: Int16Array;
  readonly sequences: Int32Array;
  readonly deformSlots: Int16Array;
  readonly deformStarts: Int32Array;
  readonly deformLengths: Int32Array;
  readonly deforms: Float32Array;
  readonly drawOrders: Int16Array;
  readonly drawOrderFrames: Uint16Array;
}
export interface BakeOptions {
  fps?: number;
  skins?: readonly string[];
  placement?: readonly [number, number, number, number];
}
export declare function decodeBakedClips(bytes: Uint8Array): BakedClip[];
export declare function encodeBakedClips(clips: readonly BakedClip[]): Uint8Array;
```

## pixi-marrow/debug

```ts
export declare function collectShapes(state: PoseState, lookup: AttachmentLookup, atlas: AtlasModel, cache: RegionOffsets): DebugShapes;
export declare const DEBUG_COLORS: Readonly<Record<DebugLayer, number>>;
export declare const DEBUG_LAYERS: Readonly<Record<DebugLayer, boolean>>;
export type DebugLayer = "bones" | "origin" | "regions" | "meshHulls" | "meshTriangles" | "boundingBoxes" | "clipping" | "paths" | "points" | "events" | "overdraw";
export interface DebugOptions {
  layers?: Partial<Record<DebugLayer, boolean>>;
  colors?: Partial<Record<DebugLayer, number>>;
  lineWidth?: number;
}
export interface DebugShapes {
  readonly bones: number[];
  readonly regions: Float64Array[];
  readonly hulls: Float64Array[];
  readonly triangles: number[];
  readonly boxes: Float64Array[];
  readonly clips: Float64Array[];
  readonly paths: PathShape[];
  readonly points: number[];
}
export declare class MarrowDebug extends Container {
  readonly layers: Record<DebugLayer, boolean>;
  readonly colors: Record<DebugLayer, number>;
  lineWidth: number;
  private readonly spine;
  private readonly lines;
  private readonly dots;
  private readonly heat;
  private readonly labels;
  private readonly offsets;
  private drawnFor;
  private readonly born;
  private readonly onEvent;
  constructor(spine: MarrowSpine, options?: DebugOptions);
  refresh(): void;
  override destroy(options?: Parameters<Container["destroy"]>[0]): void;
  private settings;
  private draw;
  private stroke;
  private polygons;
  private triangles;
  private boxes;
  private paths;
  private points;
  private bones;
  private drawOrigin;
  private drawHeat;
  private addLabel;
  private age;
}
export interface PathShape {
  readonly points: Float64Array;
  readonly closed: boolean;
}
```

