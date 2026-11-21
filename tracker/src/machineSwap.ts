// The gym has two plate-loaded machines where the plan had three lifts. One iso-lateral chest
// press replaces both benches (one press per day, in the first bench's place), and the incline
// fly machine replaces the cable incline fly. The old lifts are archived, not deleted, so their
// history keeps its names. The new ones have no aliases and no goals: machine loads aren't
// comparable with a bar or a cable, so they start fresh. The phone's side is gym/convex/sync.ts
// (swapToMachines), with the same names and settings from here.
//
// The hip thrust machine is different: the old app had no such machine, so its sessions were
// logged as "Smith Machine Hip Thrust". Those sets are renamed to the machine (renameHistory),
// and flagged FORM_FLAG: they went up to 150 kg with the lower back and hamstrings doing much
// of the work, so they stay in the history but count toward neither the next weight nor the
// strength score. From 24 Sep it went in as a single-leg hip thrust at 40 kg, one side of
// 80 (standIns): those sets take its name at 80, unflagged. Goals run on from 80 kg.

export interface MachineExercise {
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  step: number;
  laterSlot: boolean;
  perSide: boolean;
  restSeconds: number;
  note: string;
  /** Goal weight at each checkpoint, in order; none means it starts fresh with no goals. */
  goals?: number[];
}

export interface MachineSwap {
  /** The plan's lifts it replaces (any spelling of the case). */
  replaces: string[];
  exercise: MachineExercise;
  /** The old name was the old app's stand-in for this machine: past sets take the machine's name (and FORM_FLAG). */
  renameHistory?: boolean;
  /**
   * Other old-app names that were really this machine, done with good form: their sets take
   * its name too, unflagged, with the weight × weightTimes (one side logged → both sides).
   */
  standIns?: { name: string; weightTimes: number }[];
}

/** A set's flag for work done with form that moved the load off the target muscle: kept, not counted. */
export const FORM_FLAG = 'form';

export const MACHINE_SWAPS: MachineSwap[] = [
  {
    replaces: ['Barbell Bench Press', 'Dumbbell Bench Press'],
    exercise: {
      name: 'Iso-Lateral Flat Chest Press (Machine)', sets: 3, repMin: 6, repMax: 10, step: 2.5, laterSlot: false, perSide: true, restSeconds: 150,
      note: 'Rest 2–3 min. Slide on the bench so the handles line up with mid-chest; shoulder blades back and down; wrists stacked over elbows; lower for 2–3 s to a full stretch. One arm at a time: log reps per arm.',
    },
  },
  {
    replaces: ['Cable Seated Incline Fly'],
    exercise: {
      name: 'Incline Chest Fly (Plate-Loaded)', sets: 3, repMin: 10, repMax: 15, step: 2.5, laterSlot: true, perSide: true, restSeconds: 90,
      note: 'Heaviest stretched, light at the squeeze: keep the weight moderate and finish sets with bottom-half partials. Shoulders just below the pivots; fixed soft elbow bend (not a press); wide hugging arc; stop before the front of the shoulder pinches.',
    },
  },
  {
    replaces: ['Smith Machine Hip Thrust'],
    renameHistory: true,
    // From 24 Sep 2026, at 80 kg with better form, the machine went in the old app as a single-leg thrust at 40 (one side).
    standIns: [{ name: 'Bodyweight Single-Leg Hip Thrust', weightTimes: 2 }],
    exercise: {
      name: 'Iso-Lateral Hip Thrust (Machine)', sets: 3, repMin: 8, repMax: 12, step: 5, laterSlot: true, perSide: false, restSeconds: 120, goals: [80, 90, 100, 110, 120],
      note: 'Glutes, not lower back: pad low across the hips, feet so shins are vertical at the top, chin tucked and ribs down. Drive through the heels and stop when hips line up with the torso (no arching past it); squeeze 1 s with a slight tuck. Back or hamstrings take over → lighter. Log the total load.',
    },
  },
];

/**
 * What an old-app name's past sets now go by: the machine's name, the flag they take (FORM_FLAG
 * for the stand-in it replaces, none for a good-form stand-in), and what their weight is
 * multiplied by. Null for a name that isn't one.
 */
