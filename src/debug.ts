import { loadConfig } from './shared';
import { captureSnapshot } from './snapshot';
import { requireAllowed } from './tabs';
import { identifyMessages, unreadBatch } from './seen';
import { categorize, matchRules } from './decide';
import { debugStages } from './debug-types';
import type { DebugRun } from './debug-types';
import type { ModelTrace } from './model';
import type { Message } from './shared';

export async function debugActive() {
  const { debugRun } = await chrome.storage.session.get('debugRun');
  return !!debugRun && !debugRun.finished;
}
export async function startDebug(tabId: number, includeSeen: boolean) {
  const allowance = await requireAllowed(tabId);
  // A real alarm cannot advance a debug session or race its paused stages.
  await chrome.storage.local.set({ monitoring: false });
  await chrome.alarms.clear('jda-evaluate');
  const run: DebugRun = { id: crypto.randomUUID(), tabId, token: allowance.token, startedAt: new Date().toISOString(),
    includeSeen, config: await loadConfig(), next: 0, finished: false, traces: [], traceCount: 0,
    steps: debugStages.map(name => ({ name, status: 'pending' })),
  };
  await chrome.storage.session.set({ debugRun: run });
  return run;
}
export async function clearDebug() { await chrome.storage.session.remove('debugRun'); }
export async function finishDebug() {
  const { debugRun } = await chrome.storage.session.get('debugRun');
  if (debugRun) { debugRun.finished = true; await chrome.storage.session.set({ debugRun }); }
}
export async function nextDebugStep() {
  const { debugRun } = await chrome.storage.session.get('debugRun');
  const run = debugRun as DebugRun | undefined;
  if (!run || run.finished) throw new Error('Start a new debug run first.');
  const step = run.steps[run.next];
  if (!step) return run;
  const checkAccess = () => requireAllowed(run.tabId, run.token);
  const save = () => chrome.storage.session.set({ debugRun: run });
  const trace = async (item: ModelTrace) => {
    run.traceCount++;
    run.traces.push({ ...item, raw: item.raw?.slice(0, 32000) });
    run.traces = run.traces.slice(-40);
    await save();
  };
  const started = performance.now(); step.status = 'running'; delete step.error;
  await save();
  try {
    await checkAccess();
    if (run.next === 0) {
      step.input = { tabId: run.tabId, selectors: ['.message-text', '.message-body[data-message-id]'] };
      const [capture] = await chrome.scripting.executeScript({ target: { tabId: run.tabId }, func: captureSnapshot });
      if (!capture.result) throw new Error('Could not capture the target tab.');
      run.snapshot = { ...capture.result, text: capture.result.text.slice(0, 16000) };
      run.documentId = capture.documentId;
      step.output = run.snapshot;
    } else if (run.next === 1) {
      const { seenMessages = {} } = await chrome.storage.local.get('seenMessages');
      const items = await identifyMessages(run.snapshot!.url, run.snapshot!.messages);
      const selected = unreadBatch(items, run.includeSeen ? {} : seenMessages);
      run.selected = { ...run.snapshot!, messages: selected.map(item => item.message) };
      step.input = { includeSeen: run.includeSeen, captured: items.length };
      step.output = { selected: run.selected.messages, seen: items.filter(item => !!seenMessages[item.key]).map(item => ({ ...item.message, record: seenMessages[item.key] })), skipped: items.length - selected.length };
    } else if (run.next === 2) {
      step.input = run.selected!.messages;
      run.classified = await categorize(run.selected!, checkAccess, trace);
      step.output = run.classified;
    } else if (run.next === 3) {
      step.input = { categorized: run.classified, rules: run.config.rules };
      run.result = await matchRules(run.config, run.selected!, run.classified!, checkAccess, trace);
      step.output = run.result;
    } else {
      const candidates = (run.result?.queryResults ?? []).filter(item => item.action === 'approve');
      const { approvalReceipts = {}, seenMessages = {} } = await chrome.storage.local.get(['approvalReceipts', 'seenMessages']);
      const identities = await identifyMessages(run.snapshot!.url, candidates);
      const [inspection] = await chrome.scripting.executeScript({ target: { tabId: run.tabId, documentIds: [run.documentId!] }, func: inspectReplyTargets, args: [candidates] });
      step.input = { candidates, dryRun: true };
      step.output = await Promise.all(candidates.map(async (item, index) => {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${run.snapshot!.url}|${item.id}`));
        const key = Array.from(new Uint8Array(hash)).map(n => n.toString(16).padStart(2, '0')).join('');
        return { ...item, target: inspection.result?.[index], alreadySeen: !!seenMessages[identities[index].key], receipt: approvalReceipts[key] ?? null,
          note: 'Preview only. Reply and Send were not clicked. Seen state and receipts were not changed.' };
      }));
      run.finished = true;
    }
    step.status = 'done'; run.next++;
  } catch (error) {
    step.status = 'error'; step.error = error instanceof Error ? error.message : 'Debug stage failed.';
  }
  step.elapsedMs = Math.round(performance.now() - started);
  await save();
  return run;
}
/** Read-only probe: never clicks Reply, edits a draft, or sends a message. */
function inspectReplyTargets(messages: Message[]) {
  return messages.map(message => {
    const body = message.id ? document.querySelector(`.message-body[data-message-id="${CSS.escape(message.id)}"]`) : null;
    const text = body?.querySelector<HTMLElement>('.message-text')?.innerText.trim();
    const reply = body?.querySelector<HTMLButtonElement>('button[aria-label="Reply"]');
    return { id: message.id, found: !!body, unchanged: text === message.text, replyButton: !!reply, replyEnabled: !!reply && !reply.disabled };
  });
}
