import type { DeviceInfo } from './device';
import type { RunSettings } from './lab';
import { type FrameTimes, median, quantile } from './measure';

/*
 * The result of a run: the frame rate and the time per frame, a few sentences that say what
 * they mean, and a text that holds all of it for a chat or an issue. The last line of the text
 * is the same result as JSON, so a script can read it back.
 */

/** The share of frames a scene may drop and still count as played at the full rate. */
const FULL_RATE_DROPS = 0.03;

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
    const dropped = times.gaps.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / interval) - 1), 0);
    const cpu = times.update.map((update, i) => update + (times.render[i] ?? 0));

    return {
        seconds: played / 1000,
        frames: times.gaps.length,
        dropped,
        fps: played > 0 ? (times.gaps.length * 1000) / played : 0,
        update: median(times.update),
        render: median(times.render),
        cpu: median(cpu),
        cpuP95: quantile(cpu, 0.95),
        draws: times.draws,
    };
}

/** True when a scene dropped few enough frames to count as played at the full rate. */
export const atFullRate = (result: PlayResult): boolean =>
    result.dropped <= (result.frames + result.dropped) * FULL_RATE_DROPS;

/** A number of milliseconds with two decimals. */
export const ms = (value: number): string => value.toFixed(2);

/** A count with its noun, as in 1 draw call and 3 draw calls. */
export const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** What the result means, in a few sentences. */
export function verdicts(result: LabResult): string[] {
    const { play, over, noun } = result;
    const refresh = result.device.refresh;
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
            `Played at the full rate of this ${refresh} Hz screen: ${fps} fps, ${play.dropped} of ${total} frames dropped.`,
        );
    } else {
        lines.push(`Played at ${fps} fps on this ${refresh} Hz screen, ${play.dropped} of ${total} frames dropped.`);
    }
    if (result.count > 0) {
        lines.push(
            `Update and render took ${ms(play.cpu)} ms on the CPU, ${share} percent of the ${ms(budget)} ms a frame has.`,
        );
    }
    if (!grows && !atFullRate(play) && share < 50) {
        lines.push('The CPU had time to spare, so the GPU or the browser set the pace.');
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
        `Canvas ${device.canvas} at density ${device.canvasDensity} (screen ${device.screenDensity}), ${device.refresh} Hz.`,
        `Cores ${device.cores ?? 'unknown'}, memory ${device.memory === null ? 'unknown' : `${device.memory} GB`}, battery ${device.battery ?? 'unknown'}.`,
        `pixi.js ${device.pixi}, ${result.settings.renderer}, the settings a game gets when it sets none. ${Math.round(result.seconds)} s.`,
        '',
        ...verdicts(result),
        '',
        `${result.count} ${result.noun}: ${play.fps.toFixed(1)} fps over ${play.seconds.toFixed(1)} s, ${play.dropped} of ${play.frames + play.dropped} frames dropped.`,
        `CPU per frame: ${ms(play.cpu)} ms (update ${ms(play.update)}, render ${ms(play.render)}), 95th percentile ${ms(play.cpuP95)} ms.`,
        `Draw calls per frame: ${play.draws}.`,
        ...(result.over === null
            ? []
            : [
                  `${result.over.count} ${result.noun}: ${result.over.play.fps.toFixed(1)} fps, CPU per frame ${ms(result.over.play.cpu)} ms.`,
              ]),
        '',
        JSON.stringify(result),
    ].join('\n');
}
