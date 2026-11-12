/*
 * The constants of the official `MathUtils`, the same in 4.1 and 4.2. The official code uses the
 * rounded `MathUtils.PI` in some places and the exact `Math.PI` in others. A port keeps each.
 */

/** The official `MathUtils.PI`: pi rounded to 32-bit precision. */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the official MathUtils.PI is this rounded number
export const PI = 3.1415927;
/** The official `MathUtils.PI2`. */
export const PI2: number = PI * 2;
/** The official `MathUtils.radDeg`. */
export const RAD_DEG: number = 180 / PI;
/** The official `MathUtils.degRad`. */
export const DEG_RAD: number = PI / 180;

/**
 * A quarter turn in radians, as the official code gets it for the y axis of a bone that is not
 * turned: 90 degrees times `degRad`.
 */
export const QUARTER: number = 90 * DEG_RAD;
/** `Math.cos` of {@link QUARTER}. It is not 0, because `degRad` is a rounded number. */
export const COS_QUARTER: number = Math.cos(QUARTER);
/** `Math.sin` of {@link QUARTER}. */
export const SIN_QUARTER: number = Math.sin(QUARTER);

/** Inherit mode `normal`: an index into `INHERIT_MODES` of the model. */
export const NORMAL = 0;
/** Inherit mode `onlyTranslation`. */
export const ONLY_TRANSLATION = 1;
/** Inherit mode `noRotationOrReflection`. */
export const NO_ROTATION_OR_REFLECTION = 2;
/** Inherit mode `noScale`. */
export const NO_SCALE = 3;
/** Inherit mode `noScaleOrReflection`. */
export const NO_SCALE_OR_REFLECTION = 4;
