import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { closestName, editDistance, unknownName } from '../../src/base/names';

describe('editDistance', () => {
    it('is 0 for equal strings', () => {
        expect(editDistance('run', 'run')).toBe(0);
        expect(editDistance('', '')).toBe(0);
    });

    it('counts inserted, removed and replaced characters', () => {
        expect(editDistance('run', 'runs')).toBe(1);
        expect(editDistance('walk', 'wak')).toBe(1);
        expect(editDistance('idle', 'idly')).toBe(1);
        expect(editDistance('kitten', 'sitting')).toBe(3);
    });

    it('counts two swapped letters as two edits', () => {
        expect(editDistance('idel', 'idle')).toBe(2);
    });

    it('is the length of the other string when one is empty', () => {
        expect(editDistance('', 'jump')).toBe(4);
        expect(editDistance('jump', '')).toBe(4);
    });

    it('is the same in both directions', () => {
        expect(editDistance('hoverboard', 'portal')).toBe(editDistance('portal', 'hoverboard'));
    });

    it('tells upper case from lower case', () => {
        expect(editDistance('Run', 'run')).toBe(1);
    });
});

describe('closestName', () => {
    const names = ['walk', 'idle', 'run', 'run-to-idle'];

    it('finds the name with the fewest edits', () => {
        expect(closestName('idel', names)).toBe('idle');
        expect(closestName('wlak', names)).toBe('walk');
        expect(closestName('run-to-idel', names)).toBe('run-to-idle');
    });

    it('does not tell upper case from lower case', () => {
        expect(closestName('IDLE', ['idly', 'idle'])).toBe('idle');
    });

    it('takes the first of equally close names', () => {
        expect(closestName('rum', ['rub', 'run'])).toBe('rub');
    });

    it('has a closest name for any input when there are names', () => {
        expect(closestName('', names)).toBe('run');
    });

    it('is undefined without names', () => {
        expect(closestName('idle', [])).toBeUndefined();
    });
});

describe('unknownName', () => {
    it('states the name, the kind and the closest name', () => {
        const error = unknownName('animation', 'idel', ['walk', 'idle']);

        expect(error).toBeInstanceOf(MarrowError);
        expect(error.code).toBe('unknown-name');
        expect(error.message).toBe(
            '[pixi-marrow:unknown-name] The skeleton has no animation "idel". The closest name is "idle". ' +
                'Pass one of the animation names: walk, idle.',
        );
        expect(error.validNames).toEqual(['walk', 'idle']);
        expect(error.closest).toBe('idle');
    });

    it('spells out twelve names at most and carries all of them', () => {
        const names = Array.from({ length: 15 }, (_, i) => `skin-${i}`);
        const error = unknownName('skin', 'skin-x', names);

        expect(error.fix).toBe(`Pass one of the skin names: ${names.slice(0, 12).join(', ')} and 3 more.`);
        expect(error.validNames).toEqual(names);
    });

    it('says so when the skeleton has no names of that kind', () => {
        const error = unknownName('animation', 'idle', []);

        expect(error.message).toContain('The skeleton has no animation "idle". It has no animation names.');
        expect(error.closest).toBeUndefined();
        expect(error.validNames).toEqual([]);
    });
});
