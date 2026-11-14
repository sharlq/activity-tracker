---
name: raqib
description: Read and fill in the user's day in رقيب (Raqib), their local activity tracker. Use when the user wants to log their day or the gaps in it, says what they did at some time ("I was at the gym from 6 to 7"), asks how their day, yesterday, or week went, wants a weekly review, talks about their sleep, mood, or energy, sets or reviews the day's goals, or wants to add, tick off, or remove tasks or reminders (medicine, water, anything recurring). Also for their projects: creating or planning one (an exam, a side project, studying N slides by a date), reporting progress on one ("I did 20 anatomy slides"), asking how a project is going, or re-planning when they fall behind. Also for health: logging what they ate ("I had machboos for lunch"), their weight or body measurements, workouts ("I trained legs for an hour", sets and weights, importing from Caliber), calorie or protein targets, or asking how their eating or weight is going. Also for "رقيب", "raqib", "my day log", "evening log", "weekly review", "my projects".
---

# رقيب: logging the user's day

رقيب records what's on the PC screen and what's playing. It can't see time away from the PC, so the user fills that in: as "entries" (a time span plus what they did). They also keep daily tasks, reminders, projects, and health (food, weight, and workouts) there. You read and write all of it with commands run from the project folder `C:\Users\Asus\personal activity tracker`.

Run them as `node tracker/dist/main.js <command>` from that folder (the same as `npm run raqib -- <command>`, with less noise). They write straight to the database, whether رقيب is running or not, and its window shows the changes within a minute.

## Commands

