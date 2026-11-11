import { DT, ODD, type PoseScript, pick, script, thresholds } from './pose-script';
import type { PoseRigInfo } from './pose-shared';

/*
 * Scripts for the track entry fields. The first group is the fields one Spine dialect has and the
 * other has not. The second group is the fields every version has, under the names of the version.
 */

/** 4.1 and 4.2: `holdPrevious` and `mixBlend` add. */
function legacyDialect(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig);

    return [
        script('hold previous', (s) => {
            s.defaultMix(0.3);
            s.set(0, a, true);
            s.set(1, b, true);
            s.update(DT, 5);
            s.set(1, c, true, { holdPrevious: true });
            s.update(DT, 5);
            // a chain of held entries
            s.set(1, a, true, { holdPrevious: true });
            s.update(DT, 12);
            s.set(0, c, true, { holdPrevious: true });
            s.update(DT, 12);
        }),
        script('mix blend add', (s) => {
            s.set(0, a, true);
            s.set(1, b, true, { mixBlend: 'add', alpha: 0.6 });
            s.update(DT, 6);
            s.defaultMix(0.2);
            s.set(1, c, true, { mixBlend: 'add' });
            s.update(DT, 4);
            // replace mixes from add
            s.set(1, a, true);
            s.update(DT, 10);
            s.set(2, b, false, { mixBlend: 'add', alpha: 0.5, reverse: true });
            s.update(DT, 4);
            s.setEmpty(1, 0.2);
            s.update(DT, 8);
        }),
    ];
}

/** 4.3: `additive` and `keepHold`. */
function dialect43(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig);

    return [
        script('additive', (s) => {
            s.set(0, a, true);
            s.set(1, b, true, { additive: true, alpha: 0.6 });
            s.update(DT, 6);
            s.defaultMix(0.2);
            s.set(1, c, true, { additive: true });
            s.update(DT, 4);
            // a plain entry mixes from an additive one
            s.set(1, a, true);
            s.update(DT, 10);
            s.set(0, b, true, { additive: true });
            s.update(DT, 8);
            s.setEmpty(1, 0.2);
            s.update(DT, 8);
        }),
        script('keep hold', (s) => {
            s.defaultMix(0.3);
            // set on a new entry, the flag keeps its timelines from ever holding
            s.set(0, a, true, { keepHold: true });
            s.update(DT, 4);
            s.set(0, b, true);
            s.update(DT, 4);
            s.set(0, a, true, { keepHold: true });
            s.update(DT, 4);
            s.set(0, c, true);
            s.update(DT, 14);
        }),
    ];
}

/** The fields one dialect has and the other has not. */
export function dialectScripts(rig: PoseRigInfo): PoseScript[] {
    return rig.version === '4.3' ? dialect43(rig) : legacyDialect(rig);
}

/** The thresholds and the time fields of a track entry. */
export function fieldScripts(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c, duration } = pick(rig);
    const scripts = [
        script('mix thresholds', (s) => {
            s.defaultMix(0.3);
            s.set(0, a, true, thresholds(rig, 0.5));
            s.update(DT, 5);
            // a mixes out: its events, attachments and draw order count for the first half of the mix
            s.set(0, b, true, thresholds(rig, 1));
            s.update(DT, 5);
            s.set(0, c, true);
            s.update(DT, 12);
        }),
        script('entry times', (s) => {
            const length = duration(a);

            s.set(0, a, true, {
                animationStart: length * 0.25,
                animationEnd: length * 0.75,
                animationLast: length * 0.25,
            });
            s.update(DT, 10);
            s.set(0, b, false, { trackTime: duration(b) * 0.5, mixDuration: 0.3, trackEnd: duration(b) * 0.5 + 0.5 });
            s.update(DT, 6);
            s.add(0, c, true, 0, { delay: 0.1, mixDuration: 0.15 });
            s.update(DT, 6);
            s.set(1, a, false, { mixTime: 0.1, alpha: 0.5, loop: true });
            s.update(ODD, 12);
        }),
    ];

    if (rig.version === '4.1') return scripts;

    return [
        ...scripts,
        script('alpha attachment threshold', (s) => {
            s.set(0, a, true);
            // below the threshold: the attachment keys of this entry do not count
            s.set(1, b, true, { alpha: 0.4, alphaAttachmentThreshold: 0.5 });
            s.set(2, c, true, { alpha: 0.6, alphaAttachmentThreshold: 0.5 });
            s.update(DT, 6);
            s.defaultMix(0.2);
            s.set(1, c, true, { alpha: 0.9, alphaAttachmentThreshold: 0.5 });
            s.update(DT, 8);
        }),
    ];
}
