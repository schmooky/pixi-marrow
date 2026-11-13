import { type Geometry, type Instruction, type InstructionSet, type Renderer, type Shader, State } from 'pixi.js';
import { contextLost, watchContext } from './context-watch';
import { bendsEdges } from './gate';
import type { InstanceBody } from './instance-paint';
import { RunPart, type Shaded } from './instance-part';

/*
 * The render pipe of instanced draws. Pixi hands it the body of every view that draws instanced.
 * A body that follows another one with nothing between them in the instruction set joins its
 * run: the pipe ends the batch of Pixi before it, so anything Pixi draws in between ends the run.
 *
 * At the draw the pipe walks the run in order. Members that share a layout, a draw order, a pool,
 * pages, the dark tint and a blend mode draw as one instanced draw, and a member that differs
 * starts the next one. The instructions therefore stay right when a member changes its draw
 * order: the run draws in more parts, and Pixi builds nothing again. A draw writes the transform,
 * the tint and the slot of each member into a buffer of instance data, uploads the pool once and
 * draws every instance.
 *
 * A draw has its own buffer of instance data. WebGPU writes every buffer before the draws of a
 * frame run, so two draws that shared one buffer would both see what the second one wrote.
 *
 * Nothing registers at import. The pipe goes into a renderer when the renderer is about to draw
 * its first instanced body, see {@link linkInstancePipe}.
 */

/** The name a renderer finds the pipe under. */
export const INSTANCE_PIPE = 'marrowInstances';

/** What the pipe hands the encoder of a renderer for one draw. */
interface DrawCall {
    geometry: Geometry;
    shader: Shader;
    state: State;
    size: number;
    start: number;
    instanceCount: number;
}

/**
 * The instruction of one run: views that draw instanced and follow each other in an instruction
 * set. Its parts are the draws of the last frame.
 *
 * @example
 * set.add(run);
 * pipe.execute(run);
 * console.log(run.draws, run.members.length);
 */
export class InstanceRun implements Instruction {
    readonly renderPipeId: string = INSTANCE_PIPE;
    readonly action: string = 'draw';
    readonly canBundle: boolean = false;
    /** The bodies of the run, in render order. */
    readonly members: InstanceBody[] = [];
    /** The draws of the last frame. */
    draws = 0;
    /** Where the run is in its instruction set. */
    at = 0;
    private readonly parts: RunPart[] = [];

    /** The part of a draw of this frame. */
    part(index: number): RunPart {
        let part = this.parts[index];

        if (part === undefined) {
            part = new RunPart();
            this.parts[index] = part;
        }

        return part;
    }

    /** Takes a body out, when its view is destroyed. */
    drop(body: InstanceBody): void {
        const at = this.members.indexOf(body);

        if (at >= 0) this.members.splice(at, 1);
    }

    /** Frees the buffers of the parts. */
    destroy(): void {
        for (const part of this.parts) part.destroy();
        this.parts.length = 0;
        this.members.length = 0;
    }
}

/** Whether a member draws at all this frame: it lives, is instanced and visible with an alpha above 0. */
const drawable = (body: InstanceBody): boolean =>
    !body.destroyed && body.isRenderable && body.paint.slot !== undefined && body.paint.union !== undefined;

/** Whether two members can be in one instanced draw. */
function sameDraw(a: InstanceBody, b: InstanceBody): boolean {
    const x = a.paint;
    const y = b.paint;

    return (
        x.layout === y.layout &&
        x.union === y.union &&
        x.slot?.pool === y.slot?.pool &&
        x.dark === y.dark &&
        x.pages === y.pages &&
        a.groupBlendMode === b.groupBlendMode
    );
}

/** The runs of one instruction set, which a later build takes again. */
interface RunBook {
    readonly runs: InstanceRun[];
    used: number;
    last: InstanceRun | undefined;
    /** The instruction set, held weakly: Pixi before 8.21 does not tell when it destroys one. */
    readonly set: WeakRef<InstructionSet>;
}

/**
 * The pipe of instanced draws in one renderer. Pixi calls it by the pipe protocol: `addRenderable`
 * when it builds the instructions of a render group, `execute` for every run before it draws.
 *
 * @example
 * const pipe = linkInstancePipe(renderer);
 * pipe.addRenderable(body, instructionSet);
 */
export class InstancePipe {
    private renderer: Renderer | null;
    private readonly books = new WeakMap<InstructionSet, RunBook>();
    /** Every book, so that the runs of a destroyed instruction set are freed. */
    private readonly all: RunBook[] = [];
    private readonly state = State.for2d();
    /** What a draw asks a part for its shader: one object for every draw. */
    private want: Shaded | undefined;
    /** What a draw hands the encoder of the renderer: one object for every draw. */
    private call: DrawCall | undefined;

    constructor(renderer: Renderer) {
        this.renderer = renderer;
    }

    /** Puts a body into the run before it, or into a new run when Pixi put something between them. */
    addRenderable(body: InstanceBody, set: InstructionSet): void {
        const { renderer } = this;

        if (renderer === null) return;
        // the picture is drawn to this target unless a filter or a cache comes between
        body.gate.beforeDraw(bendsEdges(renderer));
        renderer.renderPipes.batch.break(set);
        const last = set.instructions[set.instructionSize - 1];

        if (last instanceof InstanceRun && this.books.get(set)?.last === last) {
            last.members.push(body);
            body.run = last;

            return;
        }
        const run = this.next(set);

        run.members.push(body);
        body.run = run;
        set.add(run);
    }

    /** A body has nothing to write between two builds: the draw reads it. */
    updateRenderable(): void {}

