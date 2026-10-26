import type { Config, Result, Snapshot } from './shared';
import type { ModelTrace } from './model';
export const debugStages = ['Query DOM', 'Filter seen', 'Categorize', 'Match approval rules', 'Preview replies'] as const;
export type DebugStep = { name: string; status: 'pending' | 'running' | 'done' | 'error'; input?: unknown; output?: unknown; error?: string; elapsedMs?: number };
export type DebugRun = {
  id: string; tabId: number; token: string; startedAt: string; includeSeen: boolean; config: Config;
  next: number; finished: boolean; steps: DebugStep[]; traces: ModelTrace[]; traceCount: number;
  documentId?: string; snapshot?: Snapshot; selected?: Snapshot; classified?: Result; result?: Result;
};
