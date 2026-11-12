# رقيب (Raqib)

A local-only record of how you spend your day on your Windows PC. Nothing leaves the machine.

Tracks the app in front, idle time, games, Chrome sites, VS Code and Cursor projects, and
Claude Code sessions, plus music, podcasts, and videos playing in the background while you
do something else. Turns them into daily and weekly reports, and into a daily rhythm:

- **Morning:** the first time you're at the PC each morning, رقيب opens a page with
  last night's sleep, yesterday's summary, and asks how you feel, your goals for the day,
  and today's tasks.
- **Welcome back:** when you come back to the PC after a gap, a small window asks what you
  were doing while it's fresh.
- **Evening:** at 22:00 a notification sums up your day and asks you to log the gaps
  (time away from the PC, or idle at it), how you felt, and how your goals went.
- **Weekly review:** the week side by side: sleep, mood, energy, focus, goals, and what
  stood out, compared with the week before. On Sundays the evening notification offers it.
- **Reminders:** notifications every hour, or at set times, for medicine, water, or
  anything else.

## Setup

Requires Node.js 22.18 or newer on 64-bit Windows.

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

Then start it hidden at every login, and right away:

```bash
npm run raqib -- install
```

## Usage

Check that it's running, when it last recorded something, and how big the database is:

```bash
npm run raqib -- status
```

Pause recording for a while (`30m`, `2h`, `1h30m`), or end the pause early. A pause
survives restarts, and nothing at all is recorded during it:

```bash
npm run raqib -- pause 30m
```

```bash
npm run raqib -- resume
```

Stop it, start it again, or stop it from starting at login:

```bash
npm run raqib -- stop
```

```bash
npm run raqib -- start
```

```bash
npm run raqib -- uninstall
```

To watch it work instead, run it in a terminal (Ctrl+C stops it). Stop the hidden one
first, since only one tracker can record at a time:

```bash
npm start
```

### How autostart works

