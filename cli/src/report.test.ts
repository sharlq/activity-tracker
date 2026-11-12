import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CategoryConfig } from './categories.ts';
import type { Block, Segment } from './report.ts';
import { gamingSessions, longestFocus, switches, timeline, top, totals } from './report.ts';

const MIN = 60_000;
const SEC = 1000;
const T0 = new Date(2026, 10, 6, 12, 0).getTime();
const CONFIG: CategoryConfig = { focus: ['work', 'learning'], distraction: ['video', 'social media', 'gaming'], rules: [] };

/** Builds back-to-back segments from [category, detail, seconds] triples, starting at T0. */
function run(...parts: Array<[Segment['category'], string, number]>): Segment[] {
  let at = T0;
  return parts.map(([category, detail, seconds]) => {
    const segment: Segment = { start: at, end: at + seconds * SEC, category, detail, app: detail, domain: null, game: null };
    at += seconds * SEC;
    return segment;
  });
}

const shape = (blocks: Block[]) => blocks.map((b) => [b.category, b.detail, (b.end - b.start) / SEC]);

describe('timeline', () => {
  it('joins back-to-back time in one category and labels it with its main detail', () => {
    const blocks = timeline(run(['work', 'backend', 600], ['work', 'github.com', 120], ['work', 'backend', 300]));
    assert.deepEqual(shape(blocks), [['work', 'backend', 1020]]);
  });

  it('folds an interruption under a minute into the surrounding block', () => {
    const blocks = timeline(run(['work', 'backend', 600], ['video', 'youtube.com', 40], ['work', 'backend', 600]));
    assert.deepEqual(shape(blocks), [['work', 'backend', 1240]]);
  });

  it('keeps an interruption of a minute or more as its own block', () => {
    const blocks = timeline(run(['work', 'backend', 600], ['video', 'youtube.com', 60], ['work', 'backend', 600]));
    assert.deepEqual(shape(blocks), [['work', 'backend', 600], ['video', 'youtube.com', 60], ['work', 'backend', 600]]);
  });

  it('folds several short blips in a row', () => {
    const blocks = timeline(
      run(['work', 'backend', 300], ['messaging', 'WhatsApp', 20], ['video', 'youtube.com', 15], ['social media', 'x.com', 10], ['work', 'backend', 300]),
    );
    assert.deepEqual(shape(blocks), [['work', 'backend', 645]]);
  });

  it('gives a short block at a switch to the longer neighbour', () => {
    const blocks = timeline(run(['work', 'backend', 120], ['other', 'explorer', 20], ['video', 'youtube.com', 600]));
    assert.deepEqual(shape(blocks), [['work', 'backend', 120], ['video', 'youtube.com', 620]]);
  });

  it('never joins across a gap of a minute or more, such as a locked screen', () => {
    const [a, b] = run(['work', 'backend', 600], ['work', 'backend', 600]) as [Segment, Segment];
    const later = { ...b, start: b.start + 10 * MIN, end: b.end + 10 * MIN };
    assert.equal(timeline([a, later]).length, 2);
  });

  it('keeps a short block that touches nothing', () => {
    assert.equal(timeline(run(['video', 'youtube.com', 20])).length, 1);
  });
});

describe('totals', () => {
  it('sums time per category with shares, largest first', () => {
    const result = totals(run(['work', 'a', 300], ['video', 'b', 100], ['work', 'c', 300], ['idle', 'idle', 300]));
    assert.deepEqual(
      result.map((t) => [t.category, t.ms / SEC, Math.round(t.share * 1000) / 10]),
      [['work', 600, 60], ['video', 100, 10], ['idle', 300, 30]].sort((a, b) => (b[1] as number) - (a[1] as number)),
    );
  });

  it('returns nothing for an empty day', () => {
    assert.deepEqual(totals([]), []);
  });
});

