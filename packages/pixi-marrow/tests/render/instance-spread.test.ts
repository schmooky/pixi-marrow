import { describe, expect, it } from 'vitest';
import { setupVertices } from '../../src/render/instance-layout';
import { buildTemplate } from '../../src/render/template';
import { coverRig } from './cover-rig';

/*
 * `instancing: 'auto'` draws a layout alone when its union has more than twice the vertices a pose
 * shows. A slot that is empty in the setup pose gets its attachment from an animation, as in a
 * rig of effects, so it counts its largest attachment. Before that rule, such a rig counted 0
 * and never drew instanced.
 */

describe('the vertices a pose shows, as instancing auto guesses them', () => {
    it('counts the setup attachment of a slot, and the largest attachment of a slot empty in the setup pose', async () => {
        const rig = await coverRig([
            { name: 'a', shows: 'big' },
            { name: 'b', shows: 'mid' },
        ]);
        const template = buildTemplate(rig.model, rig.atlas, rig.lookup, -1, null, false);
        const shown = setupVertices(template, rig.model);

        expect(shown).toBe(8);
        // the animation fills slot b: empty in the setup pose, it still counts its region
        const attachments = rig.model.slots.attachments as (string | null)[];
        const [first, second] = attachments;

        attachments[0] = null;
        attachments[1] = null;
        try {
            expect(setupVertices(template, rig.model)).toBe(8);
        } finally {
            attachments[0] = first ?? null;
            attachments[1] = second ?? null;
        }
    });
});