    /** A run regroups its members at the draw, so no change of a body asks for a new build. */
    validateRenderable(): boolean {
        return false;
    }

    /** A body keeps nothing in the pipe. */
    destroyRenderable(): void {}

    /** Draws a run, in as few instanced draws as its members allow. Draws nothing while the context is lost. */
    execute(run: InstanceRun): void {
        const { renderer } = this;
        const { members } = run;

        if (renderer === null || contextLost()) return;
        const bends = bendsEdges(renderer);
        let parts = 0;

        // every member learns how Pixi is about to draw it, which can change what it shows
        for (const body of members) if (!body.destroyed) body.gate.beforeDraw(bends);
        for (let i = 0; i < members.length; ) {
            const first = members[i];

            if (first === undefined || !drawable(first)) {
                if (first !== undefined) first.drawnWith = 0;
                i++;
                continue;
            }
            i = this.drawFrom(renderer, run.part(parts++), members, i);
        }
        run.draws = parts;
    }

    /**
     * Draws the members from one on that can share its draw, and notes in each how many
     * instances its draw had. Returns where the next draw starts.
     */
    private drawFrom(renderer: Renderer, part: RunPart, members: readonly InstanceBody[], start: number): number {
        const first = members[start];
        let count = 0;
        let end = start;

        if (first === undefined) return start + 1;
        for (; end < members.length; end++) {
            const body = members[end];

            if (body === undefined || !drawable(body)) continue;
            if (!sameDraw(first, body)) break;
            part.write(count++, body);
        }
        for (let k = start; k < end; k++) {
            const body = members[k];

            if (body !== undefined) body.drawnWith = drawable(body) ? count : 0;
        }
        this.draw(renderer, part, first, count);

        return end;
    }

    /** Pixi calls this when an instruction set is destroyed, from pixi.js 8.23. */
    destroyInstructionSet(set: InstructionSet): void {
        const book = this.books.get(set);

        if (book === undefined) return;
        for (const run of book.runs) run.destroy();
        this.all.splice(this.all.indexOf(book), 1);
        this.books.delete(set);
    }

    /** Pixi calls this when the renderer is destroyed. */
    destroy(): void {
        for (const book of this.all) for (const run of book.runs) run.destroy();
        this.all.length = 0;
        this.renderer = null;
    }

    /** Frees the runs of the instruction sets that are gone. A new instruction set calls it. */
    private sweep(): void {
        for (let i = this.all.length - 1; i >= 0; i--) {
            const book = this.all[i];

            if (book === undefined || book.set.deref() !== undefined) continue;
            for (const run of book.runs) run.destroy();
            this.all.splice(i, 1);
        }
    }

    /** One instanced draw of the members a part holds. */
    private draw(renderer: Renderer, part: RunPart, first: InstanceBody, count: number): void {
        const { layout, union, slot, pages, dark } = first.paint;

        if (layout === undefined || union === undefined || slot === undefined || union.count === 0) return;
        const { pool } = slot;
        const geometry = part.geometry(layout, union);

        this.want ??= { layout, pool, pages, dark, round: false };
        const { want } = this;

        want.layout = layout;
        want.pool = pool;
        want.pages = pages;
        want.dark = dark;
        want.round = renderer.roundPixels;
        const shader = part.shade(want);

        this.call ??= { geometry, shader, state: this.state, size: 0, start: 0, instanceCount: 0 };
        const draw = this.call;

        draw.geometry = geometry;
        draw.shader = shader;
        draw.size = union.count;
        draw.instanceCount = count;
        pool.flush();
        part.upload();
        this.state.blendMode = first.groupBlendMode;
        // the uniforms of the render group, where the mesh adaptor of each renderer puts them
        if ('gl' in renderer) {
            shader.groups[100] = renderer.globalUniforms.bindGroup;
            renderer.encoder.draw(draw);
        } else if ('gpu' in renderer) {
            shader.groups[0] = renderer.globalUniforms.bindGroup;
            renderer.encoder.draw(draw);
        }
    }

    /** A run for a new place in an instruction set, one of an earlier build where there is one. */
    private next(set: InstructionSet): InstanceRun {
        let book = this.books.get(set);

        if (book === undefined) {
            this.sweep();
            book = { runs: [], used: 0, last: undefined, set: new WeakRef(set) };
            this.books.set(set, book);
            this.all.push(book);
        }
        const { last } = book;

        // a new build: the run added last is no longer where it was put. The runs let go of their members
        if (last === undefined || last.at >= set.instructionSize || set.instructions[last.at] !== last) {
            book.used = 0;
            for (const old of book.runs) old.members.length = 0;
        }
        let run = book.runs[book.used];

        if (run === undefined) {
            run = new InstanceRun();
            book.runs.push(run);
        }
        book.used++;
        run.members.length = 0;
        run.at = set.instructionSize;
        book.last = run;

        return run;
    }
}

/**
 * The pipe of instanced draws in a renderer. The first call for a renderer creates the pipe and
 * puts it where Pixi looks its pipes up.
 *
 * @example
 * body.onRender = (renderer) => linkInstancePipe(renderer);
 */
export function linkInstancePipe(renderer: Renderer): InstancePipe {
    const found: unknown = Reflect.get(renderer.renderPipes, INSTANCE_PIPE);

    if (found instanceof InstancePipe) return found;
    const pipe = new InstancePipe(renderer);

    // what a renderer does with the pipes it finds at its creation
    Reflect.set(renderer.renderPipes, INSTANCE_PIPE, pipe);
    renderer.runners.destroy.add(pipe);
    watchContext(renderer);

    return pipe;
}
