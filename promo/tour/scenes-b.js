// The later scenes of the tour: the measured numbers, the diagnosis of a moving container, and
// the outro.
import { Container } from 'pixi.js';
import { watch } from 'pixi-marrow/diagnose';
import {
    C,
    card,
    cover,
    credit,
    FPS,
    fitOf,
    heading,
    K,
    LEFT,
    MONO_ADVANCE,
    outCubic,
    outQuint,
    prog,
    STEP,
    spawn,
    W,
} from './kit.js';

// ---- 4. measured -----------------------------------------------------------------------------
/** True when the runs of two times overlap: the rule of the benchmarks page for "not decided". */
const overlap = (a, b) => a[1] <= b[2] && b[1] <= a[2];

/** One rig of the run at 200 instances: the frame times and the draw calls of both runtimes. */
function benchRow(rig) {
    const block = rig.blocks.find((it) => it.instances === 200);
    const side = (name) => block.sides.find((it) => it.side === name);
    const [marrow, other] = [side('pixi-marrow'), side('spine-pixi-v8')];

    return {
        name: rig.rig.split('/')[1],
        marrow: marrow.frameMs,
        other: other.frameMs,
        ratio: marrow.frameMs[0] / other.frameMs[0],
        draws: [marrow.drawCalls, other.drawCalls],
        undecided: overlap(marrow.frameMs, other.frameMs),
    };
}

/**
 * The rows of the scene. The rule: of the rigs that play on WebGL2, sorted by the ratio of the
 * two frame times, the first, the middle one and the last. So the best, the median and the worst.
 */
function benchRows() {
    const { rigs } = K.bench.renderers.find((it) => it.renderer === 'webgl');
    const play = rigs.filter((rig) => rig.scene === 'play').map(benchRow);
    const sorted = [...play].sort((a, b) => a.ratio - b.ratio);
    const shown = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]];

    return { shown, coin: play.find((row) => row.name === 'coin-pro') };
}

/** Where and when the numbers were measured, and where the whole table is. */
function benchSource() {
    const { machine, date } = K.bench;
    const day = new Date(date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });

    return [
        `${machine.cpu}, Chrome ${machine.chrome.split('.')[0]}, ${day}`,
        'Full table: pixi-marrow.schmooky.dev/benchmarks',
    ];
}

