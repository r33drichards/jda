import type { Message } from './shared';

/** Serialized into an allowed tab; decorations never change message text. */
export async function applyHighlights(items: (Message & { seen: boolean })[], token: string) {
  const access = await chrome.runtime.sendMessage({ type: 'CHECK_TAB_ALLOWANCE', token });
  const { highlightEnabled = true } = await chrome.storage.local.get('highlightEnabled');
  if (!access?.allowed || !highlightEnabled) return;
  const host = globalThis as typeof globalThis & { __jdaObserver?: MutationObserver; __jdaTimer?: ReturnType<typeof setTimeout> };
  host.__jdaObserver?.disconnect(); clearTimeout(host.__jdaTimer);
  document.querySelectorAll('[data-jda-read]').forEach(el => el.removeAttribute('data-jda-read'));
  let style = document.getElementById('jda-read-style');
  if (!style) {
    style = document.createElement('style'); style.id = 'jda-read-style';
    style.textContent = `[data-jda-read]{outline-offset:-2px}[data-jda-read="read"]{outline:1px dashed #78908b}[data-jda-read="unread"]{outline:2px solid #438cff}`;
    document.head.append(style);
  }
  const texts = document.querySelectorAll<HTMLElement>('.message-text');
  const bodies = new Map<Element, boolean>();
  for (const item of items) {
    const body = item.id ? document.querySelector(`.message-body[data-message-id="${CSS.escape(item.id)}"]`) : texts[item.index]?.closest('.message-body');
    const text = body?.querySelector<HTMLElement>('.message-text')?.innerText.trim().slice(0, 4000);
    if (body && text === item.text) bodies.set(body, (bodies.get(body) ?? true) && item.seen);
  }
  for (const [body, seen] of bodies) body.setAttribute('data-jda-read', seen ? 'read' : 'unread');
  host.__jdaObserver = new MutationObserver(records => {
    const relevant = records.some(record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      return element?.closest('.message-body,.message-text') || Array.from(record.addedNodes).some(node => node instanceof Element && (node.matches('.message-body,.message-text') || node.querySelector('.message-body,.message-text')));
    });
    if (!relevant) return;
    clearTimeout(host.__jdaTimer);
    host.__jdaTimer = setTimeout(() => { void chrome.runtime.sendMessage({ type: 'REFRESH_HIGHLIGHTS', token }).catch(() => {}); }, 150);
  });
  host.__jdaObserver.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-message-id'] });
}
export function removeHighlights() {
  const host = globalThis as typeof globalThis & { __jdaObserver?: MutationObserver; __jdaTimer?: ReturnType<typeof setTimeout> };
  host.__jdaObserver?.disconnect(); clearTimeout(host.__jdaTimer);
  document.getElementById('jda-read-style')?.remove();
  document.querySelectorAll('[data-jda-read]').forEach(el => el.removeAttribute('data-jda-read'));
}
