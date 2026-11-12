import type { PathAttachmentData } from '../../model/attachments';
import { WORLD_STRIDE } from '../state';
import { modifyWorld } from './bone-pose';
import { DEG_RAD, EPSILON, PI, PI2 } from './math';
import { computeWorldPositions } from './path-positions';
import { constraintError } from './plan-checks';
import { PATH_MIX, PATH_SPACING, type PathPlan, type SolveScratch43 } from './solver-types';
import type { Pose43 } from './types';

const SPACING_LENGTH = 0;
const SPACING_PERCENT = 2;
const SPACING_PROPORTIONAL = 3;
const ROTATE_TANGENT = 0;
const ROTATE_CHAIN = 1;
const ROTATE_CHAIN_SCALE = 2;

/*
 * Typed arrays are read in place, as `Number(array[i])`, and the numbers a loop carries from bone
 * to bone stay in the variables of one function. solve.ts gives the reasons.
 */

/**
 * Throws for a path the official code fails on or reads past the end of: one whose vertices are
 * not whole curves, or that has no curve at all.
 */
function checkPath(plan: PathPlan, path: PathAttachmentData): void {
    const knots = path.worldVerticesLength / 6;

    if (Number.isInteger(knots) && knots >= (path.closed ? 1 : 2)) return;
    throw constraintError(
        'path',
        plan.name,
        `follows the path "${path.name}", whose ${path.worldVerticesLength / 2} vertices make no curve.`,
    );
}

/** Makes the scratch long enough for a path. The scratch of a rig fits every path of its model. */
function fitScratch(scratch: SolveScratch43, path: PathAttachmentData): void {
    const vertices = path.worldVerticesLength;

    if (scratch.world.length < vertices + 2) scratch.world = new Float64Array(vertices + 2);
    if (scratch.curves.length < vertices / 6) scratch.curves = new Float64Array(vertices / 6);
}

/** The spaces of the official `SpacingMode.Percent`: every space is the spacing. */
function percentSpaces(pose: Pose43, plan: PathPlan, spacesCount: number, scale: boolean): void {
    const { world } = pose.state;
    const { spaces, lengths } = pose.rig.solver.scratch;
    const setupLengths = pose.rig.model.bones.lengths;
    const spacing = Number(pose.solve.applied[plan.at + PATH_SPACING]);

    if (scale) {
        for (let i = 0, n = spacesCount - 1; i < n; i++) {
            const bone = plan.bones[i] ?? -1;
            const setupLength = Number(setupLengths[bone]);
            const x = setupLength * Number(world[bone * WORLD_STRIDE]);
            const y = setupLength * Number(world[bone * WORLD_STRIDE + 2]);

            lengths[i] = Math.sqrt(x * x + y * y);
        }
    }
    for (let i = 1; i < spacesCount; i++) spaces[i] = spacing;
}

/**
 * The spaces of the other official spacing modes, and the world length of every bone of the
 * constraint. `SpacingMode.Proportional` takes the bone lengths, scaled so that their mean is the
 * spacing. `SpacingMode.Length` adds the spacing to the length of each bone and
 * `SpacingMode.Fixed` takes the spacing, both in the scale of the bone. A bone without a setup
 * length has the length 0 and takes the spacing.
 */
function boneSpaces(pose: Pose43, plan: PathPlan, spacesCount: number): void {
    const { world } = pose.state;
    const { spaces, lengths } = pose.rig.solver.scratch;
    const setupLengths = pose.rig.model.bones.lengths;
    const spacing = Number(pose.solve.applied[plan.at + PATH_SPACING]);
    const mode = plan.spacingMode;
    let sum = 0;

    for (let i = 0, n = spacesCount - 1; i < n; i++) {
        const bone = plan.bones[i] ?? -1;
        const setupLength = Number(setupLengths[bone]);

        if (setupLength < EPSILON) {
            lengths[i] = 0;
            spaces[i + 1] = spacing;
            continue;
        }
        const x = setupLength * Number(world[bone * WORLD_STRIDE]);
        const y = setupLength * Number(world[bone * WORLD_STRIDE + 2]);
        const length = Math.sqrt(x * x + y * y);

        lengths[i] = length;
        if (mode === SPACING_PROPORTIONAL) {
            spaces[i + 1] = length;
            sum += length;
        } else {
            const space = mode === SPACING_LENGTH ? Math.max(0, setupLength + spacing) : spacing;

            spaces[i + 1] = (space * length) / setupLength;
        }
    }
    if (mode === SPACING_PROPORTIONAL && sum > 0) {
        sum = (spacesCount / sum) * spacing;
        for (let i = 1; i < spacesCount; i++) spaces[i] = Number(spaces[i]) * sum;
    }
}

/**
 * Writes the space before every position to the scratch, and the world length of the bones,
 * which the chain scale mode reads. The first space is 0 and the two numbers after the last position are 0,
 * as in the official arrays, which the official code never writes there.
 */
function computeSpaces(pose: Pose43, plan: PathPlan, spacesCount: number): void {
    const { spaces, positions } = pose.rig.solver.scratch;
    const scale = plan.rotateMode === ROTATE_CHAIN_SCALE;

    spaces[0] = 0;
    positions[spacesCount * 3] = 0;
    positions[spacesCount * 3 + 1] = 0;
    if (plan.spacingMode === SPACING_PERCENT) percentSpaces(pose, plan, spacesCount, scale);
    else boneSpaces(pose, plan, spacesCount);
}

