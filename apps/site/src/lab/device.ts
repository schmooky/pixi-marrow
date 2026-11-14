import { type Renderer, RendererType, VERSION } from 'pixi.js';

/*
 * What the device of a run is, for the result. Browsers say little about themselves on
 * purpose, so every field can be missing. Safari names every Apple GPU "Apple GPU".
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
    /** The refresh rate of the screen in Hz, measured. */
    refresh: number;
    /** The level and the state of the battery where the browser tells it. */
    battery: string | null;
    pixi: string;
}

/** A short name of the device and the browser. */
function shortName(agent: string): string {
    return `${deviceName(agent)}, ${browserName(agent)}`;
}

/** The device and its system, read from the user agent. */
function deviceName(agent: string): string {
    const apple = /\((iPhone|iPad)[^)]*? OS ([\d_]+)/.exec(agent);

    if (apple !== null) return `${apple[1]} iOS ${(apple[2] ?? '').replaceAll('_', '.')}`;
    const android = /Android ([\d.]+)(?:; ([^;)]+))?/.exec(agent);

    if (android !== null) return [android[2], `Android ${android[1]}`].filter(Boolean).join(', ');
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

/**
 * Describes the device of a run.
 *
 * @param refresh The refresh rate of the screen, measured by the runner.
 * @example
 * const device = await describeDevice(app.renderer, 60);
 */
export async function describeDevice(renderer: Renderer, refresh: number): Promise<DeviceInfo> {
    const agent = navigator.userAgent;
    const memory: unknown = Reflect.get(navigator, 'deviceMemory');

    return {
        name: shortName(agent),
        userAgent: agent,
        gpu: describeGpu(renderer),
        canvas: `${renderer.canvas.width}x${renderer.canvas.height}`,
        screenDensity: window.devicePixelRatio,
        canvasDensity: renderer.resolution,
        cores: navigator.hardwareConcurrency || null,
        memory: typeof memory === 'number' ? memory : null,
        refresh,
        battery: await readBattery(),
        pixi: VERSION,
    };
}
