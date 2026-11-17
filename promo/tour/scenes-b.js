// The later scenes of the tour: the measured numbers, the diagnosis of a moving container, the
// debug overlays and the outro.
import { Container } from 'pixi.js';
import { DEBUG_COLORS, MarrowDebug } from 'pixi-marrow/debug';
import { watch } from 'pixi-marrow/diagnose';
import { C, card, cover, FPS, heading, K, LEFT, MONO_ADVANCE, outCubic, outQuint, prog, STEP, spawn } from './kit.js';

// ---- 4. measured -----------------------------------------------------------------------------
/** True when the runs of two times overlap: the rule of the benchmarks page for "not decided". */
const overlap = (a, b) => a[1] <= b[2] && b[1] <= a[2];

/** One rig of the run at 200 instances: the frame times and the draw calls of both runtimes. */
function benchRow(rig) {
    const block = rig.blocks.find((it) => it.instances === 200);
    const side = (name) => block.sides.find((it) => it.side === name);
    const [marrow, other] = [side('pixi-marrow'), side('spine-pixi-v8')];
    const [spine, name] = rig.rig.split('/');

    return {
        name,
        note: `Spine ${spine} · ${rig.scene === 'rest' ? 'at rest' : 'playing'}`,
        marrow: marrow.frameMs,
        other: other.frameMs,
        draws: [marrow.drawCalls, other.drawCalls],
        undecided: overlap(marrow.frameMs, other.frameMs),
    };
}

/** The rows of the scene: every rig of the WebGL2 run that plays, and coin-pro at rest. */
function benchRows() {
    const { rigs } = K.bench.renderers.find((it) => it.renderer === 'webgl');
    const play = rigs.filter((rig) => rig.scene === 'play').map(benchRow);
    const rest = benchRow(rigs.find((rig) => rig.scene === 'rest' && rig.rig.endsWith('/coin-pro')));

    return [...play, rest];
}

/** The two lines under the bars: where, when and with what the numbers were measured. */
function benchSource() {
    const { machine, versions, settings, date, renderers } = K.bench;
    const { pixi } = renderers.find((it) => it.renderer === 'webgl');
    const marrow = versions['pixi-marrow'].split(',')[0];

    return [
        `${machine.cpu} · Chrome ${machine.chrome} · pixi.js ${pixi} · WebGL2 · ${date.slice(0, 10)} · median of ${settings.runs} runs`,
        `pixi-marrow ${marrow} · spine-pixi-v8 ${versions['spine-pixi-v8 for 4.2']} and ${versions['spine-pixi-v8 for 4.3']} · rigs: official Spine examples`,
    ];
}

