/**
 * `pixi-marrow/diagnose`: reads every skeleton of a Pixi scene tree as plain data. It names what
 * costs draw calls, CPU time, uploads or overdraw, each with a stable rule id and a docs address.
 * For people, for PixiJS DevTools and for coding agents.
 */
export type { DevtoolsOptions, MarrowDevtools } from './diagnose/devtools';
export { installDevtools } from './diagnose/devtools';
export { formatHit } from './diagnose/hits';
export { inspect } from './diagnose/inspect';
export { DOCS as RULES_DOCS, RULES } from './diagnose/rules-data';
export { diagnoseTree } from './diagnose/static';
export type { RendererLike, TreeOptions } from './diagnose/tree';
export { isMarrowSpine, serializeTree } from './diagnose/tree';
export type {
    Diagnosis,
    PerfRule,
    RendererInfo,
    RuleCost,
    RuleHit,
    RuleSeverity,
    SceneTotals,
    SkeletonInspection,
    TreeDump,
    TreeNode,
} from './diagnose/types';
export type { DiagnoseOptions, Watch } from './diagnose/watch';
export { diagnose, watch } from './diagnose/watch';
