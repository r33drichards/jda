import { loadConfig, resultSchema } from './shared';
import type { Latest } from './shared';
import { captureSnapshot } from './snapshot';
import { replyApprove } from './reply';

const ALARM = 'jda-evaluate';
let inFlight = false;
async function evaluate() {
  if (inFlight) return;
  inFlight = true;
  let url: string | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error('Open a web page before evaluating.');
    const [capture] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureSnapshot });
    const snapshot = capture.result;
    const config = await loadConfig();
    if (!snapshot) throw new Error('Could not read this page.');
    url = snapshot.url;
    const response = await fetch('http://127.0.0.1:8787/decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, snapshot }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Decision service returned ${response.status}. Check the local server and API key.`);
    const result = resultSchema.parse(await response.json());
    const { approvalReceipts = {} } = await chrome.storage.local.get('approvalReceipts');
    for (const item of result.queryResults ?? []) {
      if (item.result.decision !== 'asking for approval' || item.action !== 'approve') continue;
      const bytes = new TextEncoder().encode(`${snapshot.url}|${item.id}`);
      const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
      if (approvalReceipts[key]) {
        item.replyStatus = approvalReceipts[key].state === 'sent' ? 'already handled' : 'failed';
        if (item.replyStatus === 'failed') item.replyError = 'A previous attempt was incomplete or failed; inspect the page before retrying manually.';
        continue;
      }
      try {
        if (!item.id) throw new Error('Automatic replies require a stable data-message-id.');
        if (!config.reply.editorSelector || !config.reply.sendSelector) throw new Error('Configure reply editor and Send selectors in Settings.');
        // Persist before the click so a worker restart cannot send the same approval twice.
        approvalReceipts[key] = { state: 'sending', at: new Date().toISOString() };
        await chrome.storage.local.set({ approvalReceipts });
        const [reply] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, documentIds: [capture.documentId!] },
          func: replyApprove, args: [{ index: item.index, id: item.id, text: item.text }, config.reply],
        });
        if (reply.result !== 'sent') throw new Error('Reply execution did not finish.');
        item.replyStatus = 'sent'; approvalReceipts[key].state = 'sent';
      } catch (error) {
        item.replyStatus = 'failed'; item.replyError = error instanceof Error ? error.message : 'Reply failed.';
        if (approvalReceipts[key]) approvalReceipts[key].state = 'failed';
      }
      await chrome.storage.local.set({ approvalReceipts });
    }
    const latest: Latest = { result, url, evaluatedAt: new Date().toISOString() };
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
