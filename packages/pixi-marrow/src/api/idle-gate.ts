import { Batch, type Container, type Renderer } from 'pixi.js';
import { i32 } from '../geometry/read';
import { BLEND_MODES, type SkeletonModel } from '../model/model';
import { INSTANCE_PIPE } from '../render/instance-id';
import { u8 } from '../render/read';
import type { SkeletonView } from '../render/skeleton-view';

/*
 * What the idle cache asks before it draws an image, and what it clears after: whether a filter
 * or a mask lies above the skeleton, whether every slot blends alone, and the release of the
 * render group it draws through. It loads with the idle cache, see `idle-image.ts`.
 */

const MULTIPLY = BLEND_MODES.indexOf('multiply');
const SCREEN = BLEND_MODES.indexOf('screen');

/**
 * Lets the studio go of what its last render built: the instructions, the renderables, and the
 * elements and textures of its batches. They hold the view of the last capture and its skeleton.
 * The next capture builds them again, since the studio gets another child. A batcher of ours
 * keeps its batches for the next build, and each one was in the instructions of its last build.
 */
export function releaseStudio(group: Container, renderer: Renderer): void {
    const renderGroup = group.renderGroup;

    if (renderGroup === null || renderGroup === undefined) return;
    const set = renderGroup.instructionSet;
    // the pipe of instanced draws keeps its runs per instruction set, and their members with them
    const instances: unknown = Reflect.get(renderer.renderPipes, INSTANCE_PIPE);

    if (typeof instances === 'object' && instances !== null && 'destroyInstructionSet' in instances) {
        (instances as { destroyInstructionSet(set: unknown): void }).destroyInstructionSet(set);
    }

    for (let i = 0; i < set.instructionSize; i++) {
        const instruction = set.instructions[i];

        if (!(instruction instanceof Batch)) continue;
        instruction.elements.length = 0;
        instruction.textures.clear();
    }
    set.instructions.length = 0;
    set.instructionSize = 0;
    set.renderables.length = 0;
    renderGroup.childrenRenderablesToUpdate.list.length = 0;
    renderGroup.childrenRenderablesToUpdate.index = 0;
}

/**
 * Whether no container from the display object up has a filter or a mask. A filter draws at a
 * resolution of its own, so an image on the grid of the target would be sampled between texels.
 */
export function unmasked(owner: Container): boolean {
    for (let node: Container | null = owner; node !== null; node = node.parent) {
        if (node.mask != null || (node.filters?.length ?? 0) > 0) return false;
    }

    return true;
}

/**
 * Whether every visible slot of a view blends with the slots below it alone. Normal and additive
 * slots do: drawn into an empty image and then over the background, they give the same color as
 * drawn over the background one by one. A slot that multiplies or screens blends with what lies
 * behind the skeleton too, and an image has nothing behind it.
 */
export function blendsAlone(view: SkeletonView, model: SkeletonModel): boolean {
    const { template, seen } = view.parts;
    const { blendModes } = model.slots;

    for (let i = 0; i < seen.count; i++) {
        const blend = u8(blendModes, i32(template.slots, i32(seen.list, i)));

        if (blend === MULTIPLY || blend === SCREEN) return false;
    }

    return true;
}