`install` registers a Task Scheduler task called "Raqib" that runs at
your login, as you, without admin rights. (It replaces the task from before the rename,
"Personal Activity Tracker", if that's still there.) It also adds **رقيب** to the Start
menu, which opens its window. It runs `wscript.exe` with a small generated
launcher, `%USERPROFILE%\.activity-tracker\launch-hidden.vbs`, because Node on its own
always opens a console window.

The launcher starts a supervisor, which starts the tracker and restarts it if it crashes:
after 1 second, then 2, 4, and so on up to a minute while it keeps crashing. Restarts are
logged. As a safety net in case the supervisor itself dies, the task checks every 5
minutes and starts it again. The task never times out and keeps running on battery.

After pulling new code, run `npm run build`, then `npm run raqib -- stop` and
`npm run raqib -- start` to switch to it.

See how you spent today, a given day, or this week (Monday to Sunday). Reports also show
background listening and, for a day, what you logged yourself:

```bash
npm run report
```

```bash
npm run report -- --date 2026-11-05
```

```bash
npm run report -- --week
```

Add `--md` to also write the report as Markdown, ready to paste into a chat:
`report-2026-11-06.md` in the current folder, or `--md some/file.md`. Reports name
categories, projects, games, sites, and apps, but never window titles or full addresses.

See the newest raw events:

```bash
npm run raqib -- recent 30
```

Permanently delete events, background sound, and logged entries that ended before a date,
and tasks, check-ins, goals, and weekly reviews for days before it:

```bash
npm run raqib -- purge --before 2026-01-01
```

List Claude Code sessions for a day (today if no date is given):

```bash
npm run raqib -- claude --date 2026-11-05
```

Data lives in `%USERPROFILE%\.activity-tracker\`: `data.db` holds the events, and
`logs\tracker.log` is the log (rotated at 5 MB, 5 old files kept). Logs contain service
state only, never window titles or paths.

## رقيب's window

Open it from the Start menu, from a notification, or with:

```bash
npm run raqib -- open
```

Add `morning`, `evening`, `week`, `projects`, `reminders`, or `settings` to open that page. The window
is a page served by رقيب itself on 127.0.0.1, shown in a Chrome (or Edge) app window.

- **Today:** the day as three lanes: what was on screen, what was playing, and what you
  logged. Below it: the gaps still to log, mood and energy, the day's goals, last night's
  sleep, your tasks, multitasking, and where the PC time went. Use the arrows to look at
  earlier days.
- **Morning:** last night's sleep (confirm the estimate or correct it), yesterday at a
  glance (active time, focus, tasks and goals, mood, unlogged gaps), then a check-in (mood
  and energy, 1 to 5), your goals for the day, your projects with today's targets,
  and today's tasks. Unfinished tasks
  from yesterday can be brought over with one click. On Mondays it links to last week's
  review.
- **Evening log:** how you felt (mood, energy, and a note on what affected your day), then
  every gap of 15 minutes or more without active PC use, each with quick answers (Sleep,
  Meal, Out, Exercise...) or your own words, and times you can adjust to split a gap. Then
  what you did on each active project, against today's targets, then mark each goal met,
  partly, or missed, and tick off the day's tasks.
- **Week:** Monday to Sunday: average focus, sleep, mood, and energy (with arrows against
  the week before), goals met and tasks done, a day-by-day table, bedtime and waking times
  and how much they vary, when in the day you focus, the biggest distractions, and a few
  plain observations ("After nights under 6h30m you focused 1h10m a day, against 2h40m
  after longer nights"). It only compares when it has at least two days on each side. Two
  boxes for your own review: what went well, and what to change next week.
- **Projects:** every project as a card with its progress bar, sub-tasks, today's targets, and
  a warning for any not touched in 3 days. Open one to add and edit sub-tasks, enter how many
  you did today (it saves as you type), tick checkboxes, write what you did, or mark "nothing
  today". Its **Plan** tab lists the planned days with each target (change one and it
  saves) and whether it was met, and **History** shows the last 90 days. Set the deadline,
  colour, and status (active, paused, finished) at the top. See [Projects](#projects).
- **Welcome back:** a small window that opens when you come back after a gap (see below).
- **Reminders:** "every N minutes/hours between two times" or "at these times", on chosen
  weekdays. A reminder stays on screen until you press **Done** or **Snooze**. If the PC was
  asleep through several reminder times, you get one reminder when it wakes, saying when it
  was due, not a burst. Nothing pops up while the screen is locked; it waits for you.
- **Settings:** when the morning page opens (default: first use between 08:00 and 12:00),
  when the evening log comes (22:00), the project reminder and when a project counts as untouched, the shortest gap worth asking about (15 minutes), how
  to ask when you come back (a small window, a notification, or not at all), and whether to
  record background sound.

### Coming back to the PC

When you return after a gap, رقيب asks what you were doing, with the same quick answers as
the evening log, so you log it while you still remember. By default it opens a small window;
in Settings you can have a notification instead, or switch it off.

- **What counts:** the time from your last input before you left to your first input back.
  If the screen was locked or the PC asleep or off, any gap of at least the shortest gap
  setting (15 minutes) counts. If the PC was left on and unlocked, it waits for 45 minutes,
  since you may have been reading or watching.
- **When it stays quiet:** if you've already logged at least 90% of that time, while
  recording is paused, and when the morning page or the evening log opens at that moment
  instead (they ask about the gaps themselves).
- A restart of the tracker counts as time away from the last thing it recorded.

### Sleep

Each day shows the night you woke from that morning:

- **Logged:** anything logged as `sleep` between 18:00 the evening before and 14:00. Entries
  up to 30 minutes apart are one night, since the evening log splits a night at midnight.
  Sleep logged later in the day, before 20:00, counts as a nap and is added to the total.
- **Estimated:** without logged sleep, the longest stretch of 3 to 11 hours in that window
  with no active PC use and nothing else logged, from your last input at night to your first
  in the morning. It's marked as an estimate, and the morning page asks you to confirm it
  (which logs it) or adjust the times. It doesn't guess if the PC wasn't used that evening,
  if you haven't used it yet this morning, or if the stretch is longer than 11 hours (it
  probably includes a morning out).

### Mood, energy, and goals

Twice a day, morning and evening, you rate your mood and energy from 1 (low) to 5 (great),
with an optional note in the evening. Goals are what you want to get done that day, as many as you like, set in
the morning and marked met, partly, or missed in the evening. Tasks stay the day's smaller
to-dos. All of it is kept in the same database, and `purge` deletes it with the rest.

If the PC is off at the evening time, the evening log comes the first time you use it later
that evening, and yesterday's unlogged gaps also show on the next morning page.

**Privacy:** the window signs in with the API token (the link رقيب opens contains it) and
then uses a cookie only this window's browser profile holds. Its data needs that cookie and a
custom header, which web pages on other sites can't send to 127.0.0.1. Your tasks,
reminders, and logged entries live in the same database as the events.

The timeline shows details when you hover a bar. To zoom, scroll over it, drag across a
stretch, or click a bar; double-click or **Whole day** zooms back out. Clicking a gap jumps
to its form.

## Your day from the command line, or through Claude

Everything the window does with your day also works as commands, which write straight to
the database (running or not; the window catches up within a minute):

```bash
npm run raqib -- day yesterday
```

```bash
npm run raqib -- log 07:15-09:00 "Breakfast and coffee" --category meal
```

```bash
npm run raqib -- task add "Renew the credit card"
```

```bash
npm run raqib -- remind add "Take your medicine" --at 09:00,21:00
```

```bash
npm run raqib -- checkin evening --mood 3 --energy 2 --note "Long day at court"
```

```bash
npm run raqib -- goal add "Finish the health insurance form"
```

```bash
npm run raqib -- week
```

Also `unlog <id>`, `tasks`, `task done|undo|rm <id>`, `goals [date]`,
`goal met|partly|missed|clear|rm <id>`, `sleep [date]`, `reminders`,
`remind on|off|rm <id>`, and `remind add "..." --every 1h --from 09:00 --until 22:00 --days weekdays`.
`day --json` and `week --json` print every figure. Run `npm run raqib` for the full list.

The skill in `.claude/skills/raqib` teaches Claude Code these commands. In a Claude session
in this folder, say "let's log my day" (or "I was at the gym 6 to 7", or "remind me to take
my pills at 9 and 21") and Claude reads the gaps, asks what you did, and logs it.

## Projects

Projects are the longer things going on in your life (an exam, a side project, a
tournament), unlike tasks and goals, which are for one day. Each project has sub-tasks, and
a sub-task is either **measured** ("Lecture slides, 120 slides", with a progress bar) or a
**checkbox** ("Book the venue"). The project's bar is the average of its sub-tasks, each
counting the same whatever its size. Manage them on the window's **Projects** page, from the
command line, or through Claude.

Every evening the evening log asks what you did on each active project: type how many you did
of each sub-task ("16 slides"), tick what you finished, add a note, or press **Nothing today**.
It saves as you go. The morning page and Today show today's planned targets, each project's
progress, and any project you haven't touched in 3 days.

- **Reminders:** the evening notification names the projects you haven't answered yet. On
  days you skip the evening log, switch on **Remind me about my projects** in Settings (off by
  default, 21:00): it comes once a day only while a project is still unanswered, and not after
  the evening log has gone out. Settings also sets how many days without work flag a project
  (default 3).
- **Week:** the weekly review (window and `week` command) lists each project's week: what
  moved ("+64 slides · Lecture slides"), days worked, planned targets met, and projects
  nothing moved on.

```bash
npm run raqib -- project add "Anatomy exam" --due 2026-11-28
```

```bash
npm run raqib -- sub add 1 "Lecture slides" --total 120 --unit slides
```

```bash
npm run raqib -- progress 1 +15
```

```bash
npm run raqib -- projects
```

```
#1  Anatomy exam  █████████░░░░░░░  54%  due 2026-11-28
    #1  Lecture slides  ██████████░░  96 / 120 slides
    #2  Summary sheet  [x]
    2026-11-10: +15 slides · "Finished chapter 6"
    last worked on today
```

- **What you did each day:** `progress <sub id> +15` adds to a measured sub-task (`-3`
  corrects a mistake, `=12` sets the day's amount), `sub done <id>` ticks a checkbox,
  `project note <id> "..."` says what you did, and `project skip <id>` records "nothing
  today". All take `--date`.
- **Details:** `project show <id>` adds what's left and how much a day it takes to make the
  due date, when you'd finish at the last week's pace, and the plan. An active project
  with no work for 3 days is flagged.
- **Plans:** a plan says how much of each sub-task to do on which day. `project create
  --file plan.json` makes a whole project with its sub-tasks and daily targets in one step,
  and `project plan <id> --file plan.json` re-plans from today on, never touching past days
  or what you've done. Both check the file first and save all of it or nothing; add
  `--dry-run` to only check. `targets` shows the day's targets across your projects.
- **Also:** `project rename|due|pause|resume|done|rm`, `sub edit|undo|rm`, and `--json` on
  `projects`, `project show`, and `targets`.

The easiest way to set one up is to ask Claude: "I have an anatomy exam on the 28th, 6
chapters, about 120 slides and 8 past papers, plan it for me". It asks what it needs, shows
you a plan, and creates it once you agree.

A plan file looks like this (`due` and `targets` are optional; no `total` means a checkbox):

```json
{
  "name": "Anatomy exam",
  "due": "2026-11-28",
  "subtasks": [
    { "title": "Lecture slides", "total": 120, "unit": "slides", "due": "2026-11-20",
      "targets": { "2026-11-11": 15, "2026-11-12": 15 } },
    { "title": "Summary sheet", "targets": { "2026-11-27": 1 } }
  ]
}
```

For `project plan`, give existing sub-tasks by `"id"` (what you leave out stays as it is)
and new ones without. `purge` deletes project history (progress, notes, targets) before its
date but keeps the projects, and sub-task counts stay the same.

## Multitasking: background sound

Every second, رقيب reads Windows' audio meters to see which apps are making sound, and
records it alongside what's in front. The day then shows, for example, "Code + Spotify 40m":
an hour of work with a podcast playing in the background.

- **What counts:** an app that's actually producing sound. Short silences (a pause in
  speech) don't end it; snippets under 30 seconds, like notification sounds, don't count.
  Windows' own system sounds are ignored.
- **What's named:** the app, and its window title where that shows what's playing (Spotify
  shows the song). For Chrome, the extension reports which tabs are playing, so it's
  "youtube.com" with the video's title; without the updated extension it's just "chrome".
  Other browsers are recorded as the browser only, since their window title shows the tab in
  front, not the one playing.
- **Not multitasking:** sound from what you're looking at, such as the YouTube video in
  front of you. Another tab playing while you read a different site does count.
- **Same rules as windows:** nothing while locked or paused, and `exclude.apps`,
  `exclude.titleContains`, and `exclude.domains` apply.

It's stored in the `audio_events` table (`process_name`, `exe_path`, `title`, `domain`,
`start_ms`, `end_ms`), and `purge` deletes it with the events. Turn it off in Settings.

## Other screens

With more than one monitor, رقيب records the window on top of each screen that doesn't have
the focus, on every tick. The focused window stays the main record, so active time and
categories don't change. The day page's "Other screens" card and the reports show what was
up on each screen, what was most often side by side ("code + youtube.com 30m"), and what
was open while the PC sat idle, which helps tell reading apart from being away.

- **What counts as on top:** the frontmost visible app window covering at least a quarter of
  the screen. Minimized windows, windows on other virtual desktops, tool palettes, and the
  desktop and taskbar are skipped. Windows passing by for under 30 seconds don't count.
- **Screens are numbered** left to right, then top to bottom.
- **Chrome:** a Chrome window is recorded only if the extension says which tab it shows,
  because private windows look the same as normal ones. The extension (0.3.0 and later)
  reports every window's active tab every 30 seconds. Reload it in `chrome://extensions`
  after updating. Without it, Chrome windows on other screens are left out.
- **Same rules as windows:** nothing while locked or paused, and `exclude.apps`,
  `exclude.titleContains`, and `exclude.domains` apply.

It's stored in the `screen_events` table (`screen`, `process_name`, `exe_path`, `title`,
`domain`, `start_ms`, `end_ms`), and `purge` deletes it with the events. Turn it off in
Settings.

