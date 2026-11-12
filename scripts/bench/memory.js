/*
 * Browser part of scripts/bench/ab.mjs: the memory readings of the page. Chrome must run with
 * `--enable-precise-memory-info` and an exposed `gc()` for them to mean something.
 */

/** Bytes of the typed array that tells whether `usedJSHeapSize` counts typed array memory. */
const PROBE_BYTES = 32 << 20;
/** Milliseconds to wait for the memory of the page before that measurement counts as missing. */
const AGENT_MEMORY_TIMEOUT = 4000;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Collects garbage three times, with a turn of the event loop after each, so freed buffers are gone too. */
export async function settle() {
    for (let i = 0; i < 3; i++) {
        globalThis.gc?.();
        await tick();
    }
}

/** The memory of the whole page as Chrome measures it, typed arrays included, or null. */
async function agentMemory() {
    if (!performance.measureUserAgentSpecificMemory) return null;
    try {
        const result = await Promise.race([
            performance.measureUserAgentSpecificMemory(),
            new Promise((resolve) => setTimeout(() => resolve(null), AGENT_MEMORY_TIMEOUT)),
        ]);

        return result ? result.bytes : null;
    } catch {
        return null;
    }
}

/**
 * What the two memory readings cover. A typed array of 32 MB is allocated and both readings are
 * taken before and after: `usedJSHeapSize` and `performance.measureUserAgentSpecificMemory`.
 */
export async function probeMemory() {
    const hasHeap = typeof performance.memory?.usedJSHeapSize === 'number';

    await settle();
    const before = { heap: hasHeap ? performance.memory.usedJSHeapSize : 0, agent: await agentMemory() };
    const block = new Uint8Array(PROBE_BYTES);

    // every page is written, so the memory is committed
    for (let i = 0; i < block.length; i += 4096) block[i] = 1;
    const after = { heap: hasHeap ? performance.memory.usedJSHeapSize : 0, agent: await agentMemory() };
    const grew = (delta) => delta > PROBE_BYTES / 2;

    return {
        gc: typeof globalThis.gc === 'function',
        heap: hasHeap,
        probeBytes: block.length,
        heapDelta: after.heap - before.heap,
        heapCountsTypedArrays: grew(after.heap - before.heap),
        agent: before.agent !== null && after.agent !== null,
        agentDelta: before.agent !== null && after.agent !== null ? after.agent - before.agent : null,
        agentCountsTypedArrays:
            before.agent !== null && after.agent !== null ? grew(after.agent - before.agent) : false,
    };
}

/**
 * One reading of both memory numbers. Garbage must have been collected before, see `settle`.
 *
 * @param memory What `probeMemory` returned: which of the two readings the page has.
 */
export async function readMemory(memory) {
    return {
        heap: memory.heap ? performance.memory.usedJSHeapSize : null,
        agent: memory.agent ? await agentMemory() : null,
    };
}
