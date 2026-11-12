/** Numbers per constraint in {@link Solve43.values} and {@link Solver43.setup}. */
export const CONSTRAINT_STRIDE = 6;

/*
 * Where the pose of a constraint is among its numbers. The order is that of the keys of its
 * timeline. A transform constraint has six mixes, in this order: rotate, x, y, scaleX, scaleY, shearY.
 */

/** The official `IkConstraintPose.mix`. */
export const IK_MIX = 0;
/** The official `IkConstraintPose.softness`. */
export const IK_SOFTNESS = 1;
/** The official `IkConstraintPose.bendDirection`. */
export const IK_BEND_DIRECTION = 2;
/** The official `IkConstraintPose.compress`: 1 for true, 0 for false. */
export const IK_COMPRESS = 3;
/** The official `IkConstraintPose.stretch`: 1 for true, 0 for false. */
export const IK_STRETCH = 4;

/** The official `PathConstraintPose.position`. */
export const PATH_POSITION = 0;
/** The official `PathConstraintPose.spacing`. */
export const PATH_SPACING = 1;
/** The first of three mixes of a path constraint: the rotate mix, the x mix and the y mix. */
export const PATH_MIX = 2;

/** What every plan has. */
interface PlanBase {
    /** The index of the constraint in the model. */
    readonly index: number;
    readonly name: string;
    readonly skinRequired: boolean;
}

/** The official `IkConstraint`, ready to solve. */
export interface IkPlan extends PlanBase {
    readonly type: 'ik';
    readonly bones: Int16Array;
    readonly target: number;
    /** The official `ScaleYMode` number: 0 none, 1 uniform, 2 volume. */
    readonly scaleYMode: number;
}

/**
 * The official `TransformConstraint`, ready to solve. Its properties are flat lists. A property
 * kind is the position of the property in this order: rotate, x, y, scaleX, scaleY, shearY.
 */
export interface TransformPlan extends PlanBase {
    readonly type: 'transform';
    readonly bones: Int16Array;
    readonly source: number;
    readonly localSource: boolean;
    readonly localTarget: boolean;
    readonly additive: boolean;
    readonly clamp: boolean;
    /** The six official offsets, by property kind. */
    readonly offsets: Float64Array;
    /** The kind of each property that is read from the source bone. */
    readonly fromKinds: Uint8Array;
    readonly fromOffsets: Float64Array;
    /** Per source property: where its target properties start. One more entry ends the last. */
    readonly toStarts: Int32Array;
    /** The kind of each property that is written. */
    readonly toKinds: Uint8Array;
    readonly toOffsets: Float64Array;
    readonly toMax: Float64Array;
    readonly toScales: Float64Array;
}

/** The official `PathConstraint`, ready to solve. */
export interface PathPlan extends PlanBase {
    readonly type: 'path';
    readonly bones: Int16Array;
    readonly slot: number;
    /** The bone of the slot. */
    readonly slotBone: number;
    /** True for the official `PositionMode.Percent`. */
    readonly percentPosition: boolean;
    /** The official `SpacingMode` number: 0 length, 1 fixed, 2 percent, 3 proportional. */
    readonly spacingMode: number;
    /** The official `RotateMode` number: 0 tangent, 1 chain, 2 chain scale. */
    readonly rotateMode: number;
    readonly offsetRotation: number;
}

/**
 * The official `PhysicsConstraint`. It is not solved. It keeps its place in the update order,
 * like an official physics constraint that is updated with `Physics.none`.
 */
export interface PhysicsPlan extends PlanBase {
    readonly type: 'physics';
    readonly bone: number;
}

/**
 * The official `Slider`. It is not solved. It keeps its place in the update order, like an
 * official slider with a mix of 0.
 */
export interface SliderPlan extends PlanBase {
    readonly type: 'slider';
    /** The bone whose property drives the slider, or -1. */
    readonly bone: number;
    readonly local: boolean;
    /** The official `Animation.bones` of the animation of the slider: the bones its timelines animate. */
    readonly bones: Int32Array;
}

/** One constraint of a model, ready to sort and, for the kinds this engine solves, to solve. */
export type Plan43 = IkPlan | TransformPlan | PathPlan | PhysicsPlan | SliderPlan;

/** Working memory for constraints that every engine of one model shares. No call keeps it across a return. */
export interface SolveScratch43 {
    /** The official `bone.sorted`, while the update cache is built. */
    readonly sorted: Uint8Array;
    /** Which bones had a constrained pose before the update cache was built. */
    readonly previous: Uint8Array;
    /** The update cache while it is built. */
    readonly items: number[];
    /** The official `PathConstraint.spaces`. */
    spaces: Float64Array;
    /** The official `PathConstraint.positions`. */
    positions: Float64Array;
    /** The official `PathConstraint.lengths`. */
    lengths: Float64Array;
    /** The official `PathConstraint.world`. */
    world: Float64Array;
    /** The official `PathConstraint.curves`. */
    curves: Float64Array;
    /** The official `PathConstraint.segments`. */
    readonly segments: Float64Array;
}

/** What every engine of one model shares to solve constraints. */
export interface Solver43 {
    /** One plan per constraint of the model, in the order of the model. */
    readonly plans: readonly Plan43[];
    /** The setup pose of every constraint. See {@link CONSTRAINT_STRIDE}. */
    readonly setup: Float64Array;
    /** True when the model has an IK, transform or path constraint. */
    readonly solvable: boolean;
    /** Per bone: where its children start in `children`. One more entry ends the last. */
    readonly childStarts: Int32Array;
    /** The children of every bone, in bone order. The official `Bone.children`. */
    readonly children: Int32Array;
    readonly scratch: SolveScratch43;
}

/**
 * The constraint state of one engine. `constrained` and `spare` are empty for a model without
 * constraints. `local` and the stamps are empty for a model without a constraint this engine solves.
 */
export interface Solve43 {
    /** The animated pose of every constraint: the official `constraint.pose`. See {@link CONSTRAINT_STRIDE}. */
    readonly values: Float64Array;
    /** The official `constraint.active`. */
    readonly active: Uint8Array;
    /**
     * The applied local pose of every bone, in the layout of `PoseState.local`. Every update copies
     * the animated pose into it, then the constraints change it.
     */
    readonly local: Float64Array;
    /** 1 for each bone whose applied pose is its official constrained pose. */
    readonly constrained: Uint8Array;
    /**
     * The world transform of the official pose object of each bone that is not the applied one.
     * A bone swaps it with its numbers in `PoseState.world` when it gets or loses its constrained pose.
     */
    readonly spare: Float64Array;
    /** The number of the update that is going on, from 1 to 255: the official `skeleton._update`. */
    stamp: number;
    /** `stamp` for each bone whose world transform is from this update: the official `world` stamp. */
    readonly worldStamps: Uint8Array;
    /** `stamp` for each bone whose local pose is behind its world transform: the official `local` stamp. */
    readonly localStamps: Uint8Array;
    /**
     * The official update cache. A bone index, or the complement of the index of a constraint this
     * engine solves. With no such constraint in it, it holds every active bone once.
     */
    cache: Int32Array;
    /** How many numbers of `cache` are in use. */
    cacheLength: number;
    /** How many constraints the cache holds. */
    solved: number;
}
