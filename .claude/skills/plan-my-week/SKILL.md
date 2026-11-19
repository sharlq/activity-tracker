---
name: plan-my-week
description: Plan or re-plan the user's week (or the rest of this week) in رقيب (Raqib), within their fixed rules: the job block Mon–Fri 07:00–16:00, Wednesday football 17:45–21:00, the gym closed on Fridays, no family visits planned. Use whenever the user asks to plan, propose, reshape, or fix their week or upcoming days ("propose a plan for next week", "plan the rest of this week", "move the gym", "redo Wednesday"), and before sending any proposal with `propose`.
---

# Planning the user's week

A plan goes to رقيب as a **proposal**: aims for the week, and each day's aims and time blocks, each with a reason. It waits in the window under **Proposed plan** (one per week, with tabs when several wait) until the user applies the days they take. Nothing changes on their days before that. Commands run from `C:\Users\Asus\personal activity tracker` as `node tracker/dist/main.js <command>`; the `raqib` skill has the full command list.

## The rules (never break these)

Check every one before you send a proposal, and again after any change the user asks for.

1. **The job block: Monday to Friday, 07:00–16:00.** Plan nothing in it. Evenings on job days start at 16:00 at the earliest; most blocks start from 17:30. The job band in the window comes from Settings; if it ever differs from this, ask which is right.
2. **Wednesday football, every week.** Exactly these three blocks, and nothing else from 17:45 to 21:00:
   - `17:45–18:30` "Commute and get ready for football" (`commute`)
   - `18:30–20:30` "Football match" (`exercise`)
   - `20:30–21:00` "Commute back, talk with the guys" (`social`)

   The match counts as a training session, and as a leg-heavy day.
3. **The gym is closed on Fridays.** Never put a gym session on a Friday. Friday evenings are good for focused work or rest instead.
4. **No family visits.** Don't plan visits to their grandmother or similar family visits, in blocks or aims, even if an old goal about one was missed. They said this is beyond what they can plan. Plan one only if they ask for it themselves.

## Habits to keep (unless they say otherwise)

- **Worry slot and evening check-in, 22:00–22:20, every day** (`other`). It's their own habit.
- **Bed by 00:15 before a work day**: a `23:45–00:15` "Wind down for bed" block (`sleep routine`) on Sunday to Thursday nights. They've been going to bed around 01:00, so move it earlier gradually, not all at once.
- **Gym: a 4-day split** (Upper A, Lower A, Upper B, Lower B; `plan overview` lists them). Sessions are 75 minutes, at 17:30 on job days or in the afternoon on weekends. Keep at least a day between two leg days, and count Wednesday football as one. A week that fits all the rules: Mon Lower A, Wed football, Thu Upper A, Sat Lower B, Sun Upper B. If four sessions don't fit, say so and propose three.
- **One focused project block per evening**, about 90 minutes, two at most. Their focus has been about 2h a day lately, so a plan that asks for much more won't hold.
- Leave at least one evening free, and don't fill every weekend hour.

## Steps

1. **Read the week ahead:**
   - `week` (and the week before) for focus, sleep, phone time, goals met, and what stood out.
   - `projects`, then `project show <id>` for anything with a deadline, and `targets <date>` for each day (due posts, slides).
   - `exercise` and `plan overview` for training. `plan progress` shows sessions a week.
   - For days already planned or with goals, read them from the journal (the `plan` command shows the gym plan, not the day plan). Use a goal's exact text as a day aim so applying doesn't add it twice.
   - The clock: when planning the rest of this week, start from now. Tonight gets only what fits before bed.
2. **Shape it:** up to 5 week aims that are outcomes, not activities ("Ready for a full practice exam", not "Study"), each with a `how` line. Each day gets up to 3 aims, each pointing at the week aim it serves (`"aim": 1`) or standing alone, plus its blocks, each with a `why` line. Use categories from the `raqib` skill (`learning`, `debate`, `work`, `exercise`, `meal`, `social`, `commute`, `sleep routine`, `other`; `focus` means any focused work).
3. **Check it against every rule above.** Then write the file in your scratchpad directory:
   ```json
   {
     "week": "2026-11-23",
     "note": "Why the week is shaped this way, in two or three sentences.",
     "basedOn": ["Job 07:00–16:00, Mon–Fri", "Football Wed 18:30–20:30", "Gym closed Fri"],
     "aims": [{ "text": "Ready for a full practice exam", "how": "Two topics by Wednesday, the exam on Saturday" }],
     "days": {
       "2026-11-23": {
         "aims": [{ "text": "Finish notes on networking", "aim": 1 }, "Call the bank"],
         "blocks": [{ "start": "17:30", "end": "18:45", "label": "Gym: Lower A", "category": "exercise", "why": "Straight after the job." }]
       }
     }
   }
   ```
   `week` is the Monday. Days must fall in that week and not be past. Blocks can't overlap, and an end before the start runs past midnight. A day aim can be plain text. `basedOn` items are at most 60 characters.
4. **`propose --file <path> --dry-run`**, fix what it lists, read the warnings, then run it without `--dry-run`. A newer proposal for the same week replaces the one waiting; other weeks keep theirs.
5. **Tell the user briefly** the week aims and the shape of each day, as a short day-by-day list, and that it's waiting under Proposed plan. Name any rule that shaped a choice ("no gym Friday, so Lower B moves to Saturday"). If they ask for changes, edit the same file, check the rules again, and propose again.
6. **Afterwards:** in the weekly review, `aims` lists the week aims; mark each with `aim met|partly|missed <id>`.

## When the user adds a rule

When they state a new standing restriction ("I can't train on Mondays", "keep Sunday mornings free"), add it to **The rules** or **Habits to keep** above in their words, and re-check any proposal still waiting against it.