export const benchScene = {
    id: 'bench',
    dur: 9.4,
    enter() {
        this.rows = benchRows();
        this.source = benchSource();
        this.max = Math.max(...this.rows.map((row) => Math.max(row.marrow[0], row.other[0])));
        this.coin = this.rows.find((row) => row.name === 'coin-pro');
    },
    step() {},
    front(t) {
        const { g, tx } = K.hud;
        const out = 1 - prog(t, this.dur - 0.45, 0.45);
        const x0 = 420;
        const full = 700;

        cover(t, this.dur);
        heading(
            'bench',
            '03  MEASURED',
            'Measured on one machine.',
            'Frame time of 200 skeletons, in milliseconds. Shorter is better.',
            t,
            out,
        );
        const legend = outCubic(prog(t, 0.6, 0.6)) * out;

        g.roundRect(x0, 312, 26, 26, 4).fill({ color: C.MARROW, alpha: legend });
        tx.put('lg-m', 'pixi-marrow', K.style.label, x0 + 40, 311, { alpha: legend, fill: C.TEXT });
        g.roundRect(x0 + 300, 312, 26, 26, 4).fill({ color: C.OTHER, alpha: legend });
        tx.put('lg-o', '@esotericsoftware/spine-pixi-v8', K.style.label, x0 + 340, 311, { alpha: legend });
        this.rows.forEach((row, i) => {
            const y = 364 + i * 90 + (i === this.rows.length - 1 ? 14 : 0);
            const at = 0.8 + i * 0.14;
            const a = outCubic(prog(t, at, 0.5)) * out;
            const grow = outQuint(prog(t, at + 0.1, 1.1));
            const shown = outCubic(prog(t, at + 0.9, 0.5)) * out;

            tx.put(`r${i}`, row.name, K.style.value, LEFT, y + 2, { alpha: a });
            tx.put(`n${i}`, row.note, K.style.note, LEFT, y + 40, { alpha: a });
            for (const [k, time, color, dy] of [
                ['m', row.marrow[0], C.MARROW, 4],
                ['o', row.other[0], C.OTHER, 38],
            ]) {
                const w = Math.max(4, (time / this.max) * full * grow);

                g.roundRect(x0, y + dy, w, 28, 4).fill({ color, alpha: a });
                tx.put(`${k}${i}`, `${time.toFixed(2)} ms`, K.style.value, x0 + w + 16, y + dy - 4, {
                    alpha: shown,
                    fill: k === 'm' ? C.TEXT : C.MUTED,
                });
            }
            if (row.undecided) {
                const w = (Math.max(row.marrow[0], row.other[0]) / this.max) * full;

                tx.put(`u${i}`, 'the runs overlap: not decided', K.style.note, x0 + w + 190, y + 26, {
                    alpha: shown,
                    fill: C.MUTED,
                });
            }
        });
        const last = 364 + (this.rows.length - 1) * 90;

        g.rect(LEFT, last + 4, 1180, 2).fill({ color: C.LINE, alpha: legend });
        this.drawCalls(t, out);
        const note = outCubic(prog(t, 2.2, 0.8)) * out;

        tx.put('src0', this.source[0], K.style.note, LEFT, 962, { alpha: note, fill: C.MUTED });
        tx.put('src1', this.source[1], K.style.note, LEFT, 1000, { alpha: note, fill: C.MUTED });
    },
    /** The card on the right: the draw calls of coin-pro, of both runtimes. */
    drawCalls(t, out) {
        const { g, tx } = K.hud;
        const a = outCubic(prog(t, 2.6, 0.7)) * out;
        const [x, y] = [1380, 312];
        const [mine, theirs] = this.coin.draws;

        card(g, x, y, 440, 600, { alpha: a });
        tx.put('dc-l', 'DRAW CALLS', K.style.label, x + 36, y + 34, { alpha: a });
        tx.put('dc-n', 'coin-pro, 200 playing', K.style.note, x + 36, y + 74, { alpha: a, fill: C.MUTED });
        tx.put('dc-m', mine[1], K.style.huge, x + 28, y + 100, { alpha: a, scale: 0.8 });
        tx.put('dc-ml', 'pixi-marrow', K.style.label, x + 36, y + 318, { alpha: a, fill: C.TEXT });
        g.rect(x + 36, y + 372, 368, 2).fill({ color: C.LINE, alpha: a });
        tx.put('dc-o', theirs[1], K.style.stat, x + 32, y + 394, { alpha: a, scale: 1.25, fill: C.MUTED });
        tx.put('dc-ol', 'spine-pixi-v8', K.style.label, x + 36, y + 520, { alpha: a });
    },
    leave() {},
};

// ---- 5. diagnose -----------------------------------------------------------------------------
/** The symbols of the reels of the scene, column by column. */
const REELS = [
    ['q', 'rose_flower', 'a'],
    ['blue_flower', 'k', 'coin'],
    ['a', 'purple_flower', 'j'],
    ['k', 'boost', 'rose_flower'],
    ['purple_flower', 'j', 'q'],
];
const REEL_CELL = 150;
const REEL_AT = [500, 664];
/** Seconds of the scene at which things happen. */
const DX = { watch: 0.8, report: 2.6, fix: 6.0, again: 7.9 };

/** Writes a line of code in one colour per part. `parts` is a list of [text, colour]. */
function codeLine(key, parts, x, y, alpha) {
    const { tx } = K.hud;
    const advance = K.style.code.fontSize * MONO_ADVANCE;
    let at = 0;

    parts.forEach(([text, fill], i) => {
        tx.put(`${key}-${i}`, text, K.style.code, x + at * advance, y, { alpha, fill });
        at += text.length;
    });
}

