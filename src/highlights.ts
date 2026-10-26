import { captureSnapshot } from './snapshot';
import { identifyMessages } from './seen';
import { requireAllowed, tabAllowance } from './tabs';
import { applyHighlights, removeHighlights } from './highlight-dom';

const generations = new Map<number, number>();

export async function refreshHighlights(tabId: number, token?: string) {
  const generation = (generations.get(tabId) ?? 0) + 1; generations.set(tabId, generation);
  const access = await requireAllowed(tabId, token);
  const { highlightEnabled = true, seenMessages = {} } = await chrome.storage.local.get(['highlightEnabled', 'seenMessages']);
  if (generations.get(tabId) !== generation) return;
  if (!highlightEnabled) {
    await chrome.scripting.executeScript({ target: { tabId }, func: removeHighlights }); return;
  }
  const [capture] = await chrome.scripting.executeScript({ target: { tabId }, func: captureSnapshot });
  if (!capture.result) return;
  const items = await identifyMessages(capture.result.url, capture.result.messages);
  await requireAllowed(tabId, access.token);
  if (generations.get(tabId) !== generation) return;
  await chrome.scripting.executeScript({ target: { tabId, documentIds: [capture.documentId!] }, func: applyHighlights,
    args: [items.map(({ key, message }) => ({ ...message, state: seenMessages[key]?.state === 'processing' ? 'processing' as const : seenMessages[key] ? 'read' as const : 'unread' as const })), access.token],
  });
}
export async function refreshAllowedHighlights() {
  const session = await chrome.storage.session.get(null);
  await Promise.all(Object.keys(session).filter(k => k.startsWith('allowedTab:')).map(async key => {
    const id = Number(key.slice('allowedTab:'.length));
    if (await tabAllowance(id)) await refreshHighlights(id).catch(() => {});
  }));
}
