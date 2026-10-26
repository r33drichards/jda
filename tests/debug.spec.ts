import { test, expect } from './fixtures';
import { defaultConfig } from '../src/shared';
import type { BrowserContext, Page } from '@playwright/test';
import type { Config } from '../src/shared';

const base = 'http://127.0.0.1:8790';
const rules: Config['rules'] = [{ id: 'tests', description: 'May run local tests.', canApprove: true, enabled: true }];
async function setup(context: BrowserContext, id: string, config: Config = defaultConfig, multi = false) {
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/options.html`);
  await popup.getByLabel('Configuration (JSON)').fill(JSON.stringify(config));
  await popup.getByRole('button', { name: 'Save settings' }).click();
  await expect(popup.getByRole('status')).toHaveText('Settings saved.');
  await popup.goto(`chrome-extension://${id}/index.html`);
  const page = await context.newPage(); await page.goto(`${base}/fixture${multi ? '?multi=1' : ''}`); await page.bringToFront();
  await popup.getByRole('button', { name: 'Allow this tab', exact: true }).click();
  await expect(popup.getByTestId('tab-access')).toHaveText('Allowed on this tab');
  return { popup, page };
}
async function evaluate(popup: Page) {
  await popup.getByRole('button', { name: 'Evaluate current page' }).click();
  await expect(popup.getByRole('button', { name: 'Evaluate current page' })).toBeEnabled({ timeout: 35000 });
}
async function openDebugger(context: BrowserContext, popup: Page) {
  const opened = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Open debugger' }).click();
  const debug = await opened; await debug.waitForLoadState(); return debug;
}
async function step(debug: Page, name: string) {
  await debug.getByRole('button', { name: `Next: ${name}`, exact: true }).click();
  await expect(debug.getByRole('region', { name, exact: true }).getByText(/^done ·/)).toBeVisible();
}
test.beforeEach(async ({ model }) => { await model.configure({}); });

