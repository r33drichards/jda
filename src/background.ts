import { loadConfig, resultSchema } from './shared';
import type { Latest } from './shared';
import { captureSnapshot } from './snapshot';

const ALARM = 'jda-evaluate';
let inFlight = false;
async function evaluate() {
  if (inFlight) return;
  inFlight = true;
  let url: string | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error('Open a web page before evaluating.');
    const [{ result: snapshot }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureSnapshot });
    if (!snapshot) throw new Error('Could not read this page.');
    url = snapshot.url;
    const response = await fetch('http://127.0.0.1:8787/decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: await loadConfig(), snapshot }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Decision service returned ${response.status}. Check the local server and API key.`);
    const latest: Latest = { result: resultSchema.parse(await response.json()), url, evaluatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ latest });
  } catch (error) {
    const latest: Latest = { error: error instanceof Error ? error.message : 'Evaluation failed.', url, evaluatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ latest });
  } finally { inFlight = false; }
}
async function reschedule() {
  const { monitoring } = await chrome.storage.local.get('monitoring');
  await chrome.alarms.clear(ALARM);
  if (monitoring) {
    const config = await loadConfig();
    await chrome.alarms.create(ALARM, { periodInMinutes: config.intervalSeconds / 60 });
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  let task: Promise<unknown>;
  switch (message?.type) {
    case 'EVALUATE': task = evaluate(); break;
    case 'START': task = chrome.storage.local.set({ monitoring: true }).then(reschedule).then(evaluate); break;
    case 'STOP': task = chrome.storage.local.set({ monitoring: false }).then(reschedule); break;
    case 'RESCHEDULE': task = reschedule(); break;
    default: return;
  }
  task.then(() => respond({ ok: true })).catch(() => respond({ error: 'Could not update monitoring.' }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) {
    void chrome.storage.local.get('monitoring').then(({ monitoring }) => { if (monitoring) return evaluate(); });
  }
});
chrome.runtime.onStartup.addListener(() => { void reschedule(); });
chrome.runtime.onInstalled.addListener(() => { void reschedule(); });
