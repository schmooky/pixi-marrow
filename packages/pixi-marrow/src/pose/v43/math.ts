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
/** `Math.cos` of {@link QUARTER}. It is not 0, because `degRad` is a rounded number. */
export const COS_QUARTER: number = Math.cos(QUARTER);
/** `Math.sin` of {@link QUARTER}. */
export const SIN_QUARTER: number = Math.sin(QUARTER);
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
