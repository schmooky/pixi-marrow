import type { SkeletonModel, SpineVersion } from '../../src/core';
import { officialModel41 } from './model41';
import { officialModel42 } from './model42';
import { officialModel43 } from './model43';
import type { RigFiles } from './official';

/**
 * The model of a skeleton as the official core of its version holds it after loading: the
 * reference the importers are compared against.
 */
export function officialModel(version: SpineVersion, files: RigFiles): SkeletonModel {
    if (version === '4.1') return officialModel41(files);
    if (version === '4.2') return officialModel42(files);

    return officialModel43(files);
}
