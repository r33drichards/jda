type TabAllowance = { origin: string; token: string };
const keyFor = (id: number) => `allowedTab:${id}`;

export async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('Open a web page first.');
  return tab;
}

export async function tabAllowance(tabId: number, token?: string): Promise<TabAllowance | undefined> {
  const key = keyFor(tabId);
  const stored = (await chrome.storage.session.get(key))[key] as TabAllowance | undefined;
  if (!stored || (token && token !== stored.token)) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && /^https?:/.test(tab.url) && new URL(tab.url).origin === stored.origin) return stored;
  } catch { /* Closed tabs have no allowance. */ }
}

export async function requireAllowed(tabId: number, token?: string) {
  const allowance = await tabAllowance(tabId, token);
  if (!allowance) throw new Error('This tab is inactive. Click Allow this tab first.');
  return allowance;
}

export async function allowCurrentTab(expectedId: number) {
  const tab = await currentTab();
  if (tab.id !== expectedId) throw new Error('Active tab changed; click Allow this tab again.');
  if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Only HTTP(S) tabs can be allowed.');
  const site = new URL(tab.url);
  const origins = [`${site.protocol}//${site.hostname}/*`];
  if (!(await chrome.permissions.contains({ origins }))) throw new Error('Grant site access before allowing this tab.');
  await chrome.storage.session.set({ [keyFor(tab.id!)]: { origin: site.origin, token: crypto.randomUUID() } });
}

export async function revokeTab(tabId: number) {
  await chrome.storage.session.remove(keyFor(tabId));
}

chrome.tabs.onRemoved.addListener(id => { void revokeTab(id); });
chrome.tabs.onReplaced.addListener((_added, removed) => { void revokeTab(removed); });
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url || change.status) {
    void (async () => {
      const key = keyFor(id);
      const before = (await chrome.storage.session.get(key))[key] as TabAllowance | undefined;
      if (!before || await tabAllowance(id, before.token)) return;
      const now = (await chrome.storage.session.get(key))[key] as TabAllowance | undefined;
      if (now?.token === before.token) await revokeTab(id);
    })();
  }
});
