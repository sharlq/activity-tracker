// The training plan as first written (2026-11-14): a 4-day Upper/Lower split, a weight
// goal per exercise at each quarterly checkpoint, and bodyweight targets for a slow lean
// bulk. A migration copies it into the database once; from then on it lives there and can
// be edited, so changing this file later changes nothing already set up.

export const SEED_CHECKPOINTS: [day: string, label: string][] = [
  ['2026-11-14', 'Now'],
  ['2027-02-14', 'Feb 27'],
  ['2027-05-14', 'May 27'],
  ['2027-08-14', 'Aug 27'],
  ['2027-11-14', 'Nov 27'],
];

const LOWER_NOTE = 'At least 48 h before a football match';
export const SEED_DAYS: [name: string, note: string | null][] = [
  ['Upper A', 'Suggested week: Upper A · Lower A · rest · Upper B · Lower B'],
  ['Lower A', LOWER_NOTE],
  ['Upper B', null],
  ['Lower B', LOWER_NOTE],
];

export interface SeedExercise {
  day: string;
  name: string;
  /** Other names it goes by, as the old app spelled it. */
  aliases?: string[];
  sets: number;
  reps: [number, number];
  later: boolean;
  step: number;
  /** The weight at each checkpoint, in order. */
  goals: number[];
  note?: string;
  perHand?: boolean;
  bodyweight?: boolean;
}

export const SEED_EXERCISES: SeedExercise[] = [
  { day: 'Upper A', name: 'Barbell Bench Press', sets: 3, reps: [6, 10], later: false, step: 2.5, goals: [67.5, 72.5, 75, 77.5, 80], note: 'Main chest lift, rest 2–3 min' },
  { day: 'Upper A', name: 'Barbell Bent-Over Row', sets: 3, reps: [6, 10], later: false, step: 2.5, goals: [85, 87.5, 90, 92.5, 95], note: 'Strict, no hip swing' },
  { day: 'Upper A', name: 'DB Shoulder Press', aliases: ['Dumbbell Shoulder Press'], sets: 3, reps: [8, 12], later: true, step: 2.5, goals: [22.5, 25, 25, 27.5, 30], note: 'After bench', perHand: true },
  { day: 'Upper A', name: 'Cable Single Arm Lat Pulldown', sets: 3, reps: [8, 12], later: true, step: 4.5, goals: [46, 50, 50, 55, 59], note: 'After rows; step = next pin' },
  { day: 'Upper A', name: 'Cable Single Arm Lateral Raise', sets: 3, reps: [10, 15], later: false, step: 2.5, goals: [12.5, 12.5, 15, 15, 17.5] },
  { day: 'Upper A', name: 'Cable Tricep Extension', sets: 2, reps: [10, 15], later: true, step: 5, goals: [40, 45, 45, 50, 50], note: 'After pressing' },
  { day: 'Upper A', name: 'Dumbbell Curl', sets: 2, reps: [8, 12], later: true, step: 2.5, goals: [17, 17, 19.5, 19.5, 22], note: 'After rows/pulldowns' },
  { day: 'Upper A', name: 'Barbell Reverse Curl', sets: 2, reps: [10, 15], later: true, step: 2.5, goals: [30, 30, 32.5, 35, 35], note: 'After curls' },
  { day: 'Lower A', name: 'Barbell Squat', sets: 3, reps: [6, 10], later: false, step: 2.5, goals: [85, 90, 95, 100, 102.5], note: 'Rest 3 min' },
  { day: 'Lower A', name: 'Romanian Deadlift', sets: 3, reps: [8, 12], later: false, step: 5, goals: [60, 80, 90, 100, 105], note: 'New lift, fast early gains' },
  { day: 'Lower A', name: 'Machine Seated Leg Curl', sets: 3, reps: [10, 15], later: true, step: 5, goals: [40, 45, 45, 50, 50], note: 'After RDL' },
  { day: 'Lower A', name: 'Machine Single-Leg Extension', sets: 2, reps: [10, 15], later: true, step: 5, goals: [15, 15, 20, 20, 25], note: 'After squats' },
  { day: 'Lower A', name: 'Dumbbell Single-Leg Calf Raise', sets: 3, reps: [10, 15], later: false, step: 2.5, goals: [50, 52.5, 55, 57.5, 60], note: '1 s pause at bottom' },
  { day: 'Lower A', name: 'Machine Seated Crunch', sets: 2, reps: [10, 15], later: false, step: 2.5, goals: [27.5, 30, 32.5, 35, 37.5] },
  { day: 'Upper B', name: 'Dumbbell Bench Press', sets: 3, reps: [8, 12], later: false, step: 2.5, goals: [30, 30, 32.5, 35, 35], perHand: true },
  { day: 'Upper B', name: 'Cable Seated Row', sets: 3, reps: [8, 12], later: false, step: 4.5, goals: [50, 50, 55, 55, 59], note: 'Step = next pin' },
  { day: 'Upper B', name: 'Cable Seated Incline Fly', sets: 3, reps: [10, 15], later: true, step: 2.5, goals: [22.5, 22.5, 25, 25, 27.5], note: 'After DB bench' },
  { day: 'Upper B', name: 'Pull-Up', sets: 3, reps: [6, 10], later: true, step: 2.5, goals: [0, 0, 0, 5, 10], note: 'Weight = added kg', bodyweight: true },
  { day: 'Upper B', name: 'Dumbbell Lateral Raise', sets: 3, reps: [10, 15], later: false, step: 2.5, goals: [10, 10, 12.5, 12.5, 15] },
  { day: 'Upper B', name: 'Cable Reverse Fly', sets: 2, reps: [12, 15], later: false, step: 2.5, goals: [15, 15, 17.5, 17.5, 20] },
  { day: 'Upper B', name: 'Cable Single Arm Tricep Pushdown', sets: 2, reps: [10, 15], later: true, step: 2.5, goals: [20, 20, 22.5, 22.5, 25] },
  { day: 'Upper B', name: 'Cable Single Arm Curl', sets: 2, reps: [10, 15], later: true, step: 2.5, goals: [25, 25, 25, 27.5, 30] },
  { day: 'Lower B', name: 'Barbell Deadlift', sets: 3, reps: [5, 8], later: false, step: 5, goals: [70, 85, 97.5, 105, 115], note: 'Rebuilding' },
  { day: 'Lower B', name: 'DB Bulgarian Split Squat', aliases: ['Dumbbell Bulgarian Split Squat'], sets: 3, reps: [8, 12], later: true, step: 2.5, goals: [15, 17.5, 20, 22.5, 25], note: 'Reps per leg', perHand: true },
  { day: 'Lower B', name: 'Smith Machine Hip Thrust', sets: 3, reps: [8, 12], later: true, step: 5, goals: [150, 155, 160, 170, 180] },
  { day: 'Lower B', name: 'Machine Seated Hip Adduction', sets: 2, reps: [12, 15], later: false, step: 5, goals: [15, 20, 25, 30, 35] },
  { day: 'Lower B', name: 'Plate-Loaded Shrug', sets: 3, reps: [10, 15], later: true, step: 5, goals: [60, 60, 65, 70, 75], note: 'After deadlifts' },
  { day: 'Lower B', name: 'Machine Seated Crunch (Arm Pad Version)', sets: 2, reps: [10, 15], later: false, step: 2.5, goals: [27.5, 30, 32.5, 35, 37.5] },
];

