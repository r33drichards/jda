import { z } from 'zod';

export const decisionSchema = z.enum(['update', 'asking for approval', 'clarifying question', 'other']);
export const configSchema = z.object({
  model: z.string().trim().min(1).max(100),
  intervalSeconds: z.number().int().min(30).max(86400),
  rules: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).max(60),
    description: z.string().trim().min(1).max(2000),
    decision: decisionSchema,
    enabled: z.boolean(),
  })).max(30).refine(rules => new Set(rules.map(r => r.id)).size === rules.length, 'Rule IDs must be unique'),
});
export type Config = z.infer<typeof configSchema>;
export const defaultConfig: Config = {
  model: 'jev-latest', intervalSeconds: 60,
  rules: [
    { id: 'approval', description: 'The main content asks someone to approve, authorize, or confirm a proposed action.', decision: 'asking for approval', enabled: true },
    { id: 'clarify', description: 'The main content asks for missing information or clarification needed to proceed.', decision: 'clarifying question', enabled: true },
    { id: 'update', description: 'The main content reports progress, status, or completed work without requesting a response.', decision: 'update', enabled: true },
  ],
};
export const snapshotSchema = z.object({
  url: z.string().url().max(2000), title: z.string().max(500),
  text: z.string().max(16000),
  elements: z.array(z.object({ tag: z.string().max(20), role: z.string().max(100), text: z.string().max(160), type: z.string().max(100) })).max(80),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const requestSchema = z.object({ config: configSchema, snapshot: snapshotSchema });
export const resultSchema = z.object({
  decision: decisionSchema,
  confidence: z.number().min(0).max(1).nullable(),
  probabilities: z.record(decisionSchema, z.number().min(0).max(1)).nullable(),
});
export type Result = z.infer<typeof resultSchema>;
export type Latest = { result?: Result; error?: string; url?: string; evaluatedAt: string };
export async function loadConfig(): Promise<Config> {
  const { config } = await chrome.storage.local.get('config');
  return configSchema.parse(config ?? defaultConfig);
}
