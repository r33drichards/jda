import { test, expect } from './fixtures';
import { defaultConfig } from '../src/shared';
import type { QueryItem } from '../server/query';

const base = 'http://127.0.0.1:8790';
test.beforeEach(async ({ request }) => { await request.post(`${base}/control`, { data: {} }); });
for (const decision of ['update', 'asking for approval', 'clarifying question', 'other']) {
  test(`current DOM → real bridge + SDK → ${decision}`, async ({ context, extensionId, request }) => {
    await request.post(`${base}/control`, { data: { decision } });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    const page = await context.newPage();
    await page.goto(`${base}/fixture?private=secret-query#secret-fragment`);
    await page.bringToFront();
    await popup.getByRole('button', { name: 'Evaluate current page' }).click();
    await expect(popup.getByRole('heading', { name: decision, exact: true })).toBeVisible();
    const calls = await (await request.get(`${base}/requests`)).json();
    expect(calls).toHaveLength(1);
    expect(calls[0].questions.classification.type).toBe('choice');
    expect(Object.keys(calls[0].questions.classification.criteria)).toEqual(['update', 'asking for approval', 'clarifying question', 'other']);
    expect(calls[0].questions.classification.instructions.rules).toEqual(defaultConfig.rules);
    expect(calls[0].state.text).toContain('Hello world');
    expect(calls[0].state.elements).toContainEqual({ tag: 'input', role: '', text: '', type: 'password' });
    expect(JSON.stringify(calls[0])).not.toMatch(/secret-(input|textarea|script|query|fragment)/);
  });
}
test('settings persist, disabled rules are excluded, and invalid edits are rejected', async ({ context, extensionId, request }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const config = { ...defaultConfig, model: 'jev-test', rules: defaultConfig.rules.map((r, i) => ({ ...r, enabled: i === 0 })) };
  await options.getByLabel('Jev configuration (JSON)').fill(JSON.stringify(config));
  await options.getByRole('button', { name: 'Save settings' }).click();
  await expect(options.getByRole('status')).toHaveText('Settings saved.');
  await options.reload();
  await expect(options.getByLabel('Jev configuration (JSON)')).toHaveValue(JSON.stringify(config, null, 2));
  await options.getByLabel('Jev configuration (JSON)').fill('{"intervalSeconds":1}');
  await options.getByRole('button', { name: 'Save settings' }).click();
  await expect(options.getByRole('status')).toContainText('Invalid settings');
  await options.goto(`chrome-extension://${extensionId}/index.html`);
  const target = await context.newPage(); await target.goto(`${base}/fixture`); await target.bringToFront();
  await options.getByRole('button', { name: 'Evaluate current page' }).click();
  await expect(options.getByRole('heading', { name: 'update', exact: true })).toBeVisible();
  const calls = await (await request.get(`${base}/requests`)).json();
  expect(calls[0].model).toBe('jev-test');
  expect(calls[0].questions.classification.instructions.rules).toHaveLength(1);
});
test('upstream failure is visible and never displayed as a decision', async ({ context, extensionId, request }) => {
  await request.post(`${base}/control`, { data: { fail: true } });
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/index.html`);
  const target = await context.newPage(); await target.goto(`${base}/fixture`); await target.bringToFront();
  await popup.getByRole('button', { name: 'Evaluate current page' }).click();
  await expect(popup.getByRole('alert')).toContainText('502');
  await expect(popup.getByRole('region', { name: 'Decision result' })).toHaveCount(0);
});
test('periodic loop uses the latest DOM, survives popup closure, and stops', async ({ context, extensionId, request }) => {
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/options.html`);
  await popup.getByLabel('Jev configuration (JSON)').fill(JSON.stringify({ ...defaultConfig, intervalSeconds: 30 }));
  await popup.getByRole('button', { name: 'Save settings' }).click();
  await expect(popup.getByRole('status')).toHaveText('Settings saved.');
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  const target = await context.newPage(); await target.goto(`${base}/fixture`); await target.bringToFront();
  await popup.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(popup.getByTestId('monitoring')).toContainText('Monitoring on');
  await expect.poll(async () => (await (await request.get(`${base}/requests`)).json()).length).toBe(1);
  await popup.close();
  await target.locator('h1').evaluate(el => { el.textContent = 'Changed during monitoring'; });
  await expect.poll(async () => (await (await request.get(`${base}/requests`)).json()).length, { timeout: 40000, intervals: [1000] }).toBeGreaterThanOrEqual(2);
  const calls = await (await request.get(`${base}/requests`)).json();
  expect(calls[1].state.text).toContain('Changed during monitoring');
  const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${extensionId}/index.html`);
  await reopened.getByRole('button', { name: 'Stop monitoring' }).click();
  await expect(reopened.getByTestId('monitoring')).toContainText('Monitoring off');
  const worker = context.serviceWorkers()[0];
  expect(await worker.evaluate(() => chrome.alarms.get('jda-evaluate'))).toBeUndefined();
});
test('bridge rejects web origins and invalid configuration', async ({ request }) => {
  const forbidden = await request.post('http://127.0.0.1:8787/decide', { headers: { Origin: 'https://example.com' }, data: {} });
  expect(forbidden.status()).toBe(403);
  const invalid = await request.post('http://127.0.0.1:8787/decide', { data: {} });
  expect(invalid.status()).toBe(400);
});
test('no enabled rules returns other without calling Jev', async ({ request }) => {
  const response = await request.post('http://127.0.0.1:8787/decide', { data: {
    config: { ...defaultConfig, rules: [] }, snapshot: { url: `${base}/fixture`, title: '', text: 'Hello world', elements: [] },
  } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ decision: 'other', confidence: null, probabilities: null });
  expect(await (await request.get(`${base}/requests`)).json()).toEqual([]);
});
test('query JSON items become separate questions in one Jev request', async ({ request }) => {
  const { TypeSafeClient } = await import('@typesafe-ai/sdk');
  const { decide } = await import('../server/decide');
  const { query } = await import('../server/query');
  const snapshot = { url: `${base}/fixture`, title: 'Messages', text: 'A page with messages', elements: [] };
  expect(await query(snapshot)).toEqual([]); // Deliberately unimplemented hook.
  const items: QueryItem[] = [{ id: 'message-1', text: 'Build finished', metadata: { complete: true } }, { id: 'message-2', text: 'Deployment finished' }];
  const client = new TypeSafeClient({ apiKey: 'jda-fake-test-key', baseURL: base, compression: false, retry: { maxRetries: 0 } });
  await request.post(`${base}/control`, { data: { decisions: { query_0: 'update', query_1: 'asking for approval' } } });
  const result = await decide(client, defaultConfig, snapshot, items);
  expect(result.queryResults?.map(item => ({ index: item.index, decision: item.result.decision }))).toEqual([
    { index: 0, decision: 'update' }, { index: 1, decision: 'asking for approval' },
  ]);
  const calls = await (await request.get(`${base}/requests`)).json();
  expect(calls).toHaveLength(1);
  expect(calls[0].state).toEqual({ page: snapshot, queryItems: items });
  expect(Object.keys(calls[0].questions)).toEqual(['classification', 'query_0', 'query_1']);
  expect(calls[0].questions.query_0.instructions.task).toContain('queryItems[0]');
  expect(calls[0].questions.query_1.instructions.task).toContain('queryItems[1]');
});
