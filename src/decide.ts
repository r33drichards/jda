import { z } from 'zod';
import { decisionSchema, resultSchema } from './shared';
import type { Config, Snapshot, Result } from './shared';
import { query } from './query';
import { promptJson } from './model';
import type { TraceObserver } from './model';

const categories = z.object({ results: z.array(z.object({ index: z.number().int(), category: decisionSchema }).strict()) }).strict();
const permissions = z.object({ matches: z.array(z.object({ key: z.string(), canApprove: z.boolean() }).strict()) }).strict();
function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}
function requireExactKeys(actual: (string | number)[], expected: (string | number)[]) {
  if (actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some(k => !expected.includes(k))) {
    throw new Error('Invalid model output: missing, duplicate, or unexpected result IDs. No approval was authorized.');
  }
}

/** Local two-stage inference. No partial batch is returned if any response is invalid. */
export async function categorize(snapshot: Snapshot, checkAccess: () => Promise<unknown>, observe?: TraceObserver) {
  const messages = query(snapshot);
  const results = messages.map(message => ({ ...message,
    result: { decision: 'other' as z.infer<typeof decisionSchema>, confidence: null, probabilities: null },
    action: 'none' as 'none' | 'approve', matchedRules: [] as string[], reason: '', ruleChecks: [] as { ruleId: string; matched: boolean }[],
  }));
  for (const batch of chunks(messages, 4)) {
    await checkAccess();
    const response = categories.parse(await promptJson({ stage: 'categorize',
      task: 'Categorize each message independently as update, asking for approval, clarifying question, or other. Use other if uncertain. Return each input index exactly once. Do not apply permission rules in this stage.',
      messages: batch,
    }, { type: 'object', additionalProperties: false, required: ['results'], properties: { results: {
      type: 'array', minItems: batch.length, maxItems: batch.length, items: { type: 'object', additionalProperties: false,
        required: ['index', 'category'], properties: { index: { type: 'integer', enum: batch.map(m => m.index) }, category: { type: 'string', enum: decisionSchema.options } },
      },
    } } }, observe));
    requireExactKeys(response.results.map(r => r.index), batch.map(m => m.index));
    for (const answer of response.results) results.find(m => m.index === answer.index)!.result.decision = answer.category;
  }
  for (const item of results) item.reason = item.result.decision === 'asking for approval' ? 'Awaiting approval-rule checks.' : `Category '${item.result.decision}' does not trigger a reply.`;
  return resultSchema.parse({ ...(results[0]?.result ?? { decision: 'other', confidence: null, probabilities: null }), queryResults: results });
}
export async function matchRules(config: Config, snapshot: Snapshot, classified: Result, checkAccess: () => Promise<unknown>, observe?: TraceObserver) {
  const results = resultSchema.parse(classified).queryResults ?? [];
  const rules = config.rules.filter(rule => rule.enabled && rule.canApprove);
  for (const item of results) { item.ruleChecks = []; item.action = 'none'; item.matchedRules = []; }
  for (const message of results.filter(r => r.result.decision === 'asking for approval')) {
    for (const batch of chunks(rules, 4)) {
      await checkAccess();
      const checks = batch.map(rule => ({ key: `${message.index}:${rule.id}`, ruleId: rule.id, rule: rule.description }));
      const response = permissions.parse(await promptJson({ stage: 'approve',
        task: 'For each rule, decide whether it explicitly permits the ENTIRE requested action in this approval message. Missing or ambiguous evidence means canApprove=false. Return each check key exactly once.',
        message: { index: message.index, id: message.id, text: message.text }, checks,
        page: { url: snapshot.url, title: snapshot.title, text: snapshot.text.slice(0, 4000), elements: snapshot.elements.slice(0, 20) },
      }, { type: 'object', additionalProperties: false, required: ['matches'], properties: { matches: {
        type: 'array', minItems: checks.length, maxItems: checks.length, items: { type: 'object', additionalProperties: false,
          required: ['key', 'canApprove'], properties: { key: { type: 'string', enum: checks.map(c => c.key) }, canApprove: { type: 'boolean' } },
        },
      } } }, observe));
      requireExactKeys(response.matches.map(m => m.key), checks.map(c => c.key));
      for (const answer of response.matches) message.ruleChecks!.push({ ruleId: checks.find(c => c.key === answer.key)!.ruleId, matched: answer.canApprove });
      for (const answer of response.matches.filter(m => m.canApprove)) {
        message.action = 'approve'; message.matchedRules.push(checks.find(c => c.key === answer.key)!.ruleId);
      }
    }
  }
  for (const item of results) {
    if (item.result.decision === 'asking for approval') item.reason = !rules.length ? 'No enabled canApprove rules configured.' : item.action === 'approve' ? `Matched approval rule: ${item.matchedRules.join(', ')}.` : 'No approval rule matched.';
  }
  return resultSchema.parse({ ...(results[0]?.result ?? { decision: 'other', confidence: null, probabilities: null }), queryResults: results });
}

export async function decide(config: Config, snapshot: Snapshot, checkAccess: () => Promise<unknown>) {
  return matchRules(config, snapshot, await categorize(snapshot, checkAccess), checkAccess);
}
