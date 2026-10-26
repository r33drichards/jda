import { z } from 'zod';
import { messageSchema } from './shared';
import type { Snapshot } from './shared';

export const queryItemsSchema = z.array(messageSchema).max(30);
export type QueryItem = z.infer<typeof messageSchema>;
export function query(snapshot: Snapshot): QueryItem[] {
  return queryItemsSchema.parse(snapshot.messages ?? []);
}
