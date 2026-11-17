// The gym app's data: training plans (each with its own days) and every workout, mirrored from رقيب's SQLite
// tables. Ids stay numbers (`num`) because the shared engine (tracker/src/trainingPlan.ts)
// works in numbers; what came from the PC keeps the PC's id, what's logged here counts up
// from 100,000,000 so the two never meet. A workout keeps its sets inside it.
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const nullable = <T extends Parameters<typeof v.union>[0]>(t: T) => v.union(t, v.null());

export const set = v.object({
  num: v.number(),
  exercise: v.string(),
  position: v.number(),
  setNo: v.number(),
  reps: nullable(v.number()),
  weight: nullable(v.number()),
  rpe: nullable(v.number()),
  seconds: nullable(v.number()),
  distance: nullable(v.number()),
  flag: nullable(v.string()),
  /** When it was logged here (ms); null for sets that came from the PC. */
  at: nullable(v.number()),
});

export const exerciseLog = v.object({ exercise: v.string(), formReset: v.boolean(), note: nullable(v.string()) });

export const workoutFields = {
  num: v.number(),
  day: v.string(),
  start: nullable(v.number()),
  /** When "Finish workout" was pressed. */
  end: nullable(v.number()),
  name: v.string(),
  kind: v.string(),
  minutes: nullable(v.number()),
  calories: nullable(v.number()),
  note: nullable(v.string()),
  /** 'manual' (logged by hand, here or on the PC) or the app it came from ('caliber'). */
  source: v.string(),
  externalId: nullable(v.string()),
  planDayNum: nullable(v.number()),
  sets: v.array(set),
  logs: v.array(exerciseLog),
  createdAt: v.number(),
  /** Last change, so the PC can fetch only what changed. */
  updatedAt: v.number(),
  /** Where it started: 'pc' (pushed from رقيب) or 'gym' (logged here). */
  origin: v.string(),
  /** Removed in the app: kept (empty) so the PC's sync learns it's gone. */
  deleted: v.optional(v.boolean()),
};

export const planExerciseFields = {
  num: v.number(),
  dayNum: v.number(),
  position: v.number(),
  name: v.string(),
  aliases: v.array(v.string()),
  sets: v.number(),
  repMin: v.number(),
  repMax: v.number(),
  step: v.number(),
  laterSlot: v.boolean(),
  perHand: v.boolean(),
  /** Weight is the plates on one side of a plate-loaded machine; missing is false. */
  perSide: v.optional(v.boolean()),
  bodyweight: v.boolean(),
  note: nullable(v.string()),
  active: v.boolean(),
  /** Rest between sets, in seconds: the timer's length. */
  restSeconds: v.number(),
  goals: v.array(v.object({ day: v.string(), weight: v.number() })),
};

export default defineSchema({
  /** Plans, each with its own days; the active one is what "today" follows. */
  plans: defineTable({ num: v.number(), name: v.string(), note: nullable(v.string()), active: v.boolean(), createdAt: v.number() }).index('by_num', ['num']),
  planDays: defineTable({ num: v.number(), planNum: v.number(), name: v.string(), position: v.number(), note: nullable(v.string()) }).index('by_num', ['num']).index('by_plan', ['planNum']),
  planExercises: defineTable(planExerciseFields).index('by_num', ['num']),
  workouts: defineTable(workoutFields).index('by_num', ['num']).index('by_day', ['day']).index('by_updated', ['updatedAt']),
  checkpoints: defineTable({ day: v.string(), label: v.string() }).index('by_day', ['day']),
  bodyGoals: defineTable({ day: v.string(), weight: v.number(), lean: nullable(v.number()) }).index('by_day', ['day']),
  weighIns: defineTable({ day: v.string(), weight: v.number(), bodyFat: nullable(v.number()), waist: nullable(v.number()), note: nullable(v.string()), at: v.number() }).index('by_day', ['day']),
  settings: defineTable({ key: v.string(), value: v.any() }).index('by_key', ['key']),
  counters: defineTable({ name: v.string(), value: v.number() }).index('by_name', ['name']),
});
