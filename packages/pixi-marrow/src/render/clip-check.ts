import { MarrowError } from '../base/errors';
import type { ClippingAttachmentData } from '../model/attachments';

/** A mask draws with 16-bit indices. */
const MAX_VERTICES = 65535;

/**
 * Throws a {@link MarrowError} that names the attachment when its polygon cannot clip: fewer than
 * three vertices, or more than a mask can index. The official runtime does not throw for fewer
 * than three. It then draws nothing of the clipped slots, and with `inverse` all of them.
 *
 * @example
 * const attachment = state.attachments[slot];
 * if (attachment?.type === 'clipping') checkClip(attachment);
 */
export function checkClip(attachment: ClippingAttachmentData): void {
    const vertices = attachment.worldVerticesLength >> 1;

    if (vertices >= 3 && vertices <= MAX_VERTICES) return;
    throw new MarrowError(
        'invalid-data',
        `The clipping attachment "${attachment.name}" has ${vertices} vertices. A clip polygon has 3 to ${MAX_VERTICES}.`,
        { fix: 'Give the clipping attachment three vertices or more in the Spine editor and export again.' },
    );
}
