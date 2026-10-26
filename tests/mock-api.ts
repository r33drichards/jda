import { createServer } from 'node:http';
let decision = 'update';
let fail = false;
let decisions: Record<string, string> = {};
function answer(label: string) {
  return { type: 'choice', choice: label, confidence: 0.95, probabilities: {
    update: label === 'update' ? 0.97 : 0.01,
    'asking for approval': label === 'asking for approval' ? 0.97 : 0.01,
    'clarifying question': label === 'clarifying question' ? 0.97 : 0.01,
    other: label === 'other' ? 0.97 : 0.01,
  } };
}
const requests: unknown[] = [];
createServer(async (req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  if (req.url?.split('?')[0] === '/fixture') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>jda test page</title><h1>Hello world</h1><label>Password<input type="password" value="secret-input"></label><textarea>secret-textarea</textarea><button>Submit</button><script>const secret = "secret-script";</script>'); return;
  }
  if (req.url === '/requests') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(requests)); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url === '/control') {
    const value = JSON.parse(body);
    decisions = value.decisions ?? {};
    decision = value.decision ?? 'update'; fail = value.fail ?? false; requests.length = 0;
    res.end('ok'); return;
  }
  if (req.url === '/v1/systemone') {
    const payload = JSON.parse(body);
    requests.push(payload);
    res.setHeader('Content-Type', 'application/json');
    if (fail) { res.writeHead(503).end('{"error":"test outage"}'); return; }
    res.end(JSON.stringify({ model: 'jev-test', usage: { input_tokens: 10, output_tokens: 0 },
      answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, answer(decisions[key] ?? decision)])),
    })); return;
  }
  res.writeHead(404).end();
}).listen(8790, '127.0.0.1');
