import { z } from 'zod';
import type { Snapshot } from '../src/shared';

export const queryItemsSchema = z.array(z.record(z.string(), z.json())).max(30);
export type QueryItem = z.infer<typeof queryItemsSchema>[number];

/** Extract items from the captured DOM summary for batched Jev classification. */
export async function query(snapshot: Snapshot): Promise<QueryItem[]> {
  // TODO: implement page-specific querying and return one JSON object per item.
  // This no-op keeps page classification working until querying is implemented.
  void snapshot;
  return [];
}
