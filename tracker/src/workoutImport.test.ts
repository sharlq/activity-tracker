import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flattenJson, importWorkouts, matchColumns, parseCsv, readDate, readMinutes } from './workoutImport.ts';

describe('reading an export', () => {
  it('reads CSV with quotes, a BOM, CRLF, and semicolons', () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
    assert.deepEqual(parseCsv('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]);
  });

  it('matches headers loosely', () => {
    assert.deepEqual(matchColumns(['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight (lbs)', 'Reps']), {
      date: 'Date', workout: 'Workout Name', exercise: 'Exercise Name', setNo: 'Set Order', weight: 'Weight (lbs)', reps: 'Reps',
    });
  });

  it('reads dates in the usual shapes', () => {
    assert.deepEqual(readDate('2026-11-14'), { day: '2026-11-14', start: null, ambiguous: false });
    assert.equal(readDate('11/14/2026 6:30 PM')?.start, new Date(2026, 10, 14, 18, 30).getTime());
    assert.equal(readDate('14/11/2026')?.day, '2026-11-14'); // Can only be day first.
    assert.equal(readDate('03/04/2026', 'dmy')?.day, '2026-04-03');
    assert.equal(readDate('03/04/2026')?.ambiguous, true);
    assert.equal(readDate('nonsense'), null);
  });

  it('reads durations', () => {
    assert.equal(readMinutes('55'), 55);
    assert.equal(readMinutes('1:05:00'), 65);
    assert.equal(readMinutes('3300 s'), 55);
    assert.equal(readMinutes('3300', 'Duration (seconds)'), 55);
  });

  it('flattens nested JSON, carrying the workout down to each set', () => {
    const rows = flattenJson({ workouts: [{ name: 'Upper', date: '2026-11-10', exercises: [{ name: 'Bench', sets: [{ reps: 8, weight: 60 }, { reps: 6, weight: 65 }] }] }] });
    assert.deepEqual(rows, [
      { workoutname: 'Upper', date: '2026-11-10', exercisename: 'Bench', reps: 8, weight: 60 },
      { workoutname: 'Upper', date: '2026-11-10', exercisename: 'Bench', reps: 6, weight: 65 },
    ]);
  });
});

describe('importing workouts', () => {
  const csv = [
    'Date,Workout Name,Exercise Name,Set Order,Weight (lbs),Reps,Duration',
    '11/14/2026 6:30 PM,Upper A,Bench Press,1,135,8,55:00',
    '11/14/2026 6:30 PM,Upper A,Bench Press,2,135,8,55:00',
    '11/14/2026 6:30 PM,Upper A,"Row, Cable",1,120,10,55:00',
    '11/15/2026 7:00 PM,Lower A,Squat,1,185,5,1:02:00',
    'bad,Lower A,Squat,1,185,5,',
  ].join('\n');

  it('groups sets into workouts and exercises, in kg', () => {
    const result = importWorkouts(csv);
    assert.equal(result.unit, 'lb');
    assert.equal(result.workouts.length, 2);
    const [upper] = result.workouts;
    assert.equal(upper?.workout.name, 'Upper A');
    assert.equal(upper?.workout.kind, 'strength');
    assert.equal(upper?.workout.minutes, 55);
    assert.equal(upper?.workout.source, 'caliber');
    assert.deepEqual(upper?.exercises.map((e) => [e.name, e.sets.map((s) => [s.reps, s.weight])]), [
      ['Bench Press', [[8, 61.2], [8, 61.2]]],
      ['Row, Cable', [[10, 54.4]]],
    ]);
    assert.equal(result.skippedCount, 1);
    assert.match(result.skipped[0]?.why ?? '', /date/);
  });

  it('gives each workout the same id every time, for importing again', () => {
    assert.deepEqual(importWorkouts(csv).workouts.map((w) => w.workout.externalId), importWorkouts(csv).workouts.map((w) => w.workout.externalId));
    const withIds = importWorkouts('date,workout id,exercise,reps,weight kg\n2026-11-14,abc-1,Bench,8,60');
    assert.equal(withIds.workouts[0]?.workout.externalId, 'abc-1');
    assert.equal(withIds.unit, 'kg');
  });

  it('warns when the weight unit is not given, and reads a unit column', () => {
    assert.match(importWorkouts('date,exercise,reps,weight\n2026-11-14,Bench,8,60').warnings.join(), /kg or lb/);
    const perRow = importWorkouts('date,exercise,reps,weight,unit\n2026-11-14,Bench,8,135,lbs\n2026-11-14,Bench,8,60,kg');
    assert.deepEqual(perRow.workouts[0]?.exercises[0]?.sets.map((s) => s.weight), [61.2, 60]);
  });

  it('keeps a workout with no sets, like a run', () => {
    const result = importWorkouts('date,workout,type,duration,calories\n2026-11-14,Morning run,Running,32,310');
    assert.equal(result.workouts[0]?.workout.kind, 'run');
    assert.equal(result.workouts[0]?.workout.calories, 310);
    assert.deepEqual(result.workouts[0]?.exercises, []);
  });
});

describe("Caliber's own export", () => {
  const strength = [
    '"Date","Title","Exercise","Set #","Reps","Weight","Time"',
    '"2026-11-09","Back","Barbell Bent-Over Row","1","8","187.393",""',
    '"2026-11-09","Back","Barbell Bent-Over Row","2","7","187.393",""',
    '"2026-11-09","Back","Barbell Reverse Curl","1","9","55.1156",""',
    '"2024-01-02","Bi ,back and forearm ","Dead hang","1","","0.0","35"',
    '"2024-01-02","Bi ,back and forearm ","Pull Up","1","10","0.0",""',
  ].join('\n');
  const cardio = [
    '"Date","Title","Distance","Time","Calories","Level","Speed"',
    '"2026-07-08","Soccer","","3600","","",""',
    '"2025-08-17","HIIT","","1800","240","",""',
    '"2025-08-10","HIIT","","108000","260","",""',
    '"2024-07-24","Boxing","","5400","","",""',
  ].join('\n');

  it('reads strength workouts: pounds to kg, timed holds in seconds, one workout per day and title', () => {
    const result = importWorkouts(strength);
    assert.equal(result.profile, 'Caliber strength workouts');
    assert.equal(result.unit, 'lb');
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.workouts.map((w) => [w.workout.externalId, w.workout.name, w.workout.kind, w.workout.minutes]), [
      ['2026-11-09:Back', 'Back', 'strength', null],
      ['2024-01-02:Bi ,back and forearm', 'Bi ,back and forearm', 'strength', null],
    ]);
    assert.deepEqual(result.workouts[0]?.exercises.map((e) => [e.name, e.sets.map((s) => [s.reps, s.weight])]), [
      ['Barbell Bent-Over Row', [[8, 85], [7, 85]]],
      ['Barbell Reverse Curl', [[9, 25]]],
    ]);
    assert.deepEqual(result.workouts[1]?.exercises.map((e) => e.sets.map((s) => [s.reps, s.weight, s.seconds])), [[[null, null, 35]], [[10, null, null]]]);
  });

  it('reads cardio sessions, and holds back one too long to be right', () => {
    const result = importWorkouts(cardio);
    assert.equal(result.profile, 'Caliber cardio activities');
    assert.deepEqual(result.workouts.map((w) => [w.workout.externalId, w.workout.kind, w.workout.minutes, w.workout.calories, w.exercises.length]), [
      ['cardio:2026-07-08:Soccer', 'sport', 60, null, 0],
      ['cardio:2025-08-17:HIIT', 'other', 30, 240, 0],
      ['cardio:2024-07-24:Boxing', 'sport', 90, null, 0],
    ]);
    assert.deepEqual(result.flagged.map((f) => [f.row, f.day, f.name]), [[4, '2025-08-10', 'HIIT']]);
    assert.match(result.flagged[0]?.why ?? '', /30 hours/);
  });
});
