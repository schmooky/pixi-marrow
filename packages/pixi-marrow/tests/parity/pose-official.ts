import type { SpineVersion } from '../../src/core';
import type { RigFiles } from './official';
import { loadPose41 } from './pose-official41';
import { loadPose42 } from './pose-official42';
import { loadPose43 } from './pose-official43';
import type { OfficialPoseRig, RigOptions } from './pose-shared';

/**
 * Loads a skeleton for posing with the official core of its version: the reference of the pose
 * parity suite. The rig makes drivers that take the calls of a pose engine.
 */
export function loadPoseRig(version: SpineVersion, files: RigFiles, options: RigOptions = {}): OfficialPoseRig {
    if (version === '4.1') return loadPose41(files, options);
    if (version === '4.2') return loadPose42(files, options);

    return loadPose43(files, options);
}