| What | Command |
| --- | --- |
| The day: summary, PC timeline, sound playing, gaps still to log, entries (with ids), tasks (with ids) | `day [today\|yesterday\|YYYY-MM-DD]` (add `--json` for every figure) |
| Log what they did | `log 07:15-09:00 "Breakfast and coffee" --category meal [--date YYYY-MM-DD]` |
| Remove an entry | `unlog <id>` |
| Tasks | `tasks [date]`, `task add "text" [--date D]`, `task done <id>`, `task undo <id>`, `task rm <id>` |
| Mood and energy (1 low to 5 great), morning or evening | `checkin morning\|evening --mood 4 --energy 3 [--note "..."] [--date D]` |
| Goals: up to three bigger aims a day | `goals [date]`, `goal add "text" [--date D]`, `goal met\|partly\|missed\|clear <id>`, `goal rm <id>` |
| The day's plan: time blocks, each held up against what happened (kept, partly, missed) | `plan [date]`, `plan add 09:00-11:00 "Study AWS" --category study [--date tomorrow]`, `plan rm <id>`, `plan copy [from] [--to D]` (same clock times; default yesterday to today) |
| Sleep: the night the user woke from that day | `sleep [date]` (logged, or estimated from the PC; log it as an entry with `--category sleep` to confirm) |
| The week (Monday to Sunday): weekly review | `week [date] [--json]` |
| Reminders | `reminders`, `remind add "text" --every 1h [--from 09:00 --until 22:00] [--days mon,tue\|weekdays]`, `remind add "text" --at 09:00,21:00`, `remind on\|off\|rm <id>` |
| Projects: list with progress, today's answer per project, neglect warnings | `projects [--all] [--date D] [--json]` |
| One project: sub-tasks (with ids), pace to the due date, projected finish, the plan day by day, ahead/behind | `project show <id> [--json]` |
| Make or change a project | `project add "name" [--due D]`, `project rename <id> "name"`, `project due <id> D\|none`, `project pause\|resume\|done\|rm <id>` |
| Sub-tasks | `sub add <project id> "title" [--total 120 --unit slides] [--due D]` (no total = checkbox), `sub edit <id> [--title ..] [--total N] [--unit U] [--due D\|none]`, `sub done\|undo <id> [--date D]`, `sub rm <id>` |
| PC time that counts toward a project automatically | `project match <id> "AWS Certified, aws.amazon.com, FoxitPDFReader"` (window title words, sites, apps, editor workspaces; `none` clears) |
| Health: the day's food (with ids) against targets, weight trend, calories over the last 7 days | `health [date] [--json]` |
| Log something eaten | `food add "Chicken machboos" --meal lunch --kcal 650 --protein 40 [--carbs 75] [--fat 18] [--date D]` (meal: breakfast, lunch, dinner, snack; defaults by the clock), `food rm <id>` |
| Weight (kg) and measurements, one a day | `weigh 81.2 [--bodyfat 21.5] [--waist 90] [--date D]` (again the same day updates it and keeps measurements not given; `none` clears one), `weigh rm [--date D]` |
| Daily targets | `health target --kcal 2200 --protein 140` (`none` clears one) |
| Exercise: the day's workouts with workout and set ids, the last 7 days, and each exercise's best set and last time | `exercise [date] [--json]` |
| Log a workout | `workout add "Push day" [--kind strength\|run\|walk\|cycle\|swim\|sport\|other] [--min 55] [--kcal 300] [--at 18:30] [--note "..."] [--date D]`, `workout edit <id> [--name ..] [--kind ..] [--min ..] [--note ..\|none]`, `workout rm <id>` |
| Its sets | `workout set <workout id> "Bench press" 3x8@60 [1x6@65] [--lb]` (`8@62.5`, `8/8/6@60` = one set each, `3x10` bodyweight, `3x45s` timed, `5km`), `workout unset <set id>` |
| Import from Caliber (or another app) | `workout import <file> [more files] [--units kg\|lb] [--dates mdy\|dmy] --dry-run`, then without `--dry-run`. Caliber's `strength_workouts.csv` and `cardio_activities.csv` are recognised by their headers |
| The training plan: what to lift next | `plan [--day "Upper A"]` (weight to use, reps to beat, last verdict, flags), `plan overview` (every exercise against its next goal), `plan progress` (sessions a week, % on track, quarterly change, bodyweight vs target). Add `--json` to read it exactly. The engine is `tracker/src/progression.ts`; plan and goals are editable in the window (Health › Exercise › Plan, and each exercise's page) |
| Copy the database now | `backup` (one is also made each day) |
| What they did on a project that day | `progress <sub id> +15\|-3\|=12 [--date D]` (measured), `sub done <id>` (checkbox), `project note <id> "what they did" [--date D]`, `project skip <id> [--date D]` ("nothing today") |
| A whole plan at once | `project create --file plan.json [--dry-run]`, `project plan <id> --file plan.json [--dry-run]`, `targets [date] [--json]` (the day's targets) |

- Times are 24-hour `HH:MM`. An end before the start means past midnight (`23:30-01:00`), stored from `--date`'s day.
- `--date` takes `YYYY-MM-DD`, `today`, `yesterday`, or `tomorrow`, and defaults to today. Logging late at night about "this morning" is still today; after midnight, the user's "today" may mean yesterday: check the clock and ask if unsure.
- Categories (optional, but use one when it's clear): `sleep`, `in bed` (in bed but awake: scrolling, can't fall asleep, lying in after waking; not counted as sleep), `sleep routine` (getting ready for bed: shower, teeth, wind-down), `meal`, `exercise`, `errand`, `commute`, `social`, `rest`, `prayer`, `chores`, `study`, `work`, `learning`, `debate`, `social media`, `video`, `news`, `entertainment` (chosen downtime: a film, a series; neutral, not a distraction), `gaming`, `messaging`, `other`. Time on the phone is usually `social media`.
- Quote text arguments. In PowerShell use single quotes; in bash, double quotes.
- **Phone time** counts as distraction only when logged as an entry whose label says phone and whose category is a distraction one: `log 12:00-12:44 "Phone: Instagram/TikTok/WhatsApp" --category "social media"`. Use `Phone: <apps>` labels so the day can name what it was; productivity or utility apps go under `other`.

## Logging a day with the user

1. Run `day` for the day in question and read the **Gaps to log** section. Each gap is time with no active PC use that isn't logged yet; "PC on but untouched, X on screen" means the PC was idle with X in front (they may have been reading or watching, or away).
2. Show the user the gaps in a short list (time span, length, what the PC knew) and ask what they were doing. Ask about several at once; don't interrogate one by one.
3. Turn their answer into entries. Split a gap when they describe several things ("breakfast till 8, then drove to work" → two entries). Use their words for the label, short and in their language. If they give rough times ("around 7"), use them as given; don't invent precision they didn't give.
4. Log each with `log`. Then run `day` again and confirm briefly what's now logged and what's still open.
5. Sleep: if the **Sleep** section says "estimated", ask whether that's right and log it as `sleep` (bedtime's day as `--date`; an end before the start runs past midnight). If it's unknown, ask when they slept.
6. If the day has no evening check-in, ask how they felt (mood and energy, 1 to 5) and log it with `checkin evening`. If they describe their mood in words, map it ("rough day" ≈ 2, "pretty good" ≈ 4) and say what you logged. Put what affected it in `--note`, in their words.
7. If the day has goals, ask how each went and mark it `met`, `partly`, or `missed`. Ask for tomorrow's goals only if they bring up plans.
8. If the day had a plan, `day` shows it under **Plan**: say briefly how it held up (the blocks kept, and what filled the missed ones). Then, in the evening, ask for **tomorrow's plan**: the main blocks with rough times ("gym 7 to 8, study 9 to 11, work after lunch"). Add each with `plan add ... --date tomorrow`, with a category when it's clear (`focus` means any focused work). If `plan tomorrow` shows a plan already, read it back and ask what's changed.
9. If they mention plans or things to do, offer to add them as tasks; if they mention something recurring (pills twice a day), offer a reminder.

## Mornings

For "plan my day" or a morning chat: run `day yesterday` for a short recap (including how yesterday's plan held up) and `sleep` for last night, then ask how they feel (`checkin morning`). Run `plan`: if last night left a plan, read it back and ask what's changed (`plan rm`, then `plan add`, to move a block); if not, ask them to lay out the day in blocks (`plan add`), or offer `plan copy` from yesterday. Then ask for up to three goals (`goal add`), and offer to bring over yesterday's unfinished tasks.

## Projects: what they did today

When logging a day (or whenever the user mentions working on something), run `projects` and, for each **active** project with "not answered yet", ask what they did on it today. Ask about all of them in one message, not one by one: this daily question is the point of projects, since the user has several and forgets some.

- If a project shows "On the PC today: 47m", say so when you ask ("47m on AWS at the PC today: how many slides?"). Time isn't progress: still ask for the amount, and never turn time into progress yourself.
- Turn answers into commands: "20 slides of anatomy" → `progress <slides sub id> +20`; "finished the summary" → `sub done <id>`; a description of the work → `project note <id> "..."` in their words; "didn't touch it" → `project skip <id>`. Use the sub-task ids from `projects`.
- If a project shows "⚠ not touched in N days", mention it gently once, and ask whether to pause it (`project pause`) if they're not working on it for now.
- If a sub-task has a target today, say how they did against it ("12 of 15 slides"). If `project show` says they're behind plan, offer to re-plan; don't re-plan on your own.

## Planning a project

When the user wants to start or plan a project ("I have an exam on the 28th, plan it for me"):

1. **Ask what you need, in one message:** the deadline; what the work is, made countable (how many slides, pages, chapters, past papers, problems; things that are just done or not are checkboxes); how much time they have on a normal day and on weekends; days they can't work. If they don't know a count, ask for a rough one; don't invent it.
2. **Check their real capacity** if useful: `week` shows their recent focus time a day. Keep daily targets something they can actually do, and leave a buffer of a day or two before the deadline (more for long projects). Put review or practice (past papers, a summary sheet) after the material it depends on.
3. **Show the plan in chat before creating anything:** the sub-tasks with totals and units, milestone dates, and the daily schedule in a compact form ("Mon–Thu 15 slides a day, Fri off, weekends 2 past papers"). Say how much a day it asks and whether there's any slack. Wait for their yes; adjust if they ask.
4. **Write the plan file** in your scratchpad directory (never in the project folder) as JSON:
   ```json
   {
     "name": "Anatomy exam",
     "due": "2026-11-28",
     "subtasks": [
       { "title": "Lecture slides", "total": 120, "unit": "slides", "due": "2026-11-20",
         "targets": { "2026-11-11": 15, "2026-11-12": 15 } },
       { "title": "Past papers", "total": 8, "unit": "papers", "due": "2026-11-26" },
       { "title": "Summary sheet", "due": "2026-11-27", "targets": { "2026-11-27": 1 } }
     ]
   }
   ```
   Rules: dates are `YYYY-MM-DD`, from today on; amounts are whole numbers above 0; a sub-task's targets can't add up to more than its total; a checkbox (no `total`) is planned for at most one day with amount 1; a `unit` needs a `total`. List every planned day explicitly (there's no "repeat" shorthand). Keep titles short and in the user's language.
5. **Run `project create --file <path> --dry-run` first.** Fix any problems it lists; read the warnings (a plan covering less than the total is fine if that's what you agreed, but say so). Then run it without `--dry-run`, and show the user the result briefly.
6. Ask what the work looks like on the PC (a PDF's title, a site, an app, an editor folder) and offer to set `project match` so that time counts automatically. Use words specific enough not to catch other things ("AWS Certified", not "AWS").
7. Only if they ask, add today's targets to their day's tasks with `task add`.

**Re-planning** ("I fell behind", "plan my anatomy again"): run `project show <id> --json` to see what's done and left, propose new targets for the remaining days, and once they agree, write a file with the existing sub-tasks by `"id"` and only what changes (fields left out stay as they are; targets are replaced from today on; past days and progress are never touched), plus any new sub-tasks without an id. `--dry-run`, then `project plan <id> --file <path>`.

## Health: food, weight, and exercise

When the user says what they ate, log each thing with `food add`, one entry per dish or item, named in their words and language ("2 eggs and toast", "كرك"). Use the meal they name, or the time they ate; if neither, leave it to the clock default unless it's clearly wrong (a late-night report of lunch).

- **Amounts:** use what they give. If they don't give amounts, estimate calories and protein (and carbs and fat when you can) for a typical portion, and tell them the numbers you logged in one short line so they can correct them ("logged ~650 kcal, 40 g protein for the machboos"). If they correct you, `food rm` and add it again. If they'd rather not track amounts, log the name alone.
- **Weight:** `weigh` in kg. If they give pounds, convert (÷ 2.2046) and say so. Body fat is a percentage and waist is in cm; log them only when they give them.
- **Logging a day:** a `meal` entry in `log` is time spent eating; `food add` is what was eaten. When they describe a meal with times, do both.
- **"How am I doing?":** run `health` (and `health yesterday` or older days for a longer view). Report calories and protein against targets, the weight change over the weeks shown, and the 7-day average. Weight moves day to day with water and food; talk about the trend over a week or more, never one day's change. Don't comment on what they eat unless they ask, and never moralise about food or weight.
- **Workouts:** "I trained legs for an hour" → `workout add "Legs" --min 60` (with `--at` if they say when, and the matching `--kind` for a run, walk, or sport). If they list exercises, add each with `workout set <id> "Exercise" <sets>`, in their words and order; weights are kg unless they say pounds (then `--lb`). Don't invent sets or weights they didn't give: a workout with just a name and minutes is fine. If the time spent isn't in the day yet, also `log` it with `--category exercise`. For "how's my training", run `exercise` and report sessions and minutes this week, and records from the **Exercises** list (best set, last time); compare an exercise's last sets with its best only if they ask about progress.
- **Importing from Caliber:** run `workout import <file> --from caliber --dry-run` first and read it back: workouts found and their dates, the columns it recognised, the weight unit, warnings, and skipped rows. Settle any warning with the user (pounds or kg; month or day first in dates) and re-run the dry run with `--units` or `--dates`. Import only once it looks right. Importing again is safe: unchanged workouts are left alone, and one edited in the app since gets its sets replaced (a note added here is kept). Sessions over 6 hours are held back as likely typos: tell the user, and log the right time by hand with `workout add` if they confirm it. If the columns weren't recognised, show the user the file's header row; the mapping lives in `COLUMNS` in `tracker/src/workoutImport.ts`.
- Targets are theirs to set. If they ask what a target should be, give a general range and suggest checking with a doctor or dietitian for anything specific to them.

## Weekly review

For "how was my week" or a Sunday review, run `week` (or `week <a date in that week>`) and summarise: sleep (average, bedtime and how much it moved), mood and energy, focus against last week, goals met, the "What stood out" lines, and **Projects this week** (what moved on each, days worked, targets met, and any project nothing moved on: mention those, and ask whether to pause or re-plan them). Then ask the two review questions: what went well, and what to change next week. Their answers are saved in the window's Week page (there's no command for them; say so if they want them saved). Don't overstate patterns: with a week of data, say "this week" rather than "you always".

Mood notes can be personal. Read them only to help with what the user asked, and don't repeat them back unprompted.

Things that are already in the PC timeline (work, games, videos) don't need logging unless the user wants to add context. Never log something the user didn't say. Before `unlog`, `task rm`, `remind rm`, `project rm`, or `sub rm`, say what will be removed (these can't be undone, and a project or sub-task goes with all its progress and plan) unless the user just asked for exactly that.

## Reviewing a day

For "how was my day / yesterday", run `day` and summarise in a few lines: active and focused time, the main things done (PC timeline plus what they logged), tasks done out of total, background listening if any, and what's still unlogged. Keep window titles and site names to what helps; the user knows their own day.