/** True when the bone of the slot of a path constraint is not mirrored. The sign of the rotation offset follows it. */
function slotBoneUpright(pose: Pose43, plan: PathPlan): boolean {
    const { world } = pose.state;
    const o = plan.slotBone * WORLD_STRIDE;

    return Number(world[o]) * Number(world[o + 3]) - Number(world[o + 1]) * Number(world[o + 2]) > 0;
}

/**
 * Moves the bones of a path constraint to the positions in the scratch and turns them along the
 * path: the second half of the official `PathConstraint.update`. One loop holds all of it, so
 * that the numbers it carries from bone to bone stay in registers.
 */
function placeBones(pose: Pose43, plan: PathPlan): void {
    const { world } = pose.state;
    const { positions, spaces, lengths } = pose.rig.solver.scratch;
    const setupLengths = pose.rig.model.bones.lengths;
    const { bones, rotateMode } = plan;
    const v = plan.at + PATH_MIX;
    const mixRotate = Number(pose.solve.applied[v]);
    const mixX = Number(pose.solve.applied[v + 1]);
    const mixY = Number(pose.solve.applied[v + 2]);
    const tip = plan.offsetRotation === 0 && rotateMode === ROTATE_CHAIN;
    let offsetRotation = plan.offsetRotation;
    let boneX = Number(positions[0]);
    let boneY = Number(positions[1]);

    // the bone of the slot is read here and not in the loop, which moves the bones
    if (offsetRotation !== 0) offsetRotation *= slotBoneUpright(pose, plan) ? DEG_RAD : -DEG_RAD;
    for (let i = 0, ip = 3; i < bones.length; i++, ip += 3) {
        const bone = bones[i] ?? -1;
        const o = bone * WORLD_STRIDE;

        modifyWorld(pose, bone);
        const worldX = Number(world[o + 4]);
        const worldY = Number(world[o + 5]);
        const x = Number(positions[ip]);
        const y = Number(positions[ip + 1]);
        const dx = x - boneX;
        const dy = y - boneY;

        world[o + 4] = worldX + (boneX - worldX) * mixX;
        world[o + 5] = worldY + (boneY - worldY) * mixY;
        if (rotateMode === ROTATE_CHAIN_SCALE && lengths[i] !== 0) {
            const s = (Math.sqrt(dx * dx + dy * dy) / Number(lengths[i]) - 1) * mixRotate + 1;

            world[o] = Number(world[o]) * s;
            world[o + 2] = Number(world[o + 2]) * s;
        }
        boneX = x;
        boneY = y;
        if (!(mixRotate > 0)) continue;
        const a = Number(world[o]);
        const b = Number(world[o + 1]);
        const c = Number(world[o + 2]);
        const d = Number(world[o + 3]);
        // the angle of the path at the bone: of its position on a tangent, of the next position
        // for a bone without a space, else the direction to the next position
        let r = 0;

        if (rotateMode === ROTATE_TANGENT) r = Number(positions[ip - 1]);
        else if (spaces[i + 1] === 0) r = Number(positions[ip + 2]);
        else r = Math.atan2(dy, dx);
        r -= Math.atan2(c, a);
        let cos = 0;
        let sin = 0;

        if (tip) {
            // the next bone goes to the tip of this one
            const length = Number(setupLengths[bone]);

            cos = Math.cos(r);
            sin = Math.sin(r);
            boneX += (length * (cos * a - sin * c) - dx) * mixRotate;
            boneY += (length * (sin * a + cos * c) - dy) * mixRotate;
        } else r += offsetRotation;
        const aimed = r;

        if (r > PI) r -= PI2;
        else if (r < -PI) r += PI2;
        r *= mixRotate;
        // at a full mix the angle is often the one whose cosine and sine are at hand: the same input gives the same output
        if (!tip || r !== aimed) {
            cos = Math.cos(r);
            sin = Math.sin(r);
        }
        world[o] = cos * a - sin * c;
        world[o + 1] = cos * b - sin * d;
        world[o + 2] = sin * a + cos * c;
        world[o + 3] = sin * b + cos * d;
    }
}

/**
 * The official `PathConstraint.update`: places the bones of the constraint along the path
 * attachment its slot shows. A slot that shows no path leaves the bones alone.
 */
export function solvePath(pose: Pose43, plan: PathPlan): void {
    const attachment = pose.state.attachments[plan.slot];

    if (attachment == null || attachment.type !== 'path') return;
    const values = pose.solve.applied;
    const v = plan.at + PATH_MIX;

    if (values[v] === 0 && values[v + 1] === 0 && values[v + 2] === 0) return;
    const tangents = plan.rotateMode === ROTATE_TANGENT;
    const spacesCount = tangents ? plan.bones.length : plan.bones.length + 1;

    checkPath(plan, attachment);
    fitScratch(pose.rig.solver.scratch, attachment);
    computeSpaces(pose, plan, spacesCount);
    computeWorldPositions(pose, plan, attachment, spacesCount, tangents);
    placeBones(pose, plan);
}
