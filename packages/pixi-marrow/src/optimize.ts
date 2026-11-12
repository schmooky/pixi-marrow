/**
 * `pixi-marrow/optimize`: tools that run before the game does. Runs in Node.
 */
export type { OutlinesOptions, OutlinesSummary, PagePixels } from './geometry/outlines';
export {
    ATLAS_OUTLINES_VERSION,
    buildAtlasOutlines,
    readAtlasOutlines,
    summarizeOutlines,
} from './geometry/outlines';
export type { AtlasOutlines, PageRect, RegionOutline } from './model/outlines';
export type { CliHost } from './optimize/cli';
export { runCli } from './optimize/cli';
export type { PngImage } from './optimize/png';
export { decodePng } from './optimize/png';
export type { NamesOptions } from './optimize/typegen';
export { generateNames, typeNameFor } from './optimize/typegen';
