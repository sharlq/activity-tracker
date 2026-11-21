// The calf day's new shape (Nov 2026): the standing calf machine replaces the dumbbell
// single-leg raise (machineSwap.ts), the seated calf machine goes right after it, and the
// two are a superset: a set of one, a set of the other, then rest. A kettlebell tibialis
// raise for the front of the shin follows. The phone's side is gym/convex/migrations.ts
// (calvesV1), with the same names and settings from here.
import type { MachineExercise } from './machineSwap.ts';
import { STANDING_CALF_RAISE } from './machineSwap.ts';

export type AddedExercise = Omit<MachineExercise, 'goals' | 'perSide'>;

export const SEATED_CALF_RAISE: AddedExercise = {
  name: 'Machine Seated Single-Leg Calf Raise', sets: 3, repMin: 10, repMax: 15, step: 2.5, laterSlot: false, restSeconds: 90,
  note: 'Unilateral: one leg at a time, log reps per leg. Pad low on the thigh, ball of the foot on the edge; 1 s pause in the stretch at the bottom, all the way up. Bent knee, so it works the soleus.',
};

export const TIBIALIS_RAISE: AddedExercise = {
  name: 'Seated Kettlebell Tibialis Raise', sets: 3, repMin: 12, repMax: 15, step: 2, laterSlot: false, restSeconds: 60,
  note: 'Tibialis anterior (front of the shin), kettlebell. Sit on a bench with the kettlebell hooked over the top of the foot. Keep the heel on the floor and the knee still, then pull the toes up toward the shin. Lower slowly.',
};

/** The superset: these, in this order, then the rest. */
export const CALF_SUPERSET = { members: [STANDING_CALF_RAISE, SEATED_CALF_RAISE.name], restSeconds: 90 } as const;

/** The exercises that go in after the standing calf machine, in order. */
export const AFTER_STANDING_CALF: readonly AddedExercise[] = [SEATED_CALF_RAISE, TIBIALIS_RAISE];

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * For رقيب's database: on each day with the standing calf machine, the seated one and the
 * tibialis raise go in right after it (later lifts move down two). The PC has no supersets;
 * its plan only keeps the same lifts. Running it again changes nothing.
 */
export function calfWorkSql(now: number): string {
  const standing = `s.name = ${q(STANDING_CALF_RAISE)} AND s.active = 1`;
  const hasSeated = (day: string) => `EXISTS (SELECT 1 FROM plan_exercises x WHERE x.day_id = ${day} AND x.name = ${q(SEATED_CALF_RAISE.name)} AND x.active = 1)`;
  return `
    UPDATE plan_exercises SET position = position + ${AFTER_STANDING_CALF.length}
      WHERE active = 1 AND NOT ${hasSeated('plan_exercises.day_id')}
        AND position > (SELECT MIN(s.position) FROM plan_exercises s WHERE s.day_id = plan_exercises.day_id AND ${standing});
    ${AFTER_STANDING_CALF.map((e, i) => `
    INSERT INTO plan_exercises (day_id, position, name, aliases, sets, rep_min, rep_max, step_kg, later_slot, per_hand, per_side, bodyweight, note, active, created_ms)
      SELECT s.day_id, MIN(s.position) + ${i + 1}, ${q(e.name)}, '[]', ${e.sets}, ${e.repMin}, ${e.repMax}, ${e.step}, ${e.laterSlot ? 1 : 0}, 0, 0, 0, ${q(e.note)}, 1, ${now}
      FROM plan_exercises s WHERE ${standing}
        AND NOT EXISTS (SELECT 1 FROM plan_exercises x WHERE x.day_id = s.day_id AND x.name = ${q(e.name)} AND x.active = 1)
      GROUP BY s.day_id;`).join('')}`;
}
