import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TASK_NAME, currentUser, launcherScript, taskName, taskXml } from './autostart.ts';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const MAIN = 'C:\\Users\\Asus\\personal activity tracker\\tracker\\dist\\main.js';

describe('launcherScript', () => {
  it('starts the supervisor hidden (window style 0) and waits for it', () => {
    const script = launcherScript(NODE, MAIN, {});
    assert.match(script, /WScript\.Quit shell\.Run\(".+", 0, True\)/);
    assert.ok(script.includes(`"""${NODE}"" ""${MAIN}"" supervise"`), script);
  });

  it('passes on the data-folder and config overrides, and nothing else', () => {
    const script = launcherScript(NODE, MAIN, { ACTIVITY_TRACKER_HOME: 'D:\\data', SECRET: 'x', PATH: 'y' });
    assert.ok(script.includes('shell.Environment("Process")("ACTIVITY_TRACKER_HOME") = "D:\\data"'));
    assert.ok(!script.includes('SECRET') && !script.includes('PATH'));
  });

  it('escapes quotes for VBScript', () => {
    assert.ok(launcherScript(NODE, MAIN, { ACTIVITY_TRACKER_HOME: 'D:\\a"b' }).includes('"D:\\a""b"'));
  });
});

describe('taskXml', () => {
  const xml = taskXml('DESKTOP\\Asus', 'C:\\Users\\Asus\\.activity-tracker\\launch-hidden.vbs');

  it('starts at your login only, as you, without admin rights', () => {
    assert.match(xml, /<LogonTrigger>[\s\S]*<UserId>DESKTOP\\Asus<\/UserId>/);
    assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
    assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  });

  it('runs the hidden launcher through wscript', () => {
    assert.match(xml, /<Command>wscript\.exe<\/Command>/);
    assert.ok(xml.includes('<Arguments>//B //NoLogo "C:\\Users\\Asus\\.activity-tracker\\launch-hidden.vbs"</Arguments>'));
  });

  it('never times out, ignores battery power, and keeps one copy running', () => {
    assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
    assert.match(xml, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/);
    assert.match(xml, /<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/);
    assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  });

  it('checks every 5 minutes and restarts on failure, as a safety net for the supervisor', () => {
    assert.match(xml, /<Repetition>\s*<Interval>PT5M<\/Interval>/);
    assert.match(xml, /<RestartOnFailure>/);
  });

  it('escapes XML special characters', () => {
    assert.ok(taskXml('A&B', 'C:\\<x>').includes('<UserId>A&amp;B</UserId>'));
    assert.ok(taskXml('A&B', 'C:\\<x>').includes('C:\\&lt;x&gt;'));
  });
});

describe('names', () => {
  it('uses the default task name unless a test overrides it', () => {
    assert.equal(taskName({}), DEFAULT_TASK_NAME);
    assert.equal(taskName({ ACTIVITY_TRACKER_TASK: 'Test' }), 'Test');
  });

  it('identifies the user as DOMAIN\\name', () => {
    assert.equal(currentUser({ USERDOMAIN: 'DESKTOP', USERNAME: 'Asus' }), 'DESKTOP\\Asus');
  });
});
