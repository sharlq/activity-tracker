// The training plan's data, as plain shapes: what trainingPlan.ts reads. Kept apart from
// journal.ts (and its database) so the cloud gym app can run the same engine on its own data.

/** Your weight on a day, with body fat and waist if you measured them. */
export interface WeighIn {
  day: string;
  weight: number;
  bodyFat: number | null;
  waist: number | null;
  note?: string | null;
  at: number;
}

export interface PlanDay {
  id: number;
  name: string;
  position: number;
  note: string | null;
}

export interface PlanExercise {
  id: number;
  dayId: number;
  position: number;
  name: string;
  /** Other names it goes by in history (as an old app spelled it). */
  aliases: string[];
  sets: number;
  repMin: number;
  repMax: number;
  step: number;
  laterSlot: boolean;
  perHand: boolean;
  /** Plates loaded on one side of a plate-loaded machine (no bar weight). */
  perSide: boolean;
  bodyweight: boolean;
  note: string | null;
  active: boolean;
  /** Goal weight at each checkpoint, by its day. */
  goals: { day: string; weight: number }[];
}

export interface CheckpointDay {
  day: string;
  label: string;
}

export interface BodyGoal {
  day: string;
  weight: number;
  lean: number | null;
}

/** A set of a planned exercise, with the workout it was in: what the plan's history is built from. */
export interface TrainingSet {
  setId: number;
  workoutId: number;
  day: string;
  planDayId: number | null;
  source: string;
  exercise: string;
  setNo: number;
  reps: number | null;
  weight: number | null;
  flag: string | null;
  formReset: boolean;
  note: string | null;
}

/** What trainingPlan.ts reads: the journal here, the cloud's own data in the gym app. */
export interface TrainingSource {
  planDays(): PlanDay[];
  planExercises(): PlanExercise[];
  /** Every set done under any of these names (case aside), oldest first, with its workout. */
  trainingSets(names: readonly string[]): TrainingSet[];
  /** The workout on a day done as a plan day, if there is one. */
  planWorkout(day: string, planDayId: number): { id: number } | null;
  checkpoints(): CheckpointDay[];
  bodyGoals(): BodyGoal[];
  weighIns(from: string, to: string): WeighIn[];
  /** Days with a strength workout, and how many, between two days. */
  strengthDays(from: string, to: string): { day: string; sessions: number }[];
  firstWorkoutDay(): string | null;
  get(key: string): unknown;
}