## Configuration

Edit `config/config.json`, then restart the tracker. An invalid file stops the tracker
from starting, so a typo can't silently switch off your exclusions.

| Setting | Meaning |
| --- | --- |
| `pollIntervalMs` | How often to sample the foreground window (default 5000) |
| `idleThresholdMs` | Time without input before you count as idle (default 120000) |
| `exclude.apps` | Process names (`bank.exe` or `bank`) or full exe paths to never record |
| `exclude.titleContains` | Never record a window whose title contains this text (any case) |
| `exclude.domains` | Sites never to record, such as `bank.com` (subdomains included). Needs the Chrome extension |
| `gaming.games` | Extra games: process names (`celeste` or `celeste.exe`) or full exe paths |
| `browser.fullUrlDomains` | Sites whose full address is stored. Everywhere else, only the domain is kept |
| `api.port` | Port for the local API on 127.0.0.1 (default 5610) |

Excluded time leaves no trace: no row, no "excluded" marker, and no log line. It appears
only as an absence of events. Exclusions apply to new data only; use `purge` for old data.

## What gets recorded

Each row in the `events` table has `kind` (`window` or `idle`), `start_ms`, `end_ms`,
`duration_ms` (UTC milliseconds), `process_name`, `exe_path`, `title`, and for Chrome,
`domain` and (allowlisted sites only) `url`.

