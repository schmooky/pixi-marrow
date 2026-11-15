import { type Renderer, RendererType, VERSION } from 'pixi.js';

/*
 * What the device of a run is, for the result. Browsers say little about themselves on
 * purpose, so every field can be missing. Safari names every Apple GPU "Apple GPU". Chrome on
 * Android names every phone "K" with Android 10 in its user agent, and tells the model only
 * through `navigator.userAgentData`.
 */

/** The device of a run, as far as the browser tells. */
export interface DeviceInfo {
    /** A short name of the device and the browser, read from the user agent. */
    name: string;
    userAgent: string;
    /** The renderer and its GPU, as the driver names them. */
    gpu: string;
    /** The canvas in device pixels, and the density of the screen and of the canvas. */
    canvas: string;
    screenDensity: number;
    canvasDensity: number;
    /** Logical cores, and memory in GB where the browser tells it. */
    cores: number | null;
    memory: number | null;
    /** The rate in Hz at which the screen gave frames during the run, and before it while nothing played. */
    refresh: number;
    idleRefresh: number;
    /** The step of the timer of the browser in milliseconds. No time of the run is finer. */
    timerStep: number;
    /** The level and the state of the battery where the browser tells it. */
    battery: string | null;
    pixi: string;
}

/** A short name of the device and the browser. */
async function shortName(agent: string): Promise<string> {
    return `${await deviceName(agent)}, ${browserName(agent)}`;
}

/** The model and the system version a browser with client hints tells when asked, or null. */
async function clientHints(): Promise<{ model: string; platformVersion: string } | null> {
    const data: unknown = Reflect.get(navigator, 'userAgentData');
    const ask: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'getHighEntropyValues') : null;

    if (typeof ask !== 'function') return null;
    try {
        const values: unknown = await ask.call(data, ['model', 'platformVersion']);

        if (typeof values !== 'object' || values === null) return null;
        const field = (name: string): string => {
            const value: unknown = Reflect.get(values, name);

            return typeof value === 'string' ? value : '';
        };

        return { model: field('model'), platformVersion: field('platformVersion') };
    } catch {
        return null;
    }
}

/** An Android device: its model and version from client hints, else from a user agent that is not frozen. */
async function androidName(version: string, model: string | undefined): Promise<string> {
    const hints = await clientHints();
    const named = model?.trim() ?? '';
    // a frozen user agent names every phone K on Android 10, whatever it is
    const frozen = named === 'K';
    // client hints say 14.0.0 for Android 14
    const release = hints?.platformVersion.replace(/(\.0)+$/, '') || (frozen ? '' : version);
    const system = release === '' ? 'Android' : `Android ${release}`;
    // Firefox puts Mobile or Tablet where the model goes, and a web view puts wv
    const device = hints?.model || (frozen || /^(Mobile|Tablet|wv)?$/i.test(named) ? '' : named);

    return device === '' ? `${system}, model unknown` : `${device}, ${system}`;
}

/** The device and its system, read from the user agent and the client hints. */
async function deviceName(agent: string): Promise<string> {
    const apple = /\((iPhone|iPad)[^)]*? OS ([\d_]+)/.exec(agent);

    if (apple !== null) return `${apple[1]} iOS ${(apple[2] ?? '').replaceAll('_', '.')}`;
    const android = /Android ([\d.]+)(?:; ([^;)]+))?/.exec(agent);

    if (android !== null) return androidName(android[1] ?? '', android[2]);
    if (agent.includes('Macintosh')) return 'Mac';

    return agent.includes('Windows') ? 'Windows' : 'unknown device';
}

/** The browser and its major version, read from the user agent. */
function browserName(agent: string): string {
    const named: [RegExp, string][] = [
        [/CriOS\/(\d+)/, 'Chrome'],
        [/FxiOS\/(\d+)/, 'Firefox'],
        [/Firefox\/(\d+)/, 'Firefox'],
        [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
        [/Chrome\/(\d+)/, 'Chrome'],
        [/Version\/([\d.]+).*Safari/, 'Safari'],
    ];

    for (const [pattern, name] of named) {
        const version = pattern.exec(agent)?.[1];

        if (version !== undefined) return `${name} ${version}`;
    }

    return 'unknown browser';
}

/** The renderer and its GPU, as the driver names them. */
function describeGpu(renderer: Renderer): string {
    if (renderer.type === RendererType.WEBGPU) {
        const info: unknown = Reflect.get(Reflect.get(Reflect.get(renderer, 'gpu') ?? {}, 'adapter') ?? {}, 'info');
        const fields = ['vendor', 'architecture', 'description'].map((key) =>
            typeof info === 'object' && info !== null ? String(Reflect.get(info, key) ?? '') : '',
        );

        return `WebGPU, ${fields.filter(Boolean).join(' ') || 'unknown GPU'}`;
    }
    const gl: unknown = Reflect.get(renderer, 'gl');

    if (!(gl instanceof WebGL2RenderingContext)) return 'WebGL, unknown GPU';
    const names = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = names === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(names.UNMASKED_RENDERER_WEBGL);

    return `${String(gl.getParameter(gl.VERSION))}, ${String(gpu)}`;
}

/** The level of the battery and whether it charges, where the browser tells it. */
async function readBattery(): Promise<string | null> {
    const get: unknown = Reflect.get(navigator, 'getBattery');

    if (typeof get !== 'function') return null;
    try {
        const battery: unknown = await get.call(navigator);

        if (typeof battery !== 'object' || battery === null) return null;
        const level = Math.round(Number(Reflect.get(battery, 'level')) * 100);

        return `${level} percent, ${Reflect.get(battery, 'charging') === true ? 'charging' : 'not charging'}`;
    } catch {
        return null;
    }
}

/** What the runner measured of the screen and the timer. */
export interface Measured {
    refresh: number;
    idleRefresh: number;
    timerStep: number;
}

/**
 * Describes the device of a run.
 *
 * @param measured The rates of the screen and the step of the timer, as the runner measured them.
 * @example
 * const device = await describeDevice(app.renderer, { refresh: 60, idleRefresh: 60, timerStep: 0.1 });
 */
export async function describeDevice(renderer: Renderer, measured: Measured): Promise<DeviceInfo> {
    const agent = navigator.userAgent;
    const memory: unknown = Reflect.get(navigator, 'deviceMemory');

    return {
        name: await shortName(agent),
        userAgent: agent,
        gpu: describeGpu(renderer),
        canvas: `${renderer.canvas.width}x${renderer.canvas.height}`,
        screenDensity: window.devicePixelRatio,
        canvasDensity: renderer.resolution,
        cores: navigator.hardwareConcurrency || null,
        memory: typeof memory === 'number' ? memory : null,
        ...measured,
        battery: await readBattery(),
        pixi: VERSION,
    };
}
