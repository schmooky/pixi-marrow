// Shared by the tour and its scenes: the frame, the palette, easing, text styles and the helpers
// that every scene draws with. K is filled by tour.js at boot.
import { Container, RenderTexture } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';
import { horizontal } from 'pixi-silk';
import { SdfAtlas, SilkText } from 'pixi-silk/text';

// The frame: 4:5, the portrait format of the LinkedIn feed.
export const W = 1080;
export const H = 1350;
export const FPS = 60;
/** One step of the simulation, in seconds. */
export const STEP = 1 / FPS;

// The colours of the docs site (apps/site/src/styles/global.css), as numbers.
export const C = {
    BG: 0x09090b,
    CARD: 0x121214,
    CODE: 0x0e0e11,
    LINE: 0x27272b,
    TEXT: 0xfafafa,
    MUTED: 0xa5a5ae,
    DIM: 0x6a6a74,
    MARROW: 0xf57047,
    MARROW_TEXT: 0xfc9c73,
    GOLD: 0xffc857,
    GREEN: 0x4ade80,
    OTHER: 0x5b5b66,
};

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", Menlo, monospace';
/** The width of one JetBrains Mono character, as a part of the font size. */
export const MONO_ADVANCE = 0.6;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0 before `at`, 1 after `at + d`, linear between. */
export const prog = (t, at, d) => clamp((t - at) / d);
export const outCubic = (x) => 1 - (1 - x) ** 3;
export const outQuint = (x) => 1 - (1 - x) ** 5;
export const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const outBack = (x, s = 1.4) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
/** A number in [0, 1) that depends on `n` only, so that every run draws the same scene. */
export const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;

    return s - Math.floor(s);
};
/** What tour.js fills at boot: the layers, the assets, the bench numbers and the text styles. */
export const K = { style: {} };

export function makeStyles() {
    const big = new SdfAtlas({ size: 96, radius: 28 });
    const sans = { fontFamily: SANS, atlas: big };
    const mono = { fontFamily: MONO, tabularNumbers: true };

    const brand = horizontal([C.GOLD, C.MARROW_TEXT, C.MARROW]);

    Object.assign(K.style, {
        head: { ...sans, fontSize: 98, fontWeight: 800, fill: C.TEXT, letterSpacing: -3.4, lineHeight: 104 },
        sub: { ...sans, fontSize: 40, fontWeight: 500, fill: C.MUTED, letterSpacing: -0.5 },
        title: { ...sans, anchor: 0.5, fontSize: 172, fontWeight: 900, letterSpacing: -7, fill: brand },
        tagline: { ...sans, anchor: 0.5, fontSize: 60, fontWeight: 600, fill: C.TEXT, letterSpacing: -1 },
        label: { ...mono, fontSize: 32, fontWeight: 700, fill: C.MUTED, letterSpacing: 3 },
        huge: { ...mono, atlas: big, fontSize: 230, fontWeight: 800, fill: C.MARROW, letterSpacing: -8 },
        stat: { ...mono, atlas: big, fontSize: 96, fontWeight: 700, fill: C.TEXT, letterSpacing: -2 },
        count: { ...sans, fontSize: 230, fontWeight: 800, fill: C.GREEN, letterSpacing: -8 },
        code: { ...mono, fontSize: 44, fontWeight: 600, fill: C.TEXT },
        body: { ...sans, fontSize: 44, fontWeight: 600, fill: C.TEXT, letterSpacing: -0.5 },
        value: { ...mono, atlas: big, fontSize: 52, fontWeight: 700, fill: C.TEXT, letterSpacing: -1 },
        name: { ...mono, fontSize: 30, fontWeight: 600, fill: C.MUTED },
        note: { ...sans, fontSize: 30, fontWeight: 500, fill: C.MUTED },
        credit: { ...sans, fontSize: 30, fontWeight: 500, fill: C.MUTED },
        maker: { ...sans, fontSize: 40, fontWeight: 800, fill: 0xffffff, letterSpacing: 7 },
    });
}

/** Immediate-mode text: put() each frame, and what was not put this frame is hidden. */
export class Texts {
    constructor(parent) {
        this.parent = parent;
        this.map = new Map();
    }
    begin() {
        for (const text of this.map.values()) text.visible = false;
    }
    put(key, value, style, x, y, o = {}) {
        let text = this.map.get(key);
        const string = String(value);
        const alpha = o.alpha ?? 1;

        if (!text) {
            text = new SilkText({ text: string, ...style, ...(o.fill === undefined ? {} : { fill: o.fill }) });
            this.parent.addChild(text);
            this.map.set(key, text);
        }
        if (text.text !== string) text.text = string;
        text.visible = alpha > 0.002;
        text.position.set(x, y);
        text.alpha = alpha;
        text.scale.set(o.scale ?? 1);

        return text;
    }
}

