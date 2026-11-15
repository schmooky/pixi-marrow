import type { DeviceInfo } from './device';
import type { RunSettings } from './lab';
import { coarseTimer, type FrameTimes, formatMs, median, quantile } from './measure';

/*
 * The result of a run: the frame rate and the time per frame, a few sentences that say what
 * they mean, and a text that holds all of it for a chat or an issue. The last line of the text
 * is the same result as JSON, so a script can read it back.
 */

/** The share of frames a scene may drop and still count as played at the full rate. */
const FULL_RATE_DROPS = 0.03;
/** The share of a frame that CPU work may take before a late frame after it counts as the fault of the CPU. */
const SLOW_CPU = 0.75;
/** The steps of the timer a time must hold before its share of a frame is worth saying. */
const SHARE_STEPS = 5;

/** How a scene played, from the times of its frames. Times are in milliseconds. */
export interface PlayResult {
    seconds: number;
    /** Frames the screen got, and frames it had time for but did not get. */
    frames: number;
    dropped: number;
    fps: number;
    /** The median update, render and both per frame, and the 95th percentile of both. */
    update: number;
    render: number;
    cpu: number;
    cpuP95: number;
    /** Frames that came one refresh or more late, and how many of them followed CPU work that took most of a frame. */
    late: number;
    lateAfterSlowCpu: number;
    /** The most draw calls a frame took. */
    draws: number;
}

/** A whole run. */
export interface LabResult {
    /** The name of the test in the address, and its title. */
    test: string;
    title: string;
    question: string;
    scene: string;
    noun: string;
    /** True for a test that adds skeletons until the frames drop. */
    grows: boolean;
    settings: RunSettings;
    /** The renderer that ran. Pixi falls back to WebGL where WebGPU was asked for and does not start. */
    renderer: RunSettings['renderer'];
    device: DeviceInfo;
    /** Seconds the run took. */
    seconds: number;
    /** The skeletons of the scene. For a test that grows, the most that played at the full rate. */
    count: number;
    /** How the scene played with `count` skeletons. */
    play: PlayResult;
    /** For a test that grows: the first number that dropped frames, and how it played. */
    over: { count: number; play: PlayResult } | null;
}

/**
 * How a scene played, from the times of its frames on a screen of some Hz.
 *
 * @example
 * const result = summarize(await play(clock, scene, 10_000), 60);
 */
export function summarize(times: FrameTimes, refresh: number): PlayResult {
    const interval = 1000 / refresh;
    const played = times.gaps.reduce((sum, gap) => sum + gap, 0);
    const behind = times.gaps.map((gap) => Math.max(0, Math.round(gap / interval) - 1));
    const cpu = times.update.map((update, i) => update + (times.render[i] ?? 0));
    let late = 0;
    let lateAfterSlowCpu = 0;

    // the work of a frame runs after its gap is taken, so it makes the gap of the next frame long
    for (let i = 1; i < behind.length; i++) {
        if ((behind[i] ?? 0) === 0) continue;
        late++;
        if ((cpu[i - 1] ?? 0) > interval * SLOW_CPU) lateAfterSlowCpu++;
    }

    return {
        seconds: played / 1000,
        frames: times.gaps.length,
        dropped: behind.reduce((sum, count) => sum + count, 0),
        fps: played > 0 ? (times.gaps.length * 1000) / played : 0,
        update: median(times.update),
        render: median(times.render),
        cpu: median(cpu),
        cpuP95: quantile(cpu, 0.95),
        late,
        lateAfterSlowCpu,
        draws: times.draws,
    };
}

/** True when a scene dropped few enough frames to count as played at the full rate. */
export const atFullRate = (result: PlayResult): boolean =>
    result.dropped <= (result.frames + result.dropped) * FULL_RATE_DROPS;

/** A number of milliseconds of a run, with as many decimals as the timer of its browser can tell. */
export const ms = (result: LabResult, value: number): string => formatMs(value, result.device.timerStep);

/** The step of a timer in milliseconds, in two digits at most, as in 1 and 0.1. */
const stepText = (step: number): string => String(Number(step.toPrecision(2)));

/** True when the screen gave frames at another rate during the run than before it. */
const rateChanged = ({ device }: LabResult): boolean =>
    Math.abs(device.refresh - device.idleRefresh) > device.idleRefresh * 0.1;

/** The renderer that ran, and what was asked for where Pixi fell back. */
export function rendererText(result: LabResult): string {
    const name = (renderer: RunSettings['renderer']): string => (renderer === 'webgpu' ? 'WebGPU' : 'WebGL');

    return result.renderer === result.settings.renderer
        ? name(result.renderer)
        : `${name(result.renderer)} (the lab requested ${name(result.settings.renderer)}, which did not start)`;
}

