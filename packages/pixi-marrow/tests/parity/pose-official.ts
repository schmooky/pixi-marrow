import { Skeleton as Skeleton41 } from 'spine-core-4.1';
import { Skeleton as Skeleton42 } from 'spine-core-4.2';
import { Skeleton as Skeleton43 } from 'spine-core-4.3';
import type { SpineVersion } from '../../src/core';
import type { RigFiles } from './official';
import { loadPose41 } from './pose-official41';
import { loadPose42 } from './pose-official42';
import { loadPose43 } from './pose-official43';
import type { OfficialPoseRig } from './pose-shared';

/**
 * Loads a skeleton for posing with the official core of its version: the reference of the pose
 * parity suite. The rig makes drivers that take the calls of a pose engine and make them on an
 * official skeleton with every constraint on.
 */
export function loadPoseRig(version: SpineVersion, files: RigFiles): OfficialPoseRig {
    if (version === '4.1') return loadPose41(files);
    if (version === '4.2') return loadPose42(files);

    return loadPose43(files);
}

/**
 * Whether the static `Skeleton.yDown` of an official core is on. A driver turns it on for the time
 * of its own update only, so between the calls of a script it is off.
 */
export const officialYDown = (): boolean => Skeleton41.yDown || Skeleton42.yDown || Skeleton43.yDown;