/** Bodyweight and lean mass (kg) at each checkpoint. */
export const SEED_BODY: [weight: number, lean: number][] = [
  [71.5, 58.6],
  [73.5, 59.9],
  [75, 61.1],
  [76, 62.1],
  [77, 63.1],
];

export const SEED_HEIGHT_CM = 172;

const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);

/** The INSERTs the migration runs once. */
export function seedSql(now: number): string {
  const lines: string[] = [];
  SEED_CHECKPOINTS.forEach(([day, label]) => lines.push(`INSERT INTO checkpoints (day, label) VALUES (${q(day)}, ${q(label)});`));
  SEED_DAYS.forEach(([name, note], i) => lines.push(`INSERT INTO plan_days (id, name, position, note) VALUES (${i + 1}, ${q(name)}, ${i + 1}, ${q(note)});`));
  const positions = new Map<string, number>();
  SEED_EXERCISES.forEach((e, i) => {
    const dayId = SEED_DAYS.findIndex(([name]) => name === e.day) + 1;
    const position = (positions.get(e.day) ?? 0) + 1;
    positions.set(e.day, position);
    lines.push(
      `INSERT INTO plan_exercises (id, day_id, position, name, aliases, sets, rep_min, rep_max, step_kg, later_slot, per_hand, bodyweight, note, active, created_ms) VALUES (${i + 1}, ${dayId}, ${position}, ${q(e.name)}, ${q(JSON.stringify(e.aliases ?? []))}, ${e.sets}, ${e.reps[0]}, ${e.reps[1]}, ${e.step}, ${e.later ? 1 : 0}, ${e.perHand ? 1 : 0}, ${e.bodyweight ? 1 : 0}, ${q(e.note ?? null)}, 1, ${now});`,
    );
    e.goals.forEach((w, c) => lines.push(`INSERT INTO exercise_goals (plan_exercise_id, day, weight_kg) VALUES (${i + 1}, ${q(SEED_CHECKPOINTS[c]![0])}, ${w});`));
  });
  SEED_BODY.forEach(([w, lean], c) => lines.push(`INSERT INTO body_goals (day, weight_kg, lean_kg) VALUES (${q(SEED_CHECKPOINTS[c]![0])}, ${w}, ${lean});`));
  lines.push(`INSERT INTO settings (key, value) VALUES ('training.heightCm', '${SEED_HEIGHT_CM}') ON CONFLICT (key) DO NOTHING;`);
  return lines.join('\n');
}
