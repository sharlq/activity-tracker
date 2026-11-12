import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EditorReport } from './editor.ts';
import { EDITOR_FRESH_MS, editorContext, rememberEditorReport } from './editor.ts';

const NOW = 1_000_000;
const CURSOR = { processName: 'Cursor.exe', title: 'main.ts - personal activity tracker - Cursor' };
const report = (changes: Partial<EditorReport> = {}): EditorReport => ({
  workspace: 'personal activity tracker',
  language: 'typescript',
  branch: 'main',
  receivedAt: NOW - 1000,
  ...changes,
});

describe('editorContext', () => {
  it('attaches project, language, and branch to the matching editor window', () => {
    assert.deepEqual(editorContext(CURSOR, [report()], NOW), {
      project: 'personal activity tracker',
      language: 'typescript',
      branch: 'main',
    });
  });

  it('works for VS Code and Insiders too, ignoring case', () => {
    for (const processName of ['Code.exe', 'Code - Insiders.exe', 'CURSOR.EXE']) {
      assert.notEqual(editorContext({ ...CURSOR, processName }, [report()], NOW), null, processName);
    }
  });

  it('ignores other apps, even if their title mentions the project', () => {
    assert.equal(editorContext({ ...CURSOR, processName: 'chrome.exe' }, [report()], NOW), null);
  });

  it('gives each editor window its own project when several are open', () => {
    const reports = [report(), report({ workspace: 'website', language: 'css', receivedAt: NOW - 500 })];
    const other = { processName: 'Code.exe', title: 'styles.css - website - Visual Studio Code' };
    assert.equal(editorContext(CURSOR, reports, NOW)?.project, 'personal activity tracker');
    assert.equal(editorContext(other, reports, NOW)?.project, 'website');
  });

  it('records the window without details when no fresh report matches', () => {
    assert.equal(editorContext(CURSOR, [], NOW), null);
    assert.equal(editorContext(CURSOR, [report({ receivedAt: NOW - EDITOR_FRESH_MS - 1 })], NOW), null);
    assert.equal(editorContext(CURSOR, [report({ workspace: null })], NOW), null);
  });

  it('leaves out a language or branch that was not reported', () => {
    assert.deepEqual(editorContext(CURSOR, [report({ language: null, branch: null })], NOW), {
      project: 'personal activity tracker',
    });
  });
});

describe('rememberEditorReport', () => {
  it('drops reports too old to use', () => {
    const old = report({ receivedAt: 0 });
    const latest = report({ receivedAt: NOW });
    assert.deepEqual(rememberEditorReport([old], latest), [latest]);
  });
});