- **Merging:** consecutive samples of the same process and title become one event.
- **Idle:** after the threshold, idle is backdated to your last input, so walking away
  doesn't add 2 minutes to whatever was on screen. Idle events also keep what was in
  front (app, site, project), so reports can tell reading apart from being away: see
  "Idle time, by what was on screen". It still counts as idle, never as using the app.
  Moving the mouse, scrolling, or pressing a key ends idle.
- **Lock screen:** nothing is recorded while locked.
- **Sleep, shutdown, crash:** every sample is written straight away, so at most one
  interval is lost. A silence longer than 3 intervals is never bridged by an event.

## Gaming

Rules are checked in this order when events are read, so editing `gaming.games` also
corrects past events:

1. **Your manual list** (`gaming.games`) counts as `gaming`.
2. **Steam, Epic, and Xbox app windows** count as `game launcher`.
3. **Exe paths containing** `steamapps\common`, `Epic Games`, or `XboxGames` count as
   `gaming`. The game's name comes from its folder.

While a game is in the foreground you are never marked idle, even if you step away. Lock
the screen if you want that time left out. Launchers still go idle as normal.

Controllers count as activity everywhere, through XInput. That covers Xbox controllers and
anything presented as one, such as a PlayStation pad through Steam Input or DS4Windows.
Stick drift inside the dead zone doesn't count, so a worn controller can't keep you "active".

