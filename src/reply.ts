import type { Message } from './shared';

/** Self-contained, serialized into the exact document that was evaluated. */
export async function replyApprove(message: Message, selectors: { editorSelector: string; sendSelector: string }) {
  if (!message.id) throw new Error('Automatic replies require a stable data-message-id.');
  if (!selectors.editorSelector || !selectors.sendSelector) throw new Error('Configure reply.editorSelector and reply.sendSelector in Settings.');
  const body = document.querySelector<HTMLElement>(`.message-body[data-message-id="${CSS.escape(message.id)}"]`);
  const text = body?.querySelector<HTMLElement>('.message-text')?.innerText.trim();
  if (!body || text !== message.text) throw new Error('Message changed or disappeared; no reply sent.');
  body.scrollIntoView({ block: 'center' });
  body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const reply = body.querySelector<HTMLButtonElement>('button[aria-label="Reply"]');
  if (!reply || reply.disabled) throw new Error('Reply button unavailable.');
  reply.click();
  async function waitFor<T extends HTMLElement>(selector: string, enabled = false): Promise<T> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const matches = Array.from(document.querySelectorAll<T>(selector)).filter(el => el.getClientRects().length > 0);
      if (matches.length > 1) throw new Error(`Reply selector is ambiguous: ${selector}`);
      if (matches.length === 1 && (!enabled || (!(matches[0] instanceof HTMLButtonElement && matches[0].disabled) && matches[0].getAttribute('aria-disabled') !== 'true'))) return matches[0];
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Reply element not found: ${selector}`);
  }
  const editor = await waitFor<HTMLElement>(selectors.editorSelector);
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    if (editor.value.trim()) throw new Error('Reply editor already contains a draft.');
    const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(editor, 'approve');
  } else if (editor.isContentEditable) {
    if (editor.innerText.trim()) throw new Error('Reply editor already contains a draft.');
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange(); range.selectNodeContents(editor);
    selection?.removeAllRanges(); selection?.addRange(range);
    // Native editing lets ProseMirror observe a normal contenteditable mutation.
    if (!document.execCommand('insertText', false, 'approve')) editor.textContent = 'approve';
  } else throw new Error('Reply editor must be an input, textarea, or contenteditable.');
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'approve' }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  const send = await waitFor<HTMLElement>(selectors.sendSelector, true);
  if ((send instanceof HTMLButtonElement && send.disabled) || send.getAttribute('aria-disabled') === 'true') throw new Error('Send button is disabled.');
  if (body.querySelector<HTMLElement>('.message-text')?.innerText.trim() !== message.text) throw new Error('Message changed before send.');
  const replyText = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement ? editor.value : editor.innerText;
  if (replyText.trim() !== 'approve') throw new Error('Reply draft changed before send.');
  send.click();
  return 'sent' as const;
}
