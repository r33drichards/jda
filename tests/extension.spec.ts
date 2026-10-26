import { test, expect } from './fixtures';
import { defaultConfig } from '../src/shared';
import type { Config } from '../src/shared';
import type { BrowserContext, Page } from '@playwright/test';

const base = 'http://127.0.0.1:8790';
const rules: Config['rules'] = [
  { id: 'tests', description: 'May run local tests that do not modify external systems.', canApprove: true, enabled: true },
  { id: 'docs', description: 'May read local documentation.', canApprove: true, enabled: true },
];
const reply = defaultConfig.reply;
async function setup(context: BrowserContext, extensionId: string, config: Config = defaultConfig, multi = false) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/options.html`);
  await popup.getByLabel('Configuration (JSON)').fill(JSON.stringify(config));
  await popup.getByRole('button', { name: 'Save settings' }).click();
  await expect(popup.getByRole('status')).toHaveText('Settings saved.');
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  const page = await context.newPage(); await page.goto(`${base}/fixture?private=secret-query${multi ? '&multi=1' : ''}#secret-fragment`); await page.bringToFront();
  await expect(popup.getByRole('button', { name: 'Allow this tab', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Allow this tab', exact: true }).click();
  await expect(popup.getByTestId('tab-access')).toHaveText('Allowed on this tab');
  return { popup, page };
}
async function evaluate(popup: Page) {
  await popup.getByRole('button', { name: 'Evaluate current page' }).click();
  await expect(popup.getByRole('button', { name: 'Evaluate current page' })).toBeEnabled({ timeout: 35000 });
}
test.beforeEach(async ({ model }) => { await model.configure({}); });
for (const decision of ['update', 'asking for approval', 'clarifying question', 'other']) {
  test(`categorizes message as ${decision}`, async ({ context, extensionId, model }) => {
    await model.configure({ decision });
    const { popup, page } = await setup(context, extensionId);
    await evaluate(popup);
    await expect(popup.getByRole('heading', { name: decision, exact: true })).toBeVisible();
    const calls = await model.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].input.messages).toEqual([{ index: 0, id: 'message-1', text: 'Hello world' }]);
    expect(calls[0].input.stage).toBe('categorize');
    expect(JSON.stringify(calls[0].schema)).toContain('asking for approval');
    expect(calls[0].input).not.toHaveProperty('rules');
    expect(JSON.stringify(calls)).not.toMatch(/secret-(input|textarea|script|query|fragment)/);
    await expect(page.locator('#sent p')).toHaveCount(0);
  });
}
test('stage two only checks approvals; any permitting rule replies approve exactly once', async ({ context, extensionId, model }) => {
  await model.configure({ decisions: {
    query_0: 'update', query_1: 'asking for approval', query_2: 'clarifying question', query_3: 'other',
    '1:tests': 'no match', '1:docs': 'can approve',
  } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply }, true);
  await evaluate(popup);
  await expect(page.locator('#sent p')).toHaveText(['approve']);
  await expect(page.locator('#sent p')).toHaveAttribute('data-message-id', 'message-2');
  await expect(page.locator('body')).toHaveAttribute('data-closed-after-send', '1');
  await expect(page.getByRole('button', { name: 'Close replies' })).toBeHidden();
  const calls = await model.calls();
  expect(calls).toHaveLength(2);
  expect(calls[0].input.messages).toHaveLength(4);
  expect(calls[1].input.checks?.map(c => c.key)).toEqual(['1:tests', '1:docs']);
  expect(calls[1].input.message).toEqual({ index: 1, id: 'message-2', text: 'Message 2' });
  expect(calls[1].input.checks?.[1].rule).toBe(rules[1].description);
  expect(calls[1].input.page?.url).toBe(`${base}/fixture`);
  expect(JSON.stringify(calls[1])).not.toMatch(/secret-(input|textarea|script|query|fragment)/);
  await evaluate(popup);
  await expect(page.locator('#sent p')).toHaveText(['approve']);
  await expect(popup.getByRole('status')).toHaveText('No unread messages to process.');
  expect(await model.calls()).toHaveLength(2);
});
test('approval without a matching rule does nothing', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval' });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await evaluate(popup);
  expect(await model.calls()).toHaveLength(2);
  await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('#sent p')).toHaveCount(0);
});
test('disabled and non-permitting rules cannot authorize a reply', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval' });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules: [ { ...rules[0], enabled: false }, { ...rules[1], canApprove: false } ], reply });
  await evaluate(popup);
  expect(await model.calls()).toHaveLength(1);
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('other categories bypass approval rules even when rules permit approval', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await evaluate(popup);
  await expect(popup.getByRole('heading', { name: 'update', exact: true })).toBeVisible();
  expect(await model.calls()).toHaveLength(1);
  await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('#sent p')).toHaveCount(0);
});
test('changed messages are not replied to', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', decisions: { '0:tests': 'can approve' }, ruleDelay: 1000 });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  const running = evaluate(popup);
  await expect.poll(async () => (await model.calls()).length).toBe(2);
  await page.locator('.message-text').evaluate(el => { el.textContent = 'A different action'; });
  await running;
  await expect(page.locator('#sent p')).toHaveCount(0);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('failed');
});
test('missing composer configuration does not click Reply', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', decisions: { '0:tests': 'can approve' } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply: { editorSelector: '', sendSelector: '' } });
  await evaluate(popup);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('Configure reply editor');
  await expect(page.locator('#composer')).toBeHidden();
});
test('settings persist and invalid edits are rejected', async ({ context, extensionId }) => {
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  const config = { ...defaultConfig, rules, reply };
  await options.getByLabel('Configuration (JSON)').fill(JSON.stringify(config));
  await options.getByRole('button', { name: 'Save settings' }).click(); await expect(options.getByRole('status')).toHaveText('Settings saved.');
  await options.reload(); await expect(options.getByLabel('Configuration (JSON)')).toHaveValue(JSON.stringify(config, null, 2));
  await options.getByLabel('Configuration (JSON)').fill('{"intervalSeconds":1}');
  await options.getByRole('button', { name: 'Save settings' }).click(); await expect(options.getByRole('status')).toContainText('Invalid settings');
});
test('upstream failure never sends a reply', async ({ context, extensionId, model }) => {
  await model.configure({ fail: true });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply }); await evaluate(popup);
  await expect(popup.getByRole('alert')).toContainText('Test model inference failed'); await expect(page.locator('#sent p')).toHaveCount(0);
});
test('periodic loop captures fresh messages after popup closure and stops', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, intervalSeconds: 30 });
  await popup.getByRole('button', { name: 'Start monitoring' }).click(); await expect(popup.getByTestId('monitoring')).toContainText('Monitoring on');
  await expect.poll(async () => (await model.calls()).length).toBe(1);
  await popup.close(); await page.locator('.message-text').evaluate(el => { el.textContent = 'Changed during monitoring'; });
  await expect.poll(async () => (await model.calls()).length, { timeout: 40000, intervals: [1000] }).toBeGreaterThanOrEqual(2);
  const calls = await model.calls(); expect(calls[1].input.messages![0].text).toBe('Changed during monitoring');
  const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${extensionId}/index.html`);
  await reopened.getByRole('button', { name: 'Stop monitoring' }).click(); await expect(reopened.getByTestId('monitoring')).toContainText('Monitoring off');
  expect(await context.serviceWorkers()[0].evaluate(() => chrome.alarms.get('jda-evaluate'))).toBeUndefined();
});
test('an empty query makes no model calls', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId);
  await page.locator('.message-body').evaluate(el => el.remove());
  await evaluate(popup);
  expect(await model.calls()).toEqual([]);
});

test('a rule-stage API failure cannot authorize a reply', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', failRules: true });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await evaluate(popup);
  await expect(popup.getByRole('alert')).toContainText('Test model inference failed');
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('existing reply drafts are never overwritten or sent', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', decisions: { '0:tests': 'can approve' } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await page.locator('#composer').evaluate(el => { (el as HTMLElement).hidden = false; });
  await page.locator('[aria-label="Message"]').evaluate(el => { el.textContent = 'My draft'; });
  await evaluate(popup);
  await expect(page.locator('#sent p')).toHaveCount(0);
  await expect(page.locator('[aria-label="Message"]')).toHaveText('My draft');
  expect(JSON.stringify(await model.calls())).not.toContain('My draft');
});
test('messages without a stable ID are never replied to by index', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', decisions: { '0:tests': 'can approve' } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await page.locator('.message-body').evaluate(el => el.removeAttribute('data-message-id'));
  await evaluate(popup);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('stable data-message-id');
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('#sent p')).toHaveCount(0);
});

test('seen messages persist across reloads; edits and new messages are processed', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId);
  await evaluate(popup);
  await page.reload(); await popup.reload(); await page.bringToFront();
  await evaluate(popup);
  await expect(popup.getByRole('status')).toHaveText('No unread messages to process.');
  expect(await model.calls()).toHaveLength(1);
  await page.locator('.message-text').evaluate(el => { el.textContent = 'Edited message'; });
  await evaluate(popup);
  const calls = await model.calls();
  expect(calls).toHaveLength(2); expect(calls[1].input.messages![0].text).toBe('Edited message');
  await page.locator('.message-body').evaluate(el => { const next = el.cloneNode(true) as HTMLElement; next.dataset.messageId = 'new-message'; next.querySelector('.message-text')!.textContent = 'New message'; el.after(next); });
  await evaluate(popup);
  const updated = await model.calls();
  expect(updated).toHaveLength(3); expect(updated[2].input.messages).toEqual([{ index: 1, id: 'new-message', text: 'New message' }]);
});
test('Mark all as read skips every existing message, including beyond one batch', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await page.locator('.message-body').evaluate(el => { for (let i = 1; i < 35; i++) { const next = el.cloneNode(true) as HTMLElement; next.dataset.messageId = `extra-${i}`; el.after(next); } });
  await popup.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(popup.getByRole('status')).toHaveText('Marked 35 messages as read.');
  await evaluate(popup);
  await expect(popup.getByRole('status')).toHaveText('No unread messages to process.');
  expect(await model.calls()).toEqual([]);
  await expect(page.locator('#sent p')).toHaveCount(0);
  await page.locator('.message-body').first().evaluate(el => { const next = el.cloneNode(true) as HTMLElement; next.dataset.messageId = 'after-mark-read'; el.after(next); });
  await evaluate(popup);
  const calls = await model.calls();
  expect(calls).toHaveLength(1); expect(calls[0].input.messages).toHaveLength(1);
  expect(calls[0].input.messages![0].id).toBe('after-mark-read');
});
test('seen filtering allows later batches past the first 30 messages', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId);
  await page.locator('.message-body').evaluate(el => { for (let i = 1; i < 35; i++) { const next = el.cloneNode(true) as HTMLElement; next.dataset.messageId = `extra-${i}`; el.after(next); } });
  await evaluate(popup); await evaluate(popup); await evaluate(popup);
  const calls = await model.calls();
  expect(calls.map(call => call.input.messages!.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 2, 4, 1]);
  expect(new Set(calls.flatMap(call => call.input.messages!.map(m => m.id))).size).toBe(35);
});
test('failed model requests remain unread and can retry', async ({ context, extensionId, model }) => {
  await model.configure({ fail: true });
  const { popup } = await setup(context, extensionId); await evaluate(popup);
  await expect(popup.getByRole('alert')).toContainText('Test model inference failed');
  await model.configure({});
  await evaluate(popup);
  await expect(popup.getByRole('heading', { name: 'update', exact: true })).toBeVisible();
  expect(await model.calls()).toHaveLength(1);
});

test('allowance is per tab, even for another tab on the same site', async ({ context, extensionId, model }) => {
  const { popup, page } = await setup(context, extensionId);
  const other = await context.newPage(); await other.goto(`${base}/fixture`); await other.bringToFront();
  await expect(popup.getByTestId('tab-access')).toHaveText('Inactive on this tab');
  await expect(popup.getByRole('button', { name: 'Evaluate current page' })).toBeDisabled();
  await expect(popup.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'EVALUATE' }));
  expect(await model.calls()).toEqual([]);
  await page.bringToFront();
  await expect(popup.getByTestId('tab-access')).toHaveText('Allowed on this tab');
  await evaluate(popup);
  expect(await model.calls()).toHaveLength(1);
});
test('disallowing a tab blocks direct evaluate, mark-read, and monitoring requests', async ({ context, extensionId, model }) => {
  const { popup } = await setup(context, extensionId);
  await popup.getByRole('button', { name: 'Disallow this tab' }).click();
  await expect(popup.getByTestId('tab-access')).toHaveText('Inactive on this tab');
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'EVALUATE' }));
  const read = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'MARK_ALL_READ' }));
  const start = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'START' }));
  expect(read.error).toContain('inactive'); expect(start.error).toContain('inactive');
  expect(await model.calls()).toEqual([]);
  expect(await popup.evaluate(() => chrome.storage.local.get('seenMessages'))).toEqual({});
});
test('revoking while the model is running prevents the pending approval reply', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', decisions: { '0:tests': 'can approve' }, holdRules: true });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await popup.getByRole('button', { name: 'Evaluate current page' }).click();
  await expect.poll(async () => (await model.calls()).length).toBe(2);
  await popup.getByRole('button', { name: 'Disallow this tab' }).click();
  await expect(popup.getByTestId('tab-access')).toHaveText('Inactive on this tab');
  await model.releaseRules();
  await expect.poll(() => popup.evaluate(async () => (await chrome.storage.local.get('latest')).latest?.result?.queryResults?.[0]?.replyStatus)).toBe('failed');
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('changing sites revokes the tab and closing it removes its allowance', async ({ context, extensionId }) => {
  const { popup, page } = await setup(context, extensionId);
  const keys = await popup.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter(k => k.startsWith('allowedTab:')));
  expect(keys).toHaveLength(1);
  await page.goto('about:blank');
  await expect.poll(() => popup.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter(k => k.startsWith('allowedTab:')).length)).toBe(0);
  await page.goto(`${base}/fixture`); await page.bringToFront();
  await expect(popup.getByTestId('tab-access')).toHaveText('Inactive on this tab');
  await popup.getByRole('button', { name: 'Allow this tab', exact: true }).click();
  await expect(popup.getByTestId('tab-access')).toHaveText('Allowed on this tab');
  await page.close();
  await expect.poll(() => popup.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter(k => k.startsWith('allowedTab:')).length)).toBe(0);
});

for (const availability of ['unavailable', 'downloadable', 'downloading'] as const) {
  test(`model ${availability} never processes messages or starts monitoring`, async ({ context, extensionId, model }) => {
    await model.configure({ availability });
    const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
    await expect(popup.getByRole('button', { name: 'Evaluate current page' })).toBeDisabled();
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'EVALUATE' }));
    await expect(popup.getByRole('alert')).toContainText(availability === 'unavailable' ? 'unavailable' : 'Prepare');
    const start = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'START' }));
    expect(start.error).toBeTruthy();
    expect(await model.calls()).toEqual([]);
    expect(await popup.evaluate(() => chrome.storage.local.get('seenMessages'))).toEqual({});
    await expect(page.locator('#sent p')).toHaveCount(0);
    // Mark all as read remains a local operation even when no model is available.
    await popup.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(popup.getByRole('status')).toHaveText('Marked 1 messages as read.');
  });
}
test('Prepare model downloads on user action and enables local inference', async ({ context, extensionId, model }) => {
  await model.configure({ availability: 'downloadable' });
  const { popup } = await setup(context, extensionId);
  await popup.getByRole('button', { name: 'Prepare model' }).click();
  await expect(popup.getByTestId('model-status')).toHaveText('Chrome model: available');
  await evaluate(popup);
  await expect(popup.getByRole('heading', { name: 'update', exact: true })).toBeVisible();
  expect(await model.calls()).toHaveLength(1);
});
for (const malformed of ['json', 'category', 'missing', 'duplicate', 'rule'] as const) {
  test(`invalid ${malformed} model output never authorizes an approval`, async ({ context, extensionId, model }) => {
    await model.configure({ decision: 'asking for approval', malformed });
    const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
    await evaluate(popup);
    await expect(popup.getByRole('alert')).toBeVisible();
    await expect(page.locator('#sent p')).toHaveCount(0);
    await expect(page.locator('#composer')).toBeHidden();
    const { seenMessages = {} } = await popup.evaluate(() => chrome.storage.local.get('seenMessages'));
    expect(Object.keys(seenMessages)).toHaveLength(0);
  });
}
test('oversized model context stops before inference or replies', async ({ context, extensionId, model }) => {
  await model.configure({ decision: 'asking for approval', contextTooSmall: true });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await evaluate(popup);
  await expect(popup.getByRole('alert')).toContainText('context is too small');
  expect(await model.calls()).toEqual([]);
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('local decisions make no AI or localhost-bridge network requests', async ({ context, extensionId, model }) => {
  const outbound: string[] = [];
  context.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/')) outbound.push(request.url()); });
  const { popup } = await setup(context, extensionId);
  await evaluate(popup);
  expect(await model.calls()).toHaveLength(1);
  expect(outbound).toEqual([]);
});
test('legacy saved settings retain rules while removing the old model option', async ({ context, extensionId }) => {
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(config => chrome.storage.local.set({ config }), { ...defaultConfig, model: 'jev-latest', rules });
  await options.reload();
  await expect(options.getByLabel('Configuration (JSON)')).toHaveValue(JSON.stringify({ ...defaultConfig, rules }, null, 2));
});
