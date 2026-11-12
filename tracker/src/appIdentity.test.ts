import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAppWindowTitle } from './appIdentity.ts';

test('only رقيب app windows get رقيب’s taskbar identity, not browser tabs', () => {
  assert.equal(isAppWindowTitle('رقيب', 'رقيب'), true);
  assert.equal(isAppWindowTitle('رقيب · Today', 'رقيب'), true);
  assert.equal(isAppWindowTitle('رقيب · Today - Google Chrome', 'رقيب'), false);
  assert.equal(isAppWindowTitle('رقيب · Today and 2 more pages - Personal - Microsoft​ Edge', 'رقيب'), false);
  assert.equal(isAppWindowTitle('127.0.0.1/ui/login', 'رقيب'), false);
});
