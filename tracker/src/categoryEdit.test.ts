import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addToCategories } from './categoryEdit.ts';
import { categorize, parseCategories } from './report/categories.ts';

const FILE = `{
  "focus": ["work"],
  "distraction": ["video"],
  "rules": [
    { "category": "meeting", "call": "*", "note": "calls" },

    { "category": "video", "domain": ["youtube.com"] }
  ]
}
`;

const site = (domain: string) => ({ kind: 'window' as const, processName: 'chrome.exe', exePath: null, title: '', domain });

describe('adding to categories from the window', () => {
  it('adds a rule after the call rule, keeping the rest of the file as it was', () => {
    const out = addToCategories(FILE, { category: 'work', kind: 'domain', value: 'hubspot.com' });
    assert.ok(out.includes('    { "category": "meeting", "call": "*", "note": "calls" },\n    { "category": "work", "domain": ["hubspot.com"], "note": "Added in رقيب" },\n\n    { "category": "video"'));
    assert.equal(categorize(site('app-eu1.hubspot.com'), parseCategories(out), []), 'work');
  });

  it('extends its own rule for the same category instead of adding another', () => {
    const once = addToCategories(FILE, { category: 'work', kind: 'domain', value: 'hubspot.com' });
    const twice = addToCategories(once, { category: 'work', kind: 'domain', value: 'zoho.com' });
    const again = addToCategories(twice, { category: 'work', kind: 'domain', value: 'ZOHO.com' });
    assert.equal(again.match(/Added in/g)?.length, 1);
    assert.ok(again.includes('"domain": ["hubspot.com", "zoho.com"]'));
    const apps = addToCategories(again, { category: 'work', kind: 'process', value: 'pgAdmin4' });
    assert.equal(apps.match(/Added in/g)?.length, 2);
  });
});

describe('what is left uncategorised', () => {
  it('names sites by their main domain and skips bare browsers', async () => {
    const { baseDomain, uncategorisedOf } = await import('./ui.ts');
    assert.equal(baseDomain('app-eu1.hubspot.com'), 'hubspot.com');
    assert.equal(baseDomain('news.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(baseDomain('127.0.0.1'), '127.0.0.1');
    const seg = (start: number, end: number, app: string, domain: string | null, category = 'other') =>
      ({ start, end, category, detail: domain ?? app, app, domain, game: null }) as never;
    assert.deepEqual(uncategorisedOf([seg(0, 60_000, 'chrome', 'books.zoho.com'), seg(60_000, 90_000, 'chrome', 'api-console.zoho.com'), seg(0, 10_000, 'chrome', null), seg(0, 5_000, 'pgAdmin4', null), seg(0, 9_000, 'Code', null, 'work')]), [
      { name: 'zoho.com', kind: 'domain', ms: 90_000 },
      { name: 'pgAdmin4', kind: 'process', ms: 5_000 },
    ]);
  });
});
