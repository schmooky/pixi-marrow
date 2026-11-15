import { Buffer, VERSION } from 'pixi.js';
import { uploadsStretch } from '../../src/render/batch-upload';

/*
 * What the pixi.js under test can do. The peer range starts at 8.21, and CI runs the unit tests on
 * 8.21 as well as on the version of the lockfile. Two things came with pixi.js 8.23:
 *
 * - A buffer or a data texture uploads a stretch of itself. Older versions upload it whole, so
 *   the byte counts of a test differ, and the number of uploads does not.
 * - A program states which outputs its fragment shader writes, as `fragmentOutputMask`.
 */

/** True when this pixi.js uploads a stretch of a buffer, from 8.23 on. */
export const RANGED_UPLOADS = uploadsStretch(Buffer.prototype.update, VERSION);

/** The `fragmentOutputMask` of a program, or undefined before pixi.js 8.23, where programs have none. */
export const outputMask = (program: object): number | undefined =>
    (program as { fragmentOutputMask?: number }).fragmentOutputMask;

/** True when the programs of this pixi.js state the outputs of the fragment shader. */
export const STATES_OUTPUTS = RANGED_UPLOADS;
