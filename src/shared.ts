import { z } from 'zod';

export const decisionSchema = z.enum(['update', 'asking for approval', 'clarifying question', 'other']);
export const configSchema = z.object({
  model: z.string().trim().min(1).max(100),
  intervalSeconds: z.number().int().min(30).max(86400),
  rules: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).max(60),
    description: z.string().trim().min(1).max(2000),
    canApprove: z.boolean().default(false),
    enabled: z.boolean(),
  })).max(30).refine(rules => new Set(rules.map(r => r.id)).size === rules.length, 'Rule IDs must be unique'),
  reply: z.object({ editorSelector: z.string().max(500), sendSelector: z.string().max(500) })
    .default({ editorSelector: 'div.ProseMirror[contenteditable="true"][aria-label="Message"]', sendSelector: 'button[aria-label="Send"]' }),
});
export type Config = z.infer<typeof configSchema>;
export const defaultConfig: Config = {
  model: 'jev-latest', intervalSeconds: 60, rules: [],
  reply: { editorSelector: 'div.ProseMirror[contenteditable="true"][aria-label="Message"]', sendSelector: 'button[aria-label="Send"]' },
};
export const messageSchema = z.object({ index: z.number().int().nonnegative(), id: z.string().max(500).nullable(), text: z.string().max(4000) });
export type Message = z.infer<typeof messageSchema>;
export const snapshotSchema = z.object({
  url: z.string().url().max(2000), title: z.string().max(500), text: z.string().max(16000),
  elements: z.array(z.object({ tag: z.string().max(20), role: z.string().max(100), text: z.string().max(160), type: z.string().max(100) })).max(80),
  messages: z.array(messageSchema).max(30).default([]),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const requestSchema = z.object({ config: configSchema, snapshot: snapshotSchema });
export const classificationSchema = z.object({
  decision: decisionSchema, confidence: z.number().min(0).max(1).nullable(),
  probabilities: z.record(decisionSchema, z.number().min(0).max(1)).nullable(),
});
export const resultSchema = classificationSchema.extend({
  queryResults: z.array(z.object({
    index: z.number().int().nonnegative(), id: z.string().nullable(), text: z.string(), result: classificationSchema,
    action: z.enum(['approve', 'none']), matchedRules: z.array(z.string()),
    replyStatus: z.enum(['sent', 'already handled', 'failed']).optional(), replyError: z.string().optional(),
  })).optional(),
});
export type Result = z.infer<typeof resultSchema>;
export type Latest = { result?: Result; error?: string; notice?: string; url?: string; evaluatedAt: string };
export async function loadConfig(): Promise<Config> {
  const { config } = await chrome.storage.local.get('config');
  return configSchema.parse(config ?? defaultConfig);
}
