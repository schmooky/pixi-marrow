import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';
// #region import
import {
    computeMeshUVs,
    computeRegionOffsets,
    computeRegionUVs,
    computeRegionWorldVertices,
    computeWorldVertices,
    findRegion,
    readRegion,
} from 'pixi-marrow/core';
// #endregion
import { definePreview } from './runtime';

/*
 * How attachments of the bee of the slot game Bzzz become vertices. One attachment is drawn
 * over the dimmed bee: its triangles, its vertices, and for one vertex the bones it follows,
 * with lines as strong as their weights. On the right, the atlas page with a box where the
 * image lies, and that part of the page magnified with the same triangles on its pixels. The vertices are placed with the functions of
 * `pixi-marrow/core` that the runtime itself uses.
 */

/** The attachments to pick, by the slot that shows them. */
const PARTS = { wing: 'bee_right_wing', body: 'bee_body', hand: 'bee_right_hand', head: 'head' } as const;

type Part = keyof typeof PARTS;

/** Where the bee stands, and where the atlas page is shown, in design units. */
const BEE = new Rectangle(0, 10, 560, 440);
const PAGE = new Rectangle(590, 16, 280, 140);
const ZOOM = new Rectangle(590, 176, 280, 270);
const LINE = 0xff7a3d;
/** Seconds each vertex is shown before the next, while the pointer is away. */
const VERTEX_SECONDS = 0.8;

/** The vertices of the attachment a slot shows now, placed in the space of the skeleton, with their triangles and their texture coordinates. */
interface Placed {
    name: string;
    kind: 'region' | 'mesh';
    positions: Float32Array;
    uvs: Float32Array;
    triangles: ArrayLike<number>;
    /** The bones and weights each vertex follows. */
    weights: { bone: number; weight: number }[][];
    region: { width: number; height: number; page: number };
}

/** The bones and weights of each vertex of a weighted mesh, from its `bones` and `vertices` arrays. */
function weightsOf(bones: Int16Array, vertices: Float32Array): Placed['weights'] {
    const result: Placed['weights'] = [];

    // per vertex: a count, then that many bones. Per bone: x, y and the weight
    for (let b = 0, w = 0; b < bones.length; ) {
        const count = bones[b++] ?? 0;
        const vertex: Placed['weights'][number] = [];

        for (let k = 0; k < count; k++, w += 3) vertex.push({ bone: bones[b++] ?? 0, weight: vertices[w + 2] ?? 0 });
        result.push(vertex);
    }

    return result;
}

/** Places the attachment a slot shows now, or null for an empty slot or one that draws nothing. */
function place(hero: MarrowSpine, slot: number): Placed | null {
    const { state } = hero.engine;
    const { model, atlas } = hero.asset;
    const attachment = state.attachments[slot] ?? null;
    const bone = model.slots.bones[slot] ?? 0;

    if (attachment === null || (attachment.type !== 'region' && attachment.type !== 'mesh')) return null;
    const region = readRegion(atlas, findRegion(atlas, attachment.path));
    const size = { width: region.width, height: region.height, page: region.page };

    if (attachment.type === 'region') {
        // #region region
        const offsets = new Float32Array(8);
        const positions = new Float32Array(8);
        const uvs = new Float32Array(8);

        computeRegionOffsets(model.version, attachment, region, offsets);
        computeRegionWorldVertices(offsets, 0, state.world, bone, positions);
        computeRegionUVs(region, uvs);
        // #endregion

        return {
            name: attachment.name,
            kind: 'region',
            positions,
            uvs,
            triangles: [0, 1, 2, 2, 3, 0],
            weights: [0, 1, 2, 3].map(() => [{ bone, weight: 1 }]),
            region: size,
        };
    }
    // #region mesh
    const positions = new Float32Array(attachment.worldVerticesLength);
    const uvs = new Float32Array(attachment.regionUVs.length);

    computeWorldVertices(
        attachment,
        state.world,
        bone,
        state.deform[slot] ?? new Float64Array(0),
        state.deformLengths[slot] ?? 0,
        positions,
    );
    computeMeshUVs(region, attachment.regionUVs, uvs);
    // #endregion

    return {
        name: attachment.name,
        kind: 'mesh',
        positions,
        uvs,
        triangles: attachment.triangles,
        weights:
            attachment.bones === null
                ? Array.from({ length: positions.length / 2 }, () => [{ bone, weight: 1 }])
                : weightsOf(attachment.bones, attachment.vertices),
        region: size,
    };
}