/** A count with its noun, as in 1 draw call and 3 draw calls. */
export const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** What the result means, in a few sentences. */
export function verdicts(result: LabResult): string[] {
    const { play, over, noun } = result;
    const { refresh, idleRefresh, timerStep } = result.device;
    const budget = 1000 / refresh;
    const share = Math.round((play.cpu / budget) * 100);
    const fps = Math.round(play.fps);
    const total = play.frames + play.dropped;
    const lines: string[] = [];
    const { grows } = result;

    if (grows && result.count === 0) {
        lines.push(`Even one of the ${noun} did not play at the full rate of this ${refresh} Hz screen.`);
    } else if (grows) {
        lines.push(`${result.count} ${noun} played at the full rate of this ${refresh} Hz screen, ${fps} fps.`);
        lines.push(
            over === null ? 'The test stops there.' : `With ${over.count} it fell to ${Math.round(over.play.fps)} fps.`,
        );
    } else if (atFullRate(play)) {
        lines.push(
            `The scene played at the full rate of this ${refresh} Hz screen: ${fps} fps, ${play.dropped} of ${total} frames dropped.`,
        );
    } else {
        lines.push(
            `The scene played at ${fps} fps on this ${refresh} Hz screen, ${play.dropped} of ${total} frames dropped.`,
        );
    }
    if (result.count > 0) {
        const time = `Update and render took ${ms(result, play.cpu)} ms on the CPU`;
        const frame = `${budget.toFixed(1)} ms`;

        // a share of the frame is worth saying only for a time of a few steps of the timer
        lines.push(
            play.cpu >= timerStep * SHARE_STEPS
                ? `${time}, ${share} percent of the ${frame} a frame has.`
                : `${time}, and a frame has ${frame}.`,
        );
    }
    if (!grows && !atFullRate(play) && play.late > 0) {
        // the slow frames say more than the median: a pause to collect garbage is CPU work too
        const slow = play.lateAfterSlowCpu / play.late;

        if (share < 50 && play.cpuP95 < budget * SLOW_CPU && slow <= 0.1) {
            lines.push('The CPU had time to spare, in its slowest frames too, so the GPU or the browser set the pace.');
        } else if (slow >= 0.5) {
            lines.push(
                'Most frames that came late followed one whose CPU work took most of a frame, so the CPU set the pace. A pause to collect garbage counts as CPU work here.',
            );
        }
    }
    if (rateChanged(result)) {
        lines.push(
            `The screen gave ${refresh} frames a second during the run and ${idleRefresh} before it. Low Power Mode or an adaptive refresh rate can change it, and so can a GPU that misses every other frame.`,
        );
    }
    if (coarseTimer(timerStep)) {
        lines.push(
            `This browser rounds its timer to ${stepText(timerStep)} ms, so it rounds the CPU times to that too.`,
        );
    }

    return lines;
}

/** The result as text: what ran, where, what it means, the numbers and the JSON. */
export function resultText(result: LabResult): string {
    const { device, play } = result;

    return [
        `pixi-marrow lab: ${result.test}`,
        result.question,
        result.scene,
        `Device: ${device.name}. ${device.gpu}.`,
        `Canvas ${device.canvas} at density ${device.canvasDensity} (screen ${device.screenDensity}), ${device.refresh} Hz during the run, ${device.idleRefresh} Hz before it.`,
        `Cores ${device.cores ?? 'unknown'}, memory ${device.memory === null ? 'unknown' : `${device.memory} GB`}, battery ${device.battery ?? 'unknown'}, timer step ${stepText(device.timerStep)} ms.`,
        `pixi.js ${device.pixi} on ${rendererText(result)}, with the settings a game gets when it sets none. ${Math.round(result.seconds)} s.`,
        '',
        ...verdicts(result),
        '',
        `${result.count} ${result.noun}: ${play.fps.toFixed(1)} fps over ${play.seconds.toFixed(1)} s, ${play.dropped} of ${play.frames + play.dropped} frames dropped.`,
        `CPU per frame: ${ms(result, play.cpu)} ms (update ${ms(result, play.update)}, render ${ms(result, play.render)}), 95th percentile ${ms(result, play.cpuP95)} ms.`,
        `Frames that came late: ${play.late}, and ${play.lateAfterSlowCpu} of them after CPU work that took most of a frame.`,
        `Draw calls per frame: ${play.draws}.`,
        ...(result.over === null
            ? []
            : [
                  `${result.over.count} ${result.noun}: ${result.over.play.fps.toFixed(1)} fps, CPU per frame ${ms(result, result.over.play.cpu)} ms.`,
              ]),
        '',
        JSON.stringify(result),
    ].join('\n');
}
