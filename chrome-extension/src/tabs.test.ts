import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changesReport, tabReport } from './tabs.ts';

describe('tabReport', () => {
  it('reports the url and title of a normal tab', () => {
    assert.deepEqual(tabReport({ url: 'https://example.com/a', title: 'Example', incognito: false }), {
      url: 'https://example.com/a',
      title: 'Example',
    });
  });

  it('never reports an incognito tab', () => {
    assert.equal(tabReport({ url: 'https://example.com', title: 'Secret', incognito: true }), null);
  });

  it('reports nothing without a tab or a url', () => {
    assert.equal(tabReport(undefined), null);
    assert.equal(tabReport({ title: 'Loading', incognito: false }), null);
  });

  it('reports an empty title while a page is still loading', () => {
    assert.deepEqual(tabReport({ url: 'https://example.com', incognito: false }), {
      url: 'https://example.com',
      title: '',
    });
  });
});

describe('changesReport', () => {
  it('reacts to url and title changes only', () => {
    assert.ok(changesReport({ url: 'https://example.com' }));
    assert.ok(changesReport({ title: 'New title' }));
    assert.ok(!changesReport({}));
  });
});