/** Draws the edges of triangles from a list of points, scaled by `sx` and `sy` and moved by `x` and `y`. */
function drawTriangles(
    lines: Graphics,
    points: Float32Array,
    triangles: ArrayLike<number>,
    sx: number,
    sy: number,
    x = 0,
    y = 0,
): void {
    for (let i = 0; i + 2 < triangles.length; i += 3) {
        const [a, b, c] = [triangles[i] ?? 0, triangles[i + 1] ?? 0, triangles[i + 2] ?? 0];

        lines
            .moveTo(x + (points[a * 2] ?? 0) * sx, y + (points[a * 2 + 1] ?? 0) * sy)
            .lineTo(x + (points[b * 2] ?? 0) * sx, y + (points[b * 2 + 1] ?? 0) * sy)
            .lineTo(x + (points[c * 2] ?? 0) * sx, y + (points[c * 2 + 1] ?? 0) * sy)
            .closePath();
    }
}

export default definePreview({
    size: [880, 460],
    async setup(context) {
        const { app, pick, readout } = context;
        const hero = await MarrowSpine.load({ skeleton: '/rigs/animation_bee.skel', atlas: '/rigs/symbols.atlas' });
        const { model } = hero.asset;
        const overlay = new Graphics();
        const page = new Container();
        const pageLines = new Graphics();
        const zoom = new Container();
        const zoomSprite = new Sprite();
        const zoomLines = new Graphics();
        /** The part of the page the zoom shows, in pixels, and its scale. */
        let zoomFrame = new Rectangle();
        let zoomScale = 1;
        const showAttachment = readout('Attachment', 58);
        const showVertex = readout('Vertex', 58);
        const showAtlas = readout('Atlas', 58);
        let part: Part = 'head';
        let vertex = 0;
        let clock = 0;
        let pointer: { x: number; y: number } | null = null;

        hero.play('idle', { loop: true });
        hero.update(0);
        const box = hero.getLocalBounds();
        const scale = Math.min(BEE.width / box.width, BEE.height / box.height) * 0.85;

        hero.scale.set(scale);
        hero.position.set(
            BEE.x + BEE.width / 2 - (box.x + box.width / 2) * scale,
            BEE.y + BEE.height / 2 - (box.y + box.height / 2) * scale,
        );
        hero.alpha = 0.45;
        overlay.position.copyFrom(hero.position);
        overlay.scale.copyFrom(hero.scale);
        const texture = hero.asset.textures[0];

        if (texture !== undefined) {
            const sprite = page.addChild(new Sprite(texture));

            sprite.setSize(PAGE.width, PAGE.height);
        }
        page.position.set(PAGE.x, PAGE.y);
        page.addChild(pageLines);
        zoom.addChild(zoomSprite, zoomLines);
        app.stage.addChild(hero, overlay, page, zoom);
        /** Shows the part of the page that an attachment takes its pixels from, magnified. */
        const frameZoom = (placed: Placed): void => {
            if (texture === undefined) return;
            const { width, height } = texture.frame;
            let [minU, minV, maxU, maxV] = [1, 1, 0, 0];

            for (let i = 0; i < placed.uvs.length; i += 2) {
                minU = Math.min(minU, placed.uvs[i] ?? 1);
                maxU = Math.max(maxU, placed.uvs[i] ?? 0);
                minV = Math.min(minV, placed.uvs[i + 1] ?? 1);
                maxV = Math.max(maxV, placed.uvs[i + 1] ?? 0);
            }
            zoomFrame = new Rectangle(
                minU * width,
                minV * height,
                Math.max(1, (maxU - minU) * width),
                Math.max(1, (maxV - minV) * height),
            );
            zoomScale = Math.min(ZOOM.width / zoomFrame.width, ZOOM.height / zoomFrame.height);
            zoomSprite.texture = new Texture({ source: texture.source, frame: zoomFrame });
            zoomSprite.scale.set(zoomScale);
            zoomLines.scale.set(zoomScale);
            zoom.position.set(ZOOM.x + (ZOOM.width - zoomFrame.width * zoomScale) / 2, ZOOM.y);
        };
        let framed = '';
        /** Draws the attachment, its vertex with its bones, and its triangles on the page. */
        const draw = (placed: Placed): void => {
            const unit = 1 / scale;
            const count = placed.positions.length / 2;
            const at = vertex % count;
            const x = placed.positions[at * 2] ?? 0;
            const y = placed.positions[at * 2 + 1] ?? 0;
            const weights = placed.weights[at] ?? [];

            overlay.clear();
            drawTriangles(overlay, placed.positions, placed.triangles, 1, 1);
            overlay.stroke({ color: LINE, width: 1.5 * unit, alpha: 0.9 });
            for (const { bone, weight } of weights) {
                const bx = hero.engine.state.world[bone * 6 + 4] ?? 0;
                const by = hero.engine.state.world[bone * 6 + 5] ?? 0;

                overlay
                    .moveTo(x, y)
                    .lineTo(bx, by)
                    .stroke({ color: 0x5fa8ff, width: (1 + weight * 4) * unit, alpha: 0.35 + weight * 0.65 });
                overlay.circle(bx, by, 5 * unit).fill(0x5fa8ff);
            }
            for (let i = 0; i < count; i++)
                overlay.circle(placed.positions[i * 2] ?? 0, placed.positions[i * 2 + 1] ?? 0, 2.5 * unit);
            overlay.fill(0xffffff);
            overlay.circle(x, y, 6 * unit).stroke({ color: 0xffffff, width: 2 * unit });
            if (framed !== placed.name) {
                framed = placed.name;
                frameZoom(placed);
            }
            const pageWidth = texture?.frame.width ?? 1;
            const pageHeight = texture?.frame.height ?? 1;

            pageLines.clear();
            pageLines.rect(0, 0, PAGE.width, PAGE.height).stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
            pageLines
                .rect(
                    (zoomFrame.x / pageWidth) * PAGE.width - 2,
                    (zoomFrame.y / pageHeight) * PAGE.height - 2,
                    (zoomFrame.width / pageWidth) * PAGE.width + 4,
                    (zoomFrame.height / pageHeight) * PAGE.height + 4,
                )
                .stroke({ color: LINE, width: 2 });
            zoomLines.clear();
            drawTriangles(zoomLines, placed.uvs, placed.triangles, pageWidth, pageHeight, -zoomFrame.x, -zoomFrame.y);
            zoomLines.stroke({ color: 0xffffff, width: 1.5 / zoomScale, alpha: 0.9 });
            zoomLines
                .circle(
                    (placed.uvs[at * 2] ?? 0) * pageWidth - zoomFrame.x,
                    (placed.uvs[at * 2 + 1] ?? 0) * pageHeight - zoomFrame.y,
                    4 / zoomScale,
                )
                .fill(0xffffff);
            const bones = new Set(placed.weights.flat().map((item) => item.bone));

            showAttachment(
                `${placed.name}: a ${placed.kind}, ${count} vertices, ${placed.triangles.length / 3} triangles, ${bones.size} ${bones.size === 1 ? 'bone' : 'bones'}`,
            );
            showVertex(
                `${at + 1} of ${count}: ${weights.map((item) => `${model.bones.names[item.bone] ?? ''} ${item.weight.toFixed(2)}`).join(', ')}`,
            );
            showAtlas(`${placed.region.width} by ${placed.region.height} pixels of a 2048 by 1024 page`);
        };
        /** The vertex nearest to the pointer, in the space of the skeleton. */
        const nearest = (placed: Placed, point: { x: number; y: number }): number => {
            let best = 0;
            let distance = Number.POSITIVE_INFINITY;

            for (let i = 0; i < placed.positions.length / 2; i++) {
                const d = Math.hypot(
                    (placed.positions[i * 2] ?? 0) - point.x,
                    (placed.positions[i * 2 + 1] ?? 0) - point.y,
                );

                if (d < distance) [best, distance] = [i, d];
            }

            return best;
        };

        app.stage.eventMode = 'static';
        app.stage.hitArea = app.screen;
        app.stage.on('globalpointermove', (event) => {
            const point = event.getLocalPosition(overlay);

            pointer = BEE.contains(event.getLocalPosition(app.stage).x, event.getLocalPosition(app.stage).y)
                ? point
                : null;
        });
        app.stage.on('pointerleave', () => {
            pointer = null;
        });
        app.ticker.add((ticker) => {
            const placed = place(hero, model.slots.names.indexOf(PARTS[part]));

            if (placed === null) {
                overlay.clear();
                pageLines.clear();
                showAttachment(`${PARTS[part]} shows no image at this moment`);

                return;
            }
            clock += ticker.deltaMS / 1000;
            if (pointer !== null) vertex = nearest(placed, pointer);
            else if (clock >= VERTEX_SECONDS) {
                clock = 0;
                vertex = (vertex + 1) % (placed.positions.length / 2);
            }
            draw(placed);
        });
        pick(
            'Show',
            Object.keys(PARTS) as Part[],
            (next) => {
                part = next;
                vertex = 0;
            },
            'head',
        );
    },
});
