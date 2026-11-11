import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoseEngine } from '../../src/core';
import { type MarrowAsset, type MarrowEvent, MarrowSpine, type MarrowSpineEvents, type Track } from '../../src/index';
import { animationIndex, bareEngine, eventLabels, FRAME, fixtureAsset, VERSIONS } from './helpers';

const TRACK_EVENTS = ['start', 'interrupt', 'end', 'dispose', 'complete'] as const;

/** Writes down every event of a display object as text: the type and the animation name. */
function record(spine: MarrowSpine): string[] {
    const seen: string[] = [];

    for (const type of TRACK_EVENTS) spine.on(type, (track: Track) => seen.push(`${type} ${track.animation}`));
    spine.on('event', (...[, track]: MarrowSpineEvents['event']) => seen.push(`event ${track.animation}`));

    return seen;
}

describe.each(VERSIONS)('MarrowSpine events of a Spine %s skeleton', (version) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];
    const index = (name: string): number => animationIndex(asset.model, name);

    function create(): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    /** Updates a display object and a bare engine alike. Returns what the bare engine reported. */
    function steps(spine: MarrowSpine, bare: PoseEngine, count: number): string[] {
        const labels: string[] = [];

        for (let i = 0; i < count; i++) {
            spine.update(FRAME);
            bare.update(FRAME);
            labels.push(...eventLabels(asset.model, bare.takeEvents()));
        }

        return labels;
    }

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    it('emits what the engine reports, in the same order', () => {
        const spine = create();
        const bare = bareEngine(asset);
        const seen = record(spine);
        const expected: string[] = [];

        spine.defaultMix = 0.1;
        bare.defaultMix = 0.1;
        spine.play('walk');
        spine.queue('run', { loop: true });
        bare.setAnimation(0, index('walk'), false);
        bare.addAnimation(0, index('run'), true, 0);
        expected.push(...steps(spine, bare, 90));
        spine.play('jump', { track: 1 });
        spine.play('idle');
        bare.setAnimation(1, index('jump'), false);
        bare.setAnimation(0, index('idle'), false);
        expected.push(...steps(spine, bare, 120));

        expect(seen).toEqual(expected);
        expect(seen.slice(0, 4)).toEqual(['start walk', 'event walk', 'event walk', 'interrupt walk']);
        expect(new Set(seen.map((label) => label.split(' ')[0]))).toEqual(new Set([...TRACK_EVENTS, 'event']));
    });

    it('hands the track to the listeners of start, interrupt, end, dispose and complete', () => {
        const spine = create();
        const calls: [string, Track][] = [];

        for (const type of TRACK_EVENTS) spine.on(type, (track: Track) => calls.push([type, track]));
        const shoot = spine.play('shoot');
        for (let i = 0; i < 45; i++) spine.update(FRAME);
        const idle = spine.play('idle');
        for (let i = 0; i < 3; i++) spine.update(FRAME);

        expect(calls).toEqual([
            ['start', shoot],
            ['complete', shoot],
            ['interrupt', shoot],
            ['start', idle],
            ['end', shoot],
            ['dispose', shoot],
        ]);
    });

    it('hands the event as plain data, then the track', () => {
        const spine = create();
        const heard = vi.fn();
        const keys = asset.model.animations[index('walk')]?.timelines.flatMap((timeline) => timeline.events ?? []);

        spine.on('event', heard);
        const walk = spine.play('walk');
        for (let i = 0; i < 61; i++) spine.update(FRAME);
        const expected = keys?.map((key): [MarrowEvent, Track] => [
            {
                name: 'footstep',
                int: key.int,
                float: key.float,
                string: key.string,
                volume: key.volume,
                balance: key.balance,
                time: key.time,
            },
            walk,
        ]);

        expect(expected).toHaveLength(2);
        expect(heard.mock.calls).toEqual(expected);
        expect(heard.mock.calls[1]?.[0]).toMatchObject({ name: 'footstep', time: 0.5 });
        expect(Object.getPrototypeOf(heard.mock.calls[0]?.[0])).toBe(Object.prototype);
    });

    it('emits dispose alone for a queued animation that never starts', () => {
        const spine = create();
        const seen = record(spine);

        spine.play('walk', { loop: true });
        spine.queue('run');
        spine.queue('jump');
        spine.update(FRAME);
        spine.play('idle');
        spine.update(FRAME);

        expect(seen).toEqual([
            'start walk',
            'event walk',
            'dispose run',
            'dispose jump',
            'interrupt walk',
            'start idle',
        ]);
    });

    it('emits nothing for the empty animation a stop mixes through', () => {
        const spine = create();
        const seen = record(spine);

        spine.play('idle', { loop: true });
        spine.update(FRAME);
        spine.stop({ mix: 0.1 });
        for (let i = 0; i < 30; i++) spine.update(FRAME);

        expect(seen).toEqual(['start idle', 'interrupt idle', 'end idle', 'dispose idle']);
    });

    it('emits the events of a stop at the next update', () => {
        const spine = create();
        const seen = record(spine);

        spine.play('idle', { loop: true });
        spine.play('shoot', { track: 1 });
        spine.queue('aim', { track: 1 });
        spine.update(FRAME);
        seen.length = 0;
        spine.stop();
        expect(seen).toEqual([]);
        spine.update(FRAME);

        expect(seen).toEqual(['end idle', 'dispose idle', 'end shoot', 'dispose shoot', 'dispose aim']);
    });

    it('emits what a listener causes at the next update', () => {
        const spine = create();
        const seen = record(spine);
        let plays = 0;

        spine.on('start', () => {
            if (plays++ < 3) spine.play('run');
        });
        spine.play('walk');
        spine.update(FRAME);
        expect(seen).toEqual(['start walk', 'event walk']);
        spine.update(FRAME);
        expect(seen.slice(2)).toEqual(['interrupt walk', 'start run']);
        spine.update(FRAME);
        spine.update(FRAME);

        expect(plays).toBe(4);
        expect(seen.filter((label) => label === 'start run')).toHaveLength(3);
    });

    it('holds back the events of an update that a listener calls', () => {
        const spine = create();
        const seen = record(spine);

        spine.once('start', () => {
            spine.play('run');
            spine.update(FRAME);
        });
        spine.play('walk');
        spine.update(FRAME);
        expect(seen).toEqual(['start walk', 'event walk']);
        spine.update(FRAME);

        expect(seen.slice(2, 4)).toEqual(['interrupt walk', 'start run']);
    });

    it('keeps emitting after a listener throws', () => {
        const spine = create();
        const seen = record(spine);

        spine.once('start', () => {
            throw new Error('listener failed');
        });
        spine.play('walk');
        expect(() => spine.update(FRAME)).toThrow('listener failed');
        spine.play('run');
        spine.update(FRAME);

        expect(seen.slice(-2)).toEqual(['interrupt walk', 'start run']);
    });

    it('stops emitting when a listener destroys the object', () => {
        const spine = create();
        const seen = record(spine);

        spine.on('start', () => spine.destroy());
        spine.play('walk');
        spine.update(FRAME);

        expect(seen).toEqual(['start walk']);
        expect(spine.destroyed).toBe(true);
    });

    it('emits no events for an animation set on the engine directly', () => {
        const spine = create();
        const seen = record(spine);

        spine.engine.setAnimation(0, index('walk'), false);
        for (let i = 0; i < 70; i++) spine.update(FRAME);
        spine.play('run');
        spine.update(FRAME);

        expect(seen).toEqual(['start run']);
    });
});
