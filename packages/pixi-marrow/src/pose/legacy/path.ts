import { WORLD_STRIDE } from '../state';
import { updateAppliedTransform } from './applied';
import {
    CONSTRAINT_STRIDE,
    type LegacyConstraint,
    PATH_MIX,
    PATH_SPACING,
    ROTATE_CHAIN,
    ROTATE_CHAIN_SCALE,
    ROTATE_TANGENT,
    SPACING_LENGTH,
    SPACING_PERCENT,
    SPACING_PROPORTIONAL,
} from './constraints';
import { DEG_RAD, PI, PI2 } from './math';
import { computeWorldPositions } from './path-positions';
import { atLeast, pathScratch } from './path-scratch';
import type { Solver } from './solver';

/*
 * The official `PathConstraint.update`: the space each bone takes on the path, then the bones
 * moved and turned to the positions that `computeWorldPositions` finds.
 */

/** The official `PathConstraint.epsilon`: a bone shorter than this has no length. */
const EPSILON = 0.00001;

/** Makes the shared arrays long enough for `spacesCount` spaces. The first space and the two numbers after the positions are zero. */
function sizeArrays(spacesCount: number): void {
    const spaces = atLeast(pathScratch.spaces, spacesCount);
    const positions = atLeast(pathScratch.positions, spacesCount * 3 + 2);

    pathScratch.spaces = spaces;
    pathScratch.lengths = atLeast(pathScratch.lengths, spacesCount);
    pathScratch.positions = positions;
    spaces[0] = 0;
    positions[spacesCount * 3] = 0;
    positions[spacesCount * 3 + 1] = 0;
}

/** Spacing mode `percent`: every space is the spacing. The versions differ for a bone without length. */
function percentSpaces(solver: Solver, constraint: LegacyConstraint, spacesCount: number, scale: boolean): void {
    const { spaces, lengths } = pathScratch;
    const world = solver.pose.world;
    const boneLengths = solver.rig.model.bones.lengths;
    const spacing = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + PATH_SPACING]);

    if (scale) {
        for (let i = 0, n = spacesCount - 1; i < n; i++) {
            const bone = constraint.bones[i] ?? -1;
            const setupLength = Number(boneLengths[bone]);
            const x = setupLength * Number(world[bone * WORLD_STRIDE]);
            const y = setupLength * Number(world[bone * WORLD_STRIDE + 2]);

            lengths[i] = solver.rig.v41 && setupLength < EPSILON ? 0 : Math.sqrt(x * x + y * y);
        }
    }
    for (let i = 1; i < spacesCount; i++) spaces[i] = spacing;
}

/**
 * Spacing modes `length`, `fixed` and `proportional`: the space after a bone comes from its world
 * length. Mode `proportional` then scales the spaces so that they add up to the spacing.
 */
function lengthSpaces(solver: Solver, constraint: LegacyConstraint, spacesCount: number, scale: boolean): void {
    const { spaces, lengths } = pathScratch;
    const world = solver.pose.world;
    const boneLengths = solver.rig.model.bones.lengths;
    const mode = constraint.spacingMode;
    const spacing = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + PATH_SPACING]);
    let sum = 0;

    for (let i = 0, n = spacesCount - 1; i < n; i++) {
        const bone = constraint.bones[i] ?? -1;
        const setupLength = Number(boneLengths[bone]);

        if (setupLength < EPSILON) {
            if (scale) lengths[i] = 0;
            spaces[i + 1] = spacing;
            continue;
        }
        const x = setupLength * Number(world[bone * WORLD_STRIDE]);
        const y = setupLength * Number(world[bone * WORLD_STRIDE + 2]);
        const length = Math.sqrt(x * x + y * y);

        if (scale) lengths[i] = length;
        if (mode === SPACING_PROPORTIONAL) {
            spaces[i + 1] = length;
            sum += length;
        } else {
            spaces[i + 1] = ((mode === SPACING_LENGTH ? setupLength + spacing : spacing) * length) / setupLength;
        }
    }
    if (mode === SPACING_PROPORTIONAL && sum > 0) {
        sum = (spacesCount / sum) * spacing;
        for (let i = 1; i < spacesCount; i++) spaces[i] = Number(spaces[i]) * sum;
    }
}

/** True when the bone of the slot of a path constraint is not mirrored. The sign of the rotation offset follows it. */
function slotBoneUpright(solver: Solver, constraint: LegacyConstraint): boolean {
    const world = solver.pose.world;
    const w = constraint.targetBone * WORLD_STRIDE;

    return Number(world[w]) * Number(world[w + 3]) - Number(world[w + 1]) * Number(world[w + 2]) > 0;
}