export const benchScene = {
    id: 'bench',
    dur: 8.2,
    enter() {
        const { shown, coin } = benchRows();

        this.rows = shown;
        this.coin = coin;
        this.source = benchSource();
        this.max = Math.max(...shown.map((row) => Math.max(row.marrow[0], row.other[0])));
    },
    step() {},
    front(t) {
        const { g, tx } = K.hud;
        const out = 1 - prog(t, this.dur - 0.4, 0.4);
        const x0 = 316;
        const full = 430;

        cover(t, this.dur);
        heading('bench', '200 skeletons,\nframe time', '', t, out);
        this.rows.forEach((row, i) => {
            const y = 318 + i * 194;
            const at = 0.6 + i * 0.16;
            const a = outCubic(prog(t, at, 0.5)) * out;
            const grow = outQuint(prog(t, at + 0.1, 1));
            const shown = outCubic(prog(t, at + 0.8, 0.4)) * out;

            tx.put(`r${i}`, row.name, K.style.code, LEFT, y, { alpha: a });
            if (row.undecided)
                tx.put(`u${i}`, 'runs overlap, not decided', K.style.note, 330, y + 12, { alpha: shown });
            for (const [k, label, time, color, dy] of [
                ['m', 'pixi-marrow', row.marrow[0], C.MARROW, 66],
                ['o', 'spine-pixi-v8', row.other[0], C.OTHER, 124],
            ]) {
                const w = Math.max(6, (time / this.max) * full * grow);

                tx.put(`l${k}${i}`, label, K.style.name, LEFT, y + dy + 5, {
                    alpha: a,
                    fill: k === 'm' ? C.TEXT : C.MUTED,
                });
                g.roundRect(x0, y + dy, w, 46, 5).fill({ color, alpha: a });
                tx.put(`${k}${i}`, `${time.toFixed(2)} ms`, K.style.value, x0 + w + 18, y + dy - 9, {
                    alpha: shown,
                    fill: k === 'm' ? C.TEXT : C.MUTED,
                });
            }
        });
        this.drawCalls(t, out);
        const note = outCubic(prog(t, 1.6, 0.7)) * out;

        tx.put('src0', this.source[0], K.style.note, LEFT, 1262, { alpha: note });
        tx.put('src1', this.source[1], K.style.note, LEFT, 1300, { alpha: note });
    },
    /** The draw calls of coin-pro, of both runtimes, as one large pair. */
    drawCalls(t, out) {
        const { g, tx } = K.hud;
        const a = outCubic(prog(t, 2.0, 0.7)) * out;
        const y = 912;
        const [mine, theirs] = this.coin.draws;

        g.rect(LEFT, y, W - 2 * LEFT, 2).fill({ color: C.LINE, alpha: a });
        tx.put('dc-l', `DRAW CALLS, ${this.coin.name}`, K.style.label, LEFT, y + 24, { alpha: a });
        tx.put('dc-m', mine[1], K.style.huge, LEFT - 10, y + 42, { alpha: a, scale: 0.86 });
        tx.put('dc-ml', 'pixi-marrow', K.style.name, LEFT, y + 262, { alpha: a, fill: C.TEXT });
        tx.put('dc-o', theirs[1], K.style.huge, 470, y + 42, { alpha: a, scale: 0.86, fill: C.DIM });
        tx.put('dc-ol', 'spine-pixi-v8', K.style.name, 480, y + 262, { alpha: a });
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
const REEL_CELL = 164;
const REEL_AT = [W / 2, 650];
/** Seconds of the scene at which things happen. */
const DX = { watch: 0.5, report: 2.0, fix: 4.9, again: 6.6 };

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
    dur: 9.4,
    enter() {
        this.reels = new Container({ label: 'reels' });
        K.stage.addChild(this.reels);
        this.heroes = [];
        REELS.forEach((column, c) => {
            column.forEach((name, r) => {
                const size = fitOf(name, REEL_CELL - 14);
                const hero = spawn(name, this.reels, (c - 2) * REEL_CELL, (r - 1) * REEL_CELL, size);

                hero.play('idle');
                this.heroes.push(hero);
            });
        });
        this.reels.position.set(...REEL_AT);
        this.before = null;
        this.after = null;
    },
    step(n, t) {
        const at = (seconds) => n === Math.round(seconds * FPS);
        const options = { renderer: K.renderer };

        if (at(DX.watch)) this.watching = watch(K.stage, options);
        if (at(DX.report)) this.before = this.watching.report();
        if (at(DX.fix)) {
            // the fix that the hit names, and a new look at the scene from here on
            this.reels.isRenderGroup = true;
            this.watching.stop();
            this.watching = watch(K.stage, options);
        }
        if (at(DX.again)) this.after = this.watching.report();
        // the container of the reels moves in every frame of the scene, before and after the fix
        this.reels.x = REEL_AT[0] + Math.sin(t * 1.7) * 40;
        for (const hero of this.heroes) hero.update(STEP);
    },
    back(t) {
        const w = REEL_CELL * 5 + 30;
        const h = REEL_CELL * 3 + 30;

        card(K.bg, this.reels.x - w / 2, REEL_AT[1] - h / 2, w, h, { alpha: prog(t, 0, 0.4) });
    },
    front(t) {
        const { g } = K.hud;
        const out = 1 - prog(t, this.dur - 0.4, 0.4);
        const fixed = prog(t, DX.fix - 0.45, 0.35);
        const a = outCubic(prog(t, DX.report - 0.3, 0.5)) * out;
        const [x, y] = [LEFT, 950];

        K.live = { before: this.before, after: this.after };
        cover(t, this.dur);
        heading('dx', 'Ask why a scene\nis slow.', 'Rules with ids, for people and for AI agents', t, out);
        card(g, x, y, W - 2 * x, 340, { alpha: a, color: C.CODE });
        this.hit(t, x + 44, y + 36, a * (1 - fixed));
        if (fixed > 0) this.fix(t, x + 44, y + 36, out);
    },
    /** The first hit of the first report: its id, and its message up to the first comma. */
    hit(t, x, y, alpha) {
        const { g, tx } = K.hud;
        const hit = this.before?.hits[0];

        if (!hit) return;
        const shown = outCubic(prog(t, DX.report, 0.5)) * alpha;

        g.roundRect(x - 18, y + 8, 8, 252, 4).fill({ color: C.MARROW, alpha: shown });
        tx.put('h-id', hit.id, K.style.huge, x + 6, y - 10, { alpha: shown, scale: 0.62 });
        tx.put('h-msg', hit.message.split(',')[0], K.style.body, x + 12, y + 186, { alpha: shown });
    },
    /** The fix as code, and the number of hits of the second report. */
    fix(t, x, y, alpha) {
        const { tx } = K.hud;
        const one = outCubic(prog(t, DX.fix - 0.15, 0.4)) * alpha;

        codeLine(
            'c3',
            [
                ['reels.', C.TEXT],
                ['isRenderGroup', C.GOLD],
                [' = ', C.TEXT],
                ['true', C.MARROW_TEXT],
            ],
            x,
            y,
            one,
        );
        if (!this.after) return;
        const shown = outCubic(prog(t, DX.again, 0.5)) * alpha;
        const hits = this.after.hits.length;

        tx.put('s-n', hits, K.style.count, x - 4, y + 44, { alpha: shown, fill: hits === 0 ? C.GREEN : C.MARROW });
        tx.put('s-l', hits === 1 ? 'hit' : 'hits', K.style.stat, x + 180, y + 150, { alpha: shown, fill: C.MUTED });
    },
    leave() {
        this.watching?.stop();
        this.reels.destroy({ children: true });
    },
};

// ---- 6. outro --------------------------------------------------------------------------------
export const outroScene = {
    id: 'outro',
    dur: 6.6,
    enter() {
        this.root = new Container();
        K.stage.addChild(this.root);
        this.bee = spawn('bee', this.root, W / 2, 262, 1.5);
        this.bee.play('win');
        this.bee.queue('idle', { loop: true });
    },
    step(n) {
        if (n === Math.round(3 * FPS)) {
            this.bee.play('win', { mix: 0.1 });
            this.bee.queue('idle', { loop: true, mix: 0.1 });
        }
        this.bee.update(STEP);
    },
    back(t) {
        K.bg.ellipse(W / 2, 270, 260, 220).fill({ color: C.MARROW, alpha: 0.18 * prog(t, 0, 0.6), blur: 200 });
    },
    front(t) {
        const { g, tx } = K.hud;
        const rise = (at) => outCubic(prog(t, at, 0.8));
        const [a, b, c, d] = [outQuint(prog(t, 0.3, 1)), rise(0.7), rise(1.0), rise(1.4)];
        const command = 'npm install pixi-marrow pixi.js';
        const wide = command.length * 44 * MONO_ADVANCE + 100;

        cover(t, this.dur + 1);
        tx.put('o-title', 'pixi-marrow', K.style.title, W / 2, 590 + (1 - a) * 30, { alpha: a, scale: 0.95 });
        card(g, (W - wide) / 2, 716 + (1 - b) * 20, wide, 116, { alpha: b, color: C.CODE, edge: C.MARROW, radius: 12 });
        tx.put('o-npm', command, { ...K.style.code, anchor: 0.5 }, W / 2, 774 + (1 - b) * 20, { alpha: b });
        tx.put('o-url', 'pixi-marrow.schmooky.dev', K.style.tagline, W / 2, 918 + (1 - c) * 20, {
            alpha: c,
            fill: C.MARROW_TEXT,
        });
        tx.put('o-spine', 'Spine 4.1, 4.2, 4.3', K.style.tagline, W / 2, 1006 + (1 - c) * 20, {
            alpha: c,
            scale: 0.72,
            fill: C.MUTED,
        });
        g.rect(LEFT, 1084, W - 2 * LEFT, 2).fill({ color: C.LINE, alpha: d });
        credit(322, 1128, d, true);
    },
    leave() {
        this.root.destroy({ children: true });
    },
};
