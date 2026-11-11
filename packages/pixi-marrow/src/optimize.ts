/**
 * `pixi-marrow/optimize`: tools that run before the game does. Runs in Node.
 */
export type { CliHost } from './optimize/cli';
export { runCli } from './optimize/cli';
export type { NamesOptions } from './optimize/typegen';
export { generateNames, typeNameFor } from './optimize/typegen';