/**
 * Moves the bones of a path constraint to the positions in the scratch and turns them along the
 * path: the second half of the official `PathConstraint.update`. One loop holds all of it, so
 * that the numbers it carries from bone to bone stay in registers.
 *
 * Without a rotation offset, rotate mode `chain` turns each bone so that its tip meets the next
 * place. With one, the offset is mirrored with the bone of the slot.
 */
function placeBones(solver: Solver, constraint: LegacyConstraint): void {
    const { pose, values, rig } = solver;
    const world = pose.world;
    const { spaces, positions, lengths } = pathScratch;
    const boneLengths = rig.model.bones.lengths;
    const { bones, rotateMode } = constraint;
    const v = constraint.index * CONSTRAINT_STRIDE + PATH_MIX;
    const mixRotate = Number(values[v]);
    const mixX = Number(values[v + 1]);
    const mixY = Number(values[v + 2]);
    const tip = constraint.offsetRotation === 0 && rotateMode === ROTATE_CHAIN;
    let offsetRotation = constraint.offsetRotation;
    // the official boneX and boneY: the point where the next bone starts
    let boneX = Number(positions[0]);
    let boneY = Number(positions[1]);

    // the bone of the slot is read here and not in the loop, which moves the bones
    if (offsetRotation !== 0) offsetRotation *= slotBoneUpright(solver, constraint) ? DEG_RAD : -DEG_RAD;
    for (let i = 0, p = 3; i < bones.length; i++, p += 3) {
        const bone = bones[i] ?? -1;
        const w = bone * WORLD_STRIDE;
        const worldX = Number(world[w + 4]);
        const worldY = Number(world[w + 5]);
        const x = Number(positions[p]);
        const y = Number(positions[p + 1]);
        // the way from the start of the bone to the start of the next
        const dx = x - boneX;
        const dy = y - boneY;

        world[w + 4] = worldX + (boneX - worldX) * mixX;
        world[w + 5] = worldY + (boneY - worldY) * mixY;
        if (rotateMode === ROTATE_CHAIN_SCALE && Number(lengths[i]) !== 0) {
            const s = (Math.sqrt(dx * dx + dy * dy) / Number(lengths[i]) - 1) * mixRotate + 1;

            world[w] = Number(world[w]) * s;
            world[w + 2] = Number(world[w + 2]) * s;
        }
        boneX = x;
        boneY = y;
        if (mixRotate > 0) {
            const a = Number(world[w]);
            const b = Number(world[w + 1]);
            const c = Number(world[w + 2]);
            const d = Number(world[w + 3]);
            let r = 0;
            let cos = 0;
            let sin = 0;

            if (rotateMode === ROTATE_TANGENT) r = Number(positions[p - 1]);
            else if (Number(spaces[i + 1]) === 0) r = Number(positions[p + 2]);
            else r = Math.atan2(dy, dx);
            r -= Math.atan2(c, a);
            if (tip) {
                // the next bone starts at the tip of this one
                const length = Number(boneLengths[bone]);

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
            world[w] = cos * a - sin * c;
            world[w + 1] = cos * b - sin * d;
            world[w + 2] = sin * a + cos * c;
            world[w + 3] = sin * b + cos * d;
        }
        updateAppliedTransform(pose, solver.applied, rig.model.bones.parents, bone, rig.v41);
    }
}

/**
 * The official `PathConstraint.update`. It does nothing while the slot shows no path attachment
 * or every mix is zero.
 */
export function solvePath(solver: Solver, constraint: LegacyConstraint): void {
    const { pose, values } = solver;
    const attachment = pose.attachments[constraint.target] ?? null;
    const v = constraint.index * CONSTRAINT_STRIDE + PATH_MIX;

    if (attachment === null || attachment.type !== 'path') return;
    if (Number(values[v]) === 0 && Number(values[v + 1]) === 0 && Number(values[v + 2]) === 0) return;
    const tangents = constraint.rotateMode === ROTATE_TANGENT;
    const scale = constraint.rotateMode === ROTATE_CHAIN_SCALE;
    const boneCount = constraint.bones.length;
    const spacesCount = tangents ? boneCount : boneCount + 1;

    sizeArrays(spacesCount);
    if (constraint.spacingMode === SPACING_PERCENT) percentSpaces(solver, constraint, spacesCount, scale);
    else lengthSpaces(solver, constraint, spacesCount, scale);
    computeWorldPositions(solver, constraint, attachment, spacesCount, tangents);
    placeBones(solver, constraint);
}
