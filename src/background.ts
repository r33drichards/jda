import { loadConfig } from './shared';
import type { Latest } from './shared';
import { captureSnapshot } from './snapshot';
import { replyApprove } from './reply';
import { identifyMessages, unreadBatch } from './seen';
import type { SeenMessages } from './seen';
import { decide } from './decide';
import { requireModelReady } from './model';
import { startDebug, nextDebugStep, clearDebug, finishDebug, debugActive } from './debug';
import { refreshHighlights, refreshAllowedHighlights } from './highlights';
import { allowCurrentTab, currentTab, requireAllowed, revokeTab, tabAllowance } from './tabs';

const ALARM = 'jda-evaluate';
let inFlight = false;
async function evaluate() {
  if (inFlight) return;
  inFlight = true;
  let url: string | undefined;
  let claimedKeys: string[] = [];
  let classificationsSaved = false;
  try {
    if (await debugActive()) throw new Error('A debug preview is paused. Finish or clear it before evaluating.');
    const tab = await currentTab();
    const allowance = await requireAllowed(tab.id!);
    await requireModelReady();
    const [capture] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: captureSnapshot });
    const snapshot = capture.result;
    const config = await loadConfig();
    if (!snapshot) throw new Error('Could not read this page.');
    url = snapshot.url;
    const { seenMessages = {} }: { seenMessages?: SeenMessages } = await chrome.storage.local.get('seenMessages');
    const pending = unreadBatch(await identifyMessages(url, snapshot.messages), seenMessages);
    if (!pending.length) {
      await chrome.storage.local.set({ latest: { url, evaluatedAt: new Date().toISOString(), notice: 'No unread messages to process.' } });
      return;
    }
    claimedKeys = pending.map(item => item.key);
    for (const key of claimedKeys) seenMessages[key] = { state: 'processing', at: new Date().toISOString() };
    // Reserve the batch before model inference so a worker restart cannot process it twice.
    await chrome.storage.local.set({ seenMessages });
    snapshot.messages = pending.map(item => item.message);
    await requireAllowed(tab.id!, allowance.token);
    const result = await decide(config, snapshot, () => requireAllowed(tab.id!, allowance.token));
    for (const key of claimedKeys) seenMessages[key] = { state: 'processed', at: new Date().toISOString() };
    await chrome.storage.local.set({ seenMessages });
    classificationsSaved = true;
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
        await requireAllowed(tab.id!, allowance.token);
        if (!item.id) throw new Error('Automatic replies require a stable data-message-id.');
        if (!config.reply.editorSelector || !config.reply.sendSelector) throw new Error('Configure reply editor and Send selectors in Settings.');
        // Persist before the click so a worker restart cannot send the same approval twice.
        approvalReceipts[key] = { state: 'sending', at: new Date().toISOString() };
        await chrome.storage.local.set({ approvalReceipts });
        const [reply] = await chrome.scripting.executeScript({
          target: { tabId: tab.id!, documentIds: [capture.documentId!] },
          func: replyApprove, args: [{ index: item.index, id: item.id, text: item.text }, config.reply, allowance.token],
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
    // Model/validation failures are retryable; completed or interrupted batches stay seen.
    if (claimedKeys.length && !classificationsSaved) {
      const { seenMessages = {} } = await chrome.storage.local.get('seenMessages');
      for (const key of claimedKeys) delete seenMessages[key];
      await chrome.storage.local.set({ seenMessages });
    }
    const latest: Latest = { error: error instanceof Error ? error.message : 'Evaluation failed.', url, evaluatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ latest });
  } finally { inFlight = false; }
}
async function markAllRead() {
  if (inFlight) throw new Error('Wait for the current evaluation to finish.');
  inFlight = true;
  try {
    const tab = await currentTab();
    await requireAllowed(tab.id!);
    const [{ result: snapshot }] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: captureSnapshot });
    if (!snapshot) throw new Error('Could not read this page.');
    const { seenMessages = {} }: { seenMessages?: SeenMessages } = await chrome.storage.local.get('seenMessages');
    const items = await identifyMessages(snapshot.url, snapshot.messages);
    for (const { key } of items) seenMessages[key] = { state: 'read', at: new Date().toISOString() };
    await chrome.storage.local.set({ seenMessages, latest: {
      url: snapshot.url, evaluatedAt: new Date().toISOString(), notice: `Marked ${new Set(items.map(item => item.key)).size} messages as read.`,
    } });
  } finally { inFlight = false; }
}
async function popSeen(targetId?: number) {
  if (inFlight) throw new Error('Wait for the current evaluation to finish.');
  inFlight = true;
  try {
    const tab = targetId ? await chrome.tabs.get(targetId) : await currentTab();
    await requireAllowed(tab.id!);
    const [{ result: snapshot }] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: captureSnapshot });
    if (!snapshot) throw new Error('Could not read this page.');
    const { seenMessages = {} }: { seenMessages?: SeenMessages } = await chrome.storage.local.get('seenMessages');
    const items = await identifyMessages(snapshot.url, snapshot.messages);
    const latest = items.filter(item => !!seenMessages[item.key])
      .sort((a, b) => seenMessages[b.key].at.localeCompare(seenMessages[a.key].at) || b.message.index - a.message.index)[0];
    const notice = latest ? `Made message ${latest.message.id ?? latest.message.index} unread. Approval receipts are retained.` : 'No read messages on this page to pop.';
    if (latest) { delete seenMessages[latest.key]; await chrome.storage.local.set({ seenMessages }); }
    await chrome.storage.local.set({ latest: { url: snapshot.url, notice, evaluatedAt: new Date().toISOString() } });
    await refreshHighlights(tab.id!);
    return { notice, message: latest?.message };
  } finally { inFlight = false; }
}
async function debugExclusive(action: () => Promise<unknown>) {
  if (inFlight) throw new Error('Wait for the current stage to finish.');
  inFlight = true;
  try { return await action(); } finally { inFlight = false; }
}
async function openDebug() {
  const tab = await currentTab(); await requireAllowed(tab.id!);
  return chrome.tabs.create({ url: chrome.runtime.getURL(`debug.html?tab=${tab.id}`) });
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
  if (message?.type === 'REFRESH_HIGHLIGHTS' && sender.id === chrome.runtime.id && sender.tab?.id) {
    void refreshHighlights(sender.tab.id, message.token).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
    return true;
  }
  if (message?.type === 'CHECK_TAB_ALLOWANCE' && sender.id === chrome.runtime.id && sender.tab?.id) {
    void tabAllowance(sender.tab.id, message.token).then(allowance => respond({ allowed: !!allowance }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  let task: Promise<unknown>;
  switch (message?.type) {
    case 'DRY_RUN': task = debugExclusive(async () => {
      const tab = await currentTab();
      let run = await startDebug(tab.id!, false);
      await chrome.tabs.create({ url: chrome.runtime.getURL(`debug.html?tab=${tab.id}`) });
      while (!run.finished) {
        run = await nextDebugStep();
        if (run.steps.some(step => step.status === 'error')) break;
      }
      return run;
    }); break;
    case 'OPEN_DEBUG': task = openDebug(); break;
    case 'DEBUG_START': task = debugExclusive(() => startDebug(message.tabId, !!message.includeSeen)); break;
    case 'DEBUG_NEXT': task = debugExclusive(nextDebugStep); break;
    case 'DEBUG_FINISH': task = debugExclusive(finishDebug); break;
    case 'DEBUG_CLEAR': task = debugExclusive(clearDebug); break;
    case 'GET_TAB_ACCESS': task = currentTab().then(async tab => ({ allowed: !!(await tabAllowance(tab.id!)) })); break;
    case 'ALLOW_TAB': task = allowCurrentTab(message.tabId).then(() => refreshHighlights(message.tabId)); break;
    case 'REVOKE_TAB': task = currentTab().then(tab => revokeTab(tab.id!)); break;
    case 'EVALUATE': task = evaluate(); break;
    case 'START': task = debugActive().then(active => { if (active) throw new Error('Finish the debug preview before monitoring.'); }).then(currentTab).then(tab => requireAllowed(tab.id!)).then(requireModelReady).then(() => chrome.storage.local.set({ monitoring: true })).then(reschedule).then(evaluate); break;
    case 'STOP': task = chrome.storage.local.set({ monitoring: false }).then(reschedule); break;
    case 'POP_SEEN': task = popSeen(message.tabId); break;
    case 'SET_HIGHLIGHTS': task = chrome.storage.local.set({ highlightEnabled: !!message.enabled }).then(refreshAllowedHighlights); break;
    case 'MARK_ALL_READ': task = markAllRead(); break;
    case 'RESCHEDULE': task = reschedule(); break;
    default: return;
  }
  task.then(value => respond({ ok: true, value })).catch(error => respond({ error: error instanceof Error ? error.message : 'Could not update monitoring.' }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) {
    void chrome.storage.local.get('monitoring').then(({ monitoring }) => { if (monitoring) return evaluate(); });
  }
});
chrome.runtime.onStartup.addListener(() => { void reschedule(); });
chrome.runtime.onInstalled.addListener(() => { void reschedule(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.seenMessages || changes.highlightEnabled)) void refreshAllowedHighlights();
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status === 'complete') void tabAllowance(id).then(allowed => { if (allowed) return refreshHighlights(id); });
});
