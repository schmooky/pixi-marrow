/*
 * The plain data of the entry `pixi-marrow/diagnose`: a skeleton as `inspect` describes it, a
 * scene tree as `serializeTree` writes it, and what `diagnose` reports. Every value here survives
 * `JSON.stringify`, so a tool can copy it out of a browser and read it somewhere else.
 */

/** What a cause costs. The docs page of the rules explains each word. */
export type RuleCost = 'draw-calls' | 'cpu-vertex' | 'cpu-pose' | 'upload' | 'overdraw' | 'memory';

/** `warn`: a cost that grows with the scene. `info`: a cost to know about. */
export type RuleSeverity = 'warn' | 'info';

/** One rule of the catalogue. scripts/perf-rules.mjs holds the source of every rule. */
export interface PerfRule {
    /** The stable id, such as `MARROW001`. An id never names another cause later. */
    readonly id: string;
    /** A short name in lower case, such as `moving-ancestor-batched`. */
    readonly slug: string;
    /** One line for a table. */
    readonly title: string;
    readonly severity: RuleSeverity;
    readonly cost: readonly RuleCost[];
    /** `static`: one look at the tree finds it. `dynamic`: two looks do. `both`: each finds a part. */
    readonly detect: 'static' | 'dynamic' | 'both';
    /** What a tool sees in the tree or in the counters. */
    readonly pattern: string;
    /** What the runtime does then. */
    readonly does: string;
    /** The source file that does it. */
    readonly source: string;
    /** The field of `inspect(hero)` that shows it. */
    readonly check: string;
    /** What to change. */
    readonly fix: string;
    /** The release that first reported the rule. */
    readonly since: string;
    /** The address of the rule in the docs. */
    readonly docs: string;
}

/** One cause that `diagnose` found for one display object. */
export interface RuleHit {
    /** The id of the rule, such as `MARROW004`. */
    id: string;
    slug: string;
    severity: RuleSeverity;
    /** The path of the first skeleton, such as `stage/reels[2]/MarrowSpine`. The root path for a hit about the scene. */
    node: string;
    /** The paths of all skeletons with this cause. `measured.skeletons` is their number. */
    nodes: string[];
    /** The path of the display object that causes it. Empty when the skeleton itself does. */
    cause: string;
    cost: RuleCost[];
    /** The numbers behind the hit. */
    measured: Record<string, number>;
    /** What happens, in one or two sentences, with the numbers of this scene. */
    message: string;
    fix: string;
    /** The address of the rule in the docs. */
    docs: string;
}

/** A skeleton as plain data. `inspect` makes it. */
export interface SkeletonInspection {
    kind: 'pixi-marrow/skeleton';
    /** The version of the shape of this object. */
    version: 1;
    /** The Pixi label of the display object. */
    label: string;
    asset: {
        /** A number that is the same for every instance of one asset in one tree dump. -1 outside a dump. */
        id: number;
        /** The Spine version line of the file: `4.1`, `4.2` or `4.3`. */
        spine: string;
        /** The version of the editor that exported the file. */
        editorVersion: string;
        /** The hash the editor wrote, or null. */
        hash: string | null;
        /** The instances of the asset in the dump. 1 outside a dump. */
        instances: number;
    };
    counts: {
        bones: number;
        slots: number;
        visibleSlots: number;
        /** Vertices in the buffers at the moment. */
        vertices: number;
        /** Indices the skeleton draws at the moment. */
        indices: number;
        atlasPages: number;
        /** The constraints of the skeleton by type. */
        constraints: Record<string, number>;
    };
    render: {
        mode: 'mesh' | 'batched';
        /** The `renderMode` option. */
        option: 'auto' | 'mesh' | 'batched';
        /** Why the skeleton draws in its mode: `option`, `small`, `large` or `limit`. */
        modeReason: string;
        /** The vertices the skeleton has in a batch, which `auto` decides by, and the limit. */
        batchVertices: number;
        batchLimit: number;
        drawCalls: number;
        /** The skeletons in its first batch, itself included. 0 in the mesh mode. */
        sharedBy: number;
        /** The batches or the draw ranges of the skeleton. */
        runs: number;
        /** Visible slots that multiply or screen. Each starts a draw. */
        blendSlots: number;
        skinning: 'cpu' | 'gpu';
        instancing: { active: boolean; why: string | null; run: number; draws: number };
        darkTint: boolean;
        clips: number;
        maskDraws: number;
        /** Containers attached to a slot, and containers that follow a bone. */
        attached: number;
        following: number;
    };
    cuts: {
        /** Where the outlines of the asset stand: `given`, `scanned`, `scanning`, `unread` or `off`. */
        outlines: string;
        occlusion: 'auto' | 'off';
        tightMesh: 'auto' | 'on' | 'off';
        /** What stops the cuts: `roundPixels`, `multisample`, `edge-bend`, `alpha-or-blend`, `code`. */
        blockedBy: string[];
        /** The pages whose regions keep their quads, each as `name: reason`. */
        pageBlocks: string[];
        coveredSlots: number;
        tightRanges: number;
    };
    /** The last update of the view, and the bytes since that update began. */
    frame: {
        /** False when the update found the pose it drew last. */
        posed: boolean;
        skipped: boolean;
        placedSlots: number;
        coloredSlots: number;
        /** `stats.frameBytes`: 0 after a frame in which nothing above the skeleton changed either. */
        uploadBytes: number;
    };
    /** Counters since the skeleton was made. They only grow. */
    totals: {
        skips: number;
        transformReplaces: number;
        tintRewrites: number;
        templateBuilds: number;
        indexRebuilds: number;
        instructionBuilds: number;
        positionUploads: number;
        colorUploads: number;
        uvUploads: number;
        boneUploads: number;
        maskUploads: number;
        uploadBytes: { positions: number; statics: number; indices: number; bones: number; masks: number };
    };
    pacing: {
        autoUpdate: boolean;
        /** Updates a second, or `display`. */
        rate: number | 'display';
        offscreen: string;
        /** What the pacing found at the last renders. */
        hidden: boolean;
        /** Pixels across at the last render, or null before one. */
        size: number | null;
        reduced: boolean;
        /**
         * False when an update from the ticker does not pose the skeleton. It then has no parent,
         * or it or a container above it is not visible, not renderable or has an alpha of 0. With
         * an alpha of 0 a batched skeleton still fills its triangles, so hide with `visible`.
         */
        drawn: boolean;
        /** Whether its bounds touch the screen. Null when the dump has no screen size. */
        onScreen: boolean | null;
    };
    /** The `perf` settings in effect, and the names of those the game gave. */
    perf: { preset: string; given: string[]; settings: Record<string, string | number> };
    idle: { setting: string; showing: boolean };
    bake: { setting: string; active: boolean; baked: number; unbaked: number; last: string; bytes: number };
    physics: { constraints: number; mode: string };
    /** The bytes of `perf.memory()`. */
    memory: {
        shared: number;
        baked: number;
        instance: number;
        gpuBuffers: number;
        gpuTextures: number;
    };
    /** The ids of the static rules that hit for this instance. Filled by `serializeTree` and `diagnose`. */
    rules: string[];
}