export const diagnoseScene = {
    id: 'diagnose',
    dur: 10.8,
    enter() {
        this.reels = new Container({ label: 'reels' });
        K.stage.addChild(this.reels);
        this.heroes = [];
        REELS.forEach((column, c) => {
            column.forEach((name, r) => {
                const hero = spawn(name, this.reels, (c - 2) * REEL_CELL, (r - 1) * REEL_CELL, REEL_CELL / 140);

                hero.play('idle');
                this.heroes.push(hero);
            });
        });
        this.reels.position.set(...REEL_AT);
        this.first = null;
        this.second = null;
        this.bytes = 0;
    },
    step(n, t) {
        const at = (seconds) => n === Math.round(seconds * FPS);
        const options = { renderer: K.renderer };

        if (at(DX.watch)) this.watching = watch(K.stage, options);
        if (at(DX.report)) this.first = this.watching.report();
        if (at(DX.fix)) {
            // the fix that the hit names, and a new look at the scene from here on
            this.reels.isRenderGroup = true;
            this.watching.stop();
            this.watching = watch(K.stage, options);
        }
        if (at(DX.again)) this.second = this.watching.report();
        // the container of the reels moves in every frame of the scene, before and after the fix
        this.reels.x = REEL_AT[0] + Math.sin(t * 1.7) * 46;
        for (const hero of this.heroes) hero.update(STEP);
    },
    back(t) {
        const w = REEL_CELL * 5 + 40;
        const h = REEL_CELL * 3 + 40;

        card(K.bg, this.reels.x - w / 2, REEL_AT[1] - h / 2, w, h, { alpha: prog(t, 0, 0.4) });
    },
    front(t) {
        const { g, tx } = K.hud;
        const out = 1 - prog(t, this.dur - 0.45, 0.45);
        const fixed = prog(t, DX.fix - 0.5, 0.4);
        const a = outCubic(prog(t, 0.5, 0.6)) * out;

        this.bytes = this.heroes.reduce((sum, hero) => sum + hero.stats.frameBytes, 0);
        K.live = { first: this.first, second: this.second, bytes: this.bytes };
        cover(t, this.dur);
        heading(
            'dx',
            '04  DIAGNOSE',
            'Ask it why a scene is slow.',
            'Rules with ids, for you and for AI agents.',
            t,
            out,
        );
        // under the reels: what this frame handed to the GPU
        tx.put('dx-l', 'UPLOADED THIS FRAME', K.style.label, 104, 946, { alpha: a });
        tx.put('dx-b', `${(this.bytes / 1024).toFixed(1)} KB`, K.style.stat, 500, 918, { alpha: a, scale: 0.72 });
        tx.put('dx-m', 'the container of the reels moves in every frame', K.style.note, 104, 996, {
            alpha: a,
            fill: C.MUTED,
        });
        const [x, y, w] = [940, 318, 900];

        card(g, x, y, w, 700, { alpha: a, color: C.CODE });
        this.before(t, x + 44, y + 40, a * (1 - fixed));
        if (fixed > 0) this.after(t, x + 44, y + 40, out);
    },
    /** The watch, the report and the hit it returned. */
    before(t, x, y, alpha) {
        const { g, tx } = K.hud;
        const one = outCubic(prog(t, DX.watch - 0.2, 0.4)) * alpha;
        const two = outCubic(prog(t, DX.report - 0.5, 0.4)) * alpha;
        const hit = this.first?.hits[0];

        codeLine(
            'c1',
            [
                ['const ', C.MARROW_TEXT],
                ['watching = ', C.TEXT],
                ['watch', C.GOLD],
                ['(app.stage, { renderer });', C.TEXT],
            ],
            x,
            y,
            one,
        );
        codeLine(
            'c2',
            [
                ['watching.', C.TEXT],
                ['report', C.GOLD],
                ['().hits', C.TEXT],
            ],
            x,
            y + 50,
            two,
        );
        if (!this.first) return;
        const shown = outCubic(prog(t, DX.report, 0.5)) * alpha;

        if (!hit) {
            tx.put('h-none', '[]', K.style.stat, x, y + 130, { alpha: shown });

            return;
        }
        g.roundRect(x - 14, y + 132, 6, 478, 3).fill({ color: C.MARROW, alpha: shown });
        tx.put('h-id', hit.id, K.style.stat, x + 16, y + 118, { alpha: shown, scale: 0.86, fill: C.MARROW });
        tx.put('h-sev', `${hit.severity} · ${hit.cost.join(', ')}`, K.style.label, x + 18, y + 208, { alpha: shown });
        const wrap = { ...K.style.body, wordWrap: true, wordWrapWidth: 780 };

        tx.put('h-msg', hit.message, wrap, x + 18, y + 262, { alpha: shown });
        tx.put('h-fl', 'FIX', K.style.label, x + 18, y + 392, { alpha: shown, fill: C.GREEN });
        tx.put('h-fix', hit.fix, wrap, x + 18, y + 432, { alpha: shown, fill: C.MUTED });
    },
    /** The fix, the second report and what it returned. */
    after(t, x, y, alpha) {
        const { tx } = K.hud;
        const one = outCubic(prog(t, DX.fix - 0.2, 0.4)) * alpha;
        const two = outCubic(prog(t, DX.again - 0.5, 0.4)) * alpha;

        codeLine(
            'c3',
            [
                ['reels.', C.TEXT],
                ['isRenderGroup', C.GOLD],
                [' = ', C.TEXT],
                ['true', C.MARROW_TEXT],
                [';', C.TEXT],
            ],
            x,
            y,
            one,
        );
        codeLine(
            'c4',
            [
                ['watching.', C.TEXT],
                ['report', C.GOLD],
                ['().hits', C.TEXT],
            ],
            x,
            y + 50,
            two,
        );
        if (!this.second) return;
        const shown = outCubic(prog(t, DX.again, 0.5)) * alpha;
        const hits = this.second.hits.length;

        tx.put('s-n', hits, K.style.count, x + 8, y + 120, { alpha: shown, fill: hits === 0 ? C.GREEN : C.MARROW });
        tx.put('s-l', hits === 1 ? 'hit' : 'hits', K.style.stat, x + 200, y + 262, { alpha: shown, fill: C.MUTED });
        const gone = this.first?.hits.filter((hit) => !this.second.hits.some((it) => it.id === hit.id)) ?? [];

        if (gone.length > 0) {
            const ids = gone.map((hit) => hit.id).join(', ');

            tx.put('s-g', `${ids} is gone. The reels still move.`, K.style.body, x + 16, y + 440, { alpha: shown });
            tx.put('s-w', 'A render group moves on the GPU.', K.style.body, x + 16, y + 492, {
                alpha: shown,
                fill: C.MUTED,
            });
        }
    },
    leave() {
        this.watching?.stop();
        this.reels.destroy({ children: true });
    },
};

