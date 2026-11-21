# رقيب · Gym

The workout page for the phone: today's plan day a set at a time, a rest timer between
sets, and a summary when you finish. The app is static (Vite, hosted on Vercel); the
data and the functions live in Convex. The progression engine is the PC's own
(`../tracker/src/progression.ts` and `trainingPlan.ts`), so the phone and رقيب always
give the same suggestion.

## Run it on this PC

```
npm install
npx convex dev          # first time: pick "start without an account" for a local backend
npm run dev             # http://localhost:5173
```

`.env.local` holds the Convex URL and, locally, the test keys. Set them on the backend:

```
npx convex env set GYM_KEY <long random text>    # what you type on the phone, once
npx convex env set SYNC_KEY <other long random text>
SYNC_KEY=<same> npm run push-from-pc           # copies the plan and history from رقيب
npm run check-parity                             # the cloud's suggestions match the PC's
```

## Put it on the web (free tiers)

1. **Convex.** `npx convex login`, then `npx convex dev --configure=new` to make a cloud
   project, and `npx convex deploy` for its production deployment. Set the keys there:
   `npx convex env set GYM_KEY … --prod` and `npx convex env set SYNC_KEY … --prod`.
2. **Your data.** Put `{ "url": "<production URL>", "syncKey": "…" }` in
   `~/.activity-tracker/gym-sync.json`. رقيب then sends the plan and workouts when it starts
   and when its window opens (at most every 5 minutes; results in its log). `raqib gym-sync`
   does it now and prints the result. `CONVEX_URL=… SYNC_KEY=… npm run push-from-pc` still works.
3. **Vercel.** Import the GitHub repo, set *Root Directory* to `gym`, and keep *Include
   files outside the root directory* on (the functions import `../tracker/src`). Build
   command: `npx convex deploy --cmd 'npm run build'`, output `dist`. Add the
   `CONVEX_DEPLOY_KEY` environment variable (Convex dashboard → Settings → Deploy key).
4. **The phone.** Open the Vercel link, enter the gym key, then *Add to Home Screen*.

## How it fits together

- `convex/schema.ts`: the plan and workouts, mirrored from رقيب's SQLite tables. Ids stay
  numbers: PC ones keep the PC's id, ones logged here count up from 100,000,000.
- `convex/lib/source.ts`: the cloud's data as the engine's `TrainingSource`.
- `convex/plans.ts`: plans, each with its own days and exercises, edited on the phone. One
  plan is active and "today" follows it. A lift keeps its history across plans: sessions
  from another plan count as history, so switching plans doesn't reset weights.
  `push-from-pc` sends the PC's plan up only the first time (as "Main plan"); after that the
  phone owns plans (`-- --replace-plan` overwrites them with the PC's).
- `convex/training.ts`: today, log a set, remove a set, rest length, finish, summary, past.
- Supersets (`supersets` table; a plan exercise's `supersetNum` and `supersetOrder`): two or
  more lifts on a day done in rounds, a set of A1, a set of A2, then one rest (each superset
  has its own). Sets are still logged to each exercise, so history and progress stay per
  lift. `convex/lib/supersets.ts` letters and orders them; `src/supersetFlow.ts` says whose
  turn it is. Made and edited in the plan editor (*Superset with next*, *Leave superset*).
- `convex/migrations.ts`: one-off data changes, run by hand (`npx convex run migrations:<name>`,
  add `--prod` for the deployed one). `calvesV1` is the calf day of `tracker/src/calfWork.ts`.
- `convex/strength.ts`: the strength score and strength balance (#/strength), from the
  shared `../tracker/src/strength.ts`. Each muscle group's best lift in 90 days, as a 1RM
  on its reference lift for your bodyweight, scored 100 points per level (Beginner …
  Elite); the overall score is the mean of upper and lower body.
- `convex/sync.ts`: what the PC calls with the sync key (push the plan and history; later,
  pull what was logged here).
- `src/`: the page. `timer.ts` counts down to a time rather than by ticks, so a locked
  screen can't make it drift; it beeps, vibrates where the phone allows (not iPhones),
  and can keep the screen on.