/** One display object of a tree dump. */
export interface TreeNode {
    /** The class name of the display object. */
    type: string;
    label: string;
    /** The path from the root, such as `stage/reels[2]/MarrowSpine`. */
    path: string;
    visible: boolean;
    renderable: boolean;
    alpha: number;
    /** The tint as a number, 0xffffff for none. */
    tint: number;
    blendMode: string;
    /** The local transform: position, scale and rotation in radians. */
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    zIndex: number;
    sortableChildren: boolean;
    /** How many filters the object has. */
    filters: number;
    mask: boolean;
    renderGroup: boolean;
    cacheAsTexture: boolean;
    /** Whether the object draws something itself, as a sprite or a mesh does. */
    draws: boolean;
    /** The skeleton, for a `MarrowSpine`. Its children are left out. */
    marrow?: SkeletonInspection;
    children: TreeNode[];
}

/** What a dump knows of the renderer. */
export interface RendererInfo {
    /** `webgl`, `webgpu` or `unknown`. */
    type: string;
    roundPixels: boolean;
    /** Whether the screen target is multisampled. */
    antialias: boolean;
    /** The size of the screen in pixels of the stage. */
    width: number;
    height: number;
    /** The most textures a batch samples. */
    maxBatchTextures: number;
}

/** A scene tree as plain data. `serializeTree` makes it and `diagnoseTree` reads it. */
export interface TreeDump {
    kind: 'pixi-marrow/tree';
    version: 1;
    /** The version of pixi.js that drew the tree. */
    pixi: string;
    /** Null when `serializeTree` got no renderer. */
    renderer: RendererInfo | null;
    root: TreeNode;
}

/** Totals over the skeletons of a tree. */
export interface SceneTotals {
    /** Skeletons that Pixi draws. */
    drawn: number;
    batched: number;
    mesh: number;
    instanced: number;
    /** Distinct assets. */
    assets: number;
    vertices: number;
    indices: number;
    /** The draw calls of the skeletons in the mesh mode. Batched skeletons share theirs. */
    meshDrawCalls: number;
    /** The bytes the skeletons handed to the GPU since their last updates began. */
    frameBytes: number;
    /** The bytes the instances hold in typed arrays and in GPU buffers. */
    instanceBytes: number;
    gpuBufferBytes: number;
}

/** What `diagnose` and `diagnoseTree` return. */
export interface Diagnosis {
    /** How many skeletons the tree holds. */
    skeletons: number;
    /** The causes, `warn` first, then in tree order. */
    hits: RuleHit[];
    scene: SceneTotals;
}
