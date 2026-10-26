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
  await popup.getByLabel('Jev configuration (JSON)').fill(JSON.stringify(config));
  await popup.getByRole('button', { name: 'Save settings' }).click();
  await expect(popup.getByRole('status')).toHaveText('Settings saved.');
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  const page = await context.newPage(); await page.goto(`${base}/fixture?private=secret-query${multi ? '&multi=1' : ''}#secret-fragment`); await page.bringToFront();
  return { popup, page };
}
async function evaluate(popup: Page) {
  await popup.getByRole('button', { name: 'Evaluate current page' }).click();
  await expect(popup.getByRole('button', { name: 'Evaluate current page' })).toBeEnabled();
}
test.beforeEach(async ({ request }) => { await request.post(`${base}/control`, { data: {} }); });
for (const decision of ['update', 'asking for approval', 'clarifying question', 'other']) {
  test(`categorizes message as ${decision}`, async ({ context, extensionId, request }) => {
    await request.post(`${base}/control`, { data: { decision } });
    const { popup, page } = await setup(context, extensionId);
    await evaluate(popup);
    await expect(popup.getByRole('heading', { name: decision, exact: true })).toBeVisible();
    const calls = await (await request.get(`${base}/requests`)).json();
    expect(calls).toHaveLength(1);
    expect(calls[0].state.messages).toEqual([{ index: 0, id: 'message-1', text: 'Hello world' }]);
    expect(Object.keys(calls[0].questions.query_0.criteria)).toEqual(['update', 'asking for approval', 'clarifying question', 'other']);
    expect(calls[0].questions.query_0.instructions).not.toHaveProperty('rules');
    expect(JSON.stringify(calls)).not.toMatch(/secret-(input|textarea|script|query|fragment)/);
    await expect(page.locator('#sent p')).toHaveCount(0);
  });
}
test('stage two only checks approvals; any permitting rule replies approve exactly once', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decisions: {
    query_0: 'update', query_1: 'asking for approval', query_2: 'clarifying question', query_3: 'other',
    approve_1_0: 'no match', approve_1_1: 'can approve',
  } } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply }, true);
  await evaluate(popup);
  await expect(page.locator('#sent p')).toHaveText(['approve']);
  await expect(page.locator('#sent p')).toHaveAttribute('data-message-id', 'message-2');
  const calls = await (await request.get(`${base}/requests`)).json();
  expect(calls).toHaveLength(2);
  expect(Object.keys(calls[0].questions)).toEqual(['query_0', 'query_1', 'query_2', 'query_3']);
  expect(Object.keys(calls[1].questions)).toEqual(['approve_1_0', 'approve_1_1']);
  expect(calls[1].state.messages).toEqual([{ index: 1, id: 'message-2', text: 'Message 2' }]);
  expect(calls[1].questions.approve_1_1.instructions.rule).toBe(rules[1].description);
  expect(calls[1].state.page.url).toBe(`${base}/fixture`);
  expect(JSON.stringify(calls[1])).not.toMatch(/secret-(input|textarea|script|query|fragment)/);
  await evaluate(popup);
  await expect(page.locator('#sent p')).toHaveText(['approve']);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('already handled');
});
test('approval without a matching rule does nothing', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decision: 'asking for approval' } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await evaluate(popup);
  expect(await (await request.get(`${base}/requests`)).json()).toHaveLength(2);
  await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('#sent p')).toHaveCount(0);
});
test('disabled and non-permitting rules cannot authorize a reply', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decision: 'asking for approval' } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules: [ { ...rules[0], enabled: false }, { ...rules[1], canApprove: false } ], reply });
  await evaluate(popup);
  expect(await (await request.get(`${base}/requests`)).json()).toHaveLength(1);
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('other categories bypass approval rules even when rules permit approval', async ({ context, extensionId, request }) => {
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await evaluate(popup);
  expect(await (await request.get(`${base}/requests`)).json()).toHaveLength(1);
  await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('#sent p')).toHaveCount(0);
});
test('changed messages are not replied to', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decision: 'asking for approval', decisions: { approve_0_0: 'can approve' }, ruleDelay: 1000 } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  const running = evaluate(popup);
  await expect.poll(async () => (await (await request.get(`${base}/requests`)).json()).length).toBe(2);
  await page.locator('.message-text').evaluate(el => { el.textContent = 'A different action'; });
  await running;
  await expect(page.locator('#sent p')).toHaveCount(0);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('failed');
});
test('missing composer configuration does not click Reply', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decision: 'asking for approval', decisions: { approve_0_0: 'can approve' } } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply: { editorSelector: '', sendSelector: '' } });
  await evaluate(popup);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('Configure reply editor');
  await expect(page.locator('#composer')).toBeHidden();
});
test('settings persist and invalid edits are rejected', async ({ context, extensionId }) => {
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  const config = { ...defaultConfig, rules, reply };
  await options.getByLabel('Jev configuration (JSON)').fill(JSON.stringify(config));
  await options.getByRole('button', { name: 'Save settings' }).click(); await expect(options.getByRole('status')).toHaveText('Settings saved.');
  await options.reload(); await expect(options.getByLabel('Jev configuration (JSON)')).toHaveValue(JSON.stringify(config, null, 2));
  await options.getByLabel('Jev configuration (JSON)').fill('{"intervalSeconds":1}');
  await options.getByRole('button', { name: 'Save settings' }).click(); await expect(options.getByRole('status')).toContainText('Invalid settings');
});
test('upstream failure never sends a reply', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { fail: true } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply }); await evaluate(popup);
  await expect(popup.getByRole('alert')).toContainText('502'); await expect(page.locator('#sent p')).toHaveCount(0);
});
test('periodic loop captures fresh messages after popup closure and stops', async ({ context, extensionId, request }) => {
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, intervalSeconds: 30 });
  await popup.getByRole('button', { name: 'Start monitoring' }).click(); await expect(popup.getByTestId('monitoring')).toContainText('Monitoring on');
  await expect.poll(async () => (await (await request.get(`${base}/requests`)).json()).length).toBe(1);
  await popup.close(); await page.locator('.message-text').evaluate(el => { el.textContent = 'Changed during monitoring'; });
  await expect.poll(async () => (await (await request.get(`${base}/requests`)).json()).length, { timeout: 40000, intervals: [1000] }).toBeGreaterThanOrEqual(2);
  const calls = await (await request.get(`${base}/requests`)).json(); expect(calls[1].state.messages[0].text).toBe('Changed during monitoring');
  const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${extensionId}/index.html`);
  await reopened.getByRole('button', { name: 'Stop monitoring' }).click(); await expect(reopened.getByTestId('monitoring')).toContainText('Monitoring off');
  expect(await context.serviceWorkers()[0].evaluate(() => chrome.alarms.get('jda-evaluate'))).toBeUndefined();
});
test('bridge rejects web origins and invalid config; an empty query makes no API calls', async ({ request }) => {
  expect((await request.post('http://127.0.0.1:8787/decide', { headers: { Origin: 'https://example.com' }, data: {} })).status()).toBe(403);
  expect((await request.post('http://127.0.0.1:8787/decide', { data: {} })).status()).toBe(400);
  const response = await request.post('http://127.0.0.1:8787/decide', { data: { config: defaultConfig, snapshot: { url: `${base}/fixture`, title: '', text: '', elements: [], messages: [] } } });
  expect((await response.json()).queryResults).toEqual([]); expect(await (await request.get(`${base}/requests`)).json()).toEqual([]);
});

test('a rule-stage API failure cannot authorize a reply', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decision: 'asking for approval', failRules: true } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await evaluate(popup);
  await expect(popup.getByRole('alert')).toContainText('502');
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('#sent p')).toHaveCount(0);
});
test('existing reply drafts are never overwritten or sent', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decision: 'asking for approval', decisions: { approve_0_0: 'can approve' } } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await page.locator('#composer').evaluate(el => { (el as HTMLElement).hidden = false; });
  await page.locator('[aria-label="Message"]').evaluate(el => { el.textContent = 'My draft'; });
  await evaluate(popup);
  await expect(page.locator('#sent p')).toHaveCount(0);
  await expect(page.locator('[aria-label="Message"]')).toHaveText('My draft');
  expect(JSON.stringify(await (await request.get(`${base}/requests`)).json())).not.toContain('My draft');
});
test('messages without a stable ID are never replied to by index', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { decision: 'asking for approval', decisions: { approve_0_0: 'can approve' } } });
  const { popup, page } = await setup(context, extensionId, { ...defaultConfig, rules, reply });
  await page.locator('.message-body').evaluate(el => el.removeAttribute('data-message-id'));
  await evaluate(popup);
  await expect(popup.getByRole('region', { name: 'Decision result' })).toContainText('stable data-message-id');
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('#sent p')).toHaveCount(0);
});
