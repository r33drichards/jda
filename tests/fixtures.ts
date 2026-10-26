import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { installMockModel, MockModel } from './mock-model';
export const test = base.extend<{ context: BrowserContext; extensionId: string; model: MockModel }>({
  context: async ({ headless }, provide) => {
    const extension = path.resolve('dist');
    // Grant only the fixture origin in the disposable test build; production has no default host grants.
    const { mkdtemp, cp, readFile, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const testRoot = await mkdtemp(path.join(tmpdir(), 'jda-test-'));
    const testExtension = path.join(testRoot, 'extension');
    await cp(extension, testExtension, { recursive: true });
    const manifestPath = path.join(testExtension, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions = ['http://127.0.0.1/*'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless, timeout: 30000,
      args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
    });
    await context.addInitScript(installMockModel);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(installMockModel);
    await provide(context);
    await context.close();
    await rm(testRoot, { recursive: true, force: true });
  },
  model: async ({ context }, provide) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await provide(new MockModel(worker));
  },
  extensionId: async ({ context }, provide) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await provide(new URL(worker.url()).host);
  },
});
export { expect } from '@playwright/test';
