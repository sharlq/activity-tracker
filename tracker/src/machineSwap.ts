// The gym has two plate-loaded machines where the plan had three lifts. One iso-lateral chest
// press replaces both benches (one press per day, in the first bench's place), and the incline
// fly machine replaces the cable incline fly. The old lifts are archived, not deleted, so their
// history keeps its names. The new ones have no aliases and no goals: machine loads aren't
// comparable with a bar or a cable, so they start fresh. The phone's side is gym/convex/sync.ts
// (swapToMachines), with the same names and settings from here.

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
}

export interface MachineSwap {
  /** The plan's lifts it replaces (any spelling of the case). */
  replaces: string[];
  exercise: MachineExercise;
}

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
];

/** The new exercise an old lift's name turns into (for imports that still use the old names). */
export function machineFor(name: string): MachineExercise | null {
  const n = name.trim().toLowerCase();
  return MACHINE_SWAPS.find((s) => s.replaces.some((r) => r.toLowerCase() === n))?.exercise ?? null;
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** The swap as SQL for رقيب's database: once per day that has any of the old lifts. */
export function machineSwapSql(now: number): string {
  return MACHINE_SWAPS.map(({ replaces, exercise: e }) => {
    const old = `name COLLATE NOCASE IN (${replaces.map(q).join(', ')}) AND active = 1`;
    return `
    INSERT INTO plan_exercises (day_id, position, name, aliases, sets, rep_min, rep_max, step_kg, later_slot, per_hand, per_side, bodyweight, note, active, created_ms)
      SELECT day_id, MIN(position), ${q(e.name)}, '[]', ${e.sets}, ${e.repMin}, ${e.repMax}, ${e.step}, ${e.laterSlot ? 1 : 0}, 0, ${e.perSide ? 1 : 0}, 0, ${q(e.note)}, 1, ${now}
      FROM plan_exercises WHERE ${old} GROUP BY day_id;
    UPDATE plan_exercises SET active = 0 WHERE ${old};`;
  }).join('\n');
}