describe('top', () => {
  it('ranks apps and domains by time, leaving out idle and keeping at most 10', () => {
    const segments = run(['work', 'Cursor', 300], ['video', 'chrome', 100], ['idle', 'idle', 900], ['work', 'Cursor', 50]);
    segments[1] = { ...(segments[1] as Segment), domain: 'youtube.com' };
    segments[2] = { ...(segments[2] as Segment), app: null };
    assert.deepEqual(top(segments, 'app').map((r) => [r.name, r.ms / SEC]), [['Cursor', 350], ['chrome', 100]]);
    assert.deepEqual(top(segments, 'domain').map((r) => r.name), ['youtube.com']);

    const many = Array.from({ length: 15 }, (_, i) => ({ ...(segments[0] as Segment), app: `app${i}` }));
    assert.equal(top(many, 'app').length, 10);
  });
});

describe('gamingSessions', () => {
  it('joins play of one game with short breaks into one session, counting only play time', () => {
    const segments = run(['gaming', 'Hades', 1200], ['other', 'Discord', 120], ['gaming', 'Hades', 600], ['work', 'x', 3600], ['gaming', 'Hades', 300]);
    for (const s of segments) if (s.category === 'gaming') s.game = 'Hades';
    const sessions = gamingSessions(segments);
    assert.deepEqual(sessions.map((g) => [g.game, g.ms / MIN]), [['Hades', 30], ['Hades', 5]]);
    assert.equal(sessions[0]?.end, (segments[2] as Segment).end);
  });

  it('keeps different games apart', () => {
    const segments = run(['gaming', 'Hades', 600], ['gaming', 'Celeste', 600]);
    assert.deepEqual(gamingSessions(segments).map((g) => g.game), ['Hades', 'Celeste']);
  });
});

describe('switches', () => {
  it('counts each jump between focus and distraction', () => {
    const segments = run(['work', 'a', 300], ['video', 'b', 5], ['work', 'a', 300], ['social media', 'c', 60], ['learning', 'd', 60]);
    assert.equal(switches(segments, CONFIG), 4);
  });

  it('ignores neutral time and moves within one side', () => {
    const segments = run(['work', 'a', 300], ['messaging', 'w', 60], ['learning', 'b', 300], ['idle', 'idle', 600], ['work', 'a', 60]);
    assert.equal(switches(segments, CONFIG), 0);
    assert.equal(switches(run(['video', 'a', 60], ['social media', 'b', 60], ['gaming', 'c', 60]), CONFIG), 0);
  });

  it('counts a jump across neutral time', () => {
    assert.equal(switches(run(['work', 'a', 300], ['messaging', 'w', 60], ['video', 'b', 300]), CONFIG), 1);
  });
});

describe('longestFocus', () => {
  it('finds the longest run of touching focus blocks, joining work and learning', () => {
    const blocks = timeline(run(['work', 'a', 1200], ['video', 'b', 300], ['work', 'a', 600], ['learning', 'c', 900]));
    const stretch = longestFocus(blocks, CONFIG);
    assert.equal(stretch?.ms, 25 * MIN);
    assert.equal(stretch?.start, T0 + 25 * MIN);
  });

  it('is not broken by a blip under a minute', () => {
    const blocks = timeline(run(['work', 'a', 1200], ['video', 'b', 30], ['work', 'a', 1200]));
    assert.equal(longestFocus(blocks, CONFIG)?.ms, (2400 + 30) * SEC);
  });

  it('is broken by a gap such as a locked screen', () => {
    const [a, b] = run(['work', 'a', 1200], ['work', 'a', 600]) as [Segment, Segment];
    const blocks = timeline([a, { ...b, start: b.start + 5 * MIN, end: b.end + 5 * MIN }]);
    assert.equal(longestFocus(blocks, CONFIG)?.ms, 20 * MIN);
  });

  it('is null when there was no focused time', () => {
    assert.equal(longestFocus(timeline(run(['video', 'b', 600])), CONFIG), null);
  });
});
