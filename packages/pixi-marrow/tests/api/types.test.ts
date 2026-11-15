import { Container, type FederatedPointerEvent } from 'pixi.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
    DrawMode,
    MarrowEvent,
    MarrowSpine,
    PacingStatus,
    PoseEngine,
    ResolvedPerf,
    SkeletonModel,
    SpineEventName,
    SpineListener,
    Track,
    TrackEnd,
} from '../../src/index';

/*
 * The types of the public API, checked by `pnpm typecheck`: a wrong event name is a compile
 * error, a listener gets the arguments of its event, and the types of public members can be
 * imported from the root.
 */

/** The names of a skeleton, as `pixi-marrow typegen` writes them. */
interface HeroNames {
    animations: 'idle' | 'run';
    skins: 'default';
    bones: 'root' | 'head';
    slots: 'body';
    events: 'footstep' | 'hit';
}

/** The arguments `on` gives the listener of an event of a skeleton with these names. */
type Heard<K> = Parameters<SpineListener<HeroNames, K>>;

declare const hero: MarrowSpine<HeroNames>;
declare const plain: MarrowSpine;

describe('the types of the events', () => {
    it('take the names of the skeleton events and of the container events, and no other name', () => {
        expectTypeOf<SpineEventName<HeroNames, 'complete'>>().toEqualTypeOf<'complete'>();
        expectTypeOf<SpineEventName<HeroNames, 'event'>>().toEqualTypeOf<'event'>();
        expectTypeOf<SpineEventName<HeroNames, 'pointerdown'>>().toEqualTypeOf<'pointerdown'>();
        expectTypeOf<SpineEventName<HeroNames, 'destroyed'>>().toEqualTypeOf<'destroyed'>();
        // a misspelled name is never: the call does not compile
        expectTypeOf<SpineEventName<HeroNames, 'complet'>>().toBeNever();
        expectTypeOf<SpineEventName<HeroNames, 'onComplete'>>().toBeNever();
        // a name that is known only when the game runs passes
        expectTypeOf<SpineEventName<HeroNames, string>>().toEqualTypeOf<string>();
        expect(true).toBe(true);
    });

    it('give a listener the arguments of its event, with the names of the skeleton', () => {
        expectTypeOf<Heard<'complete'>>().toEqualTypeOf<[track: Track<HeroNames>]>();
        expectTypeOf<Heard<'start'>>().toEqualTypeOf<[track: Track<HeroNames>]>();
        expectTypeOf<Heard<'event'>>().toEqualTypeOf<[event: MarrowEvent<HeroNames>, track: Track<HeroNames>]>();
        expectTypeOf<Heard<'event'>[0]['name']>().toEqualTypeOf<'footstep' | 'hit'>();
        expectTypeOf<Heard<'complete'>[0]['animation']>().toEqualTypeOf<'idle' | 'run'>();
        expectTypeOf<Heard<'pointerdown'>>().toEqualTypeOf<[event: FederatedPointerEvent]>();
        expectTypeOf<Parameters<SpineListener<{ [K in keyof HeroNames]: string }, 'event'>>[0]['name']>().toBeString();
        expect(true).toBe(true);
    });

    it('type on, once and off of a display object, which stays a Pixi container', () => {
        // never called: the lines are checked by the compiler alone
        const check = (): void => {
            hero.on('event', (event, track) => {
                expectTypeOf(event.name).toEqualTypeOf<'footstep' | 'hit'>();
                expectTypeOf(track.animation).toEqualTypeOf<'idle' | 'run'>();
            });
            hero.once('complete', (track) => expectTypeOf(track).toEqualTypeOf<Track<HeroNames>>());
            hero.off('start');
            hero.on('childAdded', (child, parent, index) => {
                expectTypeOf(parent).toEqualTypeOf<Container>();
                expectTypeOf(index).toBeNumber();
                expectTypeOf(child).not.toBeAny();
            });
            plain.on('event', (event) => expectTypeOf(event.name).toBeString());
            new Container().addChild(hero);
        };

        expectTypeOf<MarrowSpine<HeroNames>>().toMatchTypeOf<Container>();
        expectTypeOf<Parameters<typeof hero.on<'complet'>>[0]>().toBeNever();
        expectTypeOf<Parameters<typeof hero.once<'complet'>>[0]>().toBeNever();
        expectTypeOf<Parameters<typeof hero.off<'complet'>>[0]>().toBeNever();
        expectTypeOf<Parameters<typeof hero.on<'complete'>>[0]>().toEqualTypeOf<'complete'>();
        expect(check).toBeTypeOf('function');
    });
});

describe('the types of public members', () => {
    it('say why a track finished', () => {
        expectTypeOf<Track['finished']>().resolves.toEqualTypeOf<TrackEnd>();
        expectTypeOf<TrackEnd>().toEqualTypeOf<'complete' | 'interrupted' | 'stopped' | 'destroyed'>();
        expect(true).toBe(true);
    });

    it('can be imported from the root', () => {
        expectTypeOf<MarrowSpine['perfSettings']>().toEqualTypeOf<ResolvedPerf>();
        expectTypeOf<ReturnType<MarrowSpine['pacingStatus']>>().toEqualTypeOf<PacingStatus>();
        expectTypeOf<MarrowSpine['stats']['renderMode']>().toEqualTypeOf<DrawMode>();
        expectTypeOf<MarrowSpine['engine']>().toEqualTypeOf<PoseEngine>();
        expectTypeOf<MarrowSpine['asset']['model']>().toEqualTypeOf<SkeletonModel>();
        expectTypeOf<MarrowSpine['isMarrowSpine']>().toEqualTypeOf<true>();
        expect(true).toBe(true);
    });
});
