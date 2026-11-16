import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AudioEvent } from '../journal.ts';
import { complement, findGaps, union } from './gaps.ts';
import { audioBlocks, isPhoneEntry, loggedDistraction, multitasking, phoneMultitasking, playingTitle } from './multitask.ts';
import type { Segment } from './report.ts';

const MIN = 60_000;
const seg = (start: number, end: number, category: Segment['category'], detail: string, app: string | null = detail, domain: string | null = null): Segment => ({
  start: start * MIN,
  end: end * MIN,
  category,
  detail,
  app,
  domain,
  game: null,
});

describe('intervals', () => {
  it('unions overlapping and touching intervals', () => {
    assert.deepEqual(union([{ start: 5, end: 8 }, { start: 0, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 9 }]), [
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ]);
  });

  it('finds what is left of a window', () => {
    assert.deepEqual(complement([{ start: 2, end: 4 }, { start: 6, end: 12 }], 0, 10), [
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ]);
    assert.deepEqual(complement([], 0, 10), [{ start: 0, end: 10 }]);
  });
});

describe('findGaps', () => {
  const day = [seg(480, 540, 'work', 'Code'), seg(540, 600, 'idle', 'netflix.com', null), seg(600, 610, 'work', 'Code'), seg(700, 720, 'video', 'youtube.com')];

  it('asks about time off the PC and long idle stretches, but not short breaks', () => {
    const gaps = findGaps([...day, seg(610, 615, 'other', 'explorer'), seg(620, 700, 'work', 'Code')], [], 0, 720 * MIN, 15 * MIN);
    assert.deepEqual(
      gaps.map((g) => [g.start / MIN, g.end / MIN, g.kind, g.onScreen]),
      [
        [0, 480, 'away', null],
        [540, 600, 'idle', 'netflix.com'],
      ],
    );
  });

  it('leaves out what you already logged, and keeps what is still open', () => {
    const logged = [{ start: 0, end: 420 * MIN }];
    const gaps = findGaps(day, logged, 0, 720 * MIN, 15 * MIN);
    assert.deepEqual(gaps.map((g) => [g.start / MIN, g.end / MIN]), [[420, 480], [540, 600], [610, 700]]);
  });
});

describe('multitasking', () => {
  const audio = (start: number, end: number, processName: string, domain: string | null = null, title: string | null = null): AudioEvent => ({
    id: 0,
    start: start * MIN,
    end: end * MIN,
    source: { processName, exePath: null, title, domain },
  });

  it('joins a source playing on and off into blocks, and drops snippets', () => {
    const blocks = audioBlocks([audio(0, 10, 'Spotify.exe', null, 'A'), audio(10.5, 20, 'Spotify.exe', null, 'B'), audio(30, 30.2, 'Discord.exe')]);
    assert.deepEqual(blocks.map((b) => [b.source, b.start / MIN, b.end / MIN, b.title]), [['Spotify', 0, 20, 'A']]);
  });

  it('counts sound alongside other work, but not the video you are watching', () => {
    const screen = [seg(0, 30, 'work', 'raqib', 'Code'), seg(30, 40, 'video', 'youtube.com', 'chrome', 'youtube.com'), seg(40, 60, 'idle', 'idle', null)];
    const m = multitasking(screen, [audio(10, 60, 'chrome.exe', 'youtube.com')]);
    assert.equal(m.listeningMs, 50 * MIN);
    assert.equal(m.whileActiveMs, 20 * MIN); // 10-30 while coding; 30-40 is the video itself.
    assert.equal(m.whileIdleMs, 20 * MIN);
    assert.deepEqual(m.byActivity, [{ name: 'work', ms: 20 * MIN }]);
    assert.deepEqual(m.pairs, [{ doing: 'raqib', category: 'work', listening: 'youtube.com', listeningTitle: null, ms: 20 * MIN }]);
  });

  it('counts another tab playing while you read a different site', () => {
    const screen = [seg(0, 10, 'work', 'docs.google.com', 'chrome', 'docs.google.com')];
    assert.equal(multitasking(screen, [audio(0, 10, 'chrome.exe', 'open.spotify.com')]).whileActiveMs, 10 * MIN);
  });

  it('says what played, for each source and alongside what you were doing', () => {
    const screen = [seg(0, 60, 'work', 'raqib', 'Code')];
    const m = multitasking(screen, [
      audio(0, 40, 'chrome.exe', 'youtube.com', '(3) Lofi beats to study to - YouTube'),
      audio(40, 50, 'chrome.exe', 'youtube.com', 'Anatomy lecture 4 - YouTube'),
      audio(0, 30, 'Spotify.exe', null, 'Spotify Premium'),
    ]);
    const youtube = m.bySource.find((s) => s.name === 'youtube.com');
    assert.equal(youtube?.title, 'Lofi beats to study to');
    assert.deepEqual(youtube?.titles.map((t) => [t.name, t.ms / MIN]), [
      ['Lofi beats to study to', 40],
      ['Anatomy lecture 4', 10],
    ]);
    // "Spotify Premium" is just the app's name: it says nothing about what played.
    assert.equal(m.bySource.find((s) => s.name === 'Spotify')?.title, null);
    assert.equal(m.pairs.find((p) => p.listening === 'youtube.com')?.listeningTitle, 'Lofi beats to study to');
  });
});

