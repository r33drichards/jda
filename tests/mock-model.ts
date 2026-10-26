import type { Worker } from '@playwright/test';
import type { ModelAvailability } from '../src/model';

export type MockControl = { availability?: ModelAvailability; decision?: string; decisions?: Record<string, string>; fail?: boolean; failRules?: boolean; holdRules?: boolean; ruleDelay?: number; malformed?: 'json' | 'category' | 'missing' | 'duplicate' | 'rule'; contextTooSmall?: boolean };
export type ModelCall = { input: { stage: string; messages?: { index: number; id: string | null; text: string }[]; message?: { index: number; id: string | null; text: string }; checks?: { key: string; ruleId: string; rule: string }[]; page?: { url: string } }; schema: object };

// This function is serialized into extension documents and the service worker.
export function installMockModel() {
  if (location.protocol !== 'chrome-extension:') return;
  const read = async () => (await chrome.storage.session.get('__testModel')).__testModel as MockControl ?? {};
  Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
    availability: async () => (await read()).availability ?? 'available',
    create: async (options: { monitor?: (target: EventTarget) => void }) => {
      const state = await read();
      if (state.availability === 'unavailable') throw new Error('Model unavailable');
      if (state.availability === 'downloadable' || state.availability === 'downloading') {
        const monitor = new EventTarget(); options.monitor?.(monitor);
        monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 1, total: 1 }));
        await chrome.storage.session.set({ __testModel: { ...state, availability: 'available' } });
      }
      return {
        contextWindow: 32000, contextUsage: 0,
        measureContextUsage: async () => (await read()).contextTooSmall ? 50000 : 100,
        destroy() {},
        prompt: async (text: string, options: { responseConstraint: object; signal: AbortSignal }) => {
          const input = JSON.parse(text) as ModelCall['input'];
          const { __testCalls = [] } = await chrome.storage.session.get('__testCalls');
          await chrome.storage.session.set({ __testCalls: [...__testCalls, { input, schema: options.responseConstraint }] });
          let control = await read();
          if (control.fail || (input.stage === 'approve' && control.failRules)) throw new Error('Test model inference failed');
          while (input.stage === 'approve' && control.holdRules) {
            if (options.signal.aborted) throw new Error('Prompt aborted');
            await new Promise(resolve => setTimeout(resolve, 20)); control = await read();
          }
          if (input.stage === 'approve' && control.ruleDelay) await new Promise(resolve => setTimeout(resolve, control.ruleDelay));
          if (control.malformed === 'json') return 'not JSON';
          if (input.stage === 'categorize') {
            const results = input.messages!.map(m => ({ index: m.index, category: control.decisions?.[`query_${m.index}`] ?? control.decision ?? 'update' }));
            if (control.malformed === 'category') results[0].category = 'unknown';
            if (control.malformed === 'missing') results.pop();
            if (control.malformed === 'duplicate') results.push(results[0]);
            return JSON.stringify({ results });
          }
          return JSON.stringify({ matches: input.checks!.map(check => ({ key: check.key,
            canApprove: control.malformed === 'rule' ? 'yes' : control.decisions?.[check.key] === 'can approve',
          })) });
        },
      };
    },
  } });
}
export class MockModel {
  constructor(private worker: Worker) {}
  async configure(control: MockControl) {
    await this.worker.evaluate(control => chrome.storage.session.set({ __testModel: control, __testCalls: [] }), control);
  }
  async calls(): Promise<ModelCall[]> { return this.worker.evaluate(async () => (await chrome.storage.session.get('__testCalls')).__testCalls ?? []); }
  async releaseRules() { await this.worker.evaluate(async () => {
    const { __testModel = {} } = await chrome.storage.session.get('__testModel');
    await chrome.storage.session.set({ __testModel: { ...__testModel, holdRules: false } });
  }); }
}
