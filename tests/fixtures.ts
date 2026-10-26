import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({ headless }, provide) => {
    const extension = path.resolve('dist');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await provide(context);
    await context.close();
  },
  extensionId: async ({ context }, provide) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await provide(new URL(worker.url()).host);
  },
});
export { expect } from '@playwright/test';
