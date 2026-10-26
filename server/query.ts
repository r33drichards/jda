import { z } from 'zod';
import { messageSchema } from '../src/shared';
import type { Snapshot } from '../src/shared';

export const queryItemsSchema = z.array(messageSchema).max(30);
export type QueryItem = z.infer<typeof messageSchema>;

/** Messages captured in the browser using .message-text and .message-body. */
export async function query(snapshot: Snapshot): Promise<QueryItem[]> {
  return queryItemsSchema.parse(snapshot.messages ?? []);
}