// ---- 6. debug overlays -----------------------------------------------------------------------
/** The layers of the scene, in the order they turn on: the name, the label and the second it turns on. */
const LAYERS = [
    [['bones'], 'bones', 1.2],
    [['regions', 'meshHulls'], 'regions and mesh hulls', 2.4],
    [['meshTriangles'], 'mesh triangles', 3.8],
];

export const debugScene = {
    id: 'debug',
    dur: 6.8,
    enter() {
        this.root = new Container();
        K.stage.addChild(this.root);
        this.bee = spawn('bee', this.root, 1360, 626, 2.8);
        this.bee.play('idle', { loop: true });
        const off = Object.fromEntries(Object.keys(DEBUG_COLORS).map((name) => [name, false]));

        this.debug = new MarrowDebug(this.bee, { layers: off, lineWidth: 2.5 });
    },
    step(n, t) {
        for (const [layers, , at] of LAYERS) {
            if (n === Math.round(at * FPS)) for (const layer of layers) this.debug.layers[layer] = true;
        }
        if (n === Math.round(2.9 * FPS)) {
            this.bee.play('win', { mix: 0.1 });
            this.bee.queue('idle', { loop: true, mix: 0.1 });
        }
        this.bee.update(STEP);
        this.t = t;
    },
    back(t) {
        K.bg.ellipse(1360, 640, 400, 340).fill({ color: C.MARROW, alpha: 0.12 * prog(t, 0, 0.6), blur: 240 });
    },
    front(t) {
        const { g, tx } = K.hud;
        const out = 1 - prog(t, this.dur - 0.45, 0.45);

        cover(t, this.dur);
        heading('dbg', '05  DEBUG', 'See the bones.', 'MarrowDebug draws over the live skeleton.', t, out);
        const code = outCubic(prog(t, 0.5, 0.6)) * out;

        card(g, LEFT, 356, 860, 150, { alpha: code, color: C.CODE });
        codeLine(
            'd1',
            [
                ['import ', C.MARROW_TEXT],
                ['{ MarrowDebug } ', C.TEXT],
                ['from ', C.MARROW_TEXT],
                ["'pixi-marrow/debug'", C.GOLD],
                [';', C.TEXT],
            ],
            LEFT + 36,
            386,
            code,
        );
        codeLine(
            'd2',
            [
                ['new ', C.MARROW_TEXT],
                ['MarrowDebug', C.GOLD],
                ['(hero);', C.TEXT],
            ],
            LEFT + 36,
            436,
            code,
        );
        LAYERS.forEach(([layers, label, at], i) => {
            const on = outCubic(prog(t, at, 0.4));
            const a = outCubic(prog(t, 0.7 + i * 0.1, 0.6)) * out;
            const y = 580 + i * 88;
            const color = DEBUG_COLORS[layers[0]];

            g.roundRect(LEFT, y, 48, 48, 6)
                .fill({ color, alpha: a * on })
                .stroke({ width: 3, color: on > 0 ? color : C.DIM, alpha: a, alignment: 'inside' });
            tx.put(`dl${i}`, label, K.style.unit, LEFT + 76, y - 2, { alpha: a * (0.4 + 0.6 * on), fill: C.TEXT });
        });
    },
    leave() {
        this.root.destroy({ children: true });
    },
};

