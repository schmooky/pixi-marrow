/*
 * The constants of the official `MathUtils` and `Inherit`. The pose equals the official one only
 * with the same rounded numbers.
 */

/** The official `MathUtils.PI`, which is a rounded number. */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the official MathUtils.PI is this rounded number
export const PI = 3.1415927;
/** The official `MathUtils.PI2`. */
export const PI2: number = PI * 2;
/** The official `MathUtils.degRad`. */
export const DEG_RAD: number = PI / 180;
/** The official `MathUtils.radDeg`. */
export const RAD_DEG: number = 180 / PI;
/**
 * A quarter turn in radians, as the official code gets it for the y axis of a bone that is not
 * turned: 90 degrees times `degRad`.
 */
export const QUARTER: number = 90 * DEG_RAD;
/**
 * Numbers that a variable starts at before it gets a computed number: the cosine and the sine of
 * {@link QUARTER}, and {@link PI}. The cosine is not 0, because `degRad` is a rounded number.
 *
 * They are read from this array, as `Number(START[START_COS])`, and not imported as numbers. V8
 * keeps an imported number as an object on its heap. A variable that holds that object in one
 * branch holds objects in every branch, so each number the other branch computes is allocated.
 * A number read from a typed array is a plain number, and an update must not allocate.
 */
export const START: Float64Array = Float64Array.of(Math.cos(QUARTER), Math.sin(QUARTER), PI);
/** The index in {@link START} of `Math.cos` of {@link QUARTER}. */
export const START_COS = 0;
/** The index in {@link START} of `Math.sin` of {@link QUARTER}. */
export const START_SIN = 1;
/** The index in {@link START} of {@link PI}. */
export const START_PI = 2;
/** The official `MathUtils.epsilon`. */
export const EPSILON = 0.00001;
/** The official `MathUtils.epsilon2`. */
export const EPSILON2: number = EPSILON * EPSILON;

/** The official `Inherit.Normal`. */
export const NORMAL = 0;
/** The official `Inherit.OnlyTranslation`. */
export const ONLY_TRANSLATION = 1;
/** The official `Inherit.NoRotationOrReflection`. */
export const NO_ROTATION_OR_REFLECTION = 2;
/** The official `Inherit.NoScale`. */
export const NO_SCALE = 3;
/** The official `Inherit.NoScaleOrReflection`. */
export const NO_SCALE_OR_REFLECTION = 4;
