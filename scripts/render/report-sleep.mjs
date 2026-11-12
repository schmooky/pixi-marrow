/**
 * The lines of the render check about the mesh mode that loads on demand.
 */

/** Some frame numbers as text: `3`, or `3 to 7`. */
const span = (first, last) => (first === last ? `frame ${first}` : `frames ${first} to ${last}`);

/** How many instances drew in which mode in a frame, as text. */
function modesOf(counts) {
    const parts = [
        counts.mesh ? `${counts.mesh} mesh` : '',
        counts.batched ? `${counts.batched} batched` : '',
        counts.unknown ? `${counts.unknown} without a mode` : '',
    ].filter(Boolean);

    return parts.join(' and ') || 'no instance';
}

/**
 * What a scene about the lazy mesh mode saw: the modes its instances drew in, frame by frame,
 * with frames that are alike joined.
 */
export function describeLazy(info) {
    const runs = [];

    if (info.silent) return 'the runtime reports no render mode, so there is nothing to follow';
    for (const [frame, counts] of info.frames.entries()) {
        const text = modesOf(counts);
        const last = runs.at(-1);

        if (last?.text === text) last.to = frame;
        else runs.push({ text, from: frame, to: frame });
    }
    const frames = runs.map((run) => `${span(run.from, run.to)} ${run.text}`).join(', ');
    // what the report said about an instance that waits for the code of the mesh mode
    const said = (info.said ?? []).map((entry) => `From frame ${entry.frame} the report says ${entry.text}`);

    return [`with the default options: ${frames}`, ...said].join('. ');
}

/** Where the mesh mode is in the bundle of the page, and whether the page asked for its chunk. */
export function describeChunk(info) {
    return `the mesh mode loads on demand from ${info.chunk}, and the page ${info.asked ? 'asked' : 'did not ask'} for it`;
}
