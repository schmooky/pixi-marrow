import type { SliderRig43, Split43 } from './slider-types';

/*
 * Where the pose of a constraint is in `Solve43.values`, `Solve43.applied` and `Solver43.setup`.
 * A constraint takes as many numbers as its pose has, from `at` of its plan on. The positions
 * below count from there. The order is that of the keys of its timeline.
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
/** The numbers an IK constraint takes. */
export const IK_SIZE = 5;

/** The numbers a transform constraint takes: six mixes, for rotate, x, y, scaleX, scaleY and shearY. */
export const TRANSFORM_SIZE = 6;

/** The official `PathConstraintPose.position`. */
export const PATH_POSITION = 0;
/** The official `PathConstraintPose.spacing`. */
export const PATH_SPACING = 1;
/** The first of three mixes of a path constraint: the rotate mix, the x mix and the y mix. */
export const PATH_MIX = 2;
/** The numbers a path constraint takes. */
export const PATH_SIZE = 5;

/** The official `PhysicsConstraintPose.inertia`. */
export const PHYSICS_INERTIA = 0;
/** The official `PhysicsConstraintPose.strength`. */
export const PHYSICS_STRENGTH = 1;
/** The official `PhysicsConstraintPose.damping`. */
export const PHYSICS_DAMPING = 2;
/** The official `PhysicsConstraintPose.massInverse`. */
export const PHYSICS_MASS_INVERSE = 3;
/** The official `PhysicsConstraintPose.wind`. */
export const PHYSICS_WIND = 4;
/** The official `PhysicsConstraintPose.gravity`. */
export const PHYSICS_GRAVITY = 5;
/** The official `PhysicsConstraintPose.mix`. */
export const PHYSICS_MIX = 6;
/** The numbers a physics constraint takes. */
export const PHYSICS_SIZE = 7;

/** The official `SliderPose.time`. */
export const SLIDER_TIME = 0;
/** The official `SliderPose.mix`. */
export const SLIDER_MIX = 1;
/** The numbers a slider takes. */
export const SLIDER_SIZE = 2;

/** The official `Physics.none`. */
export const PHYSICS_NONE = 0;
/** The official `Physics.reset`. */
export const PHYSICS_RESET = 1;
/** The official `Physics.update`. */
export const PHYSICS_UPDATE = 2;
/** The official `Physics.pose`. */
export const PHYSICS_POSE = 3;

/** Numbers per physics constraint in {@link Solve43.physics}: what the official `PhysicsConstraint` keeps between updates. */
export const PHYSICS_STATE = 21;

/** What every plan has. */
interface PlanBase {
    /** The index of the constraint in the model. */
    readonly index: number;
    readonly name: string;
    readonly skinRequired: boolean;
    /** Where the pose of the constraint starts among the constraint poses. */
    readonly at: number;
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

/** The official `PhysicsConstraint` with the numbers of its data, ready to solve. */
export interface PhysicsPlan extends PlanBase {
    readonly type: 'physics';
    readonly bone: number;
    /** Where the state of the constraint starts in {@link Solve43.physics}. */
    readonly state: number;
    readonly x: number;
    readonly y: number;
    readonly rotate: number;
    readonly scaleX: number;
    readonly shearX: number;
    readonly limit: number;
    readonly step: number;
    /** The official `ScaleYMode` number: 0 none, 1 uniform, 2 volume. */
    readonly scaleYMode: number;
    /**
     * 1 for each number of the pose that a timeline for every physics constraint animates: the
     * official `inertiaGlobal` and so on, in the order of the pose.
     */
    readonly globals: Uint8Array;
}

/** The official `Slider` with the numbers of its data, ready to solve. */
export interface SliderPlan extends PlanBase {
    readonly type: 'slider';
    /** The index of the animation the slider applies. */
    readonly animation: number;
    readonly additive: boolean;
    readonly loop: boolean;
    /** The bone whose property drives the slider, or -1. */
    readonly bone: number;
    /** The kind of the property that drives the slider: see {@link TransformPlan}. -1 without a bone. */
    readonly property: number;
    /** The official `data.property.offset`. */
    readonly propertyOffset: number;
    readonly offset: number;
    readonly scale: number;
    readonly local: boolean;
    /** The official `Animation.bones` of the animation of the slider: the bones its timelines animate. */
    readonly bones: Int32Array;
    /** The slot of every slot timeline of the animation, each once. `Slider.sort` gives them a pose of their own. */
    readonly slots: Int16Array;
    /** True when the animation has a draw order timeline or a draw order folder timeline. */
    readonly drawOrder: boolean;
}

/** One constraint of a model, ready to sort and to solve. */
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
    /** The physics constraints of the model, in the order of the model: the official `Skeleton.physics`. */
    readonly physics: readonly PhysicsPlan[];
    /** The setup pose of every constraint, each at `at` of its plan. */
    readonly setup: Float64Array;
    /** Per bone: where its children start in `children`. One more entry ends the last. */
    readonly childStarts: Int32Array;
    /** The children of every bone, in bone order. The official `Bone.children`. */
    readonly children: Int32Array;
    /** What the sliders of the model need. Null for a model without sliders. */
    readonly sliders: SliderRig43 | null;
    readonly scratch: SolveScratch43;
}

/**
 * The constraint state of one engine. For a model without constraints only the update cache holds
 * anything. `physics` is empty for a model without physics constraints.
 */
export interface Solve43 {
    /** The animated pose of every constraint: the official `constraint.pose`. Each is at `at` of its plan. */
    readonly values: Float64Array;
    /**
     * The applied pose of every constraint: the official `constraint.appliedPose`, which the
     * constraints read. It is `values` itself unless a slider animates a constraint. Else every
     * update copies `values` into it, then the sliders change it.
     */
    readonly applied: Float64Array;
    /** The official `constraint.active`. */
    readonly active: Uint8Array;
    /**
     * The applied local pose of every bone, in the layout of `PoseState.local`. Every update copies
     * the animated pose into it, then the constraints change it.
     */
    readonly local: Float64Array;
    /**
     * The applied inherit mode of every bone. It is `PoseState.inherit` itself unless a slider
     * animates an inherit mode. Else every update copies the animated modes into it.
     */
    readonly inherit: Uint8Array;
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
     * The official update cache. A bone index, or the complement of the index of a constraint.
     * With no constraint in it, it holds every active bone once.
     */
    cache: Int32Array;
    /** How many numbers of `cache` are in use. */
    cacheLength: number;
    /** How many constraints the cache holds. */
    solved: number;
    /** What every physics constraint keeps between updates. See {@link PHYSICS_STATE}. */
    readonly physics: Float64Array;
    /** The official `Physics` argument of `updateWorldTransform`: one of the `PHYSICS_` modes. */
    physicsMode: number;
    /**
     * What the engine keeps apart for sliders. Null for a model without sliders. It is set once,
     * when the engine is created, because it holds a pose that points back at this state.
     */
    split: Split43 | null;
}
