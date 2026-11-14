/*
 * Where the lanes of a diagram stand. On a wide screen they stand side by side, with the time line
 * under them. On a phone they stand one under the other in a narrower drawing, so that their
 * labels keep a size a reader can read. The page reserves the height of the phone drawing
 * before the diagram loads, with the same numbers, so that nothing jumps.
 */

/** The width of the drawing on a phone. */
export const PHONE_WIDTH = 380;

/** The height of one lane on a phone, with the gap under it. */
export const PHONE_ROW = 154;

/** The height a time line takes under the lanes. */
const PHONE_TIMELINE = 70;

/** The screens that get the phone drawing, as a media query. */
export const PHONE_QUERY = '(max-width: 640px)';

/**
 * The size of the phone drawing of `lanes` lanes, with a time line under them or not.
 *
 * @example
 * phoneSize(3, true); // [380, 542]
 */
export const phoneSize = (lanes: number, timeline: boolean): [number, number] => [
    PHONE_WIDTH,
    10 + lanes * PHONE_ROW + (timeline ? PHONE_TIMELINE : 0),
];
