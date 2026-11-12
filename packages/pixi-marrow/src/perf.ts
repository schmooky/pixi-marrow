/**
 * `pixi-marrow/perf`: probes that measure the updates of a display object, for spine-benchmark
 * and for people who profile.
 */
export type { PerfProbe, ProbeBucket, ProbeCounters, ProbeReading, ProbeTarget } from './perf/probe';
export { createProbe } from './perf/probe';
