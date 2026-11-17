// The first scenes of the tour: the title, and the grid that grows from one skeleton to all of
// them and then comes to rest.
import { Container } from 'pixi.js';
import { vertical } from 'pixi-silk';
import {
    C,
    cover,
    credit,
    FPS,
    fitOf,
    H,
    hash,
    heading,
    inOutCubic,
    K,
    LEFT,
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
    dur: 4.4,
    enter() {
        this.root = new Container();
        K.stage.addChild(this.root);
        this.bee = spawn('bee', this.root, W / 2, 500, 2.5);
        this.bee.play('landing');
        this.bee.queue('idle', { loop: true });
    },
    step(n) {
        if (n === Math.round(1.7 * FPS)) {
            this.bee.play('win', { mix: 0.1 });
            this.bee.queue('idle', { loop: true, mix: 0.1 });
        }
        this.bee.update(STEP);
    },
    back(t) {
        const a = 0.5 + 0.5 * outCubic(prog(t, 0, 1.2));

        K.bg.ellipse(W / 2, 520, 360, 330).fill({ color: C.MARROW, alpha: 0.22 * a, blur: 240 });
    },
    front(t) {
        const { tx } = K.hud;
        const out = 1 - prog(t, this.dur - 0.4, 0.4);
        // the name is there in the first frame, so that a preview of the video is not empty
        const a = outQuint(prog(t, -0.5, 1.3));
        const b = outCubic(prog(t, 0.5, 0.8));

        cover(t, this.dur, 0.01);
        tx.put('title', 'pixi-marrow', K.style.title, W / 2, 990 + (1 - a) * 30, { alpha: a * out });
        tx.put('tagline', 'A Spine runtime for PixiJS v8', K.style.tagline, W / 2, 1136 + (1 - b) * 20, {
            alpha: b * out,
        });
    },
    leave() {
        this.root.destroy({ children: true });
    },
};

// ---- 2 and 3. one draw call, and rest --------------------------------------------------------
const COLS = 12;
const ROWS = 8;
/** The distance between two cells, and the square inside a cell that a symbol stays in. */
const PITCH = 170;
const ROOM = PITCH - 14;
/** The size of a cell on the screen when the whole grid shows. */
const CELL = 84;
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
/** The cell the scene starts on. The 3 x 3 block around it shows next. */
const FOCUS = [6, 4];
/** Where the middle of the view is on the screen. */
const MIDDLE = [W / 2, 668];
/** Seconds of the scene at which things happen. */
const AT = { block: 2.0, all: 4.6, rest: 9.2, stop: 9.8, win1: 11.7, win2: 14.6 };
/** The two wins of the rest part: a symbol, and the cells that show it. */
const WINS = [
    { at: AT.win1, name: 'purple_flower', cells: [3, 4, 5, 6, 7].map((c) => [c, 2]) },
    { at: AT.win2, name: 'bee', cells: [2, 5, 8].map((c) => [c, 6]) },
];
/** How long a win plays: two rounds of an animation of 1.33 s. */
const WIN_TIME = 2.7;

const cellX = (c) => (c - (COLS - 1) / 2) * PITCH;
const cellY = (r) => (r - (ROWS - 1) / 2) * PITCH;

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

/** The camera of the grid at a time: the zoom, and where the origin of the grid is on the screen. */
function gridCamera(t) {
    const b = inOutCubic(prog(t, AT.block, 1.6));
    const a = inOutCubic(prog(t, AT.all, 2.2));
    const z = Math.exp(lerp(lerp(Math.log(2.5), Math.log(1.18), b), Math.log(CELL / PITCH), a));
    const focus = [lerp(cellX(FOCUS[0]), 0, a), lerp(cellY(FOCUS[1]), 0, a)];

    return { z, x: MIDDLE[0] - focus[0] * z, y: MIDDLE[1] - focus[1] * z };
}

