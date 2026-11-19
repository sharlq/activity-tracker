// Which muscles a plan works, and how much: the gym app's plan summary (#/plans/<num>/summary)
// and the window's Plans tab both use it.
// Each exercise is matched by name to the muscles it trains: a set counts in full for its
// main muscles and as half a set for the ones that help (bench press: chest, with triceps
// and front delts helping), the usual way weekly volume is counted. A plan is taken as one
// pass through its days a week.

export type Muscle =
  | 'Chest' | 'Lats' | 'Upper back' | 'Traps' | 'Front delts' | 'Side delts' | 'Rear delts' | 'Biceps' | 'Triceps' | 'Forearms'
  | 'Abs' | 'Lower back' | 'Quads' | 'Hamstrings' | 'Glutes' | 'Adductors' | 'Calves';

/** In the order the summary lists them: upper body, then trunk, then lower body. */
export const MUSCLES: readonly Muscle[] = [
  'Chest', 'Lats', 'Upper back', 'Traps', 'Front delts', 'Side delts', 'Rear delts', 'Biceps', 'Triceps', 'Forearms',
  'Abs', 'Lower back', 'Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves',
];

/** The muscles a growth range (about 10–20 hard sets, twice a week) is judged for. Small helpers are shown without one. */
export const JUDGED: ReadonlySet<Muscle> = new Set<Muscle>(['Chest', 'Lats', 'Upper back', 'Side delts', 'Rear delts', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes']);

export interface Works {
  main: Muscle[];
  helps: Muscle[];
}

const W = (main: Muscle[], helps: Muscle[] = []): Works => ({ main, helps });

/** First match wins, so the more specific names come first (leg curl before curl, reverse fly before fly). */
const RULES: [RegExp, Works][] = [
  [/leg curl|hamstring curl|nordic/, W(['Hamstrings'])],
  [/leg extension/, W(['Quads'])],
  [/calf/, W(['Calves'])],
  [/adduct/, W(['Adductors'])],
  [/abduct|kickback|glute bridge|hip thrust/, W(['Glutes'], ['Hamstrings'])],
  [/romanian|rdl|stiff[- ]leg|good morning/, W(['Hamstrings', 'Glutes'], ['Lower back'])],
  [/deadlift/, W(['Glutes', 'Hamstrings', 'Lower back'], ['Quads', 'Traps'])],
  [/split squat|lunge|step[- ]up/, W(['Quads', 'Glutes'], ['Adductors'])],
  [/squat|leg press|hack/, W(['Quads'], ['Glutes', 'Adductors'])],
  [/back extension|hyperextension/, W(['Lower back'], ['Glutes', 'Hamstrings'])],
  [/crunch|sit-?up|leg raise|knee raise|plank|ab wheel|rollout|\babs?\b|wood ?chop|pallof/, W(['Abs'])],
  [/shrug/, W(['Traps'])],
  [/reverse fly|rear delt|face pull|\bt raise|y raise/, W(['Rear delts'], ['Upper back'])],
  [/lateral raise|side raise|upright row/, W(['Side delts'], ['Traps'])],
  [/front raise/, W(['Front delts'])],
  [/shoulder press|overhead press|military press|arnold|push press/, W(['Front delts'], ['Side delts', 'Triceps'])],
  [/fly|flye|pec deck|crossover/, W(['Chest'], ['Front delts'])],
  [/incline.*(press|push)/, W(['Chest', 'Front delts'], ['Triceps'])],
  [/bench press|chest press|push-?up|floor press/, W(['Chest'], ['Triceps', 'Front delts'])],
  [/\bdips?\b/, W(['Chest', 'Triceps'], ['Front delts'])],
  [/tricep|pushdown|skull ?crusher|close[- ]grip/, W(['Triceps'])],
  [/reverse curl|wrist curl|farmer|dead hang/, W(['Forearms'], ['Biceps'])],
  [/curl/, W(['Biceps'], ['Forearms'])],
  [/pulldown|pull-?up|chin-?up|pullover|lat /, W(['Lats'], ['Biceps', 'Upper back'])],
  [/row/, W(['Upper back', 'Lats'], ['Biceps', 'Rear delts'])],
];

/** What an exercise trains; null when its name isn't recognised. */
export function works(exercise: string): Works | null {
  const n = exercise.toLowerCase();
  return RULES.find(([re]) => re.test(n))?.[1] ?? null;
}

export interface Contribution {
  day: string;
  exercise: string;
  sets: number;
  main: boolean;
}

export interface MuscleLoad {
  muscle: Muscle;
  /** Sets where this is a main muscle. */
  direct: number;
  /** Sets where it helps (each counts as half in `total`). */
  indirect: number;
  /** direct + indirect / 2. */
  total: number;
  /** Days a week with at least one direct set. */
  days: number;
  /** Days a week it gets only helper work. */
  helperDays: number;
  from: Contribution[];
}

export interface PlanLoad {
  muscles: MuscleLoad[];
  /** Exercises whose names weren't matched, so they aren't counted. */
  unknown: { day: string; exercise: string }[];
  days: { name: string; sets: number }[];
}

export function planLoad(days: { name: string; exercises: { name: string; sets: number }[] }[]): PlanLoad {
  const rows = new Map<Muscle, MuscleLoad>(MUSCLES.map((m) => [m, { muscle: m, direct: 0, indirect: 0, total: 0, days: 0, helperDays: 0, from: [] }]));
  const unknown: PlanLoad['unknown'] = [];
  for (const d of days) {
    const direct = new Set<Muscle>();
    const helped = new Set<Muscle>();
    for (const e of d.exercises) {
      const w = works(e.name);
      if (!w) {
        unknown.push({ day: d.name, exercise: e.name });
        continue;
      }
      for (const m of w.main) {
        const r = rows.get(m)!;
        r.direct += e.sets;
        r.from.push({ day: d.name, exercise: e.name, sets: e.sets, main: true });
        direct.add(m);
      }
      for (const m of w.helps) {
        if (w.main.includes(m)) continue;
        const r = rows.get(m)!;
        r.indirect += e.sets;
        r.from.push({ day: d.name, exercise: e.name, sets: e.sets, main: false });
        helped.add(m);
      }
    }
    for (const m of direct) rows.get(m)!.days++;
    for (const m of helped) if (!direct.has(m)) rows.get(m)!.helperDays++;
  }
  for (const r of rows.values()) r.total = r.direct + r.indirect / 2;
  return {
    muscles: [...rows.values()],
    unknown,
    days: days.map((d) => ({ name: d.name, sets: d.exercises.reduce((n, e) => n + e.sets, 0) })),
  };
}

export type Verdict = 'low' | 'ok' | 'high' | 'once' | null;

/** A rough read against about 10–20 sets and two days a week; null for muscles that aren't judged. */
export function verdict(r: MuscleLoad): Verdict {
  if (!JUDGED.has(r.muscle)) return null;
  if (r.total < 8) return 'low';
  if (r.total > 22) return 'high';
  if (r.days < 2) return 'once';
  return 'ok';
}
