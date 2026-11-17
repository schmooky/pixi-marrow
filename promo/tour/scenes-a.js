// The first scenes of the tour: the title, and the grid that grows from 1 to 200 skeletons and
// then comes to rest.
import { Container } from 'pixi.js';
import { horizontal, vertical } from 'pixi-silk';
import {
    C,
    cover,
    FPS,
    H,
    hash,
    heading,
    inOutCubic,
    K,
    lerp,
    outBack,
    outCubic,
    outQuint,
    prog,
    STEP,
    spawn,
    W,
} from './kit.js';

// ---- 1. title --------------------------------------------------------------------------------
export const titleScene = {
    id: 'title',
    brand: false,
    dur: 5.4,
    enter() {
        this.root = new Container();
        K.stage.addChild(this.root);
        this.bee = spawn('bee', this.root, 960, 340, 2);
        this.bee.play('landing');
        this.bee.queue('idle', { loop: true });
    },
    step(n) {
        if (n === Math.round(2.2 * FPS)) {
            this.bee.play('win', { mix: 0.1 });
            this.bee.queue('idle', { loop: true, mix: 0.1 });
        }
        this.bee.update(STEP);
    },
    back(t) {
        const a = outCubic(prog(t, 0, 1.4));

        K.bg.ellipse(960, 370, 360, 270).fill({ color: C.MARROW, alpha: 0.22 * a, blur: 230 });
    },
    front(t) {
        const { tx } = K.hud;
        const out = 1 - prog(t, this.dur - 0.45, 0.45);
        const a = outQuint(prog(t, 0.5, 1.1));
        const b = outCubic(prog(t, 1.1, 0.9));

        cover(t, this.dur, 0.01);
        tx.put('title', 'pixi-marrow', K.style.title, 960, 760 + (1 - a) * 36, { alpha: a * out });
        tx.put('tagline', 'A Spine runtime for PixiJS v8', K.style.tagline, 960, 928 + (1 - b) * 20, {
            alpha: b * out,
        });
    },
    leave() {
        this.root.destroy({ children: true });
    },
};

// ---- 2 and 3. one draw call, and rest --------------------------------------------------------
const COLS = 20;
const ROWS = 10;
const CELL = 140;
/** The symbols of the grid and how often each shows. */
const POOL = [
    ['a', 12],
    ['j', 12],
    ['k', 12],
    ['q', 12],
    ['blue_flower', 9],
    ['purple_flower', 9],
    ['rose_flower', 9],
    ['coin', 5],
    ['boost', 4],
    ['bee', 5],
    ['wild', 3],
];
const POOL_SUM = POOL.reduce((sum, [, weight]) => sum + weight, 0);
/** The cell the scene starts on, and the 5 x 3 block around it. */
const FOCUS = [10, 5];
/** Seconds of the scene at which things happen. */
const AT = { block: 2.7, all: 6.0, rest: 11.2, stop: 11.9, win1: 14.2, win2: 17.2 };
/** The two wins of the rest part: a symbol, and the cells that show it. */
const WINS = [
    { at: AT.win1, name: 'purple_flower', cells: [3, 4, 5, 6, 7].map((c) => [c, 2]) },
    { at: AT.win2, name: 'bee', cells: [12, 14, 16].map((c) => [c, 7]) },
];
/** How long a win plays: two rounds of an animation of 1.33 s. */
const WIN_TIME = 2.7;

const cellX = (c) => (c - (COLS - 1) / 2) * CELL;
const cellY = (r) => (r - (ROWS - 1) / 2) * CELL;

function pick(i) {
    let left = hash(i * 3.17 + 5) * POOL_SUM;

    for (const [name, weight] of POOL) {
        left -= weight;
        if (left < 0) return name;
    }

    return 'a';
}

