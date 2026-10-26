import { createServer } from 'node:http';
let decision = 'update';
let fail = false;
let failRules = false;
let decisions: Record<string, string> = {};
let ruleDelay = 0;
let holdRules = false;
const releaseRules: (() => void)[] = [];
const requests: unknown[] = [];
function answer(label: string, labels: string[]) {
  const other = labels.length === 2 ? 0.02 : 0.01;
  return { type: 'choice', choice: label, confidence: 0.95,
    probabilities: Object.fromEntries(labels.map(key => [key, key === label ? (labels.length === 2 ? 0.98 : 0.97) : other])),
  };
}
createServer(async (req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  if (req.url?.split('?')[0] === '/fixture') {
    const multiple = new URL(req.url, 'http://localhost').searchParams.has('multi');
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>jda test page</title><h1>Hello world</h1>
      ${Array.from({ length: multiple ? 4 : 1 }, (_, i) => `<div class="message-body" data-message-id="message-${i + 1}"><div class="message-text">${i ? `Message ${i + 1}` : 'Hello world'}</div><button aria-label="Reply">Reply</button></div>`).join('')}
      <input type="password" value="secret-input"><textarea hidden>secret-textarea</textarea>
      <div id="composer" hidden><div class="ProseMirror" contenteditable="true" aria-multiline="true" role="textbox" aria-label="Message"><p><br></p></div><button aria-label="Send" disabled>Send</button></div><div id="sent"></div>
      <script>
        let target;
        document.querySelectorAll('button[aria-label="Reply"]').forEach(button => button.onclick = () => {
          target = button.closest('.message-body').dataset.messageId;
          document.querySelector('#composer').hidden = false;
        });
        document.querySelector('[aria-label="Message"]').addEventListener('input', () => setTimeout(() => { document.querySelector('button[aria-label="Send"]').disabled = false; }, 50));
        document.querySelector('button[aria-label="Send"]').onclick = () => {
          const editor = document.querySelector('[aria-label="Message"]');
          const sent = document.createElement('p'); sent.dataset.messageId = target; sent.textContent = editor.innerText.trim();
          document.querySelector('#sent').append(sent); editor.innerHTML = '<p><br></p>'; document.querySelector('button[aria-label="Send"]').disabled = true; document.querySelector('#composer').hidden = true;
        };
        const secret = 'secret-script';
      </script>`); return;
  }
  if (req.url === '/release-rules') { releaseRules.splice(0).forEach(release => release()); res.end('ok'); return; }
  if (req.url === '/requests') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(requests)); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  if (req.url === '/control') {
    const value = JSON.parse(body); decisions = value.decisions ?? {}; ruleDelay = value.ruleDelay ?? 0; holdRules = value.holdRules ?? false;
    decision = value.decision ?? 'update'; fail = value.fail ?? false; failRules = value.failRules ?? false; requests.length = 0;
    res.end('ok'); return;
  }
  if (req.url === '/v1/systemone') {
    const payload = JSON.parse(body); requests.push(payload);
    res.setHeader('Content-Type', 'application/json');
    if (fail || (failRules && Object.keys(payload.questions)[0]?.startsWith('approve_'))) { res.writeHead(503).end('{"error":"test outage"}'); return; }
    if (Object.keys(payload.questions)[0]?.startsWith('approve_') && holdRules) await new Promise<void>(resolve => releaseRules.push(resolve));
    if (Object.keys(payload.questions)[0]?.startsWith('approve_') && ruleDelay) await new Promise(resolve => setTimeout(resolve, ruleDelay));
    res.end(JSON.stringify({ model: 'jev-test', usage: { input_tokens: 10, output_tokens: 0 },
      answers: Object.fromEntries(Object.keys(payload.questions).map(key => {
        const labels = Object.keys(payload.questions[key].criteria);
        return [key, answer(decisions[key] ?? (key.startsWith('approve_') ? 'no match' : decision), labels)];
      })),
    })); return;
  }
  res.writeHead(404).end();
}).listen(8790, '127.0.0.1');