export const gridScene = {
    id: 'grid',
    dur: 18.2,
    enter() {
        this.cam = new Container({ label: 'grid', isRenderGroup: true });
        K.stage.addChild(this.cam);
        this.cells = [];
        this.live = { skeletons: 0, posed: 0, bytes: 0, draws: 0 };
        this.add(0, (c, r) => c === FOCUS[0] && r === FOCUS[1]);
    },
    /** Adds the skeletons of the cells that `wanted` names and that are not there yet. */
    add(t, wanted) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (!wanted(c, r) || this.cells.some((cell) => cell.c === c && cell.r === r)) continue;
                const name = symbolOf(c, r);
                // every symbol stays inside its own cell, also at the widest moment of its win
                const size = Math.min(1.1, fitOf(name, ROOM));
                const hero = spawn(name, this.cam, cellX(c), cellY(r), t === 0 ? size : 0);
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
                    size,
                    born: t === 0 ? -1 : t + 0.1 + far * 0.1,
                    order: r * COLS + c,
                });
            }
        }
        // the draw order of the grid: row by row
        this.cells.sort((a, b) => a.order - b.order);
        this.cells.forEach((cell, i) => {
            this.cam.setChildIndex(cell.hero, i);
        });
    },
    step(n, t) {
        const at = (seconds) => n === Math.round(seconds * FPS);

        if (at(AT.block)) this.add(t, (c, r) => Math.abs(c - FOCUS[0]) <= 1 && Math.abs(r - FOCUS[1]) <= 1);
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

            if (cell.born >= 0 && t <= cell.born + 0.6) {
                hero.scale.set(cell.size * Math.max(0, outBack(prog(t, cell.born, 0.5))));
            }
            const skips = hero.stats.skips;

            hero.update(STEP);
            // an update that found the pose of the last frame returns at once and counts a skip
            if (hero.stats.skips === skips) posed++;
        }
        this.live.posed = posed;
        this.live.skeletons = this.cells.length;
    },
    /** A tile under every cell of a win while it plays. The tiles are smaller than a cell, so two never touch. */
    back(t) {
        const camera = gridCamera(t);
        const size = PITCH * camera.z - 10;

        for (const win of WINS) {
            const a = Math.min(prog(t, win.at, 0.25), 1 - prog(t, win.at + WIN_TIME - 0.1, 0.35));

            if (a <= 0) continue;
            for (const [c, r] of win.cells) {
                const x = camera.x + cellX(c) * camera.z - size / 2;
                const y = camera.y + cellY(r) * camera.z - size / 2;

                K.bg
                    .roundRect(x, y, size, size, 10)
                    .fill({ color: C.MARROW, alpha: 0.2 * a })
                    .stroke({ width: 3, color: C.MARROW_TEXT, alpha: a, alignment: 'inside' });
            }
        }
    },
    front(t) {
        const { tx } = K.hud;
        const { live } = this;
        const out = 1 - prog(t, this.dur - 0.4, 0.4);
        const second = prog(t, AT.rest, 0.5);

        // the bytes that the skeletons handed to the GPU in this frame
        live.bytes = this.cells.reduce((sum, cell) => sum + cell.hero.stats.frameBytes, 0);
        live.draws = K.frameDraws;
        K.live = live;
        cover(t, this.dur);
        this.window();
        const many = live.skeletons === 1 ? '1 skeleton.' : `${live.skeletons} skeletons.`;

        heading('one', `${many}\nOne draw call.`, '', t, (1 - second) * out);
        if (second > 0) heading('rest', 'A skeleton at rest\ncosts nothing.', '', t - AT.rest - 0.25, out);
        const a = outCubic(prog(t, 0.5, 0.7)) * (1 - second) * out;
        const b = outCubic(prog(t, AT.rest + 0.4, 0.6)) * out;

        tx.put('l-draws', 'DRAW CALLS', K.style.label, LEFT, 1064, { alpha: a });
        tx.put('n-draws', live.draws, K.style.huge, LEFT - 10, 1086, { alpha: a });
        if (a > 0) credit(596, 1160, a * outCubic(prog(t, 1.2, 0.7)));
        tx.put('l-posed', 'SKELETONS POSED', K.style.label, LEFT, 1064, { alpha: b });
        tx.put('n-posed', live.posed, K.style.huge, LEFT - 10, 1086, { alpha: b });
        tx.put('l-bytes', 'KB UPLOADED', K.style.label, 596, 1064, { alpha: b });
        tx.put('n-bytes', (live.bytes / 1024).toFixed(1), K.style.huge, 588, 1136, {
            alpha: b,
            fill: C.TEXT,
            scale: 0.74,
        });
    },
    /** Keeps the grid out of the headline and out of the numbers while the camera pulls back. */
    window() {
        const { g } = K.hud;
        const [top, bottom, soft] = [296, 1040, 30];
        const fade = (from, to) => [
            [0, C.BG, from],
            [1, C.BG, to],
        ];

        g.rect(0, 0, W, top).fill(C.BG);
        g.rect(0, top, W, soft).fill({ gradient: vertical(fade(1, 0)) });
        g.rect(0, bottom - soft, W, soft).fill({ gradient: vertical(fade(0, 1)) });
        g.rect(0, bottom, W, H - bottom).fill(C.BG);
    },
    leave() {
        this.cam.destroy({ children: true });
    },
};
