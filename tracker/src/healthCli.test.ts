import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { healthText, mealForHour } from './healthCli.ts';
import type { HealthView } from './uiHealth.ts';

describe('health from the command line', () => {
  it('picks the meal by the clock', () => {
    assert.deepEqual([7, 13, 19, 23].map(mealForHour), ['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('reads out the day in meal order, against targets, with the weight trend', () => {
    const food = (id: number, meal: 'breakfast' | 'lunch', name: string, calories: number | null) => ({ id, day: '2026-11-14', meal, name, calories, protein: null, carbs: null, fat: null, at: 0 });
    const view: HealthView = {
      day: '2026-11-14',
      foods: [food(1, 'lunch', 'Machboos', 650), food(2, 'breakfast', 'Dates', null)],
      totals: { calories: 650, protein: 0, carbs: 0, fat: 0 },
      targets: { calories: 600, protein: null },
      weighIn: null,
      weights: [
        { day: '2026-11-01', weight: 82, bodyFat: null, waist: null, at: 0 },
        { day: '2026-11-14', weight: 81.2, bodyFat: 21.5, waist: null, at: 0 },
      ],
      week: [{ day: '2026-11-14', calories: 650, protein: 0, items: 2 }],
      recent: [],
    };
    const text = healthText(view);
    assert.match(text, /650 kcal of 600 kcal \(50 kcal over\)/);
    assert.ok(text.indexOf('Dates  (no amounts)') < text.indexOf('Machboos'));
    assert.match(text, /81\.2 kg on 2026-11-14 · body fat 21\.5% \(-0\.8 kg since 2026-11-01\)/);
  });
});