test('highlights show unread/read; Pop seen makes only the latest read message unread', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId, defaultConfig, true);
  await expect(page.locator('[data-jda-read="unread"]')).toHaveCount(4);
  await popup.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.locator('[data-jda-read="read"]')).toHaveCount(4);
  await popup.getByRole('button', { name: 'Pop seen', exact: true }).click();
  await expect(page.locator('[data-jda-read="unread"]')).toHaveCount(1);
  await expect(page.locator('[data-message-id="message-4"]')).toHaveAttribute('data-jda-read', 'unread');
  expect(await model.calls()).toHaveLength(0);
  await evaluate(popup);
  const calls = await model.calls(); expect(calls).toHaveLength(1);
  expect(calls[0].input.messages?.[0].id).toBe('message-4');
  await expect(page.locator('[data-jda-read="read"]')).toHaveCount(4);
});
test('Pop seen reruns classification without sending a duplicate approval', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', decisions: { '0:tests': 'can approve' } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules });
  await evaluate(popup); await expect(page.locator('#sent p')).toHaveText(['approve']);
  await popup.getByRole('button', { name: 'Pop seen', exact: true }).click();
  await evaluate(popup);
  expect(await model.calls()).toHaveLength(4);
  await expect(page.locator('#sent p')).toHaveText(['approve']);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('already handled');
});
test('highlights update for new and edited messages and disappear when disabled or disallowed', async ({ context, extensionId }) => {
  const { popup, page } = await setup(context, extensionId);
  await popup.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.locator('[data-jda-read="read"]')).toHaveCount(1);
  await page.locator('.message-body').evaluate(el => { const copy = el.cloneNode(true) as HTMLElement; copy.dataset.messageId = 'new'; el.after(copy); });
  await expect(page.locator('[data-message-id="new"]')).toHaveAttribute('data-jda-read', 'unread');
  await page.locator('.message-text').first().evaluate(el => { el.textContent = 'Edited'; });
  await expect(page.locator('[data-jda-read="unread"]')).toHaveCount(2);
  await popup.getByLabel('Highlight read / unread messages').uncheck();
  await expect(page.locator('[data-jda-read]')).toHaveCount(0);
  await popup.getByLabel('Highlight read / unread messages').check();
  await expect(page.locator('[data-jda-read="unread"]')).toHaveCount(2);
  await popup.getByRole('button', { name: 'Disallow this tab' }).click();
  await expect(page.locator('[data-jda-read]')).toHaveCount(0);
  await expect(page.locator('#jda-read-style')).toHaveCount(0);
});
test('countdown follows the actual alarm and stops with monitoring', async ({ context, extensionId }) => {
  const { popup } = await setup(context, extensionId, { ...defaultConfig, intervalSeconds: 30 });
  await expect(popup.getByTestId('countdown')).toHaveText('Timer stopped');
  await popup.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(popup.getByTestId('countdown')).toHaveText(/Next evaluation in 00:\d{2}/);
  const text = await popup.getByTestId('countdown').innerText();
  const alarm = await popup.evaluate(() => chrome.alarms.get('jda-evaluate'));
  const shown = Number(text.split(':').pop());
  expect(Math.abs(shown - Math.ceil((alarm!.scheduledTime - Date.now()) / 1000))).toBeLessThanOrEqual(2);
  await expect.poll(() => popup.getByTestId('countdown').innerText()).not.toBe(text);
  await popup.getByRole('button', { name: 'Stop monitoring' }).click();
  await expect(popup.getByTestId('countdown')).toHaveText('Timer stopped');
});
test('debugger steps through real stages without marking seen or sending replies and exports trace', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', decisions: { '0:tests': 'can approve' } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules });
  const debug = await openDebugger(context, popup);
  await debug.getByRole('button', { name: 'Start new debug run' }).click();
  await expect(debug.getByTestId('debug-state')).toContainText('Paused between stages');
  await step(debug, 'Query DOM'); await step(debug, 'Filter seen');
  expect(await model.calls()).toHaveLength(0);
  await step(debug, 'Categorize'); expect(await model.calls()).toHaveLength(1);
  await expect(debug.getByRole('region', { name: 'Categorize', exact: true })).toContainText('asking for approval');
  await step(debug, 'Match approval rules'); expect(await model.calls()).toHaveLength(2);
  await expect(debug.getByRole('region', { name: 'Match approval rules', exact: true })).toContainText('Matched approval rule: tests.');
  await step(debug, 'Preview replies');
  await expect(debug.getByTestId('debug-state')).toContainText('Preview finished · no replies sent');
  await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('#sent p')).toHaveCount(0);
  expect(await debug.evaluate(() => chrome.storage.local.get(['seenMessages', 'approvalReceipts']))).toEqual({});
  await expect(debug.getByRole('region', { name: 'Model traces' })).toContainText('2 calls');
  await debug.screenshot({ path: test.info().outputPath('debugger.png'), fullPage: true });
  const downloadEvent = debug.waitForEvent('download'); await debug.getByRole('button', { name: 'Export trace JSON' }).click();
  const download = await downloadEvent;
  const { readFile } = await import('node:fs/promises');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).not.toHaveProperty('token'); expect(exported.traces).toHaveLength(2); expect(exported.traces[0].raw).toContain('asking for approval');
  expect(exported.steps[4].output[0].target.unchanged).toBe(true);
});
test('debug pause survives reload, stops the alarm, and blocks live evaluation until finished', async ({ context, extensionId, model }) => {
  const { popup } = await setup(context, extensionId);
  await popup.getByRole('button', { name: 'Start monitoring' }).click();
  await expect.poll(async () => (await model.calls()).length).toBe(1);
  const debug = await openDebugger(context, popup);
  await debug.getByRole('button', { name: 'Start new debug run' }).click();
  expect(await debug.evaluate(() => chrome.alarms.get('jda-evaluate'))).toBeUndefined();
  await step(debug, 'Query DOM'); await debug.reload();
  await expect(debug.getByRole('button', { name: 'Next: Filter seen' })).toBeEnabled();
  const start = await debug.evaluate(() => chrome.runtime.sendMessage({ type: 'START' })); expect(start.error).toContain('debug preview');
  await debug.getByRole('button', { name: 'Finish preview' }).click();
  await expect(debug.getByTestId('debug-state')).toContainText('Preview finished');
  await debug.getByRole('button', { name: 'Clear trace' }).click();
  expect(await debug.evaluate(() => chrome.storage.session.get('debugRun'))).toEqual({});
});
test('debugger exposes raw malformed output and allows retrying the same stage', async ({ context, extensionId, model }) => {
  await model.configure({ malformed: 'json' });
  const { popup, page } = await setup(context, extensionId);
  const debug = await openDebugger(context, popup);
  await debug.getByRole('button', { name: 'Start new debug run' }).click();
  await step(debug, 'Query DOM'); await step(debug, 'Filter seen');
  await debug.getByRole('button', { name: 'Next: Categorize' }).click();
  await expect(debug.getByRole('region', { name: 'Categorize', exact: true }).getByRole('alert')).toBeVisible();
  await expect(debug.getByRole('region', { name: 'Model traces' })).toContainText('not JSON');
  await model.configure({}); await debug.getByRole('button', { name: 'Retry stage' }).click();
  await expect(debug.getByRole('region', { name: 'Categorize', exact: true }).getByText(/^done ·/)).toBeVisible();
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('include-seen previews and debug Pop seen allow a fresh rerun without modifying receipts', async ({ context, extensionId, model }) => {
  const { popup } = await setup(context, extensionId);
  await popup.getByRole('button', { name: 'Mark all as read' }).click();
  const debug = await openDebugger(context, popup);
  await debug.getByLabel('Include seen messages in this preview').check();
  await debug.getByRole('button', { name: 'Start new debug run' }).click();
  await step(debug, 'Query DOM'); await step(debug, 'Filter seen'); await step(debug, 'Categorize');
  expect(await model.calls()).toHaveLength(1);
  expect(Object.keys((await debug.evaluate(() => chrome.storage.local.get('seenMessages'))).seenMessages)).toHaveLength(1);
  await debug.getByRole('button', { name: 'Pop seen', exact: true }).click();
  await expect(debug.getByRole('status')).toContainText('unread');
  expect((await debug.evaluate(() => chrome.storage.local.get('seenMessages'))).seenMessages).toEqual({});
});
test('no-match diagnostics distinguish missing rules from rejected rules', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval' });
  const { popup, page } = await setup(context, extensionId);
  await evaluate(popup);
  await expect(popup.getByTestId('message-reason')).toHaveText('No enabled canApprove rules configured.');
  await expect(popup.getByTestId('rule-count')).toContainText('Approval rules enabled: 0');
  await popup.getByRole('button', { name: 'Pop seen', exact: true }).click();
  await popup.evaluate(config => chrome.storage.local.set({ config }), { ...defaultConfig, rules });
  await evaluate(popup);
  await expect(popup.getByTestId('message-reason')).toHaveText('No approval rule matched.');
  await popup.getByText('Rule checks (1)', { exact: true }).click();
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('tests: no match');
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('debug stages reject a revoked target tab', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId);
  const debug = await openDebugger(context, popup);
  await debug.getByRole('button', { name: 'Start new debug run' }).click(); await step(debug, 'Query DOM');
  await page.bringToFront(); await popup.getByRole('button', { name: 'Disallow this tab' }).click();
  await debug.getByRole('button', { name: 'Next: Filter seen' }).click();
  await expect(debug.getByRole('region', { name: 'Filter seen', exact: true }).getByRole('alert')).toContainText('inactive');
  expect(await model.calls()).toHaveLength(0);
});

test('Pop seen can recover a reserved message after an interrupted evaluation', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId);
  await popup.getByRole('button', { name: 'Mark all as read' }).click();
  await popup.evaluate(async () => {
    const { seenMessages } = await chrome.storage.local.get('seenMessages');
    for (const key of Object.keys(seenMessages)) seenMessages[key].state = 'processing';
    await chrome.storage.local.set({ seenMessages });
  });
  await popup.getByRole('button', { name: 'Pop seen', exact: true }).click();
  await expect(page.locator('[data-jda-read="unread"]')).toHaveCount(1);
  await evaluate(popup); expect(await model.calls()).toHaveLength(1);
});

test('Eval now and Pop seen work between monitoring ticks without stopping the timer', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, intervalSeconds: 300 });
  await popup.getByRole('button', { name: 'Start monitoring', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Eval now', exact: true })).toBeEnabled();
  await expect(page.locator('[data-jda-read="read"]')).toHaveCount(1);
  const alarm = await popup.evaluate(() => chrome.alarms.get('jda-evaluate'));
  await popup.getByRole('button', { name: 'Pop seen', exact: true }).click();
  await expect(page.locator('[data-jda-read="unread"]')).toHaveCount(1);
  await popup.getByRole('button', { name: 'Eval now', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Eval now', exact: true })).toBeEnabled();
  await expect(page.locator('[data-jda-read="read"]')).toHaveCount(1);
  expect(await model.calls()).toHaveLength(2);
  await expect(popup.getByTestId('monitoring')).toContainText('Monitoring on');
  expect((await popup.evaluate(() => chrome.alarms.get('jda-evaluate')))!.scheduledTime).toBe(alarm!.scheduledTime);
});