If a game shows up as `unknown` in `recent` (Windows refused to reveal its path), it can't
be recognized by folder or name, and it will need a code change to detect.

## Chrome extension

The extension tells the tracker which tab is active: when you switch tabs or pages, and
every 15 seconds while Chrome is focused. The tracker attaches the site to the Chrome
time it's already recording, so Chrome time is split by site.

### Install it

1. Run `npm run build`. It compiles the extension into `chrome-extension/build`.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked**, and choose the `chrome-extension` folder.
3. Show the port and token:

   ```bash
   npm run raqib -- token
   ```

4. On the extension's **Details** page, open **Extension options**, paste them in, and
   click **Save and test connection**. It should say "Connected".

After changing the extension's code, run `npm run build` and click the reload icon on
`chrome://extensions`. Do that once now if you installed it before رقيب, so it can report
which tabs are playing sound.

### Privacy

- **Chrome needs the extension:** a Chrome window is recorded only when the extension
  has just reported that same tab. Anything it can't vouch for leaves no trace: private
  windows (Chrome 156 doesn't put "Incognito" in their titles, and hides them from
  extensions), excluded sites, and the first seconds after the tracker starts. Without
  the extension, Chrome isn't tracked at all.
- **What's stored:** only the domain and the page title. A full address is kept only for
  domains in `browser.fullUrlDomains`, minus any login details and `#fragment`.
- **The API:** it listens on 127.0.0.1 only, and requires the token in
  `config/api-token.txt`. It also rejects requests whose Host isn't 127.0.0.1 or
  localhost, which stops web pages from reaching it through DNS tricks. Delete the token
  file and restart to issue a new token.
- **Other browsers:** Edge, Firefox, and others have no extension, so they're recorded by
  window title. Use `exclude.titleContains` for their private windows and sensitive sites.

## VS Code and Cursor extension

While the editor is focused and you're typing or moving around, the extension tells the
tracker your workspace name, the current file's language, and the git branch. It sends
straight away when one of those changes, otherwise at most every 15 seconds. The tracker
attaches them to the editor time it's already recording, so editor time is split by
project and language.

It never sends file names, paths, or contents: a heartbeat has exactly those three fields,
and the tracker ignores anything else.