// ---- 7. outro --------------------------------------------------------------------------------
export const outroScene = {
    id: 'outro',
    brand: false,
    dur: 7,
    enter() {
        this.root = new Container();
        K.stage.addChild(this.root);
        this.heroes = [spawn('bee', this.root, 250, 560, 1.25), spawn('wild', this.root, 1670, 560, 1.25)];
        for (const hero of this.heroes) {
            hero.play('win');
            hero.queue('idle', { loop: true });
        }
    },
    step(n) {
        if (n === Math.round(3.2 * FPS)) {
            for (const hero of this.heroes) {
                hero.play('win', { mix: 0.1 });
                hero.queue('idle', { loop: true, mix: 0.1 });
            }
        }
        for (const hero of this.heroes) hero.update(STEP);
    },
    front(t) {
        const { g, tx } = K.hud;
        const rise = (at) => outCubic(prog(t, at, 0.8));
        const [a, b, c, d] = [outQuint(prog(t, 0.3, 1)), rise(0.8), rise(1.2), rise(1.6)];
        const command = 'npm install pixi-marrow pixi.js';
        const wide = command.length * 46 * MONO_ADVANCE + 110;

        cover(t, this.dur + 1);
        tx.put('o-title', 'pixi-marrow', K.style.title, 960, 250 + (1 - a) * 30, { alpha: a, scale: 0.82 });
        card(g, 960 - wide / 2, 408 + (1 - b) * 20, wide, 112, { alpha: b, color: C.CODE, edge: C.MARROW, radius: 12 });
        tx.put(
            'o-npm',
            command,
            { ...K.style.code, fontSize: 46, fontWeight: 700, anchor: 0.5 },
            960,
            464 + (1 - b) * 20,
            { alpha: b },
        );
        tx.put('o-spine', 'Spine 4.1 · 4.2 · 4.3', K.style.tagline, 960, 628 + (1 - c) * 20, { alpha: c });
        tx.put('o-gpu', 'WebGL2 · WebGPU', K.style.tagline, 960, 712 + (1 - c) * 20, { alpha: c, fill: C.MUTED });
        tx.put('o-url', 'pixi-marrow.schmooky.dev', K.style.tagline, 960, 868 + (1 - d) * 20, {
            alpha: d,
            scale: 1.1,
            fill: C.MARROW_TEXT,
        });
        tx.put('o-git', 'github.com/schmooky/pixi-marrow', { ...K.style.note, anchor: 0.5, fontSize: 30 }, 960, 958, {
            alpha: d,
            fill: C.MUTED,
        });
    },
    leave() {
        this.root.destroy({ children: true });
    },
};