export const LEFT = 60;

/** The headline at the top left, on one or two lines, and one short line under it. `a` is the alpha of both. */
export function heading(key, title, sub, t, a = 1) {
    const { tx } = K.hud;
    const [h, s] = [outCubic(prog(t, 0.1, 0.7)), outCubic(prog(t, 0.3, 0.7))];
    const lines = title.split('\n').length;

    tx.put(`${key}-head`, title, K.style.head, LEFT - 4, 64 + (1 - h) * 24, { alpha: h * a });
    if (sub) tx.put(`${key}-sub`, sub, K.style.sub, LEFT, 84 + lines * 104 + (1 - s) * 18, { alpha: s * a });
}

/**
 * The credit of the rigs: the red block with the S of the Winspinity logo, the name beside it, and
 * a line above. `x` is the left edge and `y` the top of the line.
 */
export function credit(x, y, alpha, site = false) {
    const { tx } = K.hud;
    const mark = K.mark;

    tx.put('cr-by', 'Spine animations by', K.style.credit, x, y, { alpha });
    mark.visible = alpha > 0.002;
    mark.alpha = alpha;
    mark.position.set(x, y + 48);
    tx.put('cr-name', 'WINSPINITY', K.style.maker, x + mark.width + 18, y + 52, { alpha });
    if (site) tx.put('cr-site', 'winspinity.com', K.style.credit, x, y + 118, { alpha });
}

/** A card: a rectangle with small corners, an edge and a soft shadow. */
export function card(g, x, y, w, h, o = {}) {
    const a = o.alpha ?? 1;

    if (a <= 0.002) return;
    g.roundRect(x, y + 14, w, h, o.radius ?? 14).fill({ color: 0x000000, alpha: 0.45 * a, blur: 28 });
    g.roundRect(x, y, w, h, o.radius ?? 14)
        .fill({ color: o.color ?? C.CARD, alpha: a })
        .stroke({ width: 2, color: o.edge ?? C.LINE, alpha: a, alignment: 'inside' });
}

/** A skeleton that the tour steps itself: no ticker ever updates it. */
export function spawn(name, parent, x = 0, y = 0, scale = 1) {
    const hero = new MarrowSpine(K.assets[name], { autoUpdate: false });

    hero.position.set(x, y);
    hero.scale.set(scale);
    hero.label = name;
    parent.addChild(hero);

    return hero;
}

/** Covers the skeleton layer with the background colour: the dip between two scenes. */
export function cover(t, dur, a = 0.38, b = 0.34) {
    const c = Math.max(1 - prog(t, 0, a), prog(t, dur - b, b));

    if (c > 0.002) K.hud.g.rect(0, 0, W, H).fill({ color: C.BG, alpha: c });
}

/** The scale at which a rig, with the glow of its win animation, stays inside a square of `size`. */
export const fitOf = (name, size) => size / K.extent[name];

/**
 * The size of the square around the origin that each rig stays in while it plays `win` and
 * `idle`. It is measured in pixels: every third frame of both animations is drawn into a
 * texture, and a pixel counts when its alpha is above 16 percent in one of them. So a symbol
 * that is scaled to its cell with `fitOf` never draws over the symbol of the next cell.
 */
export function measureRigs() {
    const size = 512;
    const texture = RenderTexture.create({ width: size, height: size });
    const root = new Container();
    const extent = {};

    for (const name of Object.keys(K.assets)) {
        const hero = spawn(name, root, size / 2, size / 2);
        const seen = new Uint8Array(size * size);

        for (const animation of ['win', 'idle']) {
            hero.play(animation);
            for (let i = 0; i < 84; i++) {
                hero.update(STEP);
                if (i % 3 !== 0) continue;
                K.renderer.render({ container: root, target: texture, clear: true, clearColor: [0, 0, 0, 0] });
                const { pixels } = K.renderer.extract.pixels(texture);

                for (let p = 0; p < seen.length; p++) if (pixels[p * 4 + 3] > 40) seen[p] = 1;
            }
        }
        let far = 0;

        for (let p = 0; p < seen.length; p++) {
            if (seen[p] === 1)
                far = Math.max(far, Math.abs((p % size) - size / 2), Math.abs(Math.floor(p / size) - size / 2));
        }
        extent[name] = far * 2 + 2;
        hero.destroy();
    }
    texture.destroy(true);

    return extent;
}
