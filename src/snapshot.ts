// Self-contained: Chrome serializes this function into the active tab.
export function captureSnapshot() {
  const userMessages = '.message-row.self,[data-message-author-role="user"]';
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('script,style,noscript,template,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"]').forEach(el => el.remove());
  copy.querySelectorAll(userMessages).forEach(el => el.remove());
  const url = new URL(location.href);
  url.search = ''; url.hash = '';
  const messages = Array.from(document.querySelectorAll<HTMLElement>('.message-text')).flatMap((el, index) => {
    if (el.closest(userMessages)) return [];
    const body = el.closest<HTMLElement>('.message-body');
    const text = el.innerText.trim().slice(0, 4000);
    return [{ index, id: body?.dataset.messageId ?? null, text }];
  });
  return {
    messages,
    url: url.toString().slice(0, 2000),
    title: document.title.slice(0, 500),
    text: (copy.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 16000),
    elements: Array.from(document.querySelectorAll('a,button,input,select,textarea,[role]'))
      .filter(el => el.getClientRects().length > 0 && !el.closest('[contenteditable]') && !el.closest(userMessages))
      .slice(0, 80).map(el => ({
        tag: el.tagName.toLowerCase(), role: (el.getAttribute('role') ?? '').slice(0, 100),
        text: (el.getAttribute('aria-label') ?? (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? '' : el.textContent) ?? '').trim().slice(0, 160),
        type: (el.getAttribute('type') ?? '').slice(0, 100),
      })),
  };
}