/** The symbol of a cell: the one of a win that the cell is in, or one of the pool. */
function symbolOf(c, r) {
    if (c === FOCUS[0] && r === FOCUS[1]) return 'wild';
    for (const win of WINS) if (win.cells.some(([wc, wr]) => wc === c && wr === r)) return win.name;

    return pick(r * COLS + c);
}

/** The camera of the grid at a time: what point of the grid is at what point of the screen, and the zoom. */
function gridCamera(t) {
    const b = inOutCubic(prog(t, AT.block, 1.9));
    const a = inOutCubic(prog(t, AT.all, 2.6));
    const z = Math.exp(lerp(lerp(Math.log(2.3), Math.log(1.42), b), Math.log(0.486), a));
    const focus = [lerp(cellX(FOCUS[0]), 0, a), lerp(cellY(FOCUS[1]), 0, a)];
    const anchor = [lerp(740, 734, a), lerp(676, 698, a)];

    return { z, x: anchor[0] - focus[0] * z, y: anchor[1] - focus[1] * z };
}

export const gridScene = {
    id: 'grid',
    dur: 20.8,
    enter() {
        this.cam = new Container({ label: 'grid', isRenderGroup: true });
        K.stage.addChild(this.cam);
        this.cells = [];
        this.live = { skeletons: 0, posed: 0, bytes: 0, rigs: 0 };
        this.add(0, (c, r) => c === FOCUS[0] && r === FOCUS[1]);
    },
    /** Adds the skeletons of the cells that `wanted` names and that are not there yet. */
    add(t, wanted) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (!wanted(c, r) || this.cells.some((cell) => cell.c === c && cell.r === r)) continue;
                const name = symbolOf(c, r);
                const hero = spawn(name, this.cam, cellX(c), cellY(r), t === 0 ? 1 : 0);
                const far = Math.hypot(c - FOCUS[0], r - FOCUS[1]);
                const track = hero.play('win', { loop: true });

                // every skeleton starts at another place of its loop
                hero.update(hash(r * COLS + c + 0.5) * 1.3);
                this.cells.push({
                    c,
                    r,
                    name,
                    hero,
                    track,
                    born: t === 0 ? -1 : t + 0.1 + far * 0.085,
                    order: r * COLS + c,
                });
            }
        }
        // the draw order of the grid: row by row
        this.cells.sort((a, b) => a.order - b.order);
        this.cells.forEach((cell, i) => this.cam.setChildIndex(cell.hero, i));
    },
    step(n, t) {
        const at = (seconds) => n === Math.round(seconds * FPS);

        if (at(AT.block)) this.add(t, (c, r) => Math.abs(c - FOCUS[0]) <= 2 && Math.abs(r - FOCUS[1]) <= 1);
        if (at(AT.all)) this.add(t, () => true);
        // no loop from here on: every skeleton plays its round to the end and then rests
        if (at(AT.stop)) for (const cell of this.cells) cell.track.loop = false;
        for (const win of WINS) {
            if (!at(win.at)) continue;
            for (const cell of this.cells) {
                if (!win.cells.some(([c, r]) => c === cell.c && r === cell.r)) continue;
                cell.hero.play('win');
                cell.hero.queue('win');
            }
        }
        const camera = gridCamera(t);

        this.cam.scale.set(camera.z);
        this.cam.position.set(camera.x, camera.y);
        let posed = 0;

        for (const cell of this.cells) {
            const { hero } = cell;

            if (cell.born >= 0 && t <= cell.born + 0.6) hero.scale.set(Math.max(0, outBack(prog(t, cell.born, 0.5))));
            const skips = hero.stats.skips;

            hero.update(STEP);
            // an update that found the pose of the last frame returns at once and counts a skip
            if (hero.stats.skips === skips) posed++;
        }
        this.live.posed = posed;
        this.live.skeletons = this.cells.length;
        this.live.rigs = new Set(this.cells.map((cell) => cell.name)).size;
    },
    front(t) {
        const { g, tx } = K.hud;
        const { live } = this;
        const out = 1 - prog(t, this.dur - 0.45, 0.45);
        const second = prog(t, AT.rest, 0.5);
        const x = 1500;

        // the bytes that the skeletons handed to the GPU in this frame
        live.bytes = this.cells.reduce((sum, cell) => sum + cell.hero.stats.frameBytes, 0);
        live.draws = K.frameDraws;
        K.live = live;
        cover(t, this.dur);
        this.window(g);
        this.winFrames(g, t);
        const many = live.skeletons === 1 ? '1 skeleton.' : `${live.skeletons} skeletons.`;

        heading(
            'one',
            '01  BATCHING',
            `${many} One draw call.`,
            `${live.rigs === 1 ? 'One rig' : `${live.rigs} different rigs`}, one batch.`,
            t,
            (1 - second) * out,
        );
        if (second > 0) {
            heading(
                'rest',
                '02  REST',
                'A skeleton at rest costs nothing.',
                'No change, no pose, no upload.',
                t - AT.rest - 0.25,
                out,
            );
        }
        const a = outCubic(prog(t, 0.5, 0.7)) * (1 - second) * out;
        const b = outCubic(prog(t, AT.rest + 0.4, 0.6)) * out;

        tx.put('l-draws', 'DRAW CALLS', K.style.label, x, 372, { alpha: a });
        tx.put('n-draws', live.draws, K.style.huge, x - 8, 396, { alpha: a });
        tx.put('l-count', 'SKELETONS', K.style.label, x, 700, { alpha: a });
        tx.put('n-count', live.skeletons, K.style.stat, x - 3, 738, { alpha: a });
        tx.put('l-posed', 'POSED THIS FRAME', K.style.label, x, 372, { alpha: b });
        tx.put('n-posed', live.posed, K.style.huge, x - 8, 396, { alpha: b, scale: 0.8 });
        tx.put('u-posed', `of ${live.skeletons}`, K.style.unit, x, 612, { alpha: b });
        tx.put('l-bytes', 'UPLOADED THIS FRAME', K.style.label, x, 720, { alpha: b });
        tx.put('n-bytes', `${(live.bytes / 1024).toFixed(1)} KB`, K.style.stat, x - 3, 758, { alpha: b, scale: 0.78 });
    },
    /** Keeps the grid out of the headline and out of the column of numbers while the camera pulls back. */
    window(g) {
        const [top, right, soft] = [296, 1476, 40];
        const fade = [
            [0, C.BG, 1],
            [1, C.BG, 0],
        ];

        g.rect(0, 0, W, top).fill(C.BG);
        g.rect(0, top, right, soft).fill({ gradient: vertical(fade) });
        g.rect(right, 0, W - right, H).fill(C.BG);
        g.rect(right - soft, top, soft, H - top).fill({
            gradient: horizontal(fade.map(([at, color, a]) => [at, color, 1 - a])),
        });
    },
    /** A frame around every cell of a win while it plays. */
    winFrames(g, t) {
        const camera = gridCamera(t);
        const size = CELL * camera.z;

        for (const win of WINS) {
            const a = Math.min(prog(t, win.at, 0.25), 1 - prog(t, win.at + WIN_TIME - 0.1, 0.35));

            if (a <= 0) continue;
            for (const [c, r] of win.cells) {
                const x = camera.x + cellX(c) * camera.z - size / 2;
                const y = camera.y + cellY(r) * camera.z - size / 2;

                g.roundRect(x - 3, y - 3, size + 6, size + 6, 8).stroke({
                    width: 10,
                    color: C.MARROW,
                    alpha: 0.5 * a,
                    blur: 14,
                    blend: 'add',
                });
                g.roundRect(x - 3, y - 3, size + 6, size + 6, 8).stroke({ width: 3, color: C.MARROW_TEXT, alpha: a });
            }
        }
    },
    leave() {
        this.cam.destroy({ children: true });
    },
};
