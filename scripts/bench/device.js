/*
 * Browser part of scripts/bench/ab.mjs: what the page of the bench runs on. The clock, the GPU
 * and the call that waits for the GPU.
 */

/** The smallest step `performance.now()` takes, in milliseconds. */
export function timerStep() {
    let step = Number.POSITIVE_INFINITY;
    let last = performance.now();

    for (let i = 0; i < 200_000; i++) {
        const now = performance.now();

        if (now > last) step = Math.min(step, now - last);
        last = now;
    }

    return step;
}

/** What the renderer runs on, for the report. */
export function describe(PIXI, renderer) {
    if (renderer.type === PIXI.RendererType.WEBGPU) {
        const { info } = renderer.gpu.adapter;

        return `WebGPU, ${[info.vendor, info.architecture, info.description].filter(Boolean).join(' ')}`;
    }
    const { gl } = renderer;
    const names = gl.getExtension('WEBGL_debug_renderer_info');

    return `${gl.getParameter(gl.VERSION)}, ${names ? gl.getParameter(names.UNMASKED_RENDERER_WEBGL) : 'unknown GPU'}`;
}

/** The call that blocks until the GPU has finished the WebGL commands of a frame: a read of one pixel. */
export function waiter(gl) {
    const pixel = new Uint8Array(4);

    return () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}
