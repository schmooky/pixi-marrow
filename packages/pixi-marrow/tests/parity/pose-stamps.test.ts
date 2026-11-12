import { describe, expect, it } from 'vitest';
import { importSkeleton, nextVersion } from '../../src/core';
import { mirrorEngine, type Tamper } from './pose-mirror';
import { loadPoseRig } from './pose-official';
import { attachmentLabels, engineSubject, officialSubject, runScript, type Subject } from './pose-run';
import { DT, type PoseScript, script } from './pose-script';
import { SCRIPT_FAMILIES } from './pose-scripts';
import { listPoseRigs } from './pose-synthetic';

/*
 * The check of the stamps of a pose state, checked itself. The engine here is a mirror of an
 * official driver with stamps that are honest by construction, so the proof does not lean on one
 * of our engines. Honest stamps pass every script. A stamp that is held back fails, for a bone, a
 * slot, the draw order and the version, after an update and after any other call.
 */

/** A rig, with what both sides of a run need. */
async function load(id: string) {
    const source = listPoseRigs().find((candidate) => candidate.id === id);

    if (source === undefined) throw new Error(`There is no rig ${id}`);
    const files = source.read();
    const rig = loadPoseRig(source.version, files);
    const model = await importSkeleton(files.skeleton);
    const labels = attachmentLabels(model);

    return {
        info: rig.info,
        seed: `${source.version}/${source.rig}`,
        /** The mirror engine, whose stamps `tamper` can change after every call. */
        mirror: (tamper?: Tamper): Subject =>
            engineSubject(mirrorEngine(model, rig.createDriver(), tamper), labels.ofObject),
        official: (): Subject => officialSubject(rig.createDriver(), labels.ofRef),
    };
}

/** Stamps everything after every call that can change the pose: honest, and of no use to a renderer. */
const lazy: Tamper = (state) => {
    state.version = nextVersion(state.version);
    state.boneStamps.fill(state.version);
    state.slotStamps.fill(state.version);
    state.drawOrderStamp = state.version;
};

/** Puts the first stamp of a list that moved back to what it was. */
function holdFirst(now: Uint32Array, before: Uint32Array): void {
    const moved = now.findIndex((stamp, i) => stamp !== before[i]);

    if (moved >= 0) now[moved] = before[moved] ?? 0;
}

describe('the stamp check', () => {
    const ids = ['4.1/made-for-pose.json', '4.3/made-slider-slots.json', '4.2/made-physics-order.json'];
    const families = ['loops', 'setup pose', 'skins', 'skeleton', 'rest', 'still bones', 'bone writes', 'random'];
    /** The first animation of `made-for-pose` keys bones, slots and the draw order. */
    const play = script('loop the first animation', (s) => {
        s.set(0, 0, true);
        s.update(DT, 20);
    });

    it.each(ids)('passes honest stamps on %s, tight ones and lazy ones', { timeout: 30_000 }, async (id) => {
        const rig = await load(id);
        const scripts = SCRIPT_FAMILIES.flatMap((family) =>
            families.includes(family.name) ? family.scripts(rig.info, rig.seed) : [],
        );

        expect(scripts.length).toBeGreaterThan(20);
        for (const each of scripts) {
            expect(runScript(each, rig.mirror(), rig.official()), each.name).toBeNull();
            expect(runScript(each, rig.mirror(lazy), rig.official()), each.name).toBeNull();
        }
    });

    const held: { what: string; tamper: Tamper; fault: RegExp }[] = [
        {
            what: 'a bone',
            tamper: (state, before) => holdFirst(state.boneStamps, before.boneStamps),
            fault: /stamps: "bone \d+ changed and its stamp stayed"/,
        },
        {
            what: 'a slot',
            tamper: (state, before) => holdFirst(state.slotStamps, before.slotStamps),
            fault: /stamps: "slot \d+ changed and its stamp stayed"/,
        },
        {
            what: 'the draw order',
            tamper: (state, before) => {
                state.drawOrderStamp = before.drawOrderStamp;
            },
            fault: /stamps: "the draw order changed and its stamp stayed"/,
        },
        {
            what: 'the version',
            tamper: (state, before) => {
                state.version = before.version;
            },
            fault: /stamps: "a stamp moved and the version stayed\. the stamp \d+ of bone \d+ is ahead of the version \d+/,
        },
    ];

    it.each(held)('reports $what whose stamp is held back', async ({ tamper, fault }) => {
        for (const id of ['4.1/made-for-pose.json', '4.2/made-for-pose.json', '4.3/made-for-pose.json']) {
            const rig = await load(id);
            const failure = runScript(play, rig.mirror(tamper), rig.official());

            expect(runScript(play, rig.mirror(), rig.official()), id).toBeNull();
            expect(failure, id).toMatch(fault);
            // nothing else differs: the pose is the official one
            expect(failure?.split('\n').slice(1), id).toHaveLength(1);
        }
    });

    it('reports a stamp that moved, but not past the version a reader saw', async () => {
        const rig = await load('4.2/made-for-pose.json');
        // every stamp that moves gets a version from before the call: a reader that saw the state then skips it
        const stale: Tamper = (state, before) => {
            state.boneStamps.forEach((stamp, i) => {
                if (stamp !== before.boneStamps[i]) state.boneStamps[i] = before.version - 1;
            });
        };
        const failure = runScript(play, rig.mirror(stale), rig.official());

        expect(failure).toMatch(
            /stamps: "bone \d+ changed and its stamp \d+ is not newer than the version \d+ of the look before/,
        );
    });

    /*
     * The look after every call, not only after every update. Here time stands still, a setup pose
     * call resets the slots, and the next update poses them as they were. A check that looks after
     * updates only sees the same values twice and no fault.
     */
    it('reports a call that changed the pose without a stamp, at the call', async () => {
        const rig = await load('4.2/made-for-pose.json');
        const between: PoseScript = script('a setup pose call between two updates', (s) => {
            s.set(0, 0, true);
            s.update(DT, 5);
            s.timeScale(0);
            s.update(DT, 2);
            s.setupPoseSlots();
            s.update(DT, 2);
        });
        // the stamps of calls that are not updates are held back
        const silent: Tamper = (state, before, call) => {
            if (call === 'update') return;
            state.slotStamps.set(before.slotStamps);
            state.drawOrderStamp = before.drawOrderStamp;
            state.version = before.version;
        };
        const failure = runScript(between, rig.mirror(silent), rig.official());

        expect(runScript(between, rig.mirror(), rig.official())).toBeNull();
        expect(failure).toContain('step 5 of 6, setupPoseSlots');
        expect(failure).toMatch(/stamps: "slot \d+ changed and its stamp stayed/);
    });
});