export function historyFor(name: string): { name: string; flag: string | null; weightTimes: number } | null {
  const n = name.trim().toLowerCase();
  for (const s of MACHINE_SWAPS) {
    if (!s.renameHistory) continue;
    if (s.replaces.some((r) => r.toLowerCase() === n)) return { name: s.exercise.name, flag: FORM_FLAG, weightTimes: 1 };
    const standIn = s.standIns?.find((x) => x.name.toLowerCase() === n);
    if (standIn) return { name: s.exercise.name, flag: null, weightTimes: standIn.weightTimes };
  }
  return null;
}

/** The new exercise an old lift's name turns into (for imports that still use the old names). */
export function machineFor(name: string): MachineExercise | null {
  const n = name.trim().toLowerCase();
  return MACHINE_SWAPS.find((s) => s.replaces.some((r) => r.toLowerCase() === n))?.exercise ?? null;
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** The swap as SQL for رقيب's database: once per day that has any of the old lifts. */
export function machineSwapSql(now: number, swaps: readonly MachineSwap[] = MACHINE_SWAPS): string {
  return swaps.map(({ replaces, exercise: e, renameHistory, standIns }) => {
    const old = `name COLLATE NOCASE IN (${replaces.map(q).join(', ')}) AND active = 1`;
    return `
    INSERT INTO plan_exercises (day_id, position, name, aliases, sets, rep_min, rep_max, step_kg, later_slot, per_hand, per_side, bodyweight, note, active, created_ms)
      SELECT day_id, MIN(position), ${q(e.name)}, '[]', ${e.sets}, ${e.repMin}, ${e.repMax}, ${e.step}, ${e.laterSlot ? 1 : 0}, 0, ${e.perSide ? 1 : 0}, 0, ${q(e.note)}, 1, ${now}
      FROM plan_exercises WHERE ${old} GROUP BY day_id;
    UPDATE plan_exercises SET active = 0 WHERE ${old};${goalsSql(e)}${renameHistory ? historySql(replaces, e.name) + standInSql(standIns ?? [], e.name) : ''}`;
  }).join('\n');
}

/** The machine's goals, one per checkpoint in order, for every active copy of it that has none yet. */
function goalsSql(e: MachineExercise): string {
  if (!e.goals?.length) return '';
  const weight = `CASE c.i ${e.goals.map((w, i) => `WHEN ${i} THEN ${w}`).join(' ')} END`;
  return `
    INSERT OR IGNORE INTO exercise_goals (plan_exercise_id, day, weight_kg)
      SELECT p.id, c.day, ${weight}
      FROM plan_exercises p, (SELECT day, ROW_NUMBER() OVER (ORDER BY day) - 1 AS i FROM checkpoints) c
      WHERE p.name = ${q(e.name)} AND p.active = 1 AND c.i < ${e.goals.length};`;
}

/** Past sets under the old names take the machine's name, flagged FORM_FLAG (typos stay flagged as typos). */
function historySql(replaces: readonly string[], name: string): string {
  const old = `exercise COLLATE NOCASE IN (${replaces.map(q).join(', ')})`;
  return `
    UPDATE workout_sets SET exercise = ${q(name)}, flag = CASE WHEN flag = 'outlier' THEN flag ELSE ${q(FORM_FLAG)} END WHERE ${old};
    UPDATE OR IGNORE exercise_logs SET exercise = ${q(name)} WHERE ${old};`;
}

/** Good-form stand-ins take the machine's name, the weight scaled in the same statement (so running it again changes nothing). */
function standInSql(standIns: readonly { name: string; weightTimes: number }[], name: string): string {
  return standIns.map(({ name: old, weightTimes }) => `
    UPDATE workout_sets SET exercise = ${q(name)}, weight_kg = weight_kg * ${weightTimes} WHERE exercise = ${q(old)} COLLATE NOCASE;
    UPDATE OR IGNORE exercise_logs SET exercise = ${q(name)} WHERE exercise = ${q(old)} COLLATE NOCASE;`).join('');
}