There's nothing to configure. When the tracker starts, it writes
`%USERPROFILE%\.activity-tracker\api.json` with its port and the path to its token, and
the extension reads both from there. The status bar shows **Tracker** with a pulse icon
when it's connected, or a warning icon if not; click it for details.

### Install it

```bash
npm run package -w activity-tracker-vscode
```

```bash
code --install-extension vscode-extension/build/activity-tracker.vsix
```

```bash
cursor --install-extension vscode-extension/build/activity-tracker.vsix
```

Then run **Developer: Reload Window** in each open editor window.

If several editor windows are open, each gets its own project: a heartbeat is matched to
the window whose title contains its workspace name. Editor windows without a heartbeat
are still recorded, just without project details.

## Claude Code sessions

Sessions are read straight from Claude Code's own logs in
`%USERPROFILE%\.claude\projects\**\*.jsonl` (or under `CLAUDE_CONFIG_DIR` if you've set
it) each time you ask. Nothing is copied into the tracker's database, and the logs are
only ever opened for reading.

For each session:

- **Project:** the folder name of the working directory it ran in.
- **Start and end:** the first and last message on the day you asked about.
- **Span:** end minus start.
- **Active time:** the time between messages, counting only gaps of 10 minutes or less.
  A 2-hour session where you stepped away for an hour shows about 1 hour active.

Only your messages and Claude's replies count, including subagents' work. Bookkeeping
lines in the logs, such as API records, don't. A session running past midnight is split
between the two days. No message text is read into the tracker.

## Categories

`config/categories.json` decides which category each moment belongs to. Rules are checked
top to bottom, and the first match wins, so put specific rules above general ones. Edits
apply to every report, including past days, because nothing is categorized when it's
recorded. No restart needed.

```json
{ "category": "video", "domain": ["youtube.com", "twitch.tv"] }
```

A rule has a `category` and one or more conditions. All conditions in a rule must match;
a condition given as a list matches if any item does. An optional `note` is ignored.

| Condition | Matches |
| --- | --- |
| `process` | App name, with or without `.exe` (`"chrome"`, `"Code.exe"`), or the full exe path |
| `exePath` | Text the program's path contains (`"\\Riot Games\\"`) |
| `title` | Text the window title contains, any case (`"Certification"`) |
| `domain` | A site and its subdomains (`"google.com"` covers `mail.google.com`); `"*"` is any site |
| `project` | An editor workspace name, any case; `"*"` is any project |
| `gaming` | `"game"` or `"launcher"`, using the gaming rules in `config.json` |

Categories: `work`, `learning`, `debate`, `social media`, `video`, `news`, `gaming`,
`game launcher`, `messaging`, `other`, `idle`. Anything no rule matches is `other`, and
idle time is always `idle`. A typo in a category or condition name stops the report with a
message, rather than being silently ignored.

`focus` and `distraction` at the top of the file list which categories count as each:

- **Switches:** how many times you jumped between a focus and a distraction category.
  Brief glances count. Neutral time, such as messaging, other, or idle, doesn't break
  a run, so work → messages → work isn't a switch.
- **Longest focused stretch:** the longest unbroken run of focus categories. Interruptions
  under a minute don't break it; a gap of a minute or more, such as a locked screen, does.

The timeline folds interruptions under a minute into the block around them, and labels
each block with what took most of its time: the project, game, site, or app.

The Claude app's window is always titled just "Claude", so Claude blocks are named from
Claude Code's logs instead: `claude: <chat name>` for the chat with the most messages
during the block, or for the chat you sent your next message to within 5 minutes (you
were writing it). Conversations in the app's Chat tab aren't stored on your PC, so those
blocks stay plain `claude`. Chat names also appear in the Claude Code sessions list, and
in `--md` files, so check them before pasting a report somewhere.

## Uninstall

1. Stop it and remove autostart (this also removes the Start menu shortcut and the
   notification name):

   ```bash
   npm run raqib -- stop
   ```

   ```bash
   npm run raqib -- uninstall
   ```

2. Remove the extension from `chrome://extensions` in each Chrome profile, and from VS Code
   and Cursor (Extensions view, or `code --uninstall-extension local.activity-tracker-vscode`).
3. Delete `%USERPROFILE%\.activity-tracker\` to remove all recorded data.
4. Delete this folder.