describe('playingTitle', () => {
  it('drops the app name and unread counts, and titles that are only the app', () => {
    assert.equal(playingTitle('(12) Sabaton - The Last Stand - YouTube', 'youtube.com'), 'Sabaton - The Last Stand');
    assert.equal(playingTitle('Chat | Daily Scrum Meeting | Microsoft Teams', 'ms-teams'), 'Chat | Daily Scrum Meeting');
    assert.equal(playingTitle('Spotify Premium', 'Spotify'), null);
    assert.equal(playingTitle('Claude', 'claude'), null);
    assert.equal(playingTitle(null, 'chrome'), null);
  });
});

describe('phone multitasking', () => {
  const entry = (id: number, start: number, end: number, label: string, category: string | null = 'social media') => ({ id, start: start * MIN, end: end * MIN, label, category });

  it('adds logged distraction to what the PC saw, counting each moment once', () => {
    const segments = [seg(0, 30, 'video', 'youtube.com'), seg(30, 60, 'work', 'claude')];
    const entries = [
      entry(1, 20, 50, 'Phone: Instagram/TikTok'), // 10 min of it overlaps YouTube on the PC
      entry(2, 40, 50, 'On my phone'), // inside entry 1: counted once
      entry(3, 70, 80, 'Phone: productivity apps', 'other'), // phone, but not a distraction
      entry(4, 90, 100, 'Meal', 'meal'),
    ];
    const l = loggedDistraction(entries, segments, ['video', 'social media'], 0, 24 * 60 * MIN);
    assert.equal(l.ms, 20 * MIN);
    assert.equal(l.phoneMs, 40 * MIN);
    assert.equal(l.phoneDistractionMs, 30 * MIN);
    assert.deepEqual(l.byLabel[0], { name: 'Phone: Instagram/TikTok', ms: 30 * MIN });
  });

  it('knows phone entries by their label', () => {
    assert.ok(isPhoneEntry({ label: 'On my phone' }));
    assert.ok(isPhoneEntry({ label: 'Phone: Instagram/TikTok' }));
    assert.ok(isPhoneEntry({ label: 'على الجوال' }));
    assert.ok(!isPhoneEntry({ label: 'Phoned mum' }));
    assert.ok(!isPhoneEntry({ label: 'Meal' }));
    assert.ok(!isPhoneEntry({ label: 'coffe sometimes picking phone most of it thinking' }));
    assert.ok(isPhoneEntry({ label: 'On my phone and waiting for water to get warm' }));
  });

  it('counts phone time alongside active PC use, once even where entries overlap', () => {
    const screen = [seg(0, 20, 'work', 'claude', 'claude'), seg(20, 40, 'idle', 'idle', null), seg(40, 50, 'work', 'cms.edways.com', 'chrome', 'cms.edways.com')];
    const p = phoneMultitasking(screen, [entry(1, 10, 30, 'Phone: Instagram'), entry(2, 0, 45, 'On my phone'), entry(3, 0, 60, 'Meal', 'meal')]);
    assert.equal(p.ms, 45 * MIN);
    assert.equal(p.whileActiveMs, 25 * MIN); // 0-20 on claude, 40-45 on the CMS.
    assert.equal(p.whilePcIdleMs, 20 * MIN);
    assert.deepEqual(p.pairs, [
      { doing: 'claude', category: 'work', listening: 'Phone', ms: 10 * MIN },
      { doing: 'claude', category: 'work', listening: 'Instagram', ms: 10 * MIN },
      { doing: 'cms.edways.com', category: 'work', listening: 'Phone', ms: 5 * MIN },
    ]);
  });

  it('is part of the multitasking report', () => {
    const m = multitasking([seg(0, 10, 'work', 'claude')], [], [entry(1, 0, 10, 'Phone: TikTok')]);
    assert.equal(m.phone.whileActiveMs, 10 * MIN);
    assert.equal(m.listeningMs, 0);
  });
});
