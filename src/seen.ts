import type { Message } from './shared';

export type SeenMessages = Record<string, { state: 'processing' | 'processed' | 'read'; at: string }>;

/** Ignore DOM position: moving an unchanged message must not make it unread. */
export async function identifyMessages(url: string, messages: Message[]) {
  return Promise.all(messages.map(async message => {
    const bytes = new TextEncoder().encode(JSON.stringify([url, message.id, message.text]));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const key = Array.from(new Uint8Array(hash)).map(n => n.toString(16).padStart(2, '0')).join('');
    return { key, message };
  }));
}

export function unreadBatch(items: Awaited<ReturnType<typeof identifyMessages>>, seen: SeenMessages) {
  const unique = new Set<string>();
  let remaining = 16000;
  return items.filter(({ key, message }) => {
    if (seen[key] || unique.has(key) || unique.size >= 30 || message.text.length > remaining) return false;
    unique.add(key); remaining -= message.text.length;
    return true;
  });
}
