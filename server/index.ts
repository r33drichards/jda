import { createServer } from 'node:http';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { requestSchema } from '../src/shared';
import { query } from './query';
import { decide } from './decide';

const client = new TypeSafeClient({ timeout: 15000, retry: { maxRetries: 0 }, compression: false });
const server = createServer(async (req, res) => {
  // Only extension-origin requests or local non-browser clients may reach Jev.
  const origin = req.headers.origin;
  if (req.headers.host !== '127.0.0.1:8787' || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
    res.writeHead(403).end(); return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'GET' && req.url === '/health') { res.end('{"ok":true}'); return; }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204).end(); return;
  }
  if (req.method !== 'POST' || req.url !== '/decide') { res.writeHead(404).end(); return; }
  if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 100000) { res.writeHead(413).end(); return; }
    }
    let input: unknown;
    try { input = JSON.parse(body); }
    catch { res.writeHead(400).end('{"error":"Invalid JSON"}'); return; }
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) { res.writeHead(400).end('{"error":"Invalid configuration or page snapshot"}'); return; }
    const { config, snapshot } = parsed.data;
    const items = await query(snapshot);
    const result = await decide(client, config, snapshot, items);
    res.end(JSON.stringify(result));
  } catch {
    // Never return SDK errors that might contain credentials or page contents.
    res.writeHead(502).end('{"error":"Decision failed. Check API credentials and upstream availability."}');
  }
});
server.requestTimeout = 20000;
server.listen(8787, '127.0.0.1', () => console.log('jda decision service: http://127.0.0.1:8787'));
